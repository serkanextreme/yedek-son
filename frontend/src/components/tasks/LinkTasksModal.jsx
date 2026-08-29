// Görev Bağlama modalı — birden fazla görevi seçip sıraya dizerek gruplar.
// Hem yeni grup oluşturma hem mevcut grubu düzenleme için kullanılır.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Link2, X, ChevronUp, ChevronDown, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { tasksApi } from "../../lib/api";

export const LinkTasksModal = ({ candidateTasks = [], preselectedIds = [], group = null, onClose, onSaved }) => {
  const isEdit = !!group;
  // Seçili görevler — SIRALI id listesi.
  const [selected, setSelected] = useState(() =>
    (preselectedIds || []).filter((id) => candidateTasks.some((t) => t.id === id))
  );
  const [name, setName] = useState(group?.name || "");
  const [showProgress, setShowProgress] = useState(group ? !!group.show_progress : true);
  const [saving, setSaving] = useState(false);

  const taskById = useMemo(() => {
    const m = {};
    for (const t of candidateTasks) m[t.id] = t;
    return m;
  }, [candidateTasks]);

  const available = candidateTasks.filter((t) => !selected.includes(t.id));

  const addTask = (id) => setSelected((s) => [...s, id]);
  const removeTask = (id) => setSelected((s) => s.filter((x) => x !== id));
  const move = (idx, dir) => {
    setSelected((s) => {
      const next = [...s];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return s;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    if (selected.length < 2) {
      toast.error("Bağlamak için en az 2 görev seçin");
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim() || null, show_progress: showProgress, task_ids: selected };
      if (isEdit) await tasksApi.updateGroup(group.id, payload);
      else await tasksApi.createGroup(payload);
      toast.success(isEdit ? "Grup güncellendi" : `${selected.length} görev bağlandı`);
      onSaved?.();
      onClose();
    } catch (e) {
      console.error("[LinkTasksModal] grup kaydetme hatası:", e);
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[110] bg-sertex-bg/70 backdrop-blur-sm" onClick={onClose} data-testid="link-modal-backdrop" />
      <div className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-auto w-full max-w-[520px] glass-panel corner-bracket p-4 space-y-3 max-h-[85vh] overflow-y-auto"
          data-testid="link-tasks-modal"
        >
          <div className="flex items-center justify-between border-b border-sertex-cyan/20 pb-2">
            <div className="display-text text-sertex-cyan neon-glow tracking-[0.2em] flex items-center gap-2">
              <Link2 className="h-4 w-4" /> {isEdit ? "GRUBU DÜZENLE" : "GÖREVLERİ BAĞLA"}
            </div>
            <button onClick={onClose} className="p-1 hover:bg-sertex-cyan/10 rounded text-sertex-textMuted hover:text-sertex-cyan">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Grup adı + ilerleme */}
          <div className="grid grid-cols-1 gap-2">
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">GRUP ADI (opsiyonel)</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn: Cuma İşleri"
                data-testid="link-group-name"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
              />
            </div>
            <label className="flex items-center gap-2 hud-text text-sertex-textMuted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showProgress}
                onChange={(e) => setShowProgress(e.target.checked)}
                data-testid="link-show-progress"
                className="accent-sertex-cyan"
              />
              İlerleme göster (ör. "2/4 tamamlandı")
            </label>
          </div>

          {/* Seçili görevler — sıralı */}
          <div>
            <div className="hud-text text-sertex-cyan mb-1">SEÇİLİ GÖREVLER · SIRA ({selected.length})</div>
            {selected.length === 0 ? (
              <div className="hud-text text-sertex-textMuted/70 border border-dashed border-sertex-cyan/20 rounded-md px-3 py-3 text-center">
                Aşağıdan görev ekleyin
              </div>
            ) : (
              <div className="space-y-1" data-testid="link-selected-list">
                {selected.map((id, idx) => {
                  const t = taskById[id];
                  if (!t) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 bg-sertex-surface/50 border border-sertex-cyan/25 rounded-md px-2 py-1.5"
                      data-testid={`link-selected-${id}`}
                    >
                      <span className="hud-text text-sertex-cyan w-5 text-center">{idx + 1}.</span>
                      <span className="flex-1 text-sm font-mono text-sertex-text truncate">{t.title}</span>
                      <button
                        onClick={() => move(idx, -1)}
                        disabled={idx === 0}
                        title="Yukarı"
                        className="p-1 rounded text-sertex-textMuted hover:text-sertex-cyan disabled:opacity-30"
                        data-testid={`link-move-up-${id}`}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => move(idx, 1)}
                        disabled={idx === selected.length - 1}
                        title="Aşağı"
                        className="p-1 rounded text-sertex-textMuted hover:text-sertex-cyan disabled:opacity-30"
                        data-testid={`link-move-down-${id}`}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => removeTask(id)}
                        title="Çıkar"
                        className="p-1 rounded text-rose-300/80 hover:text-rose-300"
                        data-testid={`link-remove-${id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Eklenebilir görevler */}
          {available.length > 0 && (
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">EKLENEBİLİR GÖREVLER</div>
              <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1" data-testid="link-available-list">
                {available.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => addTask(t.id)}
                    data-testid={`link-add-${t.id}`}
                    className="w-full flex items-center gap-2 bg-sertex-surface/30 border border-sertex-cyan/15 hover:border-sertex-cyan/50 hover:bg-sertex-cyan/5 rounded-md px-2 py-1.5 text-left transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
                    <span className="flex-1 text-sm font-mono text-sertex-text truncate">{t.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-sertex-cyan/15">
            <button
              onClick={onClose}
              className="flex-1 py-2 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50 rounded-md hud-text transition-colors"
            >
              İPTAL
            </button>
            <button
              onClick={handleSave}
              disabled={saving || selected.length < 2}
              data-testid="link-save"
              className="flex-1 py-2 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Check className="h-4 w-4" /> {isEdit ? "GÜNCELLE" : "BAĞLA"}
            </button>
          </div>
        </motion.div>
      </div>
    </>,
    document.body
  );
};

export default LinkTasksModal;
