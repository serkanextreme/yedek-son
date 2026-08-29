// Sertex — NEURAL LINK bildirim izni kısayolu.
//
// Masaüstü bildirimleri (hatırlatma OS-popup'ı) tarayıcı iznine bağlıdır.
// İzin "granted" değilse hatırlatma çalsa bile OS bildirimi görünmez. Bu
// rozet, izin verilmemişse tek dokunuşla tarayıcı izin penceresini açar.
// İzin verilince kendini gizler. Yalnızca görsel/kolaylık — mevcut akışları
// etkilemez.
import React, { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import { toast } from "sonner";
import { requestPermission, saveDesktopPref } from "../../lib/desktopNotifier";
import { playReminderChime } from "../../lib/reminderChime";

const readPerm = () =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

export const NotificationPermBadge = () => {
  const [perm, setPerm] = useState(readPerm());

  useEffect(() => {
    const sync = () => setPerm(readPerm());
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // İzin zaten verilmişse veya tarayıcı desteklemiyorsa hiç gösterme.
  if (perm === "unsupported" || perm === "granted") return null;

  const denied = perm === "denied";

  const onEnable = async (e) => {
    e.stopPropagation();
    if (denied) {
      toast.info(
        "Bildirimler tarayıcı ayarlarından engellenmiş. Adres çubuğundaki kilit/site simgesine tıklayıp Sertex için “Bildirimler”i İzin Ver yapın."
      );
      return;
    }
    const p = await requestPermission();
    setPerm(readPerm());
    if (p === "granted") {
      saveDesktopPref({ enabled: true });
      toast.success("Masaüstü bildirimleri açıldı");
      // Tek seferlik test bildirimi — kullanıcı gerçekten görünür olduğunu
      // doğrulasın (OS popup + kısa JARVIS chime).
      try {
        const n = new Notification("SERTEX — Bildirimler açık ✓", {
          body: "Hatırlatmalar artık masaüstünde görünecek. Bu bir test bildirimidir.",
          icon: "/favicon.ico",
          tag: "sertex-notif-test",
        });
        n.onclick = () => {
          try {
            window.focus();
            n.close();
          } catch { /* ok */ }
        };
      } catch { /* ok */ }
      try {
        playReminderChime(0.3);
      } catch { /* ok */ }
    } else if (p === "denied") {
      toast.info("Bildirim izni verilmedi");
    }
  };

  return (
    <button
      type="button"
      onClick={onEnable}
      data-testid="notif-perm-badge"
      title={
        denied
          ? "Bildirimler engelli — tarayıcı ayarlarından açın"
          : "Masaüstü hatırlatma bildirimlerini aç"
      }
      className={`mt-2 w-full flex items-center gap-1.5 px-2 py-1 rounded border hud-text transition-colors ${
        denied
          ? "border-amber-400/40 text-amber-300 hover:bg-amber-400/10"
          : "border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10"
      }`}
    >
      <BellOff className="h-3 w-3 shrink-0" />
      {denied ? "Bildirimler engelli — nasıl açılır?" : "Masaüstü bildirimlerini aç"}
    </button>
  );
};

export default NotificationPermBadge;
