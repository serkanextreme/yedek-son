import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { KeyRound, LogOut, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { licenseApi } from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * Full-screen license redemption blocker. Shown when the current user is
 * NOT admin and has no active license. Redeeming a valid key transitions
 * them into the app. Admin never sees this screen.
 */
const RedeemScreen = ({ onRedeemed }) => {
  const { user, logout } = useAuth();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await licenseApi.me();
        setStatus(s);
      } catch (e) { console.warn("[RedeemScreen.jsx] hata bastırıldı:", e); }
    })();
  }, []);

  const normalize = (v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);

  const submit = async () => {
    const trimmed = key.trim();
    if (!trimmed.startsWith("SERTEX-") || trimmed.length < 15) {
      toast.error("Kod SERTEX-XXXX-XXXX-XXXX biçiminde olmalı");
      return;
    }
    setBusy(true);
    try {
      const r = await licenseApi.redeem(trimmed);
      toast.success(`Aktif: ${r.status.type_label} · ${r.status.days_left ?? "∞"} gün`);
      onRedeemed?.(r);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kod kullanılamadı");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-sertex-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md glass-panel border border-sertex-cyan/40 rounded-lg p-6 space-y-5"
        data-testid="redeem-screen"
      >
        <div className="text-center space-y-1">
          <ShieldCheck className="h-8 w-8 text-sertex-cyan mx-auto neon-glow" />
          <h1 className="text-lg font-mono tracking-widest text-sertex-cyan neon-glow">
            LİSANS AKTİVASYON
          </h1>
          <p className="text-xs font-mono text-sertex-textMuted">
            Merhaba <span className="text-sertex-text">{user?.username}</span> —
            Sertex'i kullanmak için bir aktivasyon kodun olmalı.
          </p>
        </div>

        <div>
          <label className="block text-[10px] font-mono text-sertex-cyan mb-1 tracking-widest">
            <KeyRound className="h-3 w-3 inline mr-1" /> AKTİVASYON KODU
          </label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(normalize(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) submit();
            }}
            placeholder="SERTEX-XXXX-XXXX-XXXX"
            spellCheck={false}
            autoFocus
            className="w-full bg-sertex-surface border border-sertex-cyan/40 rounded-md px-3 py-2 text-sm font-mono text-sertex-cyan tracking-widest text-center focus:border-sertex-cyan outline-none"
            data-testid="redeem-key-input"
          />
        </div>

        {status?.previous_status && (
          <div className="text-[10px] font-mono text-amber-300 border border-amber-300/30 rounded-md p-2">
            Son lisansın durumu:{" "}
            <span className="uppercase">{status.previous_status}</span>
            {status.previous_status === "active" && status.expires_at
              ? " · süresi doldu"
              : ""}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy || !key}
          className="w-full py-2.5 border border-sertex-cyan bg-sertex-cyan/10 hover:bg-sertex-cyan/20 disabled:opacity-40 rounded-md hud-text text-sertex-cyan flex items-center justify-center gap-2 transition-colors"
          data-testid="redeem-submit"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          KODU AKTİVE ET
        </button>

        <div className="border-t border-sertex-cyan/20 pt-3 text-[10px] font-mono text-sertex-textMuted space-y-1">
          <p>
            Kod nasıl edinilir? Sertex yöneticinden bir kod iste. Kod bir defa
            kullanılabilir ve o andan itibaren senin hesabına atanır.
          </p>
          <p>
            Trial (30 gün) · Aylık · Yıllık · Ömür Boyu — 4 seçenek mevcut.
          </p>
        </div>

        <button
          onClick={() => {
            logout();
          }}
          className="w-full py-1.5 text-[10px] font-mono text-sertex-textMuted hover:text-rose-300 flex items-center justify-center gap-1 transition-colors"
          data-testid="redeem-logout"
        >
          <LogOut className="h-3 w-3" /> Farklı bir kullanıcı olarak çıkış yap
        </button>
      </motion.div>
    </div>
  );
};

export default RedeemScreen;
