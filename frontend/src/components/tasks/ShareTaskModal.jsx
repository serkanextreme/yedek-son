// Görev Paylaşımı — "Özellik Tanımla" (ÖZELLİK B).
// Search any user in the system, grant granular per-user permissions
// (Görüntüle / Düzenle / Tamamla / Sil / Başkasına ata) and optionally
// notify them. Dark HUD theme matching ReassignModal.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Share2, X, Search, User, Bell, BellOff, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { tasksApi, usersApi } from "../../lib/api";

const PERM_DEFS = [
  { key: "view", label: "Görüntüle", locked: true },
  { key: "edit", label: "Düzenle" },
  { key: "complete", label: "Tamamla" },
  { key: "delete", label: "Sil" },
  { key: "assign", label: "Başkasına ata" },
];

const defaultPerms = () => ({ view: true, edit: false, complete: false, delete: false, assign: false });

export const ShareTaskModal = ({ task, onClose, onSaved }) => {
  // shares: [{ user_id, name, perms }]
  const [shares, setShares] = useState(() =>
    (task.shared_with || []).map((s) => ({
      user_id: s.user_id,
      name: s.name,
      perms: { ...defaultPerms(), ...(s.perms || {}) },
    })),
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  const runSearch = useCallback((q) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    usersApi
      .search(q.trim())
      .then((r) => setResults(r || []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query, runSearch]);

  const addUser = (u) => {
    if (shares.some((s) => s.user_id === u.id)) {
      toast.info(`${u.username} zaten ekli`);
      return;
    }
    setShares((prev) => [
      ...prev,
      { user_id: u.id, name: u.username, perms: defaultPerms() },
    ]);
    setQuery("");
    setResults([]);
  };

  const removeUser = (uid) => setShares((prev) => prev.filter((s) => s.user_id !== uid));

  const togglePerm = (uid, key) => {
    if (key === "view") return; // baseline, always on
    setShares((prev) =>
      prev.map((s) =>
        s.user_id === uid ? { ...s, perms: { ...s.perms, [key]: !s.perms[key] } } : s,
      ),
    );
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = shares.map((s) => ({ user_id: s.user_id, perms: s.perms }));
      const updated = await tasksApi.setShares(task.id, payload, notify);
      toast.success(
        shares.length
          ? `Görev ${shares.length} kişiyle paylaşıldı`
          : "Paylaşım güncellendi",
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
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      data-testid="share-modal"
    >
      <div
        className="bg-sertex-bg border border-sertex-cyan/40 rounded-lg shadow-lg shadow-sertex-cyan/20 w-[520px] max-w-[94vw] max-h-[82vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-sertex-cyan/25">
          <div className="hud-text text-sertex-cyan flex items-center gap-1.5">
            <Share2 className="h-3.5 w-3.5" /> ÖZELLİK TANIMLA · PAYLAŞ
          </div>
          <button
            onClick={onClose}
            data-testid="share-close"
            className="p-1 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-sertex-cyan/15 text-xs text-sertex-textMuted font-mono truncate">
          {task.title}
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-sertex-cyan/10 relative">
          <div className="flex items-center gap-2 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2">
            <Search className="h-3.5 w-3.5 text-sertex-textMuted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Kullanıcı ara (sistemdeki herkes)"
              data-testid="share-user-search"
              className="w-full bg-transparent py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted outline-none"
            />
          </div>
          {(searching || results.length > 0) && query.trim() && (
            <div className="absolute left-4 right-4 mt-1 z-10 bg-sertex-bg border border-sertex-cyan/30 rounded-md shadow-lg max-h-52 overflow-y-auto">
              {searching && (
                <div className="px-3 py-2 hud-text text-sertex-textMuted">Aranıyor...</div>
              )}
              {!searching && results.length === 0 && (
                <div className="px-3 py-2 hud-text text-sertex-textMuted">Sonuç yok</div>
              )}
              {results.map((u) => (
                <button
                  key={u.id}
                  onClick={() => addUser(u)}
                  data-testid={`share-user-result-${u.username}`}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-sertex-cyan/10 transition-colors"
                >
                  <User className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
                  <span className="text-sm font-mono text-sertex-text truncate flex-1">
                    {u.username}
                    {u.role === "manager" && (
                      <span className="hud-text text-purple-300/70 ml-2">MÜDÜR</span>
                    )}
                    {(u.role === "admin" || u.role === "super_admin" || u.is_owner) && (
                      <span className="hud-text text-yellow-300/70 ml-2">{u.is_owner ? "KURUCU" : (u.role === "super_admin" ? "SÜPER YÖNETİCİ" : "YÖNETİCİ")}</span>
                    )}
                  </span>
                  {u.company_name && (
                    <span className="hud-text text-sertex-textMuted/70 truncate">{u.company_name}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Shared users + perms */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="share-list">
          {shares.length === 0 && (
            <div className="text-center py-6 hud-text text-sertex-textMuted" data-testid="share-empty">
              Henüz kimseyle paylaşılmadı.
              <br />
              <span className="text-[10px] text-sertex-textMuted/70">
                Yukarıdan kullanıcı arayıp ekleyin.
              </span>
            </div>
          )}
          {shares.map((s) => (
            <div
              key={s.user_id}
              data-testid={`share-row-${s.user_id}`}
              className="rounded-md border border-sertex-cyan/20 bg-sertex-surface/40 p-2.5"
            >
              <div className="flex items-center gap-2 mb-2">
                <User className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
                <span className="text-sm font-mono text-sertex-text truncate flex-1">
                  {s.name || s.user_id}
                </span>
                <button
                  onClick={() => removeUser(s.user_id)}
                  data-testid={`share-remove-${s.user_id}`}
                  className="p-1 text-rose-300 hover:bg-rose-500/15 rounded"
                  title="Kaldır"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PERM_DEFS.map((p) => {
                  const on = !!s.perms[p.key];
                  return (
                    <button
                      key={p.key}
                      onClick={() => togglePerm(s.user_id, p.key)}
                      disabled={p.locked}
                      data-testid={`share-perm-${s.user_id}-${p.key}`}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded border hud-text transition-colors ${
                        on
                          ? "border-sertex-cyan/60 bg-sertex-cyan/15 text-sertex-cyan"
                          : "border-sertex-textMuted/30 text-sertex-textMuted hover:border-sertex-cyan/40"
                      } ${p.locked ? "opacity-70 cursor-default" : ""}`}
                    >
                      {on && <Check className="h-2.5 w-2.5" />}
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Notify toggle + actions */}
        <div className="px-4 py-3 border-t border-sertex-cyan/15 flex items-center justify-between gap-3">
          <button
            onClick={() => setNotify((v) => !v)}
            data-testid="share-notify-toggle"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border hud-text transition-colors ${
              notify
                ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
                : "border-sertex-textMuted/40 text-sertex-textMuted"
            }`}
          >
            {notify ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
            {notify ? "Bildirim gönder: AÇIK" : "Bildirim gönder: KAPALI"}
          </button>
          <button
            onClick={save}
            disabled={saving}
            data-testid="share-save"
            className="px-4 py-1.5 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text transition-colors disabled:opacity-40"
          >
            KAYDET
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ShareTaskModal;
