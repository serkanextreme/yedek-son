import React, { useEffect, useRef, useState } from "react";
import { Bell, AlertTriangle, Check, CheckCheck, X, Clock, Link2, Link2Off, Building2, Volume2, VolumeX, Settings as SettingsIcon, KeyRound, PackageX, Share2, Trash2, CheckSquare, Square, BellRing, Moon, ShieldCheck, ShieldAlert, Bug } from "lucide-react";
import { notificationsApi, companyPermissionsApi } from "../lib/api";
import { toast } from "sonner";
import {
  loadDesktopPref, saveDesktopPref, getPermission, requestPermission,
  processBatch, isDesktopEnabled, isQuietNow, fireTestNotification,
} from "../lib/desktopNotifier";

/**
 * Team Faz 2 · in-app notification bell.
 * ---------------------------------------------------------------------
 * - Polls /api/notifications/unread-count every 60 s (cheap COUNT query).
 * - Clicking the bell fetches the latest 50 rows and opens a popover.
 * - "Tümünü okundu işaretle" flushes them all.
 *
 * Rendered in NeuralLinkHeader for every authenticated user.
 */
const RELATIVE_TIME_UNITS = [
  { name: "yıl", ms: 365 * 24 * 3600 * 1000 },
  { name: "ay", ms: 30 * 24 * 3600 * 1000 },
  { name: "gün", ms: 24 * 3600 * 1000 },
  { name: "saat", ms: 3600 * 1000 },
  { name: "dk", ms: 60 * 1000 },
];
const formatRelative = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "az önce";
  for (const u of RELATIVE_TIME_UNITS) {
    const v = Math.floor(diff / u.ms);
    if (v >= 1) return `${v} ${u.name} önce`;
  }
  return "";
};

