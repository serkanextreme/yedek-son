import { confirmDialog } from "@/lib/confirm";
// Faz 9 CP5 — extracted from UserManagement.jsx (originally lines 22–434).
// Behavior is BYTE-IDENTICAL.
// Same visual language as `TasksPanel.LockConfigModal` but scoped to a user's
// default lock policy. Non-privileged users (self-lock) land their flags in
// `default_self_lock_flags` (freely removable); admin/manager patches go into
// `default_lock_flags` with a configurable OTP requirement.
import React, { useEffect, useState } from "react";
import { KeyRound, X, Lock, Trash2 } from "lucide-react";
import { LOCK_KEY_LABELS, LOCK_KEY_ORDER } from "../../lib/taskLocks";
import { userLockApi, lockPolicyTemplateApi, archiveCapsApi } from "../../lib/api";
import { isAdminLike } from "../../lib/roles";
import { toast } from "sonner";

export const UserLockPolicyModal = ({ user, currentUser, onClose }) => {
  const [flags, setFlags] = useState({});
  const [selfFlags, setSelfFlags] = useState({});
  const [requiresOtp, setRequiresOtp] = useState(true);
  const [loading, setLoading] = useState(true);
  // Arşiv v2 — kişi bazlı arşiv yetkileri (yalnızca admin verir).
  const [archiveCaps, setArchiveCaps] = useState({ perm_delete: false, empty_trash: false, manage_policy: false });
  const [capSaving, setCapSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [auditRows, setAuditRows] = useState(null);
  // Faz 9 CP4.33 — Policy templates (managed mode only)
  const [templates, setTemplates] = useState([]);
  const [selectedTplId, setSelectedTplId] = useState("");
  const [tplSaveName, setTplSaveName] = useState("");
  const [tplSaving, setTplSaving] = useState(false);
  const isSelf = user.id === currentUser?.id;
  const isPrivileged = isAdminLike(currentUser) || currentUser?.role === "manager";
  // Which channel are we editing? Non-privileged self → self_lock (soft);
  // otherwise → default lock_flags (strict, respects requires_otp).
  const editingSelf = isSelf && !isPrivileged;
  const activeFlags = editingSelf ? selfFlags : flags;
  const setActiveFlags = editingSelf ? setSelfFlags : setFlags;

  useEffect(() => {
    (async () => {
      try {
        const res = await userLockApi.get(user.id);
        setFlags(res.default_lock_flags || {});
        setSelfFlags(res.default_self_lock_flags || {});
        setRequiresOtp(res.default_lock_requires_otp !== false);
        setArchiveCaps({
          perm_delete: !!res.archive_caps?.perm_delete,
          empty_trash: !!res.archive_caps?.empty_trash,
          manage_policy: !!res.archive_caps?.manage_policy,
        });
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Politika yüklenemedi");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Faz 9 CP4.33 — templates only fetched when in managed mode (admin/manager
  // context), NOT for pure self-lock use.
  useEffect(() => {
    if (editingSelf) return;
    (async () => {
      try {
        const res = await lockPolicyTemplateApi.list();
        setTemplates(res.templates || []);
      } catch {
        setTemplates([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTemplate = (tplId) => {
    const t = templates.find((x) => x.id === tplId);
    if (!t) return;
    // Overwrite the checkbox grid with the template's flags. User still needs
    // to press KAYDET to persist — this is a preview / staging step.
    const next = {};
    LOCK_KEY_ORDER.forEach((k) => { next[k] = !!(t.lock_flags || {})[k]; });
    setFlags(next);
    setRequiresOtp(t.requires_otp !== false);
    toast.success(`"${t.name}" uygulandı — KAYDET ile onayla`);
  };

  const saveAsTemplate = async () => {
    const name = tplSaveName.trim();
    if (!name) {
      toast.error("Şablon adı gerekli");
      return;
    }
    const activeKeys = Object.keys(flags).filter((k) => flags[k]);
    if (activeKeys.length === 0) {
      toast.error("En az bir kısıtlama seçili olmalı");
      return;
    }
    setTplSaving(true);
    try {
      const created = await lockPolicyTemplateApi.create({
        name,
        lock_flags: Object.fromEntries(activeKeys.map((k) => [k, true])),
        requires_otp: requiresOtp,
      });
      setTemplates((tpls) => [...tpls, created]);
      setTplSaveName("");
      toast.success(`"${created.name}" şablon olarak kaydedildi`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Şablon kaydedilemedi");
    } finally {
      setTplSaving(false);
    }
  };

  const deleteTemplate = async (tplId) => {
    const t = templates.find((x) => x.id === tplId);
    if (!t) return;
    if (!(await confirmDialog({ message: `"${t.name}" şablonunu sil?`, danger: true }))) return;
    try {
      await lockPolicyTemplateApi.remove(tplId);
      setTemplates((tpls) => tpls.filter((x) => x.id !== tplId));
      if (selectedTplId === tplId) setSelectedTplId("");
      toast.success("Şablon silindi");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const loadAudit = async () => {
    try {
      const res = await userLockApi.audit(user.id);
      setAuditRows(res.rows || []);
    } catch {
      setAuditRows([]);
    }
  };
  useEffect(() => {
    if (showHistory && auditRows === null) loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory]);

  const activeCount = Object.values(activeFlags).filter(Boolean).length;
  const toggle = (k) => setActiveFlags((f) => ({ ...f, [k]: !f[k] }));
  const setAll = (v) => {
    const next = {};
    LOCK_KEY_ORDER.forEach((k) => { next[k] = v; });
    setActiveFlags(next);
  };
  const isAdminUser = isAdminLike(currentUser);
  const toggleCap = async (key) => {
    if (!isAdminUser || capSaving) return;
    const next = { ...archiveCaps, [key]: !archiveCaps[key] };
    setArchiveCaps(next);
    setCapSaving(true);
    try {
      await archiveCapsApi.set(user.id, { [key]: next[key] });
      toast.success(next[key] ? "Yetki verildi" : "Yetki kaldırıldı");
    } catch (e) {
      setArchiveCaps((c) => ({ ...c, [key]: !next[key] }));
      toast.error(e?.response?.data?.detail || "İşlem başarısız");
    } finally {
      setCapSaving(false);
    }
  };
  const ARCHIVE_CAP_META = [
    { key: "perm_delete", label: "Kalıcı Sil (çöpteki tek görevi geri dönüşsüz sil)" },
    { key: "empty_trash", label: "Çöp Kutusunu Boşalt (toplu kalıcı sil)" },
    { key: "manage_policy", label: "Arşiv Politikası Düzenle (neden + otomatik temizlik ayarı)" },
  ];

  const save = async () => {
    setSaving(true);
    try {
      const updated = await userLockApi.set(user.id, activeFlags, editingSelf ? undefined : requiresOtp);
      // Refresh both channels from the response.
      setFlags(updated.default_lock_flags || {});
      setSelfFlags(updated.default_self_lock_flags || {});
      toast.success(
        activeCount === 0
          ? "Politika temizlendi"
          : `${activeCount} varsayılan kısıtlama · ${editingSelf ? "kişisel" : (requiresOtp ? "OTP zorunlu" : "OTP'siz")}`,
      );
      setAuditRows(null); // will refetch when history opened
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="user-lock-policy-modal"
    >
      <div
        className="glass-panel corner-bracket p-4 max-w-md w-full space-y-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="hud-text text-amber-300 flex items-center gap-2 neon-glow">
            <Lock className="h-4 w-4" /> VARSAYILAN KİLİT · {user.username}
          </div>
          <button onClick={onClose} className="text-sertex-textMuted hover:text-sertex-cyan">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Tab toggle */}
        <div className="flex items-center gap-1 border-b border-sertex-cyan/15 pb-1">
          <button
            type="button"
            onClick={() => setShowHistory(false)}
            data-testid="user-lock-tab-config"
            className={`px-2 py-1 text-[10px] font-mono hud-text transition-colors ${
              !showHistory ? "text-amber-300 border-b-2 border-amber-400 -mb-[5px]" : "text-sertex-textMuted hover:text-amber-300"
            }`}
          >
            KISITLAMALAR
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            data-testid="user-lock-tab-history"
            className={`px-2 py-1 text-[10px] font-mono hud-text transition-colors ${
              showHistory ? "text-emerald-300 border-b-2 border-emerald-400 -mb-[5px]" : "text-sertex-textMuted hover:text-emerald-300"
            }`}
          >
            TARİHÇE
          </button>
        </div>
        {loading ? (
          <div className="text-center text-sertex-textMuted text-xs py-6 hud-text animate-pulse">
            YÜKLENİYOR...
          </div>
        ) : !showHistory ? (
          <>
            <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
              {editingSelf ? (
                <>Kendi kişisel kilidin. <b>{user.username}</b>'a atanan yeni görevlere otomatik uygulanır.
                İstediğin an buradan kaldırabilirsin — OTP gerekmez.</>
              ) : (
                <><b>{user.username}</b>'a atanan <b>yeni</b> görevlerde otomatik uygulanacak kısıtlamalar.
                Mevcut görevler etkilenmez.</>
              )}
            </div>
            {/* Info if there are BOTH admin locks and self-locks on the user */}
            {isPrivileged && Object.values(selfFlags).some(Boolean) && (
              <div className="text-[10px] font-mono text-emerald-300/80 normal-case border border-emerald-400/30 rounded px-2 py-1 bg-emerald-500/5">
                Kullanıcı kendi kişisel kilidi de tanımlamış:{" "}
                {Object.keys(selfFlags).filter((k) => selfFlags[k]).map((k) => LOCK_KEY_LABELS[k]).join(", ")}
              </div>
            )}
            {/* Faz 9 CP4.33 — Templates (managed mode only) */}
            {!editingSelf && templates.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap px-2 py-1.5 rounded border border-cyan-400/25 bg-cyan-500/[0.03]" data-testid="lock-templates-bar">
                <span className="hud-text text-cyan-300 text-[10px]">ŞABLON:</span>
                <select
                  value={selectedTplId}
                  onChange={(e) => setSelectedTplId(e.target.value)}
                  data-testid="lock-template-select"
                  className="flex-1 min-w-[120px] bg-sertex-surface/60 border border-cyan-400/30 rounded px-1.5 py-0.5 text-[11px] font-mono text-cyan-200"
                >
                  <option value="">— seç —</option>
                  {templates.map((t) => {
                    const cnt = Object.values(t.lock_flags || {}).filter(Boolean).length;
                    return (
                      <option key={t.id} value={t.id}>
                        {`${t.name} (${cnt})${t.requires_otp ? "" : " · OTP'siz"}`}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  disabled={!selectedTplId}
                  onClick={() => applyTemplate(selectedTplId)}
                  data-testid="lock-template-apply"
                  className="px-2 py-0.5 rounded border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/15 text-[10px] font-mono hud-text disabled:opacity-40"
                >
                  UYGULA
                </button>
                <button
                  type="button"
                  disabled={!selectedTplId}
                  onClick={() => deleteTemplate(selectedTplId)}
                  data-testid="lock-template-delete"
                  title="Bu şablonu sil"
                  className="px-1.5 py-0.5 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-500/10 text-[10px] font-mono disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
            {/* Şablon olarak kaydet (managed mode + en az 1 aktif flag) */}
            {!editingSelf && activeCount > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-cyan-400/25 bg-cyan-500/[0.03]">
                <span className="hud-text text-cyan-300 text-[10px]">KAYDET:</span>
                <input
                  type="text"
                  value={tplSaveName}
                  onChange={(e) => setTplSaveName(e.target.value.slice(0, 80))}
                  maxLength={80}
                  placeholder="Şablon adı (max 80 karakter)..."
                  data-testid="lock-template-name"
                  className="flex-1 bg-sertex-surface/60 border border-cyan-400/30 rounded px-1.5 py-0.5 text-[11px] font-mono text-cyan-200 placeholder:text-sertex-textMuted"
                />
                <button
                  type="button"
                  onClick={saveAsTemplate}
                  disabled={tplSaving || !tplSaveName.trim()}
                  data-testid="lock-template-save"
                  className="px-2 py-0.5 rounded border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/15 text-[10px] font-mono hud-text disabled:opacity-40"
                >
                  {tplSaving ? "..." : "+ ŞABLON"}
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAll(true)}
                data-testid="user-lock-set-all"
                className="px-2 py-1 rounded border border-amber-400/50 text-amber-300 hover:bg-amber-500/10 text-[10px] font-mono hud-text"
              >
                TÜMÜNÜ KİLİTLE
              </button>
              <button
                type="button"
                onClick={() => setAll(false)}
                data-testid="user-lock-clear-all"
                className="px-2 py-1 rounded border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan text-[10px] font-mono hud-text"
              >
                TÜMÜNÜ SERBEST BIRAK
              </button>
              <span className="ml-auto text-[10px] font-mono text-sertex-textMuted">
                {activeCount} / {LOCK_KEY_ORDER.length} aktif
              </span>
            </div>
            {!editingSelf && (
              <label className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-xs font-mono transition-colors ${
                requiresOtp
                  ? "border-amber-400/50 bg-amber-500/5 text-amber-200"
                  : "border-emerald-400/40 bg-emerald-500/5 text-emerald-200"
              }`}>
                <input
                  type="checkbox"
                  checked={requiresOtp}
                  onChange={(e) => setRequiresOtp(e.target.checked)}
                  data-testid="user-lock-requires-otp"
                  className="accent-amber-500 cursor-pointer"
                />
                <KeyRound className="h-3 w-3" />
                <span className="flex-1">
                  {requiresOtp
                    ? "Bypass için OTP gerekli (katı)"
                    : "OTP'siz açılabilir (yumuşak — kullanıcı kendisi kaldırabilir)"}
                </span>
              </label>
            )}
            {isAdminUser && !isSelf && (
              <div className="space-y-1.5 border border-rose-400/25 rounded p-2 bg-rose-500/[0.03]" data-testid="archive-caps-section">
                <div className="hud-text text-rose-300 text-[10px] flex items-center gap-1.5">
                  ARŞİV YETKİLERİ — <span className="text-sertex-textMuted normal-case">geri dönüşsüz silme + politika</span>
                </div>
                {ARCHIVE_CAP_META.map((c) => {
                  const on = !!archiveCaps[c.key];
                  return (
                    <label
                      key={c.key}
                      className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs font-mono transition-colors ${
                        on ? "bg-rose-500/10 text-rose-200" : "text-sertex-text hover:bg-rose-500/5"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={capSaving}
                        onChange={() => toggleCap(c.key)}
                        data-testid={`archive-cap-${c.key}`}
                        className="accent-rose-500 cursor-pointer"
                      />
                      <span className="flex-1 normal-case">{c.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="space-y-1 border border-sertex-cyan/15 rounded p-1">
              {LOCK_KEY_ORDER.map((k) => {
                const checked = !!activeFlags[k];
                return (
                  <label
                    key={k}
                    className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs font-mono transition-colors ${
                      checked ? "bg-amber-500/10 text-amber-200" : "text-sertex-text hover:bg-sertex-cyan/5"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(k)}
                      data-testid={`user-lock-flag-${k}`}
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
                className="flex-1 py-1.5 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
              >
                İPTAL
              </button>
              <button
                onClick={save}
                disabled={saving}
                data-testid="user-lock-save"
                className="flex-1 py-1.5 border border-amber-400 bg-amber-500/20 text-amber-200 hover:bg-amber-500/40 rounded hud-text disabled:opacity-40"
              >
                {saving ? "KAYDEDİLİYOR..." : "KAYDET"}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-2" data-testid="user-lock-history-panel">
            {!auditRows && (
              <div className="text-center text-emerald-300 text-[10px] py-4 animate-pulse hud-text">
                YÜKLENİYOR...
              </div>
            )}
            {auditRows && auditRows.length === 0 && (
              <div className="text-center text-sertex-textMuted text-xs py-6 normal-case font-mono italic">
                Henüz politika değişikliği yok
              </div>
            )}
            {auditRows && auditRows.length > 0 && (
              <div className="border border-sertex-cyan/15 rounded max-h-[45vh] overflow-y-auto">
                {auditRows.map((row) => {
                  const p = row.payload || {};
                  const activeKeys = Object.keys(p.flags_after || {}).filter((k) => p.flags_after[k]);
                  return (
                    <div key={row.id} className="px-2 py-1.5 border-b border-sertex-cyan/10 last:border-b-0 text-[11px] font-mono">
                      <div className={`hud-text ${p.channel === "self" ? "text-emerald-300" : "text-amber-300"}`}>
                        {p.channel === "self" ? "Kişisel politika" : "Yönetici politikası"}
                        {p.requires_otp !== undefined && !p.channel === "self" ? (p.requires_otp ? " · OTP" : " · OTP'siz") : ""}
                      </div>
                      <div className="text-sertex-textMuted text-[10px] normal-case">
                        {row.actor_username}{row.actor_role ? ` (${row.actor_role})` : ""} · {(() => {
                          try { return new Date(row.created_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "medium" }); }
                          catch { return row.created_at; }
                        })()}
                      </div>
                      <div className="text-sertex-textMuted/80 text-[9px] normal-case break-all">
                        {activeKeys.length === 0
                          ? "Tüm kısıtlamalar temizlendi"
                          : activeKeys.map((k) => LOCK_KEY_LABELS[k] || k).join(", ")}
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
    </div>
  );
};

export default UserLockPolicyModal;
