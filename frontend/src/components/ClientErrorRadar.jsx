import React, { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, RefreshCw, Trash2, Bug, Server, BellRing,
  ChevronDown, ChevronRight, CheckCircle2, RotateCcw, Layers, List,
} from "lucide-react";
import { clientLogsApi } from "../lib/api";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm";

/**
 * Hata Radarı — süper yöneticiye özel frontend (istemci) hata kayıtları paneli.
 * - Ayrı sekme (tek tık): Ayarlar → Hata Radarı.
 * - Çözümleme: bir hatayı "çözüldü" işaretleyip aktif listeden gizle.
 * - Filtre: seviyeye göre süz (Hata+Kritik / Uyarı) + en sık tekrarları grupla.
 * - Yeni-hata bildirimi cooldown (dk) ayarı.
 */

const COOLDOWN_OPTS = [5, 15, 30, 60];
const LEVEL_OPTS = [
  { key: "all", label: "Tümü", param: "" },
  { key: "err", label: "Hata + Kritik", param: "error,critical,fatal" },
  { key: "warn", label: "Uyarı", param: "warning,warn" },
];
const STATUS_OPTS = [
  { key: "active", label: "Aktif" },
  { key: "resolved", label: "Çözüldü" },
  { key: "all", label: "Tümü" },
];

const levelCls = (lvl) => {
  const l = String(lvl || "").toLowerCase();
  if (l === "error" || l === "critical" || l === "fatal") return "text-sertex-danger";
  if (l === "warning" || l === "warn") return "text-orange-300";
  return "text-sertex-textMuted";
};

