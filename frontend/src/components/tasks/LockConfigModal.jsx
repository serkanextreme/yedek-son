// Faz 9 CP5 — extracted from TasksPanel.jsx (originally lines 713–972).
// Behavior is BYTE-IDENTICAL. Presentation-only component.
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Lock, X, KeyRound, Clock } from "lucide-react";
import { toast } from "sonner";
import { taskLockApi } from "../../lib/api";
import { LOCK_KEY_LABELS, LOCK_KEY_ORDER } from "../../lib/taskLocks";
import { LOCK_AUDIT_EVENT_META, formatAuditPayload } from "../../lib/taskHelpers";

export const LockConfigModal = ({ task, onClose, onSaved }) => {
  const [flags, setFlags] = useState(() => ({ ...(task.lock_flags || {}) }));
  const [requiresOtp, setRequiresOtp] = useState(() =>
    task.lock_requires_otp === undefined ? true : !!task.lock_requires_otp,
  );
  const [saving, setSaving] = useState(false);
  // Faz 9 CP4.28 — audit tab
  const [showHistory, setShowHistory] = useState(false);
  const [auditRows, setAuditRows] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const activeCount = Object.values(flags).filter(Boolean).length;
  const toggle = (k) => setFlags((f) => ({ ...f, [k]: !f[k] }));
  const setAll = (val) => {
    const next = {};
    LOCK_KEY_ORDER.forEach((k) => { next[k] = val; });
    setFlags(next);
  };
  // Faz 9 CP4.34 — bind loadAudit to current task.id via useCallback so a
  // task-swap while the modal is open doesn't fetch history for the wrong
  // task (stale closure). Also re-fetch when task.id itself changes.
  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await taskLockApi.audit(task.id);
      setAuditRows(res.rows || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Tarihçe yüklenemedi");
      setAuditRows([]);
    } finally {
      setAuditLoading(false);
    }
  }, [task.id]);
  useEffect(() => {
    if (showHistory && auditRows === null) loadAudit();
  }, [showHistory, auditRows, loadAudit]);
  const save = async () => {
    setSaving(true);
    try {
      const updated = await taskLockApi.setLocks(task.id, flags, requiresOtp);
      toast.success(
        activeCount === 0
          ? "Görev kilidi kaldırıldı"
          : `${activeCount} kısıtlama kaydedildi${requiresOtp ? " · OTP zorunlu" : " · OTP'siz"}`,
      );
      onSaved?.(updated);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="lock-config-modal"
    >
      <div
        className="glass-panel corner-bracket p-4 max-w-md w-full space-y-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="hud-text text-amber-300 flex items-center gap-2 neon-glow">
            <Lock className="h-4 w-4" /> GÖREV KİLİDİ
          </div>
          <button onClick={onClose} className="text-sertex-textMuted hover:text-sertex-cyan">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Faz 9 CP4.28 — sekme togglesi: Kısıtlamalar / Tarihçe */}
        <div className="flex items-center gap-1 border-b border-sertex-cyan/15 pb-1">
          <button
            type="button"
            onClick={() => setShowHistory(false)}
            data-testid="lock-tab-config"
            className={`px-2 py-1 rounded-t text-[10px] font-mono hud-text transition-colors ${
              !showHistory
                ? "text-amber-300 border-b-2 border-amber-400 -mb-[5px]"
                : "text-sertex-textMuted hover:text-amber-300"
            }`}
          >
            KISITLAMALAR
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            data-testid="lock-tab-history"
            className={`px-2 py-1 rounded-t text-[10px] font-mono hud-text transition-colors ${
              showHistory
                ? "text-emerald-300 border-b-2 border-emerald-400 -mb-[5px]"
                : "text-sertex-textMuted hover:text-emerald-300"
            }`}
          >
            TARİHÇE
          </button>
        </div>
        {!showHistory ? (
        <>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
          <span className="text-sertex-text font-semibold">{task.title}</span> için atanan
          kişinin izinsiz yapamayacağı işlemleri seç. İhtiyaç halinde tek seferlik OTP ile açılır.
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAll(true)}
            data-testid="lock-set-all"
            className="px-2 py-1 rounded border border-amber-400/50 text-amber-300 hover:bg-amber-500/10 text-[10px] font-mono hud-text"
          >
            TÜMÜNÜ KİLİTLE
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            data-testid="lock-clear-all"
            className="px-2 py-1 rounded border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan text-[10px] font-mono hud-text"
          >
            TÜMÜNÜ SERBEST BIRAK
          </button>
          <span className="ml-auto text-[10px] font-mono text-sertex-textMuted">
            {activeCount} / {LOCK_KEY_ORDER.length} aktif
          </span>
        </div>
        {/* Faz 9 CP4.30 — OTP requirement toggle. When off, the assignee can
            bypass the lock via a plain "kilidi aç" click (no code). */}
        <label className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-xs font-mono transition-colors ${
          requiresOtp
            ? "border-amber-400/50 bg-amber-500/5 text-amber-200"
            : "border-emerald-400/40 bg-emerald-500/5 text-emerald-200"
        }`}>
          <input
            type="checkbox"
            checked={requiresOtp}
            onChange={(e) => setRequiresOtp(e.target.checked)}
            data-testid="lock-requires-otp"
            className="accent-amber-500 cursor-pointer"
          />
          <KeyRound className="h-3 w-3" />
          <span className="flex-1">
            {requiresOtp
              ? "Bypass için OTP gerekli (katı)"
              : "OTP'siz açılabilir (yumuşak — atanan kişi kendisi kaldırabilir)"}
          </span>
        </label>
        <div className="space-y-1 border border-sertex-cyan/15 rounded p-1">
          {LOCK_KEY_ORDER.map((k) => {
            const checked = !!flags[k];
            return (
              <label
                key={k}
                className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs font-mono transition-colors ${
                  checked
                    ? "bg-amber-500/10 text-amber-200"
                    : "text-sertex-text hover:bg-sertex-cyan/5"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(k)}
                  data-testid={`lock-flag-${k}`}
                  className="accent-amber-500 cursor-pointer"
                />
                <span className="flex-1">{LOCK_KEY_LABELS[k]}</span>
                {checked && <Lock className="h-3 w-3 opacity-70" />}
              </label>
            );
          })}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            data-testid="lock-config-cancel"
            className="flex-1 py-1.5 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
          >
            İPTAL
          </button>
          <button
            onClick={save}
            disabled={saving}
            data-testid="lock-config-save"
            className="flex-1 py-1.5 border border-amber-400 bg-amber-500/20 text-amber-200 hover:bg-amber-500/40 rounded hud-text disabled:opacity-40"
          >
            {saving ? "KAYDEDİLİYOR..." : "KAYDET"}
          </button>
        </div>
        </>
        ) : (
          <div className="space-y-2" data-testid="lock-history-panel">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
                <span className="text-sertex-text font-semibold">{task.title}</span> için kilit tarihçesi.
                Şifreler değil, kim/ne zaman/hangi işlem — KVKK uyumlu.
              </div>
              <button
                onClick={loadAudit}
                title="Yenile"
                data-testid="lock-history-refresh"
                className="px-2 py-1 rounded border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10 text-[10px] font-mono hud-text"
              >
                YENİLE
              </button>
            </div>
            {auditLoading && (
              <div className="text-center text-emerald-300 text-[10px] py-4 animate-pulse hud-text">
                YÜKLENİYOR...
              </div>
            )}
            {!auditLoading && auditRows !== null && auditRows.length === 0 && (
              <div className="text-center text-sertex-textMuted text-xs py-6 normal-case font-mono italic">
                Bu görev için henüz kilit hareketi yok
              </div>
            )}
            {!auditLoading && auditRows && auditRows.length > 0 && (
              <div className="border border-sertex-cyan/15 rounded max-h-[45vh] overflow-y-auto">
                {auditRows.map((row) => {
                  const meta = LOCK_AUDIT_EVENT_META[row.event_type] || { label: row.event_type, icon: Clock, color: "text-sertex-textMuted" };
                  const EIcon = meta.icon;
                  return (
                    <div
                      key={row.id}
                      data-testid={`lock-history-row-${row.event_type}`}
                      className="flex items-start gap-2 px-2 py-1.5 border-b border-sertex-cyan/10 last:border-b-0 text-[11px] font-mono"
                    >
                      <EIcon className={`h-3 w-3 mt-0.5 shrink-0 ${meta.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`hud-text ${meta.color}`}>{meta.label}</div>
                        <div className="text-sertex-textMuted text-[10px] normal-case">
                          {row.actor_username || "?"}{row.actor_role ? ` (${row.actor_role})` : ""}
                          {" · "}
                          {(() => {
                            try { return new Date(row.created_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "medium" }); }
                            catch { return row.created_at; }
                          })()}
                        </div>
                        {row.payload && Object.keys(row.payload).length > 0 && (
                          <div className="text-sertex-textMuted/70 text-[9px] mt-0.5 normal-case break-all">
                            {formatAuditPayload(row.event_type, row.payload)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full py-1.5 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
            >
              KAPAT
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default LockConfigModal;