const NotificationBell = () => {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [prefOpen, setPrefOpen] = useState(false);
  // Bildirim silme — seçim modu + seçili id'ler.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pref, setPref] = useState(loadDesktopPref());
  const [permission, setPermission] = useState(getPermission());
  const popRef = useRef(null);

  // Poll unread count on mount + every 60 s.
  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const r = await notificationsApi.unreadCount();
        if (!cancel) setUnread(r?.unread || 0);
        // Desktop push — only fetch rows if desktop notifications are
        // effectively enabled (permission granted + not explicitly disabled).
        if ((r?.unread || 0) > 0) {
          if (isDesktopEnabled()) {
            try {
              const rows = await notificationsApi.list(true, 20);
              if (!cancel) processBatch(rows || []);
            } catch (e) { console.warn("[NotificationBell.jsx] hata bastırıldı:", e); }
          }
        }
      } catch { /* auth/401 → silently drop */ }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  // Faz 9 CP4.17 — Server-Sent Events live push. Opens an EventSource
  // against `/api/notifications/stream?token=…` (EventSource cannot send
  // custom headers so the JWT rides in a query param, validated server-
  // side). Each incoming `new` event bumps the bell instantly without
  // waiting for the 60-second poll. The polling loop above stays as a
  // safety net in case ingress kills the stream.
  useEffect(() => {
    const backend = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem("sertex_token_v1");
    if (!backend || !token || typeof EventSource === "undefined") return;

    const url = `${backend}/api/notifications/stream?token=${encodeURIComponent(token)}`;
    let es = null;
    let closed = false;

    try {
      es = new EventSource(url);
    } catch {
      return;
    }

    const handleNew = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const n = data?.notification;
        if (!n || !n.id) return;
        setUnread((u) => u + 1);
        // If the popover is open, prepend the new row so the user sees it
        // immediately. Otherwise the next `openPopover()` call fetches it.
        setItems((old) => (old.some((x) => x.id === n.id) ? old : [n, ...old]));
        // Optional desktop push mirroring the polling path.
        if (isDesktopEnabled()) {
          try { processBatch([n]); } catch (e) { console.warn("[NotificationBell.jsx] hata bastırıldı:", e); }
        }
      } catch { /* malformed frame — ignore */ }
    };

    es.addEventListener("new", handleNew);
    // Faz 9 CP6 — Global Announcement System. The backend publishes an
    // "announcement" SSE event to every targeted user. We re-broadcast it as
    // a browser CustomEvent so AnnouncementBanner (or any future listener)
    // can render it without opening a second EventSource.
    const handleAnnouncement = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const ann = data?.announcement;
        if (!ann || !ann.id) return;
        window.dispatchEvent(new CustomEvent("sertex:announcement", { detail: ann }));
      } catch { /* malformed frame — ignore */ }
    };
    es.addEventListener("announcement", handleAnnouncement);
    es.onerror = () => {
      // EventSource auto-reconnects on transient errors; nothing to do.
      // If the connection is fully closed (state=2) we drop it so the
      // browser doesn't hammer the server in a tight loop.
      if (es && es.readyState === 2 && !closed) {
        closed = true;
        es.close();
      }
    };

    return () => {
      closed = true;
      if (es) es.close();
    };
  }, []);

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const openPopover = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const rows = await notificationsApi.list(false, 50);
      setItems(rows || []);
    } catch (e) {
      toast.error("Bildirimler yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  const markOne = async (n) => {
    if (n.read_at) return;
    try {
      await notificationsApi.markRead(n.id);
      setItems((old) => old.map((x) => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      setUnread((u) => Math.max(0, u - 1));
    } catch { /* keep silent */ }
  };

  // Click a notification row → mark as read + jump the user to the referenced
  // task (or, for cross-perm rows, do nothing — the inline Approve/Decline
  // buttons handle the action).
  const clickItem = async (n) => {
    // Cross-perm rows have no task_id; they carry a permission_id instead
    // and rely on the inline Approve/Decline buttons. Still mark them read.
    if (n.type && n.type.startsWith("cross_perm_")) {
      await markOne(n);
      return;
    }
    await markOne(n);
    setOpen(false);
    // Hata Radarı bildirimi — doğrudan Ayarlar → Hata Radarı sekmesini aç.
    if (n.type === "client_error") {
      window.dispatchEvent(new CustomEvent("sertex:open-settings-tab", { detail: { tab: "errorradar" } }));
      return;
    }
    // Faz 10 — orphaned-tasks notification: jump straight to the "Yarım Kalan"
    // sidebar tab so the manager can reclaim/reassign the tasks.
    if (n.type === "tasks_orphaned") {
      window.dispatchEvent(new CustomEvent("sertex:sidebar-tab", { detail: "orphans" }));
      return;
    }
    // Faz 9 CP4.33 — OTP unlock notification: fire a dedicated event that
    // TasksPanel listens for and opens the UnlockOtpModal directly.
    if (n.type === "task_unlock_offered" && n.task_id) {
      window.dispatchEvent(new CustomEvent("sertex:task-unlock-request", {
        detail: { task_id: n.task_id, owner_user_id: n.owner_user_id },
      }));
      return;
    }
    if (n.type === "task_nudge") {
      const tid = n.payload?.task_id;
      if (tid) {
        window.__sertex_pending_task_jump = { task_id: tid, ts: Date.now() };
        window.dispatchEvent(new CustomEvent("sertex:task-jump", { detail: { task_id: tid } }));
      }
      return;
    }
    // Günlük Tekrar Hatırlatma — özet satırı. Tek görev varsa ona atla,
    // yoksa Görevler sekmesini aç (task_id "overdue-daily:tarih" gerçek görev değil).
    if (n.type === "overdue_daily") {
      const tid = n.payload?.first_task_id;
      if (tid) {
        window.__sertex_pending_task_jump = { task_id: tid, ts: Date.now() };
        window.dispatchEvent(new CustomEvent("sertex:task-jump", { detail: { task_id: tid } }));
      } else {
        window.dispatchEvent(new CustomEvent("sertex:sidebar-tab", { detail: "tasks" }));
      }
      return;
    }
    if (n.task_id) {
      window.__sertex_pending_task_jump = {
        task_id: n.task_id,
        owner_user_id: n.owner_user_id,
        ts: Date.now(),
      };
      window.dispatchEvent(new CustomEvent("sertex:task-jump", {
        detail: { task_id: n.task_id, owner_user_id: n.owner_user_id },
      }));
    }
  };

  // Faz 9 CP1 — Approve / Decline inline for a `cross_perm_request` notif.
  const respondPerm = async (n, approve) => {
    try {
      await companyPermissionsApi.respond(n.permission_id, approve);
      toast.success(approve ? "İstek onaylandı" : "İstek reddedildi");
      // Mark THIS notification as read so it collapses in the popover.
      await markOne(n);
      // Refresh full list so a follow-up response notif can appear if any.
      const rows = await notificationsApi.list(false, 50);
      setItems(rows || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "İşlem başarısız");
    }
  };

  const markAll = async () => {
    try {
      const r = await notificationsApi.markAllRead();
      const now = new Date().toISOString();
      setItems((old) => old.map((x) => x.read_at ? x : { ...x, read_at: now }));
      setUnread(0);
      toast.success(`${r?.updated || 0} bildirim okundu`);
    } catch (e) {
      toast.error("İşaretlenemedi");
    }
  };

  // Bildirim silme helper'ları -------------------------------------------
  const removeOne = async (n) => {
    try {
      await notificationsApi.remove(n.id);
      setItems((old) => old.filter((x) => x.id !== n.id));
      if (!n.read_at) setUnread((u) => Math.max(0, u - 1));
      setSelectedIds((s) => {
        const next = new Set(s);
        next.delete(n.id);
        return next;
      });
    } catch {
      toast.error("Silinemedi");
    }
  };

  const removeAllNotifs = async () => {
    try {
      const r = await notificationsApi.removeAll();
      setItems([]);
      setUnread(0);
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success(`${r?.deleted || 0} bildirim silindi`);
    } catch {
      toast.error("Silinemedi");
    }
  };

  const removeSelectedNotifs = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const r = await notificationsApi.removeSelected(ids);
      const removed = new Set(ids);
      const unreadRemoved = items.filter((x) => removed.has(x.id) && !x.read_at).length;
      setItems((old) => old.filter((x) => !removed.has(x.id)));
      if (unreadRemoved) setUnread((u) => Math.max(0, u - unreadRemoved));
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success(`${r?.deleted || 0} bildirim silindi`);
    } catch {
      toast.error("Silinemedi");
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => (open ? setOpen(false) : openPopover())}
        data-testid="notification-bell"
        title={unread > 0 ? `${unread} okunmamış bildirim` : "Bildirimler"}
        className="relative p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded transition-colors"
      >
        <Bell className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-sertex-danger text-white text-[9px] font-mono font-bold flex items-center justify-center border border-sertex-bg"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notification-popover"
          className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-sertex-bg border border-sertex-cyan/40 rounded-md shadow-lg shadow-sertex-cyan/20 z-50"
        >
          <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-sertex-cyan/20 bg-sertex-bg">
            <span className="hud-text text-sertex-cyan flex items-center gap-1">
              <Bell className="h-3 w-3" /> BİLDİRİMLER ({items.length})
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPrefOpen((v) => !v)}
                data-testid="notification-pref-toggle"
                title="Masaüstü bildirim ayarları"
                className={`p-1 border rounded transition-colors ${
                  prefOpen
                    ? "border-emerald-400 text-emerald-300 bg-emerald-400/10"
                    : "border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10"
                }`}
              >
                <SettingsIcon className="h-3 w-3" />
              </button>
              {items.some((n) => !n.read_at) && (
                <button
                  onClick={markAll}
                  data-testid="notification-mark-all"
                  className="p-1 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
                  title="Tümünü okundu işaretle"
                >
                  <CheckCheck className="h-3 w-3" />
                </button>
              )}
              {items.length > 0 && (
                <button
                  onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
                  data-testid="notification-select-toggle"
                  title="Seçerek sil"
                  className={`p-1 border rounded transition-colors ${
                    selectMode
                      ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                      : "border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10"
                  }`}
                >
                  <CheckSquare className="h-3 w-3" />
                </button>
              )}
              {items.length > 0 && (
                <button
                  onClick={removeAllNotifs}
                  data-testid="notification-delete-all"
                  title="Hepsini sil"
                  className="p-1 border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 rounded"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                data-testid="notification-close"
                className="p-1 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
          {/* Seçim modu eylem çubuğu */}
          {selectMode && items.length > 0 && (
            <div
              data-testid="notification-select-bar"
              className="sticky top-[41px] flex items-center justify-between gap-2 px-3 py-1.5 border-b border-sertex-cyan/20 bg-sertex-bg/90"
            >
              <button
                onClick={() =>
                  setSelectedIds((s) =>
                    s.size === items.length ? new Set() : new Set(items.map((x) => x.id))
                  )
                }
                data-testid="notification-select-all"
                className="hud-text text-sertex-cyan hover:underline"
              >
                {selectedIds.size === items.length ? "Seçimi kaldır" : "Tümünü seç"}
              </button>
              <button
                onClick={removeSelectedNotifs}
                disabled={selectedIds.size === 0}
                data-testid="notification-delete-selected"
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-500/50 text-rose-300 hover:bg-rose-500/15 hud-text disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" /> Seçilenleri Sil ({selectedIds.size})
              </button>
            </div>
          )}
          {prefOpen && (
            <div
              data-testid="notification-pref-panel"
              className="px-3 py-2.5 border-b border-sertex-cyan/20 bg-sertex-bg/70 space-y-2"
            >
              <div className="hud-text text-emerald-300 text-[10px]">MASAÜSTÜ BİLDİRİMİ</div>
              {typeof Notification === "undefined" ? (
                <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
                  Tarayıcın masaüstü bildirimi desteklemiyor.
                </div>
              ) : permission === "denied" ? (
                <div className="text-[11px] font-mono text-sertex-danger normal-case">
                  İzin reddedildi. Adres çubuğundaki 🔒 ikonundan bildirim iznini aç.
                </div>
              ) : (
                <>
                  <label
                    data-testid="notification-pref-enable"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={permission === "granted" && pref.disabled !== true}
                      onChange={async (e) => {
                        const want = e.target.checked;
                        if (want) {
                          let p = permission;
                          if (p !== "granted") { p = await requestPermission(); setPermission(p); }
                          if (p === "granted") {
                            const next = saveDesktopPref({ enabled: true, disabled: false });
                            setPref(next);
                            toast.success("Masaüstü bildirimi açıldı");
                          } else {
                            toast.error("Bildirim izni verilmedi");
                          }
                        } else {
                          const next = saveDesktopPref({ enabled: false, disabled: true });
                          setPref(next);
                          toast.success("Masaüstü bildirimi kapatıldı");
                        }
                      }}
                      className="accent-emerald-400"
                    />
                    <span className="text-[11px] font-mono text-sertex-text normal-case">
                      Sertex kapalıyken de masaüstünde bildirim göster
                    </span>
                  </label>
                  <label
                    data-testid="notification-pref-sound"
                    className={`flex items-center gap-2 cursor-pointer ${permission === "granted" && pref.disabled !== true ? "" : "opacity-50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={pref.sound}
                      disabled={!(permission === "granted" && pref.disabled !== true)}
                      onChange={(e) => {
                        const next = saveDesktopPref({ sound: e.target.checked });
                        setPref(next);
                      }}
                      className="accent-emerald-400"
                    />
                    <span className="text-[11px] font-mono text-sertex-text normal-case flex items-center gap-1">
                      {pref.sound ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                      Kısa uyarı sesi de çal
                    </span>
                  </label>
                  <div className="pt-1.5 border-t border-sertex-cyan/10 space-y-1.5">
                    <label
                      data-testid="notification-pref-quiet"
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={!!pref.quietEnabled}
                        onChange={(e) => { const next = saveDesktopPref({ quietEnabled: e.target.checked }); setPref(next); }}
                        className="accent-amber-400"
                      />
                      <span className="text-[11px] font-mono text-sertex-text normal-case flex items-center gap-1">
                        <Moon className="h-3 w-3" /> Sessiz saatler (bu aralıkta sustur)
                      </span>
                    </label>
                    {pref.quietEnabled && (
                      <div className="flex items-center gap-2 pl-6" data-testid="notification-quiet-range">
                        <input
                          type="time"
                          value={pref.quietStart || "22:00"}
                          data-testid="notification-quiet-start"
                          onChange={(e) => { const next = saveDesktopPref({ quietStart: e.target.value }); setPref(next); }}
                          className="bg-sertex-bg border border-sertex-cyan/30 rounded px-1.5 py-0.5 text-[11px] font-mono text-sertex-text"
                        />
                        <span className="text-[10px] font-mono text-sertex-textMuted">→</span>
                        <input
                          type="time"
                          value={pref.quietEnd || "07:00"}
                          data-testid="notification-quiet-end"
                          onChange={(e) => { const next = saveDesktopPref({ quietEnd: e.target.value }); setPref(next); }}
                          className="bg-sertex-bg border border-sertex-cyan/30 rounded px-1.5 py-0.5 text-[11px] font-mono text-sertex-text"
                        />
                        {isQuietNow() && (
                          <span className="text-[9px] font-mono text-amber-300 uppercase">şu an sessiz</span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      let p = permission;
                      if (p !== "granted") { p = await requestPermission(); setPermission(p); }
                      if (p !== "granted") { toast.error("Önce bildirim izni verin"); return; }
                      const ok = fireTestNotification();
                      if (ok) toast.success("Test bildirimi gönderildi ✓");
                      else toast.error("Test bildirimi gönderilemedi");
                    }}
                    data-testid="notification-test-btn"
                    className="w-full flex items-center justify-center gap-1.5 py-1 rounded border border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/10 hud-text text-[10px] transition-colors"
                  >
                    <BellRing className="h-3 w-3" /> Test bildirimi gönder
                  </button>
                  <div className="text-[10px] font-mono text-sertex-textMuted normal-case pt-1 border-t border-sertex-cyan/10">
                    Bildirimler her 60 saniyede kontrol edilir. Aynı bildirim tekrar tetiklenmez.
                  </div>
                </>
              )}
            </div>
          )}
          {loading && (
            <div className="py-6 text-center text-sertex-textMuted hud-text">Yükleniyor...</div>
          )}
          {!loading && items.length === 0 && (
            <div className="py-6 text-center text-sertex-textMuted hud-text">
              Henüz bildirim yok.
            </div>
          )}
          {items.map((n) => {
            const isDueSoon = n.type === "due_soon_task";
            const isPermReq = n.type === "cross_perm_request";
            const isPermResp = n.type === "cross_perm_response";
            const isPermRevoked = n.type === "cross_perm_revoked";
            const isPerm = isPermReq || isPermResp || isPermRevoked;
            const isUnlockOffer = n.type === "task_unlock_offered";
            const isOrphan = n.type === "tasks_orphaned";
            const isShared = n.type === "task_shared";
            const isNudge = n.type === "task_nudge";
            const isOverdueDaily = n.type === "overdue_daily";
            const isSuperExpiring = n.type === "super_admin_expiring";
            const isSuperExpired = n.type === "super_admin_expired";
            const isClientError = n.type === "client_error";
            const daysUntil = n.days_until_due != null ? n.days_until_due : n.payload?.days_until_due;

            // Choose icon + colour class per notification family.
            let Icon = AlertTriangle;
            let iconCls = "text-sertex-danger";
            if (isDueSoon) { Icon = Clock; iconCls = "text-orange-300"; }
            else if (isClientError) { Icon = Bug; iconCls = "text-rose-400"; }
            else if (isSuperExpiring) { Icon = ShieldAlert; iconCls = "text-amber-300"; }
            else if (isSuperExpired) { Icon = ShieldCheck; iconCls = "text-purple-300"; }
            else if (isPermReq) { Icon = Link2; iconCls = "text-teal-300"; }
            else if (isPermResp) {
              Icon = n.payload?.approved ? Check : X;
              iconCls = n.payload?.approved ? "text-emerald-300" : "text-rose-400";
            }
            else if (isPermRevoked) { Icon = Link2Off; iconCls = "text-amber-300"; }
            else if (isUnlockOffer) { Icon = KeyRound; iconCls = "text-emerald-300"; }
            else if (isOrphan) { Icon = PackageX; iconCls = "text-amber-300"; }
            else if (isShared) { Icon = Share2; iconCls = "text-sertex-cyan"; }
            else if (isNudge) { Icon = BellRing; iconCls = "text-amber-300"; }
            else if (isOverdueDaily) { Icon = AlertTriangle; iconCls = "text-amber-300"; }

            return (
              <div
                key={n.id}
                data-testid={`notification-item-${n.id}`}
                className={`w-full text-left px-3 py-2 border-b border-sertex-cyan/10 hover:bg-sertex-cyan/5 transition-colors relative group ${
                  n.read_at ? "opacity-60" : ""
                } ${selectMode && selectedIds.has(n.id) ? "bg-sertex-cyan/10" : ""}`}
              >
                <button
                  onClick={() => (selectMode ? toggleSelect(n.id) : clickItem(n))}
                  data-testid={`notification-item-btn-${n.id}`}
                  className="w-full text-left flex items-start gap-2 pr-6"
                >
                  {selectMode && (
                    <span
                      data-testid={`notification-select-box-${n.id}`}
                      className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 mt-0.5 ${
                        selectedIds.has(n.id) ? "border-sertex-cyan bg-sertex-cyan/40" : "border-sertex-cyan/40"
                      }`}
                    >
                      {selectedIds.has(n.id) && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                  )}
                  <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${iconCls}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-sertex-text">
                      {isPermReq && (
                        <>🔗 <b>{n.viewer_company_name}</b> firması <b>{n.target_company_name}</b>'ni görmek istiyor</>
                      )}
                      {isPermResp && (
                        n.payload?.approved
                          ? <>✅ İstek onaylandı: <b>{n.viewer_company_name}</b> → <b>{n.target_company_name}</b></>
                          : <>❌ İstek reddedildi: <b>{n.viewer_company_name}</b> → <b>{n.target_company_name}</b></>
                      )}
                      {isPermRevoked && (
                        <>🔒 Yetki iptal edildi: <b>{n.viewer_company_name}</b> artık <b>{n.target_company_name}</b>'ni göremiyor</>
                      )}
                      {isDueSoon && (n.is_for_manager
                        ? `${n.owner_username} · ⏱ ${daysUntil === 0 ? "bugün son gün" : `${daysUntil} gün kaldı`}`
                        : `⏱ ${daysUntil === 0 ? "Bugün son gün" : `${daysUntil} gün kaldı`}`)}
                      {!isPerm && !isDueSoon && !isUnlockOffer && !isOrphan && !isShared && !isNudge && !isOverdueDaily && !isSuperExpiring && !isSuperExpired && !isClientError && (n.is_for_manager
                        ? `${n.owner_username} kullanıcısının görevi geciktirmesi`
                        : "Görevin gecikti")}
                      {isClientError && (
                        <>🐞 <b>{n.payload?.count || 1}</b> yeni ön yüz hatası{n.payload?.message ? `: ${String(n.payload.message).slice(0, 60)}` : ""} · tıkla ▶</>
                      )}
                      {isSuperExpiring && (n.is_for_manager
                        ? <>🛡️ <b>{n.payload?.username || n.owner_username}</b> için süper yönetici süresi <b>{n.payload?.minutes_left ?? "az"} dk</b> içinde doluyor</>
                        : <>🛡️ Süper yönetici yetkin <b>{n.payload?.minutes_left ?? "az"} dk</b> içinde sona eriyor</>)}
                      {isSuperExpired && (n.is_for_manager
                        ? <>🛡️ <b>{n.payload?.username || n.owner_username}</b> artık süper yönetici değil — <b>{n.payload?.reverted_role || "eski"}</b> rolüne döndü</>
                        : <>🛡️ Süper yönetici süren doldu — <b>{n.payload?.reverted_role || "eski"}</b> rolüne döndün</>)}
                      {isShared && (
                        <>🔗 <b>{n.owner_username || "Bir kullanıcı"}</b> bir görevi seninle paylaştı · tıkla ▶</>
                      )}
                      {isOrphan && (
                        <>📦 <b>{n.owner_username || "Bir çalışan"}</b> ayrıldı — <b>{n.payload?.count || 0}</b> görev size aktarıldı · tıkla ▶</>
                      )}
                      {isUnlockOffer && (
                        <>🔐 <b>{n.payload?.issuer_username || "Müdür"}</b> sana bu görev için tek-kullanımlık izin verdi · tıkla ▶</>
                      )}
                      {isNudge && (
                        <>⏰ <b>{n.payload?.nudger_username || n.owner_username || "Yöneticiniz"}</b> hatırlattı{n.payload?.message ? `: ${n.payload.message}` : ""} · tıkla ▶</>
                      )}
                      {isOverdueDaily && (
                        <>⚠️ <b>{n.payload?.count || ""}</b> gecikmiş görev · her sabah hatırlatma · tıkla ▶</>
                      )}
                    </div>
                    {(n.task_title || (isPerm && (n.viewer_company_name || n.target_company_name))) && (
                      <div className="text-[11px] text-sertex-textMuted truncate flex items-center gap-1">
                        {isPerm && <Building2 className="h-2.5 w-2.5" />}
                        {n.task_title || (isPerm ? `${n.viewer_company_name || "?"} ↔ ${n.target_company_name || "?"}` : "")}
                      </div>
                    )}
                    <div className="hud-text text-sertex-textMuted/70 mt-0.5">
                      {formatRelative(n.created_at)}
                    </div>
                  </div>
                  {!n.read_at && (
                    <span
                      data-testid={`notification-unread-dot-${n.id}`}
                      className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                        isDueSoon ? "bg-orange-400" :
                        isClientError ? "bg-rose-400" :
                        isSuperExpiring ? "bg-amber-300" :
                        isSuperExpired ? "bg-purple-300" :
                        isPermReq ? "bg-teal-300" :
                        isPermResp ? (n.payload?.approved ? "bg-emerald-400" : "bg-rose-400") :
                        isPermRevoked ? "bg-amber-300" :
                        isOrphan ? "bg-amber-300" :
                        isNudge ? "bg-amber-300" :
                        "bg-sertex-cyan"
                      }`}
                    />
                  )}
                </button>
                {/* Tekli sil — sağ üstte (hover'da belirir; seçim modunda gizli) */}
                {!selectMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeOne(n); }}
                    data-testid={`notification-delete-${n.id}`}
                    title="Bu bildirimi sil"
                    className="absolute top-1.5 right-1.5 p-1 rounded text-sertex-textMuted hover:text-rose-300 hover:bg-rose-500/15 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                {/* Faz 9 CP1 — Inline Approve / Decline for pending cross-perm requests. */}
                {isPermReq && !n.read_at && (
                  <div className="flex gap-1.5 mt-1.5 pl-5">
                    <button
                      onClick={(e) => { e.stopPropagation(); respondPerm(n, true); }}
                      data-testid={`notification-perm-approve-${n.id}`}
                      className="flex-1 py-1 border border-emerald-400 text-emerald-300 hover:bg-emerald-400 hover:text-sertex-bg rounded hud-text text-[10px] transition-colors flex items-center justify-center gap-1"
                    >
                      <Check className="h-2.5 w-2.5" /> ONAYLA
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); respondPerm(n, false); }}
                      data-testid={`notification-perm-decline-${n.id}`}
                      className="flex-1 py-1 border border-rose-500 text-rose-300 hover:bg-rose-500 hover:text-sertex-bg rounded hud-text text-[10px] transition-colors flex items-center justify-center gap-1"
                    >
                      <X className="h-2.5 w-2.5" /> REDDET
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
