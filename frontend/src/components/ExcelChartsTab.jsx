import React, { useState } from "react";
import { Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
import RechartsChart from "./RechartsChart";
import { excelApi } from "../lib/api";

const cardCls = "border border-sertex-cyan/20 rounded-md p-3 bg-sertex-cyan/5";

/**
 * Charts tab for the Excel Modal.
 *
 * Renders the LLM's chart suggestions and lets the user preview each one live
 * via `POST /api/excel/{id}/chart-data`, which is drawn by RechartsChart.
 */
const ExcelChartsTab = ({ fileId, charts, chartsBusy }) => {
  const [chartDataMap, setChartDataMap] = useState({});
  const [chartLoadingIdx, setChartLoadingIdx] = useState(null);

  const loadChartData = async (idx, c) => {
    setChartLoadingIdx(idx);
    try {
      // sum for magnitudes (bar/pie/etc), mean for scatter comparison
      const agg = ["pie", "bar", "column", "area", "line"].includes(
        (c.type || "").toLowerCase()
      )
        ? "sum"
        : "mean";
      const r = await excelApi.chartData(fileId, {
        sheet: c.sheet,
        x: c.x,
        y: c.y || null,
        agg,
        limit: 30,
      });
      setChartDataMap((prev) => ({ ...prev, [idx]: r }));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Veri çekilemedi");
    } finally {
      setChartLoadingIdx(null);
    }
  };

  return (
    <div data-testid="excel-charts-tab" className="space-y-3">
      {chartsBusy && (
        <div className="flex items-center gap-2 text-sertex-cyan hud-text">
          <Loader2 className="h-4 w-4 animate-spin" /> Öneriler hazırlanıyor…
        </div>
      )}
      {charts && charts.length === 0 && (
        <div className="text-xs font-mono text-sertex-textMuted">
          Öneri bulunamadı.
        </div>
      )}
      {(charts || []).map((c, i) => (
        <div key={i} className={cardCls} data-testid={`chart-suggestion-${i}`}>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sertex-cyan/10 border border-sertex-cyan/30 text-sertex-cyan uppercase">
              {c.type}
            </span>
            <span className="hud-text text-sertex-cyan">{c.title}</span>
            <button
              onClick={() => loadChartData(i, c)}
              disabled={chartLoadingIdx === i}
              className="ml-auto px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-50 rounded-md text-[10px] font-mono flex items-center gap-1 transition-colors"
              data-testid={`chart-preview-${i}`}
              title="Bu grafiği canlı çiz"
            >
              {chartLoadingIdx === i ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
              {chartDataMap[i] ? "Yenile" : "Önizle"}
            </button>
          </div>
          <div className="text-xs font-mono text-sertex-textMuted">
            Sayfa: {c.sheet} · X: {c.x} · Y: {c.y}
          </div>
          <div className="text-xs font-mono text-sertex-text mt-1">{c.why}</div>
          {chartDataMap[i] && (
            <div
              className="mt-3 border-t border-sertex-cyan/20 pt-3"
              data-testid={`chart-canvas-${i}`}
            >
              <RechartsChart
                type={c.type}
                data={chartDataMap[i].data || []}
                xLabel={c.x}
                yLabel={c.y || "adet"}
              />
              <div className="text-[10px] font-mono text-sertex-textMuted mt-1 text-right">
                {chartDataMap[i].count} nokta · agg = {chartDataMap[i].agg}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ExcelChartsTab;
