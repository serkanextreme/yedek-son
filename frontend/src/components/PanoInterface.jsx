import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, Layers, Check, Pause, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { tasksApi, taskCategoriesApi } from "../lib/api";
import { setInterfaceMode } from "../lib/appearance";
import { bucketOf, fmtDate, matchesQuery } from "../lib/interfaceHelpers";

// PANO — Kanban. Sertex durumları (pending/paused/done/overdue) 3 sütuna eşlenir.
const notTrashed = (t) => !t.archived && !t.deleted;
const COLUMNS = [
  { key: "todo", title: "YAPILACAK", match: (t) => notTrashed(t) && t.status !== "done" && t.status !== "paused", accent: "rgb(var(--sx-accent-rgb))" },
  { key: "paused", title: "BEKLEMEDE", match: (t) => notTrashed(t) && t.status === "paused", accent: "#f59e0b" },
  { key: "done", title: "BİTTİ", match: (t) => t.status === "done" && !t.deleted, accent: "#10b981" },
];

/**
 * PANO arayüzü — üç sütunlu Kanban. Kartlardaki düğmelerle durum geçişi
 * (Duraklat / Devam / Tamamla / Geri Al) — gerçek görev durumunu değiştirir.
 */
const PanoInterface = ({ onOpenSection, onOpenSettings, sidebarOpen, isMobile }) => {
  const [tasks, setTasks] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    Promise.all([
      tasksApi.list(false, "mine").catch(() => []),
      taskCategoriesApi.list("my_tasks").catch(() => []),
    ]).then(([ts, cs]) => {
      setTasks(Array.isArray(ts) ? ts : []);
      setCats(Array.isArray(cs) ? cs : []);
    }).finally(() => setLoading(false));
  }, []);

  const catName = (id) => cats.find((c) => c.id === id)?.name || null;

  const grouped = useMemo(() => {
    const filtered = tasks.filter((t) => matchesQuery(t, q, catName));
    const out = {};
    for (const col of COLUMNS) out[col.key] = filtered.filter(col.match);
    return out;
  }, [tasks, cats, q]);

  const move = async (id, status) => {
    try {
      await tasksApi.setStatus(id, status);
      setTasks((p) => p.map((t) => (t.id === id ? { ...t, status } : t)));
    } catch { toast.error("Durum değiştirilemedi"); }
  };

  const cardActions = (t, colKey) => {
    if (colKey === "done") return [{ label: "Geri Al", icon: RotateCcw, to: "pending" }];
    if (colKey === "paused") return [{ label: "Devam", icon: Play, to: "pending" }, { label: "Bitir", icon: Check, to: "done" }];
    return [{ label: "Beklet", icon: Pause, to: "paused" }, { label: "Bitir", icon: Check, to: "done" }];
  };

  return (
    <div
      className="absolute inset-0 z-10 overflow-hidden flex flex-col"
      data-testid="pano-interface"
      style={{ right: !isMobile && sidebarOpen ? 360 : 0, bottom: isMobile ? 64 : 0, transition: "right 300ms" }}
    >
      {/* Üst çubuk */}
      <div className="shrink-0 px-6 py-3 flex items-center gap-3 border-b border-sertex-cyan/20">
        <div className="display-text text-sertex-cyan neon-glow tracking-widest">PANO</div>
        <div className="relative flex-1 max-w-md ml-2">
          <Search className="h-4 w-4 text-sertex-textMuted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Görev ara..."
            data-testid="pano-search"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-sertex-surface/70 border border-sertex-cyan/25 text-sertex-text text-sm placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
          />
        </div>
        <button onClick={() => onOpenSection?.("tasks")} data-testid="pano-add-task" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sertex-cyan/15 border border-sertex-cyan text-sertex-cyan text-sm hover:bg-sertex-cyan/25 transition-colors neon-glow">
          <Plus className="h-4 w-4" /> Yeni Görev
        </button>
        <button onClick={() => { setInterfaceMode("detayli"); toast.success("Detaylı görünüme geçildi"); }} data-testid="pano-switch-detayli" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/40 transition-colors text-xs">
          <Layers className="h-3.5 w-3.5" /> Detaylı
        </button>
      </div>

      {/* Sütunlar */}
      {loading ? (
        <div className="p-8 hud-text text-sertex-textMuted" data-testid="pano-loading">YÜKLENİYOR...</div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-5">
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map((col) => {
              const items = grouped[col.key] || [];
              return (
                <div key={col.key} className="w-[320px] shrink-0 flex flex-col rounded-xl border border-white/10 bg-black/20" data-testid={`pano-col-${col.key}`}>
                  <div className="shrink-0 px-4 py-3 flex items-center justify-between border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.accent }} />
                      <span className="hud-text" style={{ color: col.accent }}>{col.title}</span>
                    </div>
                    <span className="text-xs font-mono text-sertex-textMuted">{items.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto scrollbar-sertex p-3 space-y-2.5">
                    {items.length === 0 ? (
                      <div className="text-center text-[11px] font-mono text-sertex-textMuted/60 py-6">— boş —</div>
                    ) : items.map((t, i) => {
                      const b = bucketOf(t);
                      const bc = b.color === "accent" ? "rgb(var(--sx-accent-rgb))" : b.color;
                      const due = fmtDate(t.due_date);
                      return (
                        <motion.div
                          key={t.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i * 0.02, 0.2) }}
                          className="rounded-lg border border-white/10 bg-sertex-surface/70 p-3"
                          data-testid={`pano-card-${t.id}`}
                        >
                          <div className="text-sm text-sertex-text font-medium leading-snug line-clamp-2 mb-1.5">{t.title}</div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: bc }} />
                            <span className="text-[10px] font-mono" style={{ color: bc }}>{b.label}</span>
                            {due && <span className="ml-auto text-[10px] font-mono text-sertex-textMuted">{due}</span>}
                          </div>
                          {catName(t.category_id) && (
                            <div className="hud-text text-sertex-textMuted normal-case tracking-normal mb-2 truncate">{catName(t.category_id)}</div>
                          )}
                          <div className="flex gap-1.5">
                            {cardActions(t, col.key).map((a) => {
                              const Icon = a.icon;
                              return (
                                <button
                                  key={a.label}
                                  onClick={() => move(t.id, a.to)}
                                  data-testid={`pano-move-${t.id}-${a.to}`}
                                  className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-sertex-textSecondary hover:text-sertex-cyan hover:border-sertex-cyan/40 transition-colors"
                                >
                                  <Icon className="h-3 w-3" /> {a.label}
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default PanoInterface;
