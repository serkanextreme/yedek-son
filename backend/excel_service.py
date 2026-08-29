"""Excel automation service for Sertex — Faz 3.

Provides:
- `analyze_workbook`: schema + numeric stats + LLM insight for every sheet.
- `generate_formula`: LLM writes a valid Excel formula for a natural-language task.
- `answer_data_question`: LLM answers a Turkish question grounded in the sheet data
  (schema + head sample + tail sample), returning both the answer and the
  reasoning + the pandas operation used (if any).
- `build_pivot_xlsx`: LLM parses a task into pivot params → pandas.pivot_table →
  returns an xlsx bytes buffer + preview + shape.
- `suggest_charts`: LLM proposes 2-4 chart ideas given the schema.

All heavy LLM work uses the Emergent Universal Key via LlmChat.
"""
from __future__ import annotations

import io
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger(__name__)

# ---- Config --------------------------------------------------------------
MAX_ROWS_PER_SHEET = 50_000        # hard cap; larger sheets are sampled
SAMPLE_HEAD = 15                   # rows included at head of LLM prompt
SAMPLE_TAIL = 5                    # rows included at tail
PIVOT_MAX_ROWS = 5_000             # cap rows fed into pivot_table
PREVIEW_ROWS = 10                  # rows returned in pivot/query preview


# ---- Parsing -------------------------------------------------------------
def load_workbook(data: bytes) -> Dict[str, pd.DataFrame]:
    """Read every sheet into a DataFrame. Returns {sheet_name: DataFrame}."""
    bio = io.BytesIO(data)
    try:
        sheets = pd.read_excel(bio, sheet_name=None, engine="openpyxl")
    except Exception as e:
        raise ValueError(f"Excel dosyası okunamadı: {e}") from e
    # Clip huge sheets
    for name, df in list(sheets.items()):
        if len(df) > MAX_ROWS_PER_SHEET:
            sheets[name] = df.head(MAX_ROWS_PER_SHEET)
    return sheets


def _series_stats(s: pd.Series) -> Dict[str, Any]:
    """Numeric/text summary for a single column."""
    non_null = s.dropna()
    total = int(len(s))
    nulls = int(s.isna().sum())
    unique = int(non_null.nunique()) if total else 0
    dtype = str(s.dtype)
    sample_vals = [
        None if pd.isna(v) else (v.item() if hasattr(v, "item") else v)
        for v in non_null.head(3).tolist()
    ]
    info: Dict[str, Any] = {
        "dtype": dtype,
        "count": total,
        "nulls": nulls,
        "unique": unique,
        "sample_values": sample_vals,
    }
    if pd.api.types.is_numeric_dtype(s) and not non_null.empty:
        info.update({
            "min": float(non_null.min()),
            "max": float(non_null.max()),
            "mean": float(non_null.mean()),
            "median": float(non_null.median()),
            "std": float(non_null.std()) if len(non_null) > 1 else 0.0,
            "sum": float(non_null.sum()),
        })
    elif pd.api.types.is_datetime64_any_dtype(s) and not non_null.empty:
        info.update({
            "min": non_null.min().isoformat(),
            "max": non_null.max().isoformat(),
        })
    return info


def sheet_schema(name: str, df: pd.DataFrame) -> Dict[str, Any]:
    return {
        "sheet": name,
        "rows": int(len(df)),
        "cols": int(len(df.columns)),
        "columns": [
            {"name": str(c), **_series_stats(df[c])} for c in df.columns
        ],
    }


def workbook_summary(sheets: Dict[str, pd.DataFrame]) -> List[Dict[str, Any]]:
    return [sheet_schema(name, df) for name, df in sheets.items()]


# ---- LLM helpers ---------------------------------------------------------
def _llm(session_id: str, system: str) -> LlmChat:
    import os
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    return LlmChat(
        api_key=key, session_id=session_id, system_message=system,
    ).with_model("openai", "gpt-5.2")


