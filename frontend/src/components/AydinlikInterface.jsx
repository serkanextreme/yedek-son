import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard, ListTodo, StickyNote, FolderOpen, Settings as SettingsIcon,
  Users, Plus, Search, Check, Layers, Bell,
} from "lucide-react";
import { toast } from "sonner";
import { tasksApi, taskCategoriesApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { setInterfaceMode } from "../lib/appearance";
import { isActive, bucketOf, fmtDate, matchesQuery, initials } from "../lib/interfaceHelpers";

// AYDINLIK — açık tema. Tüm uygulama koyu; bu arayüz ferah beyaz zemin sunar.
// Renkler bilinçli olarak açık paletle sabittir; vurgu (accent) değişkenden gelir.
const C = { bg: "#eef2f7", card: "#ffffff", text: "#0f172a", muted: "#64748b", line: "#e2e8f0", sidebar: "#f8fafc" };

const AydinlikInterface = ({ onOpenSection, onOpenSettings, sidebarOpen, isMobile }) => {
  const { user, teamFeaturesVisible } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

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

  const complete = async (id) => {
    try {
      await tasksApi.setStatus(id, "done");
      setTasks((p) => p.map((t) => (t.id === id ? { ...t, status: "done" } : t)));
      toast.success("Görev tamamlandı");
    } catch { toast.error("Hata"); }
  };

  const NAV = [
    { key: "home", label: "Panel", icon: LayoutDashboard, onClick: null, active: true },
    { key: "tasks", label: "Görevler", icon: ListTodo, onClick: () => onOpenSection?.("tasks") },
    ...(teamFeaturesVisible ? [{ key: "team", label: "Ekip", icon: Users, onClick: () => onOpenSection?.("team") }] : []),
    { key: "notes", label: "Notlar", icon: StickyNote, onClick: () => onOpenSection?.("notes") },
    { key: "files", label: "Dosyalar", icon: FolderOpen, onClick: () => onOpenSection?.("files") },
    { key: "settings", label: "Ayarlar", icon: SettingsIcon, onClick: () => onOpenSettings?.() },
  ];

  return (
    <div
      className="absolute inset-0 z-10 overflow-hidden"
      data-testid="aydinlik-interface"
      style={{ right: !isMobile && sidebarOpen ? 360 : 0, bottom: isMobile ? 64 : 0, transition: "right 300ms", background: C.bg, color: C.text }}
    >
      <div className="flex h-full">
        {/* Sol menü */}
        <div className="w-[200px] shrink-0 p-4 flex flex-col gap-1" style={{ background: C.sidebar, borderRight: `1px solid ${C.line}` }} data-testid="aydinlik-sidebar">
          <div className="text-lg font-bold tracking-tight mb-4" style={{ color: C.text }}>SERTEX</div>
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.key}
                onClick={n.onClick || undefined}
                data-testid={`aydinlik-nav-${n.key}`}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={n.active
                  ? { background: "rgb(var(--sx-accent-rgb) / 0.15)", color: "rgb(var(--sx-accent-rgb))" }
                  : { color: C.muted }}
              >
                <Icon className="h-4 w-4 shrink-0" /> {n.label}
              </button>
            );
          })}
          <button
            onClick={() => { setInterfaceMode("detayli"); toast.success("Detaylı görünüme geçildi"); }}
            data-testid="aydinlik-switch-detayli"
            className="mt-auto w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ color: C.muted, border: `1px solid ${C.line}` }}
          >
            <Layers className="h-3.5 w-3.5" /> Detaylı görünüm
          </button>
        </div>

        {/* Ana içerik */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 px-6 py-3 flex items-center gap-4" style={{ borderBottom: `1px solid ${C.line}`, background: C.card }}>
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.muted }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Görev ara..."
                data-testid="aydinlik-search"
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }}
              />
            </div>
            <Bell className="h-4 w-4" style={{ color: C.muted }} />
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: "rgb(var(--sx-accent-rgb) / 0.15)", color: "rgb(var(--sx-accent-rgb))" }}>{initials(user?.username)}</div>
              <span className="hidden sm:block text-sm">{user?.username}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-xs" style={{ color: C.muted }}>{new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })}</div>
                <h1 className="text-2xl font-bold mt-0.5">Görevlerin</h1>
              </div>
              <button
                onClick={() => onOpenSection?.("tasks")}
                data-testid="aydinlik-add-task"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: "rgb(var(--sx-accent-rgb))" }}
              >
                <Plus className="h-4 w-4" /> Yeni Görev
              </button>
            </div>

            {loading ? (
              <div className="py-10 text-center text-sm" style={{ color: C.muted }} data-testid="aydinlik-loading">Yükleniyor...</div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl p-8 text-center" style={{ background: C.card, border: `1px solid ${C.line}` }} data-testid="aydinlik-empty">
                <div className="font-medium mb-1">Aktif görev yok</div>
                <div className="text-sm" style={{ color: C.muted }}>{q ? "Eşleşme bulunamadı." : "Yeni görev ekleyerek başla."}</div>
              </div>
            ) : (
              <div className="space-y-3 max-w-3xl" data-testid="aydinlik-list">
                {rows.map((t, i) => {
                  const b = bucketOf(t);
                  const bc = b.color === "accent" ? "rgb(var(--sx-accent-rgb))" : b.color;
                  const due = fmtDate(t.due_date);
                  return (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className="rounded-xl p-4 flex items-center gap-3"
                      style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 1px 3px rgba(15,23,42,0.06)" }}
                      data-testid={`aydinlik-card-${t.id}`}
                    >
                      <button
                        onClick={() => complete(t.id)}
                        data-testid={`aydinlik-complete-${t.id}`}
                        title="Tamamla"
                        className="h-6 w-6 rounded-md shrink-0 flex items-center justify-center transition-colors"
                        style={{ border: `2px solid ${C.muted}` }}
                      >
                        <Check className="h-3.5 w-3.5" style={{ color: C.muted }} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{t.title}</div>
                        <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: C.muted }}>
                          {due && <span>Son tarih: {due}</span>}
                          {catName(t.category_id) && <span>· {catName(t.category_id)}</span>}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-medium px-2 py-1 rounded-full" style={{ color: bc, background: `${b.color === "accent" ? "rgb(var(--sx-accent-rgb) / 0.12)" : bc + "22"}` }}>{b.label}</span>
                      {t.assignee_name && (
                        <div className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold" style={{ background: C.bg, color: C.muted }} title={t.assignee_name}>{initials(t.assignee_name)}</div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AydinlikInterface;
