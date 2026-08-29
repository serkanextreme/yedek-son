import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Lock, User, LogIn, Loader2 } from "lucide-react";
import HolographicSphere from "./HolographicSphere";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import { Toaster } from "sonner";

const LoginScreen = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const i = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Kullanıcı adı ve şifre gerekli");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await login(username.trim(), password);
      toast.success(`Hoş geldiniz efendim`);
    } catch (err) {
      const detail = err?.response?.data?.detail || "Giriş yapılamadı";
      const msg = typeof detail === "string" ? detail : "Giriş hatası";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-sertex-bg flex items-center justify-center">
      <Toaster
        position="top-center"
        theme="dark"
        toastOptions={{
          style: {
            background: "rgba(5,9,20,0.9)",
            border: "1px solid rgba(0,240,255,0.3)",
            color: "#E2F1FF",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "12px",
          },
        }}
      />

      {/* Background */}
      <div className="absolute inset-0 grid-bg pointer-events-none opacity-40" />
      <div className="absolute inset-0 radial-glow pointer-events-none" />
      <div
        className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-sertex-cyan/30 to-transparent animate-scanline pointer-events-none z-10"
        style={{ boxShadow: "0 0 16px rgba(0,240,255,0.4)" }}
      />

      {/* Corner clock */}
      <div className="fixed top-6 right-6 z-30 hud-text text-sertex-cyan neon-glow">
        {time.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
      </div>
      <div className="fixed top-6 left-6 z-30 hud-text text-sertex-textMuted">
        SERTEX · GİRİŞ TERMİNALİ
      </div>

      {/* Sphere behind */}
      <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none">
        <div className="w-[min(70vh,600px)] h-[min(70vh,600px)]">
          <HolographicSphere state="idle" />
        </div>
      </div>

      {/* Login card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-20 w-[92vw] max-w-[420px]"
        data-testid="login-card"
      >
        <div className="glass-panel corner-bracket p-6 relative">
          <div className="text-center mb-6">
            <img
              src="/emblem-mark.png"
              alt="SERTEX"
              data-testid="login-logo"
              className="mx-auto mb-3 h-24 w-24 object-contain drop-shadow-[0_0_20px_rgba(0,240,255,0.55)]"
            />
            <div className="display-text text-sertex-cyan neon-glow text-3xl tracking-[0.25em] font-bold">
              S.E.R.T.E.X
            </div>
            <div className="hud-text text-sertex-textMuted mt-2">
              KİMLİK DOĞRULAMA GEREKLİ
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" data-testid="login-form">
            {/* Username */}
            <div>
              <label className="hud-text text-sertex-textMuted flex items-center gap-1 mb-1">
                <User className="h-3 w-3" /> KULLANICI ADI
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                data-testid="login-username"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/30 rounded-md px-3 py-2 text-sertex-text font-mono text-sm placeholder:text-sertex-textMuted focus:border-sertex-cyan focus:bg-sertex-surface outline-none transition-colors"
                placeholder="sertex"
              />
            </div>

            {/* Password */}
            <div>
              <label className="hud-text text-sertex-textMuted flex items-center gap-1 mb-1">
                <Lock className="h-3 w-3" /> ŞİFRE
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                data-testid="login-password"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/30 rounded-md px-3 py-2 text-sertex-text font-mono text-sm placeholder:text-sertex-textMuted focus:border-sertex-cyan focus:bg-sertex-surface outline-none transition-colors"
                placeholder="••••••••"
              />
            </div>

            {/* Error message */}
            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="hud-text text-sertex-danger border border-sertex-danger/40 bg-sertex-danger/10 rounded-md px-3 py-2"
                data-testid="login-error"
              >
                ⚠ {error}
              </motion.div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              data-testid="login-submit"
              className="w-full py-2.5 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg disabled:opacity-40 disabled:cursor-not-allowed rounded-md flex items-center justify-center gap-2 transition-colors font-mono"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="hud-text">DOĞRULANIYOR...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  <span className="hud-text">GİRİŞ YAP</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-sertex-cyan/15 hud-text text-sertex-textMuted text-center">
            3 hatalı deneme sonrası 5 dakika kilitlenir
          </div>
        </div>

        <div className="mt-3 text-center hud-text text-sertex-textMuted">
          KİMLİK: <span className="text-sertex-textSecondary">SERKAN</span> · SERTEX v1.0
        </div>
      </motion.div>
    </div>
  );
};

export default LoginScreen;