def _parse_json_block(text: str) -> Optional[Dict[str, Any]]:
    """Extract a JSON object from the LLM reply — tolerant of code fences."""
    text = (text or "").strip()
    if not text:
        return None
    # Strip ```json ... ``` or ``` ... ```
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    payload = m.group(1) if m else text
    # Fallback: grab from first { to last }
    if not m:
        i, j = payload.find("{"), payload.rfind("}")
        if i != -1 and j != -1 and j > i:
            payload = payload[i : j + 1]
    try:
        return json.loads(payload)
    except json.JSONDecodeError as e:
        logger.warning("JSON parse failed: %s", e)
        return None


def _sheet_snapshot(df: pd.DataFrame) -> str:
    """Compact text snapshot of a sheet for LLM prompts."""
    head = df.head(SAMPLE_HEAD).to_csv(index=False, sep="|")
    tail = ""
    if len(df) > SAMPLE_HEAD + SAMPLE_TAIL:
        tail = f"\n[... {len(df) - SAMPLE_HEAD - SAMPLE_TAIL} satır atlandı ...]\n"
        tail += df.tail(SAMPLE_TAIL).to_csv(index=False, sep="|", header=False)
    return head + tail


# ---- 1) Auto analysis ----------------------------------------------------
async def analyze_workbook(sheets: Dict[str, pd.DataFrame], filename: str) -> Dict[str, Any]:
    """Return a structured schema + Turkish LLM-generated insight per workbook."""
    schema = workbook_summary(sheets)
    # Build a compact schema string for the LLM
    schema_text_parts = []
    for s in schema:
        cols = ", ".join(
            f"{c['name']} ({c['dtype']}, boş={c['nulls']}, örnek={c['sample_values']})"
            for c in s["columns"]
        )
        schema_text_parts.append(
            f"Sayfa '{s['sheet']}' — {s['rows']} satır × {s['cols']} sütun\nSütunlar: {cols}"
        )
    schema_text = "\n\n".join(schema_text_parts)

    # First sheet snapshot for grounding
    first_name = next(iter(sheets))
    snap = _sheet_snapshot(sheets[first_name])

    system = (
        "Sen bir veri analisti Türk asistanısın. Kullanıcı Excel dosyası "
        "yükledi ve otomatik analiz istiyor. Kısa, aksiyona dönüştürülebilir "
        "Türkçe içgörüler ver. Sayısal detaylar için gerçek verileri kullan, "
        "uydurma yapma. Şu formatı KULLAN:\n"
        "**Dosya:** kısa özet.\n"
        "**Sayfalar:** her sayfada ne var (1-2 cümle).\n"
        "**Öne Çıkanlar:** 3-6 madde (ilginç sayısal bulgular, aykırı değerler, "
        "boş oranlar, veri kalitesi notları).\n"
        "**Öneri Analizler:** 3-5 madde (bu veriyle hangi soruları sorabilir? "
        "hangi grafiği çıkarabilir? hangi pivotları oluşturabilir?).\n"
        "Emoji kullanma."
    )
    chat = _llm(f"excel-analyze-{uuid.uuid4()}", system)
    msg = UserMessage(text=(
        f"Dosya: {filename}\n\n"
        f"ŞEMA:\n{schema_text}\n\n"
        f"İLK SAYFA ÖRNEK VERİ (pipe-ayrık, ilk {SAMPLE_HEAD} + son {SAMPLE_TAIL}):\n"
        f"```\n{snap}\n```"
    ))
    try:
        insight = await chat.send_message(msg)
    except Exception as e:
        logger.exception("Analyze LLM call failed")
        insight = f"LLM analizi başarısız oldu: {str(e)[:200]}"

    return {"schema": schema, "insight": str(insight).strip()}


