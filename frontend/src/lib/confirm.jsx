// Uygulama geneli temalı onay penceresi (native window.confirm yerine).
// Kullanım:  const ok = await confirmDialog({ message: "...", danger: true });
import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";

let _show = null; // ConfirmRoot tarafından set edilir

export function confirmDialog(options = {}) {
  return new Promise((resolve) => {
    if (typeof _show !== "function") {
      // Güvenli geri dönüş: provider yoksa native confirm.
      resolve(window.confirm(options.message || "Onaylıyor musunuz?"));
      return;
    }
    _show({ ...options, resolve });
  });
}

// Temalı metin girişi (native window.prompt yerine).
// Kullanım:  const name = await promptDialog({ message, defaultValue });
// İptal edilirse null, onaylanınca girilen metin döner.
export function promptDialog(options = {}) {
  return new Promise((resolve) => {
    if (typeof _show !== "function") {
      resolve(window.prompt(options.message || "", options.defaultValue || ""));
      return;
    }
    _show({ ...options, prompt: true, resolve });
  });
}

export const ConfirmRoot = () => {
  const [state, setState] = useState(null);
  const [inputVal, setInputVal] = useState("");

  useEffect(() => {
    if (state?.prompt) setInputVal(state.defaultValue || "");
  }, [state]);

  useEffect(() => {
    _show = (opts) => setState(opts);
    return () => {
      _show = null;
    };
  }, []);

  const close = useCallback(
    (result) => {
      setState((s) => {
        if (s?.resolve) s.resolve(result);
        return null;
      });
    },
    []
  );

  useEffect(() => {
    if (!state) return;
    const onKey = (e) => {
      if (e.key === "Escape") close(state.prompt ? null : false);
      else if (e.key === "Enter" && !state.prompt) close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  const danger = state?.prompt ? state?.danger === true : state?.danger !== false;

  return createPortal(
    <AnimatePresence>
      {state && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2000] bg-sertex-bg/70 backdrop-blur-sm"
            onClick={() => close(state.prompt ? null : false)}
            data-testid="confirm-backdrop"
          />
          <div className="fixed inset-0 z-[2010] flex items-center justify-center pointer-events-none px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-auto w-full max-w-[440px] glass-panel corner-bracket p-5 space-y-4"
              data-testid="confirm-modal"
              role="alertdialog"
            >
              <div
                className={`flex items-center gap-2 display-text tracking-[0.2em] neon-glow ${
                  danger ? "text-rose-300" : "text-sertex-cyan"
                }`}
              >
                <AlertTriangle className="h-4 w-4" /> {state.title || (state.prompt ? "GİRİŞ" : "ONAY")}
              </div>
              <p className="text-sm font-mono text-sertex-text leading-relaxed whitespace-pre-line">
                {state.message || "Bu işlemi yapmak istiyor musunuz?"}
              </p>
              {state.prompt && (
                <input
                  type="text"
                  autoFocus
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); close(inputVal); }
                  }}
                  placeholder={state.placeholder || ""}
                  data-testid="prompt-input"
                  className="w-full bg-sertex-surface/60 border border-sertex-cyan/30 focus:border-sertex-cyan rounded-md px-3 py-2 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted/50 outline-none transition-colors"
                />
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => close(state.prompt ? null : false)}
                  data-testid="confirm-cancel"
                  className="flex-1 py-2 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50 rounded-md hud-text transition-colors"
                >
                  {state.cancelText || "VAZGEÇ"}
                </button>
                <button
                  onClick={() => close(state.prompt ? inputVal : true)}
                  data-testid="confirm-ok"
                  autoFocus={!state.prompt}
                  className={
                    danger
                      ? "flex-1 py-2 bg-rose-500/20 border border-rose-400/60 text-rose-200 hover:bg-rose-500 hover:text-white rounded-md hud-text transition-colors"
                      : "flex-1 py-2 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text transition-colors"
                  }
                >
                  {state.confirmText || (state.prompt ? "KAYDET" : "ONAYLA")}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ConfirmRoot;
