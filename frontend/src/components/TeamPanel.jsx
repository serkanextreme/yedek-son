import React, { useEffect, useMemo, useState } from "react";
import { Users, AlertTriangle, CheckCircle2, Clock, Pause, RefreshCw, Briefcase, User, Grid3x3, Tag, BellRing } from "lucide-react";
import { teamApi } from "../lib/api";
import { toast } from "sonner";

/**
 * Faz 8 · CP3 — "Ekibim" HUD panel.
 * ---------------------------------------------------------------------
 *  Per-member task rollup for managers/admins. Rows sorted by overdue
 *  count (desc) then pending — so at-a-glance triage bubbles the users
 *  who need attention to the top.
 *
 *  Two modes:
 *   - Compact (default): username + colored badges only.
 *   - Detailed: full progress bar + numeric counts per bucket.
 */
const badgeCls = "px-1.5 py-0.5 rounded font-mono text-[10px]";

const TeamPanel = ({ refreshSignal, onDataChanged }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailed, setDetailed] = useState(false);
  const [heatmap, setHeatmap] = useState(null);           // null = not loaded yet
  const [heatmapDays, setHeatmapDays] = useState(30);      // 30 | 60 window
  // Faz 9 CP2 — Category-based ("İş Kolu") performance rollup.
  const [categorySummary, setCategorySummary] = useState([]);
  const [showCategoryPanel, setShowCategoryPanel] = useState(true);
  // Geciken Görev Özeti & Toplu Dürt.
  const [overdue, setOverdue] = useState(null);
  const [nudging, setNudging] = useState(false);

  const load = () => {
    setLoading(true);
    teamApi.summary()
      .then((r) => setRows(r || []))
      .catch(() => toast.error("Ekip verisi yüklenemedi"))
      .finally(() => setLoading(false));
    teamApi.categorySummary()
      .then((r) => setCategorySummary(r || []))
      .catch(() => { /* silent — categories are optional */ });
    teamApi.overdueSummary()
      .then((r) => setOverdue(r || null))
      .catch(() => { /* silent — non-critical triage panel */ });
  };

  const runBulkNudge = async (taskIds, label) => {
    const ids = (taskIds || []).filter(Boolean);
    if (!ids.length) return;
    setNudging(true);
    try {
      const r = await teamApi.bulkNudge(ids);
      const skippedNote = r.skipped ? ` · ${r.skipped} atlandı (az önce dürtülmüş)` : "";
      if (r.sent > 0) toast.success(`${label}: ${r.sent} hatırlatma gönderildi${skippedNote}`);
      else toast.info(`${label}: hatırlatma gönderilmedi${skippedNote}`);
      onDataChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Dürtme başarısız");
    } finally {
      setNudging(false);
    }
  };

  const bulkNudgePerson = (p) => runBulkNudge((p.tasks || []).map((t) => t.id), p.username);
  const bulkNudgeAll = () =>
    runBulkNudge((overdue?.people || []).flatMap((p) => (p.tasks || []).map((t) => t.id)), "Tümü");

  // Heat map is loaded lazily — only when the user opens the detailed view.
  // Reload it whenever the window size changes.
  useEffect(() => {
    if (!detailed) return;
    teamApi.heatmap(heatmapDays)
      .then((h) => setHeatmap(h || []))
      .catch(() => { /* silent — non-critical panel */ });
  }, [detailed, heatmapDays, refreshSignal]);

  useEffect(() => { load(); }, [refreshSignal]);

  if (loading) {
    return (
      <div className="text-center text-sertex-textMuted hud-text py-6" data-testid="team-loading">
        Ekip yükleniyor...
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="team-panel">
      <div className="flex items-center justify-between">
        <div className="hud-text text-sertex-cyan flex items-center gap-1">
          <Users className="h-3 w-3" /> EKİBİM ({rows.length})
        </div>
        <div className="flex items-center gap-1">
          {detailed && (
            <select
              value={heatmapDays}
              onChange={(e) => setHeatmapDays(Number(e.target.value))}
              data-testid="team-heatmap-window"
              className="px-1 py-0.5 border border-sertex-cyan/25 bg-sertex-surface text-sertex-cyan hud-text rounded"
              title="Isı haritası pencere boyu"
            >
              <option value={30}>30 GÜN</option>
              <option value={60}>60 GÜN</option>
              <option value={90}>90 GÜN</option>
            </select>
          )}
          <button
            onClick={() => setDetailed((v) => !v)}
            data-testid="team-toggle-detailed"
            className={`px-2 py-1 border rounded hud-text transition-colors ${
              detailed
                ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
            }`}
            title="Detay görünümünü değiştir"
          >
            {detailed ? "KOMPAKT" : "DETAYLI"}
          </button>
          <button
            onClick={load}
            data-testid="team-refresh"
            className="p-1 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
            title="Yenile"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Geciken Görev Özeti & Toplu Dürt — en acil triage bölümü. */}
      {overdue && overdue.total_overdue > 0 && (
        <div
          className="border border-sertex-danger/30 bg-sertex-danger/[0.04] rounded-md"
          data-testid="overdue-summary-panel"
        >
          <div className="px-2 py-1.5 flex items-center justify-between gap-2 border-b border-sertex-danger/20">
            <div className="hud-text text-sertex-danger flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> GECİKEN GÖREVLER ({overdue.total_overdue})
            </div>
            <button
              onClick={bulkNudgeAll}
              disabled={nudging}
              data-testid="overdue-nudge-all"
              className="px-2 py-1 border border-sertex-danger/50 text-sertex-danger hover:bg-sertex-danger/15 rounded hud-text flex items-center gap-1 disabled:opacity-40 transition-colors"
              title="Tüm geciken görev sahiplerine hatırlatma gönder (çan + push)"
            >
              <BellRing className="h-3 w-3" /> TÜMÜNÜ DÜRT
            </button>
          </div>
          <div className="p-2 space-y-1.5 max-h-64 overflow-y-auto scrollbar-sertex">
            {overdue.people.map((p) => (
              <div
                key={p.user_id}
                data-testid={`overdue-person-${p.username}`}
                className="flex items-center gap-2 p-1.5 rounded border border-sertex-danger/20 bg-sertex-surface/30"
              >
                <User className="h-3.5 w-3.5 text-sertex-danger shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-sertex-text truncate">
                    {p.username}
                    <span className="text-sertex-danger ml-1.5 hud-text">
                      {p.overdue_count} geciken
                    </span>
                  </div>
                  {p.company_name && (
                    <div className="hud-text text-sertex-textMuted/70 truncate">
                      {p.company_name}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => bulkNudgePerson(p)}
                  disabled={nudging}
                  data-testid={`overdue-nudge-${p.username}`}
                  className="shrink-0 px-2 py-1 border border-sertex-danger/40 text-sertex-danger hover:bg-sertex-danger/15 rounded hud-text flex items-center gap-1 disabled:opacity-40 transition-colors"
                  title={`${p.username} kişisine hatırlatma gönder`}
                >
                  <BellRing className="h-3 w-3" /> DÜRT
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Faz 9 CP2 — İş Kolu Performansı grid. Collapsible so it doesn't
          overwhelm the panel; hidden entirely when there are no tasks. */}
      {categorySummary.length > 0 && (
        <div data-testid="team-category-panel" className="border border-sertex-cyan/15 rounded-md">
          <button
            onClick={() => setShowCategoryPanel((v) => !v)}
            data-testid="team-category-toggle"
            className="w-full px-2 py-1.5 flex items-center justify-between hover:bg-sertex-cyan/5 rounded-t-md"
          >
            <div className="hud-text text-sertex-cyan flex items-center gap-1">
              <Tag className="h-3 w-3" /> İŞ KOLU PERFORMANSI ({categorySummary.length})
            </div>
            <span className="hud-text text-sertex-textMuted text-[10px]">
              {showCategoryPanel ? "▼" : "▶"}
            </span>
          </button>
          {showCategoryPanel && (
            <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-sertex-cyan/10">
              {categorySummary.map((c) => {
                const donePct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
                const color = c.color || "#22d3ee";
                return (
                  <div
                    key={c.category_id || "__uncat__"}
                    data-testid={`category-card-${c.category_id || "uncat"}`}
                    className="p-2 rounded-md border border-sertex-cyan/20 bg-sertex-surface/30 space-y-1"
                    style={{ borderLeftWidth: 3, borderLeftColor: color }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-mono text-sertex-text truncate flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-sm inline-block"
                          style={{ backgroundColor: color }}
                        />
                        {c.name}
                      </div>
                      <span className="hud-text text-sertex-textMuted shrink-0">
                        {c.done}/{c.total}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 bg-sertex-surface rounded-sm overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{ width: `${donePct}%`, backgroundColor: color }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.overdue > 0 && (
                        <span
                          className={`${badgeCls} bg-rose-500/20 text-rose-300`}
                          data-testid={`category-overdue-${c.category_id || "uncat"}`}
                          title="Gecikmiş"
                        >
                          <AlertTriangle className="inline h-2.5 w-2.5" /> {c.overdue} gecikti
                        </span>
                      )}
                      {c.due_soon > 0 && (
                        <span
                          className={`${badgeCls} bg-orange-500/20 text-orange-300`}
                          title="Yaklaşan"
                        >
                          <Clock className="inline h-2.5 w-2.5" /> {c.due_soon} yaklaşan
                        </span>
                      )}
                      {c.pending > 0 && (
                        <span
                          className={`${badgeCls} bg-sertex-cyan/15 text-sertex-cyan`}
                          title="Açık"
                        >
                          {c.pending} açık
                        </span>
                      )}
                      {c.paused > 0 && (
                        <span
                          className={`${badgeCls} bg-yellow-500/20 text-yellow-300`}
                          title="Duraklamış"
                        >
                          <Pause className="inline h-2.5 w-2.5" /> {c.paused}
                        </span>
                      )}
                      {c.done > 0 && (
                        <span
                          className={`${badgeCls} bg-emerald-500/20 text-emerald-300`}
                          title="Tamamlandı"
                        >
                          <CheckCircle2 className="inline h-2.5 w-2.5" /> {c.done}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 && (
        <div
          className="text-center py-6 text-sertex-textMuted hud-text border border-sertex-cyan/15 rounded-md"
          data-testid="team-empty"
        >
          Henüz görme yetkin olan bir ekip üyesi yok.
          <br />
          <span className="text-[10px] text-sertex-textMuted/70">
            Yönetici, sana kimleri gördüğünü Ayarlar → Yetkiler'den atar.
          </span>
        </div>
      )}

      {rows.map((r) => {
        const total = r.total || 0;
        const donePct = total > 0 ? (r.done / total) * 100 : 0;
        const overduePct = total > 0 ? (r.overdue / total) * 100 : 0;
        const hasOverdue = r.overdue > 0;
        return (
          <div
            key={r.user_id}
            data-testid={`team-row-${r.username}`}
            className={`border rounded-md p-2 transition-colors ${
              hasOverdue
                ? "border-sertex-danger/40 bg-sertex-danger/[0.04]"
                : "border-sertex-cyan/20 bg-sertex-cyan/[0.02]"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {r.role === "manager" ? (
                <Briefcase className="h-3.5 w-3.5 text-purple-300 shrink-0" />
              ) : (
                <User className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono text-sertex-text truncate">
                  {r.username}
                </div>
                {r.company_name && (
                  <div className="hud-text text-sertex-textMuted/70 truncate">
                    {r.company_name}
                  </div>
                )}
              </div>
              <div className="flex gap-1 flex-wrap justify-end">
                {r.overdue > 0 && (
                  <span
                    data-testid={`team-badge-overdue-${r.username}`}
                    className={`${badgeCls} bg-sertex-danger/20 text-sertex-danger border border-sertex-danger/40 flex items-center gap-1`}
                  >
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {r.overdue}
                  </span>
                )}
                {r.pending > 0 && (
                  <span
                    data-testid={`team-badge-pending-${r.username}`}
                    className={`${badgeCls} bg-sertex-cyan/10 text-sertex-cyan border border-sertex-cyan/30 flex items-center gap-1`}
                  >
                    <Clock className="h-2.5 w-2.5" />
                    {r.pending}
                  </span>
                )}
                {r.paused > 0 && (
                  <span
                    className={`${badgeCls} bg-amber-500/10 text-amber-300 border border-amber-400/30 flex items-center gap-1`}
                  >
                    <Pause className="h-2.5 w-2.5" />
                    {r.paused}
                  </span>
                )}
                {r.done > 0 && (
                  <span
                    data-testid={`team-badge-done-${r.username}`}
                    className={`${badgeCls} bg-green-500/10 text-green-300 border border-green-400/30 flex items-center gap-1`}
                  >
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {r.done}
                  </span>
                )}
                {total === 0 && (
                  <span className={`${badgeCls} bg-sertex-textMuted/10 text-sertex-textMuted border border-sertex-textMuted/25`}>
                    henüz görev yok
                  </span>
                )}
              </div>
            </div>

            {detailed && total > 0 && (
              <div className="mt-1.5 space-y-1" data-testid={`team-detail-${r.username}`}>
                <div className="flex justify-between hud-text">
                  <span className="text-sertex-textMuted">İlerleme</span>
                  <span className="text-sertex-cyan">
                    {r.done}/{total} tamamlandı (%{donePct.toFixed(0)})
                  </span>
                </div>
                <div className="h-1.5 rounded-sm bg-sertex-cyan/10 overflow-hidden border border-sertex-cyan/15 flex">
                  <div className="h-full bg-green-400" style={{ width: `${donePct}%` }} />
                  <div className="h-full bg-sertex-danger" style={{ width: `${overduePct}%` }} />
                </div>
              </div>
            )}
            {detailed && heatmap && (() => {
              const days = (heatmap.find((h) => h.user_id === r.user_id) || {}).days || [];
              if (days.length === 0) return null;
              // Colour scale — cell "done" count mapped to opacity tiers.
              const cellCls = (done) => {
                if (done === 0) return "bg-sertex-cyan/5 border-sertex-cyan/10";
                if (done <= 1) return "bg-sertex-cyan/30 border-sertex-cyan/40";
                if (done <= 3) return "bg-sertex-cyan/55 border-sertex-cyan/60";
                if (done <= 6) return "bg-sertex-cyan/80 border-sertex-cyan/80";
                return "bg-sertex-cyan border-sertex-cyan";
              };
              return (
                <div className="mt-2" data-testid={`team-heatmap-${r.username}`}>
                  <div className="flex justify-between hud-text mb-1">
                    <span className="text-sertex-textMuted flex items-center gap-1">
                      <Grid3x3 className="h-2.5 w-2.5" /> SON {heatmapDays} GÜN
                    </span>
                    <span className="text-sertex-cyan">
                      {days.reduce((a, d) => a + d.done, 0)} görev tamamlandı
                    </span>
                  </div>
                  <div
                    className="grid gap-0.5"
                    style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}
                  >
                    {days.map((d) => (
                      <div
                        key={d.date}
                        title={`${d.date} · ${d.done} tamamlandı`}
                        data-testid={`heatmap-cell-${r.username}-${d.date}`}
                        className={`w-full aspect-square border rounded-sm ${cellCls(d.done)}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
};

export default TeamPanel;