# ---- 2) Formula generator ------------------------------------------------
async def generate_formula(
    sheets: Dict[str, pd.DataFrame],
    task: str,
    filename: str,
    target_sheet: Optional[str] = None,
) -> Dict[str, Any]:
    """Ask the LLM to write an Excel formula solving `task`."""
    if target_sheet and target_sheet in sheets:
        chosen = target_sheet
    else:
        chosen = next(iter(sheets))
    df = sheets[chosen]
    schema = sheet_schema(chosen, df)
    cols_desc = ", ".join(
        f"{i+1}) '{c['name']}' [{c['dtype']}]" for i, c in enumerate(schema["columns"])
    )
    # Excel column letters mapping (A..Z, AA..)
    letters = []
    for i in range(len(df.columns)):
        n = i
        s = ""
        while True:
            s = chr(ord("A") + (n % 26)) + s
            n = n // 26 - 1
            if n < 0:
                break
        letters.append(s)
    letter_map = ", ".join(f"{letters[i]}={df.columns[i]}" for i in range(len(df.columns)))
    first_row_idx = 2  # assume row 1 is header
    last_row_idx = len(df) + 1

    system = (
        "Sen bir Excel formül uzmanısın. Kullanıcının doğal dilde belirttiği "
        "görevi çözecek TEK bir geçerli Excel formülü üret. JSON formatında "
        "cevapla — düz metin veya markdown döndürme. Şema:\n"
        "{\n"
        '  "formula": "=SUM(B2:B100)",\n'
        '  "target_cell": "D2",\n'
        '  "sheet": "Sayfa1",\n'
        '  "explanation": "Kısa Türkçe açıklama",\n'
        '  "confidence": 0.0-1.0\n'
        "}\n"
        "Formül Excel'de doğrudan çalışabilir olmalı, Türkçe fonksiyon adı "
        "kullanma (SUM, AVERAGE, VLOOKUP, XLOOKUP, IF, IFS, INDEX, MATCH, "
        "SUMIFS, COUNTIFS, TEXTJOIN gibi İngilizce ad kullan). Aralıkları "
        "gerçek satır numaralarını kullanarak yaz. Emin değilsen confidence "
        "değerini düşür ve açıklamada belirt."
    )
    chat = _llm(f"excel-formula-{uuid.uuid4()}", system)
    prompt = (
        f"Dosya: {filename}\nSayfa: {chosen} ({len(df)} satır × {len(df.columns)} sütun)\n"
        f"Sütunlar (indeks: ad, dtype): {cols_desc}\n"
        f"Excel sütun harfleri: {letter_map}\n"
        f"Veri satırları: {first_row_idx}..{last_row_idx} (satır 1 başlık)\n\n"
        f"GÖREV: {task}"
    )
    resp = await chat.send_message(UserMessage(text=prompt))
    parsed = _parse_json_block(str(resp)) or {}
    return {
        "sheet": chosen,
        "formula": parsed.get("formula") or "",
        "target_cell": parsed.get("target_cell") or "",
        "explanation": parsed.get("explanation") or str(resp)[:400],
        "confidence": parsed.get("confidence", 0.5),
        "raw": str(resp) if not parsed.get("formula") else None,
    }


# ---- 3) Natural-language data question -----------------------------------
async def answer_data_question(
    sheets: Dict[str, pd.DataFrame],
    question: str,
    filename: str,
) -> Dict[str, Any]:
    """LLM answers a data question grounded in schema + head/tail snapshot."""
    schema = workbook_summary(sheets)
    schema_text = json.dumps(schema, ensure_ascii=False, default=str)[:8000]
    first_name = next(iter(sheets))
    snap = _sheet_snapshot(sheets[first_name])

    system = (
        "Sen Sertex — kullanıcının kişisel yapay zeka asistanısın. "
        "Kullanıcı bir Excel dosyası hakkında soru soruyor. Sadece verilen "
        "şema ve örnek veriye dayanarak Türkçe, kısa ve kesin cevap ver. "
        "Sayısal hesaplama gerektiriyorsa yaklaşık değeri örnek veriden çıkar "
        "ve 'yaklaşık' olduğunu belirt. Emin değilsen 'bu soruya cevap "
        "verecek yeterli veri yok' de. Emoji kullanma."
    )
    chat = _llm(f"excel-qa-{uuid.uuid4()}", system)
    prompt = (
        f"[Dosya]: {filename}\n"
        f"[Şema JSON]: {schema_text}\n"
        f"[Örnek Veri (ilk sayfa)]:\n```\n{snap}\n```\n\n"
        f"[Soru]: {question}"
    )
    resp = await chat.send_message(UserMessage(text=prompt))
    return {"answer": str(resp).strip(), "sheets_used": [first_name]}


