// Faz 9 CP5 — extracted from TasksPanel.jsx (originally lines 977–1041).
// Behavior is BYTE-IDENTICAL.
// After a successful POST /tasks/{id}/unlock-otp we show the plaintext code
// to the issuer exactly once with a copy-to-clipboard button + countdown.
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

export const OtpDisplayModal = ({ task, code, expiresAt, ttlMinutes, onClose }) => {
  const [remaining, setRemaining] = useState(() => {
    try { return Math.max(0, Math.floor((new Date(expiresAt) - new Date()) / 1000)); }
    catch { return ttlMinutes * 60; }
  });
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [remaining]);
  const mins = String(Math.floor(remaining / 60)).padStart(2, "0");
  const secs = String(remaining % 60).padStart(2, "0");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Kod panoya kopyalandı");
    } catch { toast.error("Kopyalanamadı"); }
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="otp-display-modal"
    >
      <div
        className="glass-panel corner-bracket p-4 max-w-sm w-full space-y-3 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hud-text text-emerald-300 flex items-center justify-center gap-2 neon-glow">
          <KeyRound className="h-4 w-4" /> TEK KULLANIMLIK ŞİFRE
        </div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
          <span className="text-sertex-text font-semibold">{task.title}</span> için üretildi.
          Atanan kişiye ilet (mesaj / sözlü); sistem bildirimi de gönderdik.
        </div>
        <div
          className="text-4xl font-mono tracking-[0.4em] text-emerald-200 py-3 border-y border-emerald-400/30 select-all"
          data-testid="otp-code"
        >
          {code}
        </div>
        <div className="text-[10px] font-mono text-sertex-textMuted">
          Kalan süre: <span className="text-emerald-300">{mins}:{secs}</span> · tek kullanımlık
        </div>
        <div className="flex gap-2">
          <button
            onClick={copy}
            data-testid="otp-copy"
            className="flex-1 py-1.5 border border-emerald-400/60 text-emerald-200 hover:bg-emerald-500/20 rounded hud-text"
          >
            KOPYALA
          </button>
          <button
            onClick={onClose}
            data-testid="otp-close"
            className="flex-1 py-1.5 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
          >
            KAPAT
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default OtpDisplayModal;
