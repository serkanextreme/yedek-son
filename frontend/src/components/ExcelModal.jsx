import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  X,
  Sparkles,
  Calculator,
  MessageSquareText,
  Table2,
  BarChart3,
  Loader2,
  Copy,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { excelApi } from "../lib/api";
import ExcelChartsTab from "./ExcelChartsTab";

const TABS = [
  { id: "analyze", label: "Analiz", icon: Sparkles },
  { id: "formula", label: "Formül", icon: Calculator },
  { id: "query", label: "Sor", icon: MessageSquareText },
  { id: "pivot", label: "Pivot", icon: Table2 },
  { id: "charts", label: "Grafik", icon: BarChart3 },
];

const cardCls =
  "border border-sertex-cyan/20 rounded-md p-3 bg-sertex-cyan/5";
const btnCls =
  "px-3 py-1.5 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/20 disabled:opacity-50 rounded-md hud-text flex items-center gap-2 transition-colors";
const inputCls =
  "w-full bg-sertex-surface border border-sertex-cyan/25 rounded-md px-3 py-2 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none resize-none";

const copyToClipboard = (text) => {
  try {
    navigator.clipboard.writeText(text);
    toast.success("Panoya kopyalandı");
  } catch {
    toast.error("Kopyalanamadı");
  }
};

const downloadBase64Xlsx = (b64, filename) => {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error("Dosya indirilemedi");
  }
};