# ---- 4) Pivot builder ----------------------------------------------------
def _build_pivot(
    df: pd.DataFrame, spec: Dict[str, Any]
) -> pd.DataFrame:
    """Actually run pandas.pivot_table from an LLM-produced spec."""
    index = spec.get("index") or []
    columns = spec.get("columns") or []
    values = spec.get("values") or []
    aggfunc = spec.get("aggfunc") or "sum"
    if isinstance(index, str):
        index = [index]
    if isinstance(columns, str):
        columns = [columns]
    if isinstance(values, str):
        values = [values]
    # Validate that all referenced columns exist
    for label, group in (("index", index), ("columns", columns), ("values", values)):
        for c in group:
            if c not in df.columns:
                raise ValueError(f"Pivot {label} — bilinmeyen sütun: '{c}'")
    # Cap rows to keep pivot fast
    data = df.head(PIVOT_MAX_ROWS)
    pv = pd.pivot_table(
        data,
        index=index or None,
        columns=columns or None,
        values=values or None,
        aggfunc=aggfunc,
        fill_value=0,
    )
    # Flatten MultiIndex columns (happens when both `columns` and multi-value or
    # multiple aggfuncs are used). Xlsx writer can't emit MultiIndex + no-index.
    if isinstance(pv.columns, pd.MultiIndex):
        pv.columns = [
            " · ".join([str(x) for x in col if x != ""]).strip(" ·")
            for col in pv.columns.to_list()
        ]
    # Move index columns into regular columns so to_excel(index=False) works.
    pv = pv.reset_index()
    # Ensure all column labels are plain strings (xlsxwriter is strict)
    pv.columns = [str(c) for c in pv.columns]
    return pv


async def build_pivot_xlsx(
    sheets: Dict[str, pd.DataFrame],
    task: str,
    filename: str,
    target_sheet: Optional[str] = None,
) -> Dict[str, Any]:
    """Parse task → pivot spec via LLM, run pivot, write to xlsx bytes."""
    chosen = target_sheet if target_sheet and target_sheet in sheets else next(iter(sheets))
    df = sheets[chosen]
    schema = sheet_schema(chosen, df)
    cols_summary = ", ".join(
        f"'{c['name']}' ({c['dtype']})" for c in schema["columns"]
    )

    system = (
        "Sen bir Excel pivot-table planlayıcısısın. Kullanıcının Türkçe "
        "isteğini pandas.pivot_table parametrelerine çevir. Şu JSON şemasında "
        "yanıtla:\n"
        "{\n"
        '  "index":   ["kolonA"],\n'
        '  "columns": ["kolonB"] veya [],\n'
        '  "values":  ["kolonC"],\n'
        '  "aggfunc": "sum" | "mean" | "count" | "min" | "max",\n'
        '  "explanation": "Kısa Türkçe not"\n'
        "}\n"
        "Yalnızca verilen sütun adlarını kullan (harf-hassas). Aggfunc her "
        "zaman string olmalı."
    )
    chat = _llm(f"excel-pivot-{uuid.uuid4()}", system)
    prompt = (
        f"Dosya: {filename}\nSayfa: {chosen}\n"
        f"Sütunlar: {cols_summary}\n\nGÖREV: {task}"
    )
    resp = await chat.send_message(UserMessage(text=prompt))
    spec = _parse_json_block(str(resp)) or {}
    if not spec:
        raise ValueError(f"Pivot planı çözümlenemedi: {str(resp)[:200]}")

    pv = _build_pivot(df, spec)

    # Write to xlsx
    out = io.BytesIO()
    with pd.ExcelWriter(out, engine="xlsxwriter") as writer:
        pv.to_excel(writer, sheet_name="Pivot", index=False)
        # Also embed the spec + explanation on a second sheet
        meta = pd.DataFrame(
            [
                {"key": "Görev", "value": task},
                {"key": "index", "value": ", ".join(spec.get("index") or [])},
                {"key": "columns", "value": ", ".join(spec.get("columns") or [])},
                {"key": "values", "value": ", ".join(spec.get("values") or [])},
                {"key": "aggfunc", "value": spec.get("aggfunc") or "sum"},
                {"key": "Açıklama", "value": spec.get("explanation") or ""},
            ]
        )
        meta.to_excel(writer, sheet_name="Meta", index=False)

    # Preview (first N rows)
    preview = pv.head(PREVIEW_ROWS).astype(object).where(pd.notnull(pv.head(PREVIEW_ROWS)), None)
    preview_records = json.loads(preview.to_json(orient="records", date_format="iso"))

    return {
        "spec": spec,
        "sheet_used": chosen,
        "shape": {"rows": int(len(pv)), "cols": int(len(pv.columns))},
        "columns": [str(c) for c in pv.columns],
        "preview": preview_records,
        "xlsx_bytes": out.getvalue(),
    }


