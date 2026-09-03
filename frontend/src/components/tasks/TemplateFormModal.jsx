import React, { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { LayoutTemplate, X, Plus, Trash2, User, Users } from "lucide-react";
import { toast } from "sonner";
import { templatesApi, templateAttachmentsApi } from "../../lib/api";
import { REMINDER_DAY_CHOICES } from "../../lib/taskHelpers";
import { getCategoryPathLabel } from "../../lib/categoryTree";
import { TaskAttachments } from "./TaskAttachments";

// Şablon oluştur / düzenle. Yeni şablonda "Kaydet" önce şablonu oluşturur,
// ardından dosya ekleri bölümü açılır (ekler bir şablon id'si gerektirir).
export const TemplateFormModal = ({ template, categories = [], currentUser = null, onClose, onSaved }) => {
  const [tplId, setTplId] = useState(template?.id || null);
  const [name, setName] = useState(template?.name || "");
  const [title, setTitle] = useState(template?.title || "");
  const [description, setDescription] = useState(template?.description || "");
  const [categoryId, setCategoryId] = useState(template?.category_id || "");
  const [reminderDays, setReminderDays] = useState(
    template?.reminder_disabled ? "__off__" : (template?.reminder_days == null ? "" : String(template.reminder_days)),
  );
  const [scope, setScope] = useState(template?.scope === "shared" ? "shared" : "personal");
  const [subtasks, setSubtasks] = useState(template?.subtasks || []);
  const [newSub, setNewSub] = useState("");
  const [saving, setSaving] = useState(false);

  const addSub = () => {
    const t = newSub.trim();
    if (!t) return;
    setSubtasks((prev) => [...prev, { id: `tmp-${Date.now()}`, text: t }]);
    setNewSub("");
  };

  const buildBody = () => {
    const body = {
      name: name.trim(),
      title: title.trim(),
      description: description.trim(),
      category_id: categoryId || null,
      scope,
      subtasks: subtasks.map((s) => ({ text: s.text })),
    };
    if (reminderDays === "__off__") {
      body.reminder_disabled = true;
      body.reminder_days = 0;
    } else if (reminderDays === "") {
      body.reminder_disabled = false;
      body.reminder_days = null;
    } else {
      body.reminder_disabled = false;
      body.reminder_days = parseInt(reminderDays, 10);
    }
    return body;
  };

  const handleSave = async () => {
    if (name.trim().length < 2) {
      toast.error("Şablon adı en az 2 karakter olmalı");
      return;
    }
    setSaving(true);
    try {
      const body = buildBody();
      if (tplId) {
        await templatesApi.update(tplId, body);
        toast.success("Şablon güncellendi");
        onSaved?.();
        onClose();
      } else {
        const created = await templatesApi.create(body);
        setTplId(created.id);
        toast.success("Şablon kaydedildi — artık dosya ekleyebilirsiniz");
        onSaved?.();
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[130] bg-sertex-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[140] flex items-center justify-center pointer-events-none px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-auto w-full max-w-[460px] max-h-[88vh] overflow-y-auto glass-panel corner-bracket p-4 space-y-3"
          data-testid="template-form-modal"
        >
          <div className="flex items-center justify-between border-b border-sertex-cyan/20 pb-2">
            <div className="display-text text-sertex-cyan neon-glow tracking-[0.2em] flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4" /> {tplId ? "ŞABLONU DÜZENLE" : "YENİ ŞABLON"}
            </div>
            <button onClick={onClose} data-testid="template-form-close" className="p-1 hover:bg-sertex-cyan/10 rounded text-sertex-textMuted hover:text-sertex-cyan">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <div className="hud-text text-sertex-textMuted mb-1">ŞABLON ADI *</div>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="template-name"
              placeholder="Örn: Haftalık Rapor"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none" />
          </div>

          {/* Kapsam — Kişisel / Ekip ortak */}
          <div>
            <div className="hud-text text-sertex-textMuted mb-1">KAPSAM</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setScope("personal")} data-testid="template-scope-personal"
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md border hud-text transition-colors ${scope === "personal" ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10" : "border-sertex-textMuted/30 text-sertex-textMuted hover:border-sertex-cyan/50"}`}>
                <User className="h-3.5 w-3.5" /> Kişisel
              </button>
              <button type="button" onClick={() => setScope("shared")} data-testid="template-scope-shared"
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md border hud-text transition-colors ${scope === "shared" ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10" : "border-sertex-textMuted/30 text-sertex-textMuted hover:border-sertex-cyan/50"}`}>
                <Users className="h-3.5 w-3.5" /> Ekip (şirket)
              </button>
            </div>
          </div>

          <div>
            <div className="hud-text text-sertex-textMuted mb-1">GÖREV BAŞLIĞI</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="template-title"
              placeholder="Görev oluşturulunca gelecek başlık"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none" />
          </div>

          <div>
            <div className="hud-text text-sertex-textMuted mb-1">AÇIKLAMA</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="template-description"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none resize-none" />
          </div>

          {categories.length > 0 && (
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">🏷️ İŞ KOLU</div>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} data-testid="template-category"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none">
                <option value="">— İş kolu yok —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{getCategoryPathLabel(c.id, categories)}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="hud-text text-sertex-textMuted mb-1">⏱ YAKLAŞAN UYARISI</div>
            <select value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} data-testid="template-reminder-days"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none">
              <option value="">Varsayılan (hiyerarşi)</option>
              {REMINDER_DAY_CHOICES.map((d) => (<option key={d} value={d}>{d} gün önce</option>))}
              <option value="__off__">🚫 Kapalı</option>
            </select>
          </div>

          {/* Alt görevler */}
          <div>
            <div className="hud-text text-sertex-textMuted mb-1">ALT GÖREVLER</div>
            <div className="space-y-1">
              {subtasks.map((s, i) => (
                <div key={s.id || i} data-testid={`template-subtask-${i}`} className="flex items-center gap-2 px-2 py-1 rounded border border-sertex-cyan/15 bg-sertex-surface/40">
                  <span className="flex-1 text-[12px] font-mono text-sertex-text truncate">{s.text}</span>
                  <button onClick={() => setSubtasks((prev) => prev.filter((_, idx) => idx !== i))} data-testid={`template-subtask-remove-${i}`} className="p-1 text-sertex-textMuted hover:text-rose-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-1">
              <input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSub())}
                data-testid="template-subtask-input" placeholder="Alt görev ekle…"
                className="flex-1 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none" />
              <button onClick={addSub} data-testid="template-subtask-add" className="px-2 rounded-md border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/10">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Dosya ekleri — yalnızca şablon kaydedildikten sonra */}
          {tplId ? (
            <div className="border-t border-sertex-cyan/15 pt-1">
              <TaskAttachments taskId={tplId} currentUserId={currentUser?.id} canManage attachmentApi={templateAttachmentsApi} />
            </div>
          ) : (
            <div className="hud-text text-sertex-textMuted/70 border-t border-sertex-cyan/15 pt-2">
              📎 Dosya eklemek için önce şablonu kaydedin.
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-sertex-cyan/15">
            <button onClick={onClose} className="flex-1 py-2 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50 rounded-md hud-text transition-colors">
              {tplId ? "KAPAT" : "İPTAL"}
            </button>
            <button onClick={handleSave} disabled={saving} data-testid="template-save"
              className="flex-1 py-2 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text transition-colors disabled:opacity-40">
              {tplId ? "GÜNCELLE" : "KAYDET"}
            </button>
          </div>
        </motion.div>
      </div>
    </>,
    document.body,
  );
};

export default TemplateFormModal;
