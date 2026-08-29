// Faz 9 CP6 — Global Announcement Banner.
//
// A fixed top-of-screen strip that renders the highest-severity active
// announcement targeted at the current user. Sources of truth:
//   1. On mount → GET /api/announcements/active (catches offline users)
//   2. Live push → `sertex:announcement` CustomEvent re-broadcast by
//      NotificationBell from the shared SSE stream.
//
// Behaviour:
//   * `info` / `warning` → user can dismiss client-side (session only).
//   * `critical` OR `require_ack=true` → user must click "Anladım" which
//     POSTs /ack; the row is then filtered out on the next refetch.
//   * Multiple visible → the first (most recent) is rendered; a counter
//     hints "+N more" so nothing gets hidden silently.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { X, Megaphone, AlertTriangle, AlertOctagon, Check } from "lucide-react";
import { toast } from "sonner";
import { announcementsApi } from "../lib/api";

const SEVERITY_META = {
  info:     { icon: Megaphone,      border: "border-cyan-400/50",   bg: "bg-cyan-500/10",   text: "text-cyan-200",   label: "BİLGİ" },
  warning:  { icon: AlertTriangle,  border: "border-amber-400/60",  bg: "bg-amber-500/10",  text: "text-amber-200",  label: "UYARI" },
  critical: { icon: AlertOctagon,   border: "border-rose-500/60",   bg: "bg-rose-500/15",   text: "text-rose-200",   label: "KRİTİK" },
};

const _dismissedKey = (id) => `sertex_ann_dismissed_${id}`;

export default function AnnouncementBanner() {
  const [rows, setRows] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);
  // Client-side dismissed IDs (info/warning). Persisted per-tab so it
  // doesn't leak across sessions for people who share a device.
  const [dismissed, setDismissed] = useState(() => {
    const s = new Set();
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith("sertex_ann_dismissed_")) {
          s.add(k.replace("sertex_ann_dismissed_", ""));
        }
      }
    } catch { /* private mode */ }
    return s;
  });

  // Initial fetch + refetch when a live push arrives.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await announcementsApi.activeForMe();
        if (alive) setRows(Array.isArray(list) ? list : []);
      } catch (e) {
        // Silent — banner is best-effort UX. Log for the console just in case.
        console.warn("[announcement] initial fetch failed:", e?.message || e);
        if (alive) setRows([]);
      }
    })();
    return () => { alive = false; };
  }, [refreshTick]);

  // Live push listener (re-broadcast by NotificationBell).
  useEffect(() => {
    const onLive = (ev) => {
      const ann = ev?.detail;
      if (!ann || !ann.id) return;
      setRows((old) => {
        if (old.some((x) => x.id === ann.id)) return old;
        // New arrival — insert at the top; assume `acked=false` because we
        // just received it and haven't confirmed anything yet.
        return [{ ...ann, acked: false }, ...old];
      });
      // Also surface a toast for people focused on another panel.
      const meta = SEVERITY_META[ann.severity] || SEVERITY_META.info;
      if (ann.severity === "critical") {
        toast.error(`${meta.label}: ${ann.title}`);
      } else if (ann.severity === "warning") {
        toast.warning(`${meta.label}: ${ann.title}`);
      } else {
        toast(`${meta.label}: ${ann.title}`);
      }
    };
    window.addEventListener("sertex:announcement", onLive);
    return () => window.removeEventListener("sertex:announcement", onLive);
  }, []);

  const visible = useMemo(() => {
    return rows.filter((a) => {
      if (a.acked) return false;
      if (dismissed.has(a.id)) return false;
      return true;
    });
  }, [rows, dismissed]);

  const current = visible[0];
  const extraCount = Math.max(0, visible.length - 1);

  const dismiss = useCallback((id) => {
    try { sessionStorage.setItem(_dismissedKey(id), "1"); } catch { /* private mode */ }
    setDismissed((s) => {
      const n = new Set(s);
      n.add(id);
      return n;
    });
  }, []);

  const ack = useCallback(async (id) => {
    try {
      await announcementsApi.ack(id);
      setRows((old) => old.map((a) => (a.id === id ? { ...a, acked: true } : a)));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Onaylanamadı");
    }
  }, []);

  if (!current) return null;
  const meta = SEVERITY_META[current.severity] || SEVERITY_META.info;
  const Icon = meta.icon;
  const forceAck = current.require_ack || current.severity === "critical";

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[95] border-b backdrop-blur-md ${meta.border} ${meta.bg}`}
      data-testid="announcement-banner"
      data-severity={current.severity}
    >
      <div className="max-w-[1600px] mx-auto px-3 py-2 flex items-start gap-3">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.text}`} />
        <div className="flex-1 min-w-0">
          <div className={`hud-text ${meta.text} flex items-center gap-2`}>
            <span className="font-bold">{meta.label}</span>
            <span className="opacity-60">·</span>
            <span className="font-semibold truncate" data-testid="announcement-title">
              {current.title}
            </span>
            {extraCount > 0 && (
              <span className="opacity-70 text-[10px]" data-testid="announcement-extra-count">
                +{extraCount} daha
              </span>
            )}
          </div>
          <div className={`text-xs font-mono normal-case mt-0.5 ${meta.text} opacity-90`}>
            {current.message}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {forceAck ? (
            <button
              type="button"
              onClick={() => ack(current.id)}
              data-testid="announcement-ack-btn"
              className={`px-2 py-1 rounded border ${meta.border} ${meta.text} hover:opacity-100 opacity-90 text-[10px] font-mono hud-text flex items-center gap-1`}
            >
              <Check className="h-3 w-3" />
              ANLADIM
            </button>
          ) : (
            <button
              type="button"
              onClick={() => dismiss(current.id)}
              data-testid="announcement-dismiss-btn"
              title="Kapat"
              className={`p-1 rounded ${meta.text} hover:bg-white/5`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
