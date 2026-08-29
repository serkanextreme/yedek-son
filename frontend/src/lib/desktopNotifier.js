/**
 * Sertex — Desktop push + sound notification helpers.
 *
 * Wraps the browser Notification API + our alarmSounds preset so that
 * the notification bell can fire a real OS-level popup when a new
 * overdue / due-soon / cross-perm event is polled.
 *
 * User preference is persisted in localStorage under
 * `sertex_desktop_notif_v1`:
 *   { enabled: bool, sound: bool, permission: 'default'|'granted'|'denied' }
 *
 * `SEEN_IDS_KEY` tracks notification ids we've already popped so we don't
 * re-fire on every 60 s poll for the same rows.
 */
import { playPreset, loadAlarmSettings } from "./alarmSounds";

const PREF_KEY = "sertex_desktop_notif_v1";
const SEEN_IDS_KEY = "sertex_desktop_notif_seen_ids_v1";

const DEFAULT_PREF = {
  enabled: false,
  sound: true,
  // Sessiz Saatler — bu aralıkta masaüstü bildirimi + ses otomatik susturulur.
  quietEnabled: false,
  quietStart: "22:00",
  quietEnd: "07:00",
};

export const loadDesktopPref = () => {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { ...DEFAULT_PREF };
    return { ...DEFAULT_PREF, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREF };
  }
};

export const saveDesktopPref = (patch) => {
  const cur = loadDesktopPref();
  const next = { ...cur, ...patch };
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  } catch (e) { console.warn("[desktopNotifier.js] hata bastırıldı:", e); }
  return next;
};

export const getPermission = () => {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
};

/**
 * Masaüstü bildirimi efektif olarak açık mı?
 *
 * Kural: tarayıcı izni "granted" ise, kullanıcı AÇIKÇA kapatmadıkça
 * (pref.disabled === true) bildirimler açık sayılır. Böylece localStorage
 * sıfırlansa bile (site verisi temizleme / redeploy / yeni profil) izin
 * hâlâ verilmişken bildirimler sessizce durmaz — kendi kendini onarır.
 *
 * Not: eski `enabled` alanı geriye dönük uyumluluk için korunur ama artık
 * kapıyı `disabled` flag'i belirler.
 */
export const isDesktopEnabled = () => {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  const pref = loadDesktopPref();
  return pref.disabled !== true;
};

/**
 * Sessiz Saatler — şu an sessiz aralıkta mıyız? Yerel saate göre HH:MM
 * karşılaştırır; gece devreden aralıkları (ör. 22:00–07:00) da destekler.
 */
export const isQuietNow = (pref = loadDesktopPref()) => {
  if (!pref.quietEnabled) return false;
  const parse = (s) => {
    const parts = String(s || "").split(":");
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const start = parse(pref.quietStart);
  const end = parse(pref.quietEnd);
  if (start == null || end == null || start === end) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
};

export const requestPermission = async () => {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const p = await Notification.requestPermission();
    return p;
  } catch {
    return "denied";
  }
};