const groupLogs = (logs) => {
  const map = new Map();
  for (const l of logs) {
    const k = (l.message || "").trim() || "(boş)";
    if (!map.has(k)) map.set(k, { message: k, count: 0, level: l.level, last: l.created_at, items: [] });
    const g = map.get(k);
    g.count += 1;
    g.items.push(l);
    if (l.created_at && (!g.last || l.created_at > g.last)) { g.last = l.created_at; g.level = l.level; }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
};

const StatCard = ({ label, value, sub, accent, testid }) => (
  <div data-testid={testid} className={`glass-panel corner-bracket p-3 border ${accent}`}>
    <div className="font-mono font-bold text-2xl tabular-nums neon-glow" data-testid={`${testid}-value`}>{value}</div>
    <div className="hud-text opacity-80 mt-0.5">{label}</div>
    {sub && <div className="text-[10px] font-mono text-sertex-textMuted mt-0.5 normal-case">{sub}</div>}
  </div>
);

const Chip = ({ active, onClick, children, testid }) => (
  <button
    data-testid={testid}
    onClick={onClick}
    className={`px-2.5 py-1 rounded border hud-text transition-colors ${
      active
        ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
        : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:bg-sertex-cyan/5"
    }`}
  >
    {children}
  </button>
);

const ClientErrorRadar = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("active");
  const [grouped, setGrouped] = useState(false);
  const [expanded, setExpanded] = useState({});

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const levelParam = (LEVEL_OPTS.find((o) => o.key === level) || {}).param || "";
      const d = await clientLogsApi.list({ limit: 200, status, level: levelParam });
      setData(d);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Hata kayıtları alınamadı");
    } finally {
      setLoading(false);
    }
  }, [status, level]);

  const loadCfg = useCallback(async () => {
    try { setCfg(await clientLogsApi.getNotifySettings()); } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh(true), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => { loadCfg(); }, [loadCfg]);

  const saveCfg = async (patch) => {
    const next = { ...(cfg || { cooldown_min: 15, enabled: true }), ...patch };
    setCfg(next);
    setSavingCfg(true);
    try {
      setCfg(await clientLogsApi.setNotifySettings(next));
      toast.success("Bildirim ayarı kaydedildi");
    } catch (e) {
      toast.error("Ayar kaydedilemedi");
      loadCfg();
    } finally {
      setSavingCfg(false);
    }
  };

  const clearAll = async () => {
    if (!(await confirmDialog({ message: "Tüm frontend hata kayıtları kalıcı olarak silinsin mi?", danger: true }))) return;
    try {
      await clientLogsApi.clear();
      await refresh(true);
      toast.success("Hata kayıtları temizlendi");
    } catch (e) {
      toast.error("Temizlenemedi");
    }
  };

  const toggleResolve = async (l) => {
    try {
      await clientLogsApi.resolve(l.id, !l.resolved);
      await refresh(true);
      toast.success(l.resolved ? "Aktif sorunlara geri alındı" : "Çözüldü olarak işaretlendi");
    } catch {
      toast.error("İşlem başarısız");
    }
  };

  const resolveGroup = async (g) => {
    const target = status !== "resolved"; // aktif/tümü → çöz; çözüldü görünümü → geri al
    try {
      const r = await clientLogsApi.resolveBulk(g.message, target);
      await refresh(true);
      toast.success(`${r?.updated ?? 0} kayıt ${target ? "çözüldü" : "geri alındı"}`);
    } catch {
      toast.error("İşlem başarısız");
    }
  };

  const logs = data?.logs || [];
  const active = data?.active ?? 0;
  const last24h = data?.last_24h ?? 0;
  const total = data?.total ?? 0;
  const groups = grouped ? groupLogs(logs) : [];

  return (
    <div className="space-y-4" data-testid="error-radar-panel">
      {/* Header */}
      <div className="glass-panel corner-bracket p-3 border-sertex-danger/30 flex items-center gap-3">
        <div className="h-10 w-10 rounded-md border border-sertex-danger/50 bg-sertex-danger/15 flex items-center justify-center">
          <Bug className="h-5 w-5 text-sertex-danger" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="hud-text text-sertex-danger">HATA RADARI · FRONTEND</div>
          <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
            Web + mobil istemcilerde oluşan yakalanmamış hatalar (30 gün saklanır)
          </div>
        </div>
        <button
          onClick={() => refresh()}
          data-testid="error-radar-refresh"
          disabled={loading}
          className="p-1.5 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded disabled:opacity-40"
          title="Yenile"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          testid="error-radar-active"
          label="AKTİF SORUN" value={active}
          accent={active > 0 ? "border-sertex-danger/40 text-sertex-danger" : "border-emerald-400/30 text-emerald-300"}
          sub={active > 0 ? "Çözüm bekliyor" : "Temiz ✓"}
        />
        <StatCard
          testid="error-radar-24h"
          label="SON 24 SAAT" value={last24h}
          accent="border-orange-400/30 text-orange-300"
          sub={`${total} toplam kayıt`}
        />
      </div>

      {/* Bildirim ayarı — ayarlanabilir cooldown */}
      <div className="glass-panel corner-bracket p-3 border-sertex-cyan/25 space-y-2.5" data-testid="error-radar-notify">
        <div className="hud-text text-sertex-cyan flex items-center gap-1.5">
          <BellRing className="h-3 w-3" /> YENİ HATA BİLDİRİMİ
        </div>
        <label className="flex items-center gap-2 cursor-pointer" data-testid="error-radar-notify-enabled">
          <input
            type="checkbox"
            checked={cfg?.enabled ?? true}
            disabled={savingCfg || !cfg}
            onChange={(e) => saveCfg({ enabled: e.target.checked })}
            className="accent-sertex-cyan"
          />
          <span className="text-[12px] font-mono text-sertex-text normal-case">
            Yeni hata düşünce süper yöneticilere anlık bildirim gönder
          </span>
        </label>
        <div className={`space-y-1.5 ${cfg?.enabled === false ? "opacity-40 pointer-events-none" : ""}`}>
          <div className="text-[10px] font-mono text-sertex-textMuted normal-case">
            Bildirim sıklığı (spam koruması) — bu süre içinde en fazla 1 toplu bildirim:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COOLDOWN_OPTS.map((m) => (
              <Chip key={m} testid={`error-radar-cooldown-${m}`} active={(cfg?.cooldown_min ?? 15) === m} onClick={() => saveCfg({ cooldown_min: m })}>
                {m < 60 ? `${m} dk` : "1 saat"}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {/* Filtre + görünüm çubuğu */}
      <div className="glass-panel corner-bracket p-3 border-sertex-cyan/20 space-y-2" data-testid="error-radar-filters">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="hud-text text-sertex-textMuted">SEVİYE:</span>
          {LEVEL_OPTS.map((o) => (
            <Chip key={o.key} testid={`error-radar-level-${o.key}`} active={level === o.key} onClick={() => setLevel(o.key)}>{o.label}</Chip>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="hud-text text-sertex-textMuted">DURUM:</span>
          {STATUS_OPTS.map((o) => (
            <Chip key={o.key} testid={`error-radar-status-${o.key}`} active={status === o.key} onClick={() => setStatus(o.key)}>{o.label}</Chip>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <Chip testid="error-radar-view-list" active={!grouped} onClick={() => setGrouped(false)}>
              <span className="flex items-center gap-1"><List className="h-3 w-3" /> Liste</span>
            </Chip>
            <Chip testid="error-radar-view-group" active={grouped} onClick={() => setGrouped(true)}>
              <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> Grupla</span>
            </Chip>
          </div>
        </div>
      </div>

      {/* Liste / Grup */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="hud-text text-orange-300 flex items-center gap-1.5">
            <Server className="h-3 w-3" /> {grouped ? "HATA GRUPLARI (SIK → SEYREK)" : "HATA KAYITLARI"}
          </div>
          {logs.length > 0 && (
            <button
              onClick={clearAll}
              data-testid="error-radar-clear"
              className="inline-flex items-center gap-1 px-2 py-0.5 border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 rounded hud-text transition-colors"
            >
              <Trash2 className="h-3 w-3" /> TEMİZLE
            </button>
          )}
        </div>

        {loading && !data ? (
          <div className="py-6 text-center hud-text text-sertex-textMuted" data-testid="error-radar-loading">YÜKLENİYOR...</div>
        ) : logs.length === 0 ? (
          <div className="py-6 text-center text-[11px] font-mono text-sertex-textMuted normal-case border border-sertex-cyan/10 rounded" data-testid="error-radar-empty">
            {status === "resolved" ? "Çözülmüş kayıt yok." : "Aktif frontend hatası yok — sistem temiz ✓"}
          </div>
        ) : grouped ? (
          <div className="space-y-1.5" data-testid="error-radar-groups">
            {groups.map((g, idx) => {
              const open = !!expanded[`g:${g.message}`];
              return (
                <div key={g.message} data-testid={`error-radar-group-${idx}`} className="glass-panel border border-orange-400/20 rounded p-2 text-[11px] font-mono">
                  <div className="flex items-start gap-2">
                    <button onClick={() => setExpanded((p) => ({ ...p, [`g:${g.message}`]: !p[`g:${g.message}`] }))} className="flex-1 text-left flex items-start gap-2 min-w-0">
                      {open ? <ChevronDown className="h-3 w-3 mt-0.5 shrink-0 text-sertex-textMuted" /> : <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-sertex-textMuted" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-1.5 rounded text-[10px] font-bold bg-sertex-danger/20 text-sertex-danger tabular-nums">×{g.count}</span>
                          <span className={`px-1 rounded text-[9px] font-semibold uppercase ${levelCls(g.level)} bg-sertex-danger/10`}>{g.level || "error"}</span>
                          <span className="text-sertex-textMuted normal-case ml-auto text-[10px]">{g.last ? new Date(g.last).toLocaleString() : ""}</span>
                        </div>
                        <div className="text-sertex-text mt-0.5 normal-case break-words">{g.message}</div>
                      </div>
                    </button>
                    <button
                      onClick={() => resolveGroup(g)}
                      data-testid={`error-radar-group-resolve-${idx}`}
                      title={status === "resolved" ? "Grubu geri al" : "Grubu çöz"}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10 rounded hud-text transition-colors"
                    >
                      {status === "resolved" ? <RotateCcw className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                      {status === "resolved" ? "Geri Al" : `Çöz (${g.count})`}
                    </button>
                  </div>
                  {open && (
                    <div className="mt-2 pl-5 space-y-1 border-l border-orange-400/20">
                      {g.items.map((l, i) => (
                        <div key={l.id || i} className="text-[10px] text-sertex-textMuted normal-case flex items-center gap-2">
                          <span className="px-1 rounded bg-sertex-cyan/15 text-sertex-cyan">{l.username || "anonim"}</span>
                          {l.source && <span>◈ {l.source}</span>}
                          <span className="ml-auto">{l.created_at ? new Date(l.created_at).toLocaleString() : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5" data-testid="error-radar-list">
            {logs.map((e, idx) => {
              const open = !!expanded[e.id];
              return (
                <div key={e.id || idx} data-testid={`error-radar-row-${idx}`} className={`glass-panel border rounded p-2 text-[11px] font-mono ${e.resolved ? "border-emerald-400/20 opacity-70" : "border-orange-400/20"}`}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => setExpanded((p) => ({ ...p, [e.id]: !p[e.id] }))} className="flex-1 text-left flex items-start gap-2 min-w-0">
                      {e.stack ? (
                        open ? <ChevronDown className="h-3 w-3 mt-0.5 shrink-0 text-sertex-textMuted" /> : <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-sertex-textMuted" />
                      ) : <AlertTriangle className={`h-3 w-3 mt-0.5 shrink-0 ${levelCls(e.level)}`} />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1 rounded text-[9px] font-semibold uppercase ${levelCls(e.level)} bg-sertex-danger/10`}>{e.level || "error"}</span>
                          <span className="px-1 rounded text-[9px] bg-sertex-cyan/15 text-sertex-cyan normal-case">{e.username || "anonim"}</span>
                          {e.resolved && <span className="px-1 rounded text-[9px] bg-emerald-400/15 text-emerald-300 normal-case">çözüldü</span>}
                          <span className="text-sertex-textMuted normal-case ml-auto text-[10px]">{e.created_at ? new Date(e.created_at).toLocaleString() : ""}</span>
                        </div>
                        <div className="text-sertex-text mt-0.5 normal-case break-words">{e.message}</div>
                        <div className="flex items-center gap-2 flex-wrap text-[10px] text-sertex-textMuted/70 normal-case mt-0.5">
                          {e.source && <span>◈ {e.source}</span>}
                          {e.user_agent && <span>{e.user_agent}</span>}
                          {e.page_url && <span className="truncate max-w-[220px]">{e.page_url}</span>}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => toggleResolve(e)}
                      data-testid={`error-radar-resolve-${idx}`}
                      title={e.resolved ? "Aktife geri al" : "Çözüldü işaretle"}
                      className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded border hud-text transition-colors ${
                        e.resolved
                          ? "border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10"
                          : "border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10"
                      }`}
                    >
                      {e.resolved ? <RotateCcw className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                      {e.resolved ? "Geri Al" : "Çöz"}
                    </button>
                  </div>
                  {open && e.stack && (
                    <pre className="mt-2 p-2 rounded bg-sertex-bg/70 text-[10px] text-sertex-textSecondary normal-case whitespace-pre-wrap break-words overflow-x-auto scrollbar-sertex">{e.stack}</pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-[10px] font-mono text-sertex-textMuted normal-case text-center pt-1">Otomatik yenileme: 30 saniye</div>
    </div>
  );
};

export default ClientErrorRadar;