# ---- 5) Chart suggestions ------------------------------------------------
async def suggest_charts(
    sheets: Dict[str, pd.DataFrame], filename: str
) -> List[Dict[str, Any]]:
    """LLM suggests 3-5 useful charts for this workbook."""
    schema = workbook_summary(sheets)
    schema_text = json.dumps(schema, ensure_ascii=False, default=str)[:6000]

    system = (
        "Sen bir veri görselleştirme uzmanısın. Verilen Excel şemasına göre "
        "3-5 grafik önerisi çıkar. Sadece JSON döndür:\n"
        "{\n"
        '  "charts": [\n'
        '    {"title":"...","type":"bar|line|pie|scatter|area|column",\n'
        '     "sheet":"Sayfa1","x":"kolonA","y":"kolonB",\n'
        '     "why":"Türkçe açıklama"},\n'
        "    ...\n"
        "  ]\n"
        "}\n"
        "Kolon adları var olmalı. Emoji kullanma."
    )
    chat = _llm(f"excel-charts-{uuid.uuid4()}", system)
    resp = await chat.send_message(UserMessage(text=(
        f"Dosya: {filename}\nŞema: {schema_text}"
    )))
    parsed = _parse_json_block(str(resp)) or {}
    return parsed.get("charts") or []


# ---- 6) Chart data (aggregated for a specific chart spec) ----------------
_AGG_MAP = {
    "sum": "sum",
    "mean": "mean",
    "avg": "mean",
    "average": "mean",
    "count": "count",
    "min": "min",
    "max": "max",
    "median": "median",
}


def chart_data(
    sheets: Dict[str, pd.DataFrame],
    *,
    sheet: str,
    x: str,
    y: Optional[str],
    agg: str = "sum",
    limit: int = 50,
) -> Dict[str, Any]:
    """Aggregate a sheet into [{x, y}, ...] points ready for a chart."""
    if sheet not in sheets:
        raise ValueError(f"Sayfa bulunamadı: '{sheet}'")
    df = sheets[sheet]
    if x not in df.columns:
        raise ValueError(f"X sütunu bulunamadı: '{x}'")
    if y and y not in df.columns:
        raise ValueError(f"Y sütunu bulunamadı: '{y}'")
    # If y equals x, degrade to a count of x occurrences (pie-chart friendly).
    if y == x:
        y = None

    agg_fn = _AGG_MAP.get((agg or "sum").lower(), "sum")

    if y is None:
        # No y column -> count occurrences of each x
        series = df.groupby(x, dropna=False).size().reset_index(name="y")
        series.rename(columns={x: "x"}, inplace=True)
    elif pd.api.types.is_numeric_dtype(df[y]) or agg_fn == "count":
        grouped = df.groupby(x, dropna=False)[y].agg(agg_fn).reset_index()
        grouped.rename(columns={x: "x", y: "y"}, inplace=True)
        series = grouped
    else:
        # Non-numeric y: coerce via count
        grouped = df.groupby(x, dropna=False)[y].agg("count").reset_index()
        grouped.rename(columns={x: "x", y: "y"}, inplace=True)
        series = grouped
        agg_fn = "count"

    # Sort by y desc for better readability, cap to `limit`
    series = series.sort_values("y", ascending=False).head(limit)

    # JSON-safe
    points = []
    for _, row in series.iterrows():
        x_val = row["x"]
        if pd.isna(x_val):
            x_val = None
        elif hasattr(x_val, "isoformat"):
            x_val = x_val.isoformat()
        else:
            x_val = str(x_val)
        y_val = row["y"]
        if pd.isna(y_val):
            y_val = 0
        else:
            y_val = float(y_val) if not isinstance(y_val, (int, float)) else y_val
        points.append({"x": x_val, "y": y_val})

    return {
        "sheet": sheet,
        "x": x,
        "y": y,
        "agg": agg_fn,
        "count": len(points),
        "data": points,
    }