const loadSeen = () => {
  try {
    const raw = localStorage.getItem(SEEN_IDS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
};

const saveSeen = (set) => {
  try {
    // Cap at 500 ids to avoid unbounded storage growth.
    const arr = Array.from(set).slice(-500);
    localStorage.setItem(SEEN_IDS_KEY, JSON.stringify(arr));
  } catch (e) { console.warn("[desktopNotifier.js] hata bastırıldı:", e); }
};

/**
 * Compose title + body strings for a Sertex notification row.
 * Mirrors the copy shown inside NotificationBell popover.
 */
const composeText = (n) => {
  const type = n.type || "";
  if (type === "cross_perm_request") {
    return {
      title: "🔗 Yeni yetki isteği",
      body: `${n.viewer_company_name || "?"} → ${n.target_company_name || "?"}`,
    };
  }
  if (type === "cross_perm_response") {
    const ok = n.payload?.approved;
    return {
      title: ok ? "✅ Yetki onaylandı" : "❌ Yetki reddedildi",
      body: `${n.viewer_company_name || "?"} → ${n.target_company_name || "?"}`,
    };
  }
  if (type === "cross_perm_revoked") {
    return {
      title: "🔒 Yetki iptal edildi",
      body: `${n.viewer_company_name || "?"} artık ${n.target_company_name || "?"}'ni göremiyor`,
    };
  }
  if (type === "due_soon_task") {
    const d = n.days_until_due ?? n.payload?.days_until_due;
    return {
      title: "⏱ Yaklaşan Görev",
      body: n.is_for_manager
        ? `${n.owner_username}: ${n.task_title || "Görev"} · ${d === 0 ? "bugün son gün" : `${d} gün kaldı`}`
        : `${n.task_title || "Görevin"} · ${d === 0 ? "Bugün son gün" : `${d} gün kaldı`}`,
    };
  }
  // Default: overdue
  if (type === "overdue_daily") {
    const c = n.payload?.count;
    return {
      title: "⚠️ Geciken Görevler",
      body: c ? `${c} gecikmiş görev · ${n.task_title || ""}`.trim() : (n.task_title || "Gecikmiş görevlerin var"),
    };
  }
  return {
    title: "⚠️ Geciken Görev",
    body: n.is_for_manager
      ? `${n.owner_username}: ${n.task_title || "Görev"}`
      : n.task_title || "Bir görevin süresini aştı",
  };
};

/**
 * Fire a single desktop notification + optional sound.
 * No-op unless enabled + permission granted.
 */
export const fireOne = (n) => {
  if (!isDesktopEnabled()) return;
  const pref = loadDesktopPref();
  const { title, body } = composeText(n);
  try {
    const notif = new Notification(title, {
      body,
      tag: `sertex-${n.id || Math.random()}`,
      icon: "/favicon.ico",
      silent: !pref.sound, // OS silence when Sertex sound flag off
    });
    // Focus the tab if the user clicks the OS popup.
    notif.onclick = () => {
      try { window.focus(); notif.close(); } catch (e) { console.warn("[desktopNotifier.js] hata bastırıldı:", e); }
    };
  } catch (e) { console.warn("[desktopNotifier.js] hata bastırıldı:", e); }
  if (pref.sound) {
    try {
      const alarm = loadAlarmSettings();
      // A short-duration "digital" preset is unobtrusive; falls back if OS
      // notification sound is silenced.
      playPreset("digital", Math.min(0.5, alarm.volume || 0.5));
    } catch (e) { console.warn("[desktopNotifier.js] hata bastırıldı:", e); }
  }
};

/**
 * Process the latest unread notification batch: for each `id` that we
 * haven't previously popped, fire the desktop toast. Called by the bell
 * every 60 s poll cycle.
 */
export const processBatch = (notifications) => {
  if (!isDesktopEnabled()) return 0;
  // Sessiz saatlerde ateşleme — rows'u seen olarak İŞARETLEME ki sessiz aralık
  // bitince bir sonraki poll'de gösterilebilsinler ("sabah tekrar aç").
  if (isQuietNow()) return 0;
  if (!Array.isArray(notifications) || notifications.length === 0) return 0;
  const seen = loadSeen();
  let fired = 0;
  // Only fire for currently-unread rows so the user isn't spammed after
  // "mark all read" on a different device.
  const unread = notifications.filter((n) => !n.read_at);
  for (const n of unread) {
    if (!n.id || seen.has(n.id)) continue;
    fireOne(n);
    seen.add(n.id);
    fired += 1;
    // Rate limit — never fire more than 3 per poll to avoid blizzards.
    if (fired >= 3) break;
  }
  saveSeen(seen);
  return fired;
};

/**
 * Reset the seen-ids memoization. Useful after logout.
 */
export const clearSeenIds = () => {
  try { localStorage.removeItem(SEEN_IDS_KEY); } catch (e) { console.warn("[desktopNotifier.js] hata bastırıldı:", e); }
};

/**
 * Bildirim Test Butonu — izin verilmişse ANINDA örnek bir masaüstü bildirimi
 * gösterir. enabled / quiet / seen kapılarını atlar (kullanıcı çalıştığını
 * anında görsün). İzin yoksa false döner (çağıran taraf izin isteyebilir).
 */
export const fireTestNotification = () => {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  const pref = loadDesktopPref();
  try {
    const notif = new Notification("SERTEX — Test bildirimi ✓", {
      body: "Masaüstü bildirimleri çalışıyor. Bu bir test bildirimidir.",
      tag: "sertex-test-" + Date.now(),
      icon: "/favicon.ico",
      silent: !pref.sound,
    });
    notif.onclick = () => {
      try { window.focus(); notif.close(); } catch (e) { console.warn("[desktopNotifier.js] hata bastırıldı:", e); }
    };
  } catch (e) {
    console.warn("[desktopNotifier.js] hata bastırıldı:", e);
    return false;
  }
  if (pref.sound) {
    try {
      const alarm = loadAlarmSettings();
      playPreset("digital", Math.min(0.5, alarm.volume || 0.5));
    } catch (e) { console.warn("[desktopNotifier.js] hata bastırıldı:", e); }
  }
  return true;
};
