// Faz 9 CP5 — extracted from TasksPanel.jsx (originally lines 1046–1124).
// Behavior is BYTE-IDENTICAL.
// Assignee types the 6-digit code they got from the creator. On success we
// bubble the fresh task doc up so the parent card can retry the pending action.
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { taskLockApi } from "../../lib/api";

export const UnlockOtpModal = ({ task, onClose, onVerified }) => {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const c = code.trim();
    if (c.length !== 6 || !/^\d{6}$/.test(c)) {
      toast.error("6 haneli kod girin");
      return;
    }
    setBusy(true);
    try {
      const updated = await taskLockApi.verifyOtp(task.id, c);
      toast.success("Kilit açıldı — tek kullanımlık pencere aktif (10 dk)");
      onVerified?.(updated);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Doğrulanamadı");
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="unlock-otp-modal"
    >
      <div
        className="glass-panel corner-bracket p-4 max-w-sm w-full space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="hud-text text-emerald-300 flex items-center gap-2 neon-glow">
            <Unlock className="h-4 w-4" /> KİLİDİ AÇ
          </div>
          <button onClick={onClose} className="text-sertex-textMuted hover:text-sertex-cyan">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
          <span className="text-sertex-text font-semibold">{task.title}</span> için müdürün
          verdiği 6 haneli tek kullanımlık şifreyi gir. Doğru şifreyle 10 dk boyunca
          <b> tek bir</b> kısıtlı işlem yapabilirsin.
        </div>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="______"
          data-testid="unlock-otp-input"
          className="w-full text-center text-3xl font-mono tracking-[0.4em] bg-sertex-surface/60 border border-emerald-400/40 rounded-md px-2 py-2 text-emerald-200 focus:border-emerald-400 outline-none"
        />
        <div className="flex gap-2">
          <button
            onClick={onClose}
            data-testid="unlock-otp-cancel"
            className="flex-1 py-1.5 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
          >
            İPTAL
          </button>
          <button
            onClick={submit}
            disabled={busy || code.length !== 6}
            data-testid="unlock-otp-submit"
            className="flex-1 py-1.5 border border-emerald-400 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/40 rounded hud-text disabled:opacity-40"
          >
            {busy ? "DOĞRULANIYOR..." : "AÇ"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default UnlockOtpModal;
