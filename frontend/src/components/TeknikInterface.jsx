import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { tasksApi, taskCategoriesApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { setInterfaceMode } from "../lib/appearance";
import { isActive, bucketOf, fmtDate, matchesQuery } from "../lib/interfaceHelpers";

const shortId = (id) => "T" + String(id || "").replace(/-/g, "").slice(0, 6).toUpperCase();

/**
 * TEKNİK arayüzü — yoğun, konsol/terminal havası. Monospace tablo + komut çubuğu
 * + seçili görev detay paneli. Güçlü kullanıcılar için kompakt görünüm.
 */
const TeknikInterface = ({ onOpenSection, onOpenSettings, sidebarOpen, isMobile }) => {
  const { user, teamFeaturesVisible } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState(null);

  const load = () => {
    Promise.all([
      tasksApi.list(false, "mine").catch(() => []),
      taskCategoriesApi.list("my_tasks").catch(() => []),
    ]).then(([ts, cs]) => {
      setTasks(Array.isArray(ts) ? ts : []);
      setCats(Array.isArray(cs) ? cs : []);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const catName = (id) => cats.find((c) => c.id === id)?.name || null;
  const rows = useMemo(
    () => tasks.filter(isActive).filter((t) => matchesQuery(t, q, catName)),
    [tasks, cats, q]
  );
  const sel = tasks.find((t) => t.id === selId) || null;

  const complete = async (id) => {
    try {
      await tasksApi.setStatus(id, "done");
      setTasks((p) => p.map((t) => (t.id === id ? { ...t, status: "done" } : t)));
      toast.success("Görev tamamlandı");
    } catch { toast.error("Hata"); }
  };

  const MENU = [
    { k: "PANEL", onClick: null, active: true },
    { k: "GÖREVLER", onClick: () => onOpenSection?.("tasks") },
    ...(teamFeaturesVisible ? [{ k: "EKİP", onClick: () => onOpenSection?.("team") }] : []),
    { k: "NOTLAR", onClick: () => onOpenSection?.("notes") },
    { k: "DOSYALAR", onClick: () => onOpenSection?.("files") },
    { k: "AYARLAR", onClick: () => onOpenSettings?.() },
  ];

  return (
    <div
      className="absolute inset-0 z-10 overflow-hidden font-mono"
      data-testid="teknik-interface"
      style={{ right: !isMobile && sidebarOpen ? 360 : 0, bottom: isMobile ? 64 : 0, transition: "right 300ms", background: "#04060d" }}
    >
      <div className="flex flex-col h-full">
        {/* Üst komut çubuğu */}
        <div className="shrink-0 border-b border-sertex-cyan/25 px-4 py-2.5 flex items-center gap-3">
          <div className="text-sertex-cyan font-bold tracking-widest neon-glow">[TEKNİK]</div>
          <div className="flex-1 max-w-xl">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="> ara | filtrele | görev bul"
              data-testid="teknik-search"
              className="w-full bg-black/40 border border-sertex-cyan/30 rounded px-3 py-1.5 text-xs text-sertex-cyan placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
            />
          </div>
          <button onClick={() => onOpenSection?.("tasks")} data-testid="teknik-new-task" className="px-2.5 py-1.5 rounded border border-sertex-cyan/50 bg-sertex-cyan/10 text-sertex-cyan text-[11px] hover:bg-sertex-cyan/20 transition-colors">NEW_TASK +</button>
          <button onClick={() => onOpenSettings?.()} data-testid="teknik-settings" className="px-2.5 py-1.5 text-[11px] text-sertex-textMuted hover:text-sertex-cyan transition-colors">SETTINGS</button>
          <button onClick={() => { setInterfaceMode("detayli"); toast.success("Detaylı görünüme geçildi"); }} data-testid="teknik-switch-detayli" className="px-2.5 py-1.5 text-[11px] text-sertex-textMuted hover:text-sertex-cyan transition-colors">DETAYLI</button>
          <span className="text-[11px] text-sertex-textMuted">{user?.username}</span>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sol menü */}
          <div className="w-[140px] shrink-0 border-r border-sertex-cyan/20 p-2 space-y-1" data-testid="teknik-menu">
            {MENU.map((m) => (
              <button
                key={m.k}
                onClick={m.onClick || undefined}
                data-testid={`teknik-nav-${m.k.toLowerCase()}`}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
                  m.active ? "bg-sertex-cyan/15 text-sertex-cyan border-l-2 border-sertex-cyan" : "text-sertex-textMuted hover:text-sertex-cyan hover:bg-sertex-cyan/5"
                }`}
              >[{m.k}]</button>
            ))}
          </div>

          {/* Tablo */}
          <div className="flex-1 min-w-0 overflow-auto scrollbar-sertex">
            <div className="px-4 py-2 text-[11px] text-sertex-textMuted border-b border-sertex-cyan/15 sticky top-0 bg-[#04060d] z-10">
              TÜM AKTİF GÖREVLER · {rows.length} kayıt
            </div>
            {loading ? (
              <div className="p-6 text-xs text-sertex-textMuted" data-testid="teknik-loading">YÜKLENİYOR...</div>
            ) : (
              <table className="w-full text-[11px]" data-testid="teknik-table">
                <thead>
                  <tr className="text-sertex-textMuted border-b border-sertex-cyan/15">
                    <th className="text-left font-normal px-4 py-2">ID</th>
                    <th className="text-left font-normal px-2 py-2">GÖREV</th>
                    <th className="text-left font-normal px-2 py-2 hidden lg:table-cell">İŞ KOLU</th>
                    <th className="text-left font-normal px-2 py-2">DURUM</th>
                    <th className="text-left font-normal px-2 py-2 hidden lg:table-cell">SON TARİH</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const b = bucketOf(t);
                    const bc = b.color === "accent" ? "rgb(var(--sx-accent-rgb))" : b.color;
                    const on = selId === t.id;
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setSelId(t.id)}
                        data-testid={`teknik-row-${t.id}`}
                        className={`border-b border-white/5 cursor-pointer transition-colors ${on ? "bg-sertex-cyan/10" : "hover:bg-white/5"}`}
                      >
                        <td className="px-4 py-2 text-sertex-cyan whitespace-nowrap">{shortId(t.id)}</td>
                        <td className="px-2 py-2 text-sertex-text max-w-[280px] truncate">{t.title}</td>
                        <td className="px-2 py-2 text-sertex-textMuted hidden lg:table-cell truncate max-w-[140px]">{catName(t.category_id) || "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap"><span style={{ color: bc }}>[{b.label}]</span></td>
                        <td className="px-2 py-2 text-sertex-textMuted hidden lg:table-cell whitespace-nowrap">{fmtDate(t.due_date) || "—"}</td>
                        <td className="px-2 py-2">
                          <button onClick={(e) => { e.stopPropagation(); complete(t.id); }} data-testid={`teknik-complete-${t.id}`} className="text-emerald-400 hover:text-emerald-300">[✓]</button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sertex-textMuted" data-testid="teknik-empty">// aktif görev yok</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Detay paneli */}
          <div className="w-[280px] shrink-0 border-l border-sertex-cyan/20 p-4 overflow-y-auto scrollbar-sertex hidden xl:block" data-testid="teknik-details">
            {!sel ? (
              <div className="text-[11px] text-sertex-textMuted">// bir görev seç → detaylar</div>
            ) : (
              <div className="space-y-3">
                <div className="text-sertex-cyan text-[11px]">DETAY: {shortId(sel.id)}</div>
                <div className="text-sertex-text text-sm">{sel.title}</div>
                {sel.description && <div className="text-[11px] text-sertex-textSecondary whitespace-pre-wrap">{sel.description}</div>}
                <div className="text-[11px] text-sertex-textMuted space-y-1 pt-2 border-t border-white/10">
                  <div>durum : <span style={{ color: bucketOf(sel).color === "accent" ? "rgb(var(--sx-accent-rgb))" : bucketOf(sel).color }}>{bucketOf(sel).label}</span></div>
                  <div>iş_kolu : {catName(sel.category_id) || "—"}</div>
                  <div>sahibi : {sel.assignee_name || "—"}</div>
                  <div>son_tarih : {fmtDate(sel.due_date) || "—"}</div>
                  <div>alt_görev : {(sel.subtasks || []).length}</div>
                </div>
                <button onClick={() => complete(sel.id)} data-testid="teknik-detail-complete" className="w-full py-1.5 rounded border border-emerald-400/50 text-emerald-300 text-[11px] hover:bg-emerald-400/10">TAMAMLA [✓]</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeknikInterface;
