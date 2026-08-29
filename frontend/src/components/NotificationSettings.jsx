import { useEffect, useState } from "react";
import { Bell, BellRing, Moon, Clock, Volume2, ListChecks, CalendarOff } from "lucide-react";
import { toast } from "sonner";
import {
  loadDesktopPref, saveDesktopPref, getPermission, requestPermission,
  isQuietNow, fireTestNotification,
} from "../lib/desktopNotifier";
import { notificationsApi } from "../lib/api";

// Bildirim ayarları — hem Ayarlar panelinde hem (isteğe bağlı) başka yerde
// kullanılabilen tek yer. Masaüstü açık/kapalı + ses + Sessiz Saatler
// (localStorage) + Günlük Özet Saati (sunucu, per-user).
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const NotificationSettings = () => {
  const [pref, setPref] = useState(loadDesktopPref);
  const [permission, setPermission] = useState(getPermission());
  const [digest, setDigest] = useState({ digest_hour: 9, digest_enabled: true, digest_detailed: false, digest_skip_weekend: false });
  const [digestLoaded, setDigestLoaded] = useState(false);

  useEffect(() => {
    notificationsApi.getDigestSettings()
      .then((d) => {
        if (d) setDigest({
          digest_hour: typeof d.digest_hour === "number" ? d.digest_hour : 9,
          digest_enabled: d.digest_enabled !== false,
          digest_detailed: !!d.digest_detailed,
          digest_skip_weekend: !!d.digest_skip_weekend,
        });
      })
      .catch(() => {})
      .finally(() => setDigestLoaded(true));
  }, []);

  const desktopOn = permission === "granted" && pref.disabled !== true;

  const toggleDesktop = async (want) => {
    if (want) {
      let p = permission;
      if (p !== "granted") { p = await requestPermission(); setPermission(p); }
      if (p === "granted") {
        setPref(saveDesktopPref({ enabled: true, disabled: false }));
        toast.success("Masaüstü bildirimi açıldı");
      } else {
        toast.error("Bildirim izni verilmedi");
      }
    } else {
      setPref(saveDesktopPref({ enabled: false, disabled: true }));
      toast.success("Masaüstü bildirimi kapatıldı");
    }
  };

  const saveDigest = async (patch, msg) => {
    const merged = { ...digest, ...patch };
    setDigest(merged);
    try {
      await notificationsApi.updateDigestSettings(merged);
      if (msg) toast.success(msg);
    } catch (e) {
      toast.error("Kaydedilemedi");
    }
  };

  return (
    <div className="space-y-4" data-testid="notification-settings-tab">
      <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[11px]">
        Masaüstü bildirimleri, sessiz saatler ve her sabah gönderilen "geciken görev" özetini buradan yönet.
      </div>

      {/* Masaüstü aç/kapa */}
      <div className="glass-panel p-3 border-sertex-cyan/20 space-y-3">
        <label className="flex items-center justify-between cursor-pointer" data-testid="ns-desktop-enable">
          <span className="hud-text text-sertex-text flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5 text-sertex-cyan" /> Masaüstü Bildirimi
          </span>
          <input
            type="checkbox"
            checked={desktopOn}
            onChange={(e) => toggleDesktop(e.target.checked)}
            className="accent-emerald-400 h-4 w-4"
          />
        </label>
        <label className={`flex items-center justify-between cursor-pointer ${desktopOn ? "" : "opacity-50"}`} data-testid="ns-sound">
          <span className="hud-text text-sertex-text flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5 text-sertex-cyan" /> Kısa uyarı sesi
          </span>
          <input
            type="checkbox"
            checked={!!pref.sound}
            disabled={!desktopOn}
            onChange={(e) => setPref(saveDesktopPref({ sound: e.target.checked }))}
            className="accent-emerald-400 h-4 w-4"
          />
        </label>
        <button
          onClick={async () => {
            let p = permission;
            if (p !== "granted") { p = await requestPermission(); setPermission(p); }
            if (p !== "granted") { toast.error("Önce bildirim izni verin"); return; }
            const ok = fireTestNotification();
            if (ok) toast.success("Test bildirimi gönderildi ✓"); else toast.error("Gönderilemedi");
          }}
          data-testid="ns-test-btn"
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/10 hud-text text-[11px] transition-colors"
        >
          <BellRing className="h-3.5 w-3.5" /> Test bildirimi gönder
        </button>
      </div>

      {/* Sessiz Saatler */}
      <div className="glass-panel p-3 border-amber-400/20 space-y-3">
        <label className="flex items-center justify-between cursor-pointer" data-testid="ns-quiet-enable">
          <span className="hud-text text-sertex-text flex items-center gap-1.5">
            <Moon className="h-3.5 w-3.5 text-amber-300" /> Sessiz Saatler
          </span>
          <input
            type="checkbox"
            checked={!!pref.quietEnabled}
            onChange={(e) => setPref(saveDesktopPref({ quietEnabled: e.target.checked }))}
            className="accent-amber-400 h-4 w-4"
          />
        </label>
        <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px]">
          Bu aralıkta masaüstü bildirimi + ses susturulur; aralık bitince sabah tekrar gösterilir.
        </div>
        {pref.quietEnabled && (
          <div className="flex items-center gap-2" data-testid="ns-quiet-range">
            <input
              type="time"
              value={pref.quietStart || "22:00"}
              data-testid="ns-quiet-start"
              onChange={(e) => setPref(saveDesktopPref({ quietStart: e.target.value }))}
              className="bg-sertex-bg border border-amber-400/30 rounded px-2 py-1 text-[12px] font-mono text-sertex-text"
            />
            <span className="text-[11px] font-mono text-sertex-textMuted">→</span>
            <input
              type="time"
              value={pref.quietEnd || "07:00"}
              data-testid="ns-quiet-end"
              onChange={(e) => setPref(saveDesktopPref({ quietEnd: e.target.value }))}
              className="bg-sertex-bg border border-amber-400/30 rounded px-2 py-1 text-[12px] font-mono text-sertex-text"
            />
            {isQuietNow() && (
              <span className="text-[10px] font-mono text-amber-300 uppercase ml-1">şu an sessiz</span>
            )}
          </div>
        )}
      </div>

      {/* Günlük Özet Saati + içerik + haftasonu */}
      <div className="glass-panel p-3 border-sertex-cyan/20 space-y-3">
        <label className="flex items-center justify-between cursor-pointer" data-testid="ns-digest-enable">
          <span className="hud-text text-sertex-text flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-sertex-cyan" /> Sabah Özeti (Geciken Görevler)
          </span>
          <input
            type="checkbox"
            checked={digest.digest_enabled}
            disabled={!digestLoaded}
            onChange={(e) => saveDigest({ digest_enabled: e.target.checked }, e.target.checked ? "Sabah özeti açıldı" : "Sabah özeti kapatıldı")}
            className="accent-emerald-400 h-4 w-4"
          />
        </label>
        <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px]">
          Geciken görevlerin varsa her gün seçtiğin saatte tek bir özet bildirimi gönderilir.
        </div>
        <div className={`flex items-center gap-2 ${digest.digest_enabled ? "" : "opacity-50"}`}>
          <span className="hud-text text-sertex-text text-[11px]">Saat:</span>
          <select
            value={digest.digest_hour}
            disabled={!digestLoaded || !digest.digest_enabled}
            onChange={(e) => saveDigest({ digest_hour: parseInt(e.target.value, 10) }, `Sabah özeti saati: ${String(e.target.value).padStart(2, "0")}:00`)}
            data-testid="ns-digest-hour"
            className="bg-sertex-bg border border-sertex-cyan/30 rounded px-2 py-1 text-[12px] font-mono text-sertex-text"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
            ))}
          </select>
        </div>
        <label className={`flex items-center justify-between cursor-pointer ${digest.digest_enabled ? "" : "opacity-50"}`} data-testid="ns-digest-detailed">
          <span className="hud-text text-sertex-text flex items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5 text-sertex-cyan" /> Detaylı özet (kaç gün geciktiğini göster)
          </span>
          <input
            type="checkbox"
            checked={digest.digest_detailed}
            disabled={!digestLoaded || !digest.digest_enabled}
            onChange={(e) => saveDigest({ digest_detailed: e.target.checked }, e.target.checked ? "Detaylı özet açıldı" : "Detaylı özet kapatıldı")}
            className="accent-emerald-400 h-4 w-4"
          />
        </label>
        <label className={`flex items-center justify-between cursor-pointer ${digest.digest_enabled ? "" : "opacity-50"}`} data-testid="ns-digest-weekend">
          <span className="hud-text text-sertex-text flex items-center gap-1.5">
            <CalendarOff className="h-3.5 w-3.5 text-sertex-cyan" /> Haftasonu sustur (Cmt-Paz atla)
          </span>
          <input
            type="checkbox"
            checked={digest.digest_skip_weekend}
            disabled={!digestLoaded || !digest.digest_enabled}
            onChange={(e) => saveDigest({ digest_skip_weekend: e.target.checked }, e.target.checked ? "Haftasonu özeti kapatıldı" : "Haftasonu özeti açıldı")}
            className="accent-emerald-400 h-4 w-4"
          />
        </label>
      </div>
    </div>
  );
};

export default NotificationSettings;