const ExcelModal = ({ file, onClose }) => {
  const [tab, setTab] = useState("analyze");
  const [analyze, setAnalyze] = useState(null);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);

  const [formulaTask, setFormulaTask] = useState("");
  const [formulaResult, setFormulaResult] = useState(null);
  const [formulaBusy, setFormulaBusy] = useState(false);

  const [queryText, setQueryText] = useState("");
  const [queryAnswer, setQueryAnswer] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);

  const [pivotTask, setPivotTask] = useState("");
  const [pivotResult, setPivotResult] = useState(null);
  const [pivotBusy, setPivotBusy] = useState(false);

  const [charts, setCharts] = useState(null);
  const [chartsBusy, setChartsBusy] = useState(false);

  // Auto-analyze on open
  useEffect(() => {
    if (!file) return;
    (async () => {
      setAnalyzeBusy(true);
      try {
        const r = await excelApi.analyze(file.id);
        setAnalyze(r);
      } catch (e) {
        toast.error(e.response?.data?.detail || "Analiz alınamadı");
      } finally {
        setAnalyzeBusy(false);
      }
    })();
  }, [file]);

  const runFormula = async () => {
    if (formulaTask.trim().length < 3) {
      toast.error("Görev çok kısa");
      return;
    }
    setFormulaBusy(true);
    setFormulaResult(null);
    try {
      const r = await excelApi.formula(file.id, formulaTask.trim());
      setFormulaResult(r);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Formül üretilemedi");
    } finally {
      setFormulaBusy(false);
    }
  };

  const runQuery = async () => {
    if (queryText.trim().length < 3) {
      toast.error("Soru çok kısa");
      return;
    }
    setQueryBusy(true);
    setQueryAnswer("");
    try {
      const r = await excelApi.query(file.id, queryText.trim());
      setQueryAnswer(r.answer || "");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sorgu başarısız");
    } finally {
      setQueryBusy(false);
    }
  };

  const runPivot = async () => {
    if (pivotTask.trim().length < 3) {
      toast.error("Görev çok kısa");
      return;
    }
    setPivotBusy(true);
    setPivotResult(null);
    try {
      const r = await excelApi.pivot(file.id, pivotTask.trim());
      setPivotResult(r);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Pivot oluşturulamadı");
    } finally {
      setPivotBusy(false);
    }
  };

  const loadCharts = async () => {
    setChartsBusy(true);
    try {
      const r = await excelApi.charts(file.id);
      setCharts(r.charts || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Grafik önerileri alınamadı");
    } finally {
      setChartsBusy(false);
    }
  };

  useEffect(() => {
    if (tab === "charts" && charts === null && !chartsBusy) loadCharts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="excel-modal"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[85vh] glass-panel border border-sertex-cyan/40 rounded-lg overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-sertex-cyan/20">
          <div className="hud-text text-sertex-cyan neon-glow truncate pr-2">
            EXCEL OTOMASYONU — {file.original_filename}
          </div>
          <button
            onClick={onClose}
            className="text-sertex-textMuted hover:text-sertex-text"
            data-testid="excel-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-sertex-cyan/20 overflow-x-auto scrollbar-sertex">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                data-testid={`excel-tab-${t.id}`}
                className={`px-3 py-2 hud-text flex items-center gap-1 border-b-2 transition-colors ${
                  active
                    ? "border-sertex-cyan text-sertex-cyan"
                    : "border-transparent text-sertex-textMuted hover:text-sertex-text"
                }`}
              >
                <Icon className="h-3 w-3" /> {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-sertex p-4 space-y-3">
          {tab === "analyze" && (
            <div data-testid="excel-analyze-tab" className="space-y-3">
              {analyzeBusy && (
                <div className="flex items-center gap-2 text-sertex-cyan hud-text">
                  <Loader2 className="h-4 w-4 animate-spin" /> Analiz ediliyor…
                </div>
              )}
              {analyze && (
                <>
                  <div className={cardCls}>
                    <div className="hud-text text-sertex-cyan mb-2">İçgörüler</div>
                    <div
                      className="text-sm font-mono whitespace-pre-wrap leading-relaxed text-sertex-text"
                      data-testid="excel-insight"
                    >
                      {analyze.insight}
                    </div>
                  </div>
                  <div className={cardCls}>
                    <div className="hud-text text-sertex-cyan mb-2">Şema</div>
                    <div className="space-y-2">
                      {(analyze.schema || []).map((s) => (
                        <div key={s.sheet} className="text-xs font-mono">
                          <div className="text-sertex-cyan">
                            {s.sheet} — {s.rows} satır × {s.cols} sütun
                          </div>
                          <ul className="pl-3 text-sertex-textMuted">
                            {s.columns.map((c) => (
                              <li key={c.name}>
                                <span className="text-sertex-text">{c.name}</span>{" "}
                                <span className="opacity-60">
                                  ({c.dtype}
                                  {c.nulls > 0 ? `, ${c.nulls} boş` : ""}
                                  {c.mean != null
                                    ? `, ort=${c.mean.toFixed(1)}`
                                    : ""}
                                  )
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "formula" && (
            <div data-testid="excel-formula-tab" className="space-y-3">
              <textarea
                rows={2}
                placeholder="Örn: F sütunundaki tüm satışların toplamını hesapla; Kategoriye göre ortalama fiyatı bul; İki tarih arasındaki satış sayısını say"
                value={formulaTask}
                onChange={(e) => setFormulaTask(e.target.value)}
                className={inputCls}
                data-testid="excel-formula-input"
              />
              <button
                onClick={runFormula}
                disabled={formulaBusy}
                className={btnCls}
                data-testid="excel-formula-submit"
              >
                {formulaBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Calculator className="h-3 w-3" />
                )}
                Formül Üret
              </button>

              {formulaResult && (
                <div className={cardCls} data-testid="excel-formula-result">
                  <div className="flex items-center justify-between mb-2">
                    <span className="hud-text text-sertex-cyan">Formül</span>
                    <button
                      onClick={() => copyToClipboard(formulaResult.formula)}
                      className="text-sertex-textMuted hover:text-sertex-cyan flex items-center gap-1 text-[10px] font-mono"
                    >
                      <Copy className="h-3 w-3" /> KOPYALA
                    </button>
                  </div>
                  <div
                    className="text-sm font-mono bg-black/40 p-2 rounded border border-sertex-cyan/30 text-sertex-cyan break-all"
                    data-testid="excel-formula-text"
                  >
                    {formulaResult.formula || "(boş)"}
                  </div>
                  {formulaResult.target_cell && (
                    <div className="text-[10px] font-mono text-sertex-textMuted mt-1">
                      Hedef hücre: {formulaResult.target_cell} · Sayfa:{" "}
                      {formulaResult.sheet}
                    </div>
                  )}
                  {formulaResult.explanation && (
                    <div className="text-xs font-mono text-sertex-text mt-2 whitespace-pre-wrap">
                      {formulaResult.explanation}
                    </div>
                  )}
                  <div className="text-[10px] font-mono text-sertex-textMuted mt-2">
                    Güven: {(formulaResult.confidence * 100).toFixed(0)}%
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "query" && (
            <div data-testid="excel-query-tab" className="space-y-3">
              <textarea
                rows={2}
                placeholder="Örn: En çok satan ürün hangisi? Ortalama sipariş tutarı nedir?"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                className={inputCls}
                data-testid="excel-query-input"
              />
              <button
                onClick={runQuery}
                disabled={queryBusy}
                className={btnCls}
                data-testid="excel-query-submit"
              >
                {queryBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <MessageSquareText className="h-3 w-3" />
                )}
                Cevabı Al
              </button>
              {queryAnswer && (
                <div className={cardCls} data-testid="excel-query-answer">
                  <div className="hud-text text-sertex-cyan mb-2">Cevap</div>
                  <div className="text-sm font-mono whitespace-pre-wrap text-sertex-text">
                    {queryAnswer}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "pivot" && (
            <div data-testid="excel-pivot-tab" className="space-y-3">
              <textarea
                rows={2}
                placeholder="Örn: Ay satırlarında Kategori sütunlarında Toplam değerlerinin toplamını göster"
                value={pivotTask}
                onChange={(e) => setPivotTask(e.target.value)}
                className={inputCls}
                data-testid="excel-pivot-input"
              />
              <button
                onClick={runPivot}
                disabled={pivotBusy}
                className={btnCls}
                data-testid="excel-pivot-submit"
              >
                {pivotBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Table2 className="h-3 w-3" />
                )}
                Pivot Oluştur
              </button>
              {pivotResult && (
                <div className={cardCls} data-testid="excel-pivot-result">
                  <div className="flex items-center justify-between mb-2">
                    <span className="hud-text text-sertex-cyan">
                      {pivotResult.shape?.rows}×{pivotResult.shape?.cols} · Sayfa:{" "}
                      {pivotResult.sheet_used}
                    </span>
                    <button
                      onClick={() =>
                        downloadBase64Xlsx(
                          pivotResult.xlsx_b64,
                          `pivot_${file.original_filename}`
                        )
                      }
                      className="text-sertex-cyan hover:bg-sertex-cyan/10 border border-sertex-cyan/40 px-2 py-1 rounded flex items-center gap-1 text-[10px] font-mono"
                      data-testid="excel-pivot-download"
                    >
                      <Download className="h-3 w-3" /> XLSX İNDİR
                    </button>
                  </div>
                  <div className="overflow-x-auto scrollbar-sertex">
                    <table className="text-xs font-mono w-full border-collapse">
                      <thead>
                        <tr className="border-b border-sertex-cyan/30">
                          {(pivotResult.columns || []).map((c) => (
                            <th
                              key={c}
                              className="text-left px-2 py-1 text-sertex-cyan"
                            >
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(pivotResult.preview || []).map((row, i) => (
                          <tr
                            key={i}
                            className="border-b border-sertex-cyan/10 hover:bg-sertex-cyan/5"
                          >
                            {(pivotResult.columns || []).map((c) => (
                              <td
                                key={c}
                                className="px-2 py-1 text-sertex-text whitespace-nowrap"
                              >
                                {typeof row[c] === "number"
                                  ? row[c].toLocaleString("tr-TR")
                                  : row[c] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {pivotResult.spec?.explanation && (
                    <div className="text-[10px] font-mono text-sertex-textMuted mt-2">
                      {pivotResult.spec.explanation}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "charts" && (
            <ExcelChartsTab
              fileId={file.id}
              charts={charts}
              chartsBusy={chartsBusy}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ExcelModal;
