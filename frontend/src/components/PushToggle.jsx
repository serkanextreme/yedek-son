import { useEffect, useState } from "react";
import { BellRing, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { disablePush, enablePush, getPushState, sendTestPush } from "../lib/push";

// Tarayıcı (Web Push) bildirim aç/kapat + test — Ayarlar → Uyarılar sekmesi.
export default function PushToggle() {
  const [state, setState] = useState("loading"); // loading|unsupported|denied|subscribed|unsubscribed
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setState).catch(() => setState("unsupported"));
  }, []);

  const on = state === "subscribed";

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        setState(await disablePush());
        toast.success("Tarayıcı bildirimleri kapatıldı");
      } else {
        setState(await enablePush());
        toast.success("Tarayıcı bildirimleri açıldı");
      }
    } catch (e) {
      if (e?.message === "denied") {
        setState("denied");
        toast.error("İzin reddedildi. Tarayıcı ayarlarından bildirime izin verin.");
      } else if (e?.message === "unsupported") {
        setState("unsupported");
        toast.error("Bu tarayıcı web push desteklemiyor");
      } else {
        toast.error("İşlem başarısız oldu");
      }
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const sent = await sendTestPush();
      toast.success(sent > 0 ? "Test bildirimi gönderildi" : "Bildirim gönderilecek cihaz yok");
    } catch {
      toast.error("Test gönderilemedi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-sertex-cyan/20 bg-black/20 p-4 space-y-3" data-testid="push-settings">
      <div className="flex items-center gap-2">
        <BellRing className="h-3.5 w-3.5 text-sertex-cyan" />
        <span className="hud-text text-sertex-cyan">TARAYICI BİLDİRİMLERİ</span>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">
        Görev atandığında, dürtüldüğünde ve yaklaşan/geciken görevlerde bilgisayarına anlık
        bildirim gönderir — SERTEX sekmesi kapalıyken bile.
      </p>

      {state === "unsupported" ? (
        <p className="text-xs text-amber-400">Bu tarayıcı web push bildirimi desteklemiyor.</p>
      ) : state === "denied" ? (
        <p className="text-xs text-red-400">
          Bildirim izni engellenmiş. Tarayıcı adres çubuğundaki kilit simgesinden izin verip
          sayfayı yenileyin.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            disabled={busy || state === "loading"}
            data-testid="push-toggle-button"
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-mono uppercase transition-colors disabled:opacity-50 ${
              on
                ? "border border-red-400/40 text-red-300 hover:bg-red-500/10"
                : "border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10"
            }`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : on ? (
              <BellOff className="h-3.5 w-3.5" />
            ) : (
              <BellRing className="h-3.5 w-3.5" />
            )}
            {on ? "Bildirimi Kapat" : "Bildirimi Aç"}
          </button>
          {on && (
            <button
              onClick={test}
              disabled={busy}
              data-testid="push-test-button"
              className="px-3 py-2 rounded text-xs font-mono uppercase border border-gray-500/40 text-gray-300 hover:bg-white/5 disabled:opacity-50"
            >
              Test Et
            </button>
          )}
        </div>
      )}
    </div>
  );
}
