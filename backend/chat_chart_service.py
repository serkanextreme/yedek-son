"""Chart-in-chat orchestrator.

Detects a Turkish/English chart intent in a user message and, when present +
the user has at least one spreadsheet file, asks the LLM to translate the
request into a chart spec (type/x/y/agg/title). Runs pandas aggregation via
excel_service.chart_data() and returns an inline chart payload.
"""
import json
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage

from storage_service import get_object
from excel_service import (
    load_workbook,
    workbook_summary,
    chart_data,
    _parse_json_block,
)

logger = logging.getLogger(__name__)

_INTENT_RE = re.compile(
    r"\b(grafi[ğk]\w*|çiz(gi|)|bar\s*chart|column\s*chart|pasta|pie|line\s*chart|"
    r"sütun|alan|scatter|dağılım|görsel(leştir)?|chart|plot|"
    r"chart olarak|görsel olarak)\b",
    re.IGNORECASE,
)


def looks_like_chart_request(text: str) -> bool:
    if not text or len(text) < 4:
        return False
    return bool(_INTENT_RE.search(text))


async def _pick_spreadsheet(db, user_id: str) -> Optional[Dict[str, Any]]:
    """Newest non-deleted spreadsheet file for this user."""
    return await db.files.find_one(
        {"user_id": user_id, "is_deleted": {"$ne": True}, "category": "spreadsheet"},
        {"_id": 0, "id": 1, "original_filename": 1, "storage_path": 1},
        sort=[("created_at", -1)],
    )


async def _llm_plan_chart(schema: List[Dict[str, Any]], request: str) -> Optional[Dict[str, Any]]:
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        return None
    system = (
        "Sen bir grafik planlayıcısısın. Kullanıcının Türkçe/İngilizce grafik "
        "isteğini verilen Excel şemasına göre parse et. YALNIZCA JSON döndür: "
        '{"type":"bar|line|pie|area|scatter|column",'
        ' "sheet":"...","x":"...","y":"...","agg":"sum|mean|count","title":"..."}.'
        " Kolon adları verilen şemadaki adlardan biri olmalı (harfe duyarlı). "
        "type belirsizse 'bar' kullan. agg belirsizse 'sum' kullan. "
        "Kullanıcının isteği şemayla eşleşmiyorsa {'error':'no_match'} döndür."
    )
    schema_text = json.dumps(schema, ensure_ascii=False, default=str)[:4000]
    chat = LlmChat(
        api_key=key,
        session_id=f"chat-chart-{uuid.uuid4()}",
        system_message=system,
    ).with_model("openai", "gpt-5.2")
    try:
        resp = await chat.send_message(
            UserMessage(text=f"ŞEMA:\n{schema_text}\n\nİSTEK: {request}")
        )
    except Exception as e:
        logger.warning("Chart plan LLM failed: %s", e)
        return None
    spec = _parse_json_block(str(resp))
    if not spec or spec.get("error"):
        return None
    return spec


async def try_generate_chat_chart(
    db, user_id: str, message: str
) -> Optional[Dict[str, Any]]:
    """Return an inline chart payload for the assistant message, or None."""
    if not looks_like_chart_request(message):
        return None
    file_doc = await _pick_spreadsheet(db, user_id)
    if not file_doc:
        logger.info("Chat chart: no spreadsheet for user %s", user_id)
        return None
    try:
        raw, _ct = get_object(file_doc["storage_path"])
        sheets = load_workbook(raw)
    except Exception as e:
        logger.warning("Chat chart: failed to load workbook %s: %s", file_doc.get("id"), e)
        return None
    if not sheets:
        return None
    schema = workbook_summary(sheets)
    spec = await _llm_plan_chart(schema, message)
    if not spec:
        logger.info("Chat chart: LLM returned no spec")
        return None
    logger.info("Chat chart spec: %s", spec)
    sheet = spec.get("sheet") or next(iter(sheets))
    if sheet not in sheets:
        sheet = next(iter(sheets))
    x = spec.get("x")
    if not x:
        return None
    y = spec.get("y")
    agg = spec.get("agg", "sum")
    try:
        result = chart_data(sheets, sheet=sheet, x=x, y=y, agg=agg, limit=30)
    except Exception as e:
        logger.info("Chat chart: chart_data rejected spec: %s", e)
        return None
    return {
        "type": (spec.get("type") or "bar").lower(),
        "title": spec.get("title")
        or (f"{y} × {x}" if y else x),
        "x_label": x,
        "y_label": y or "adet",
        "sheet": sheet,
        "filename": file_doc["original_filename"],
        "data": result["data"],
    }
