import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { LayoutTemplate, X, Plus, Edit3, Trash2, Play, User, Users, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { templatesApi } from "../../lib/api";
import { TemplateFormModal } from "./TemplateFormModal";

// Şablon Kütüphanesi — listele + oluştur/düzenle/sil + "Kullan" (şablondan görev).
export const TemplatesModal = ({ categories = [], currentUser = null, onClose, onUse }) => {
  const [items, setItems] = useState(null); // null=loading
  const [form, setForm] = useState(null); // {template} | {} (new)
  const [usingId, setUsingId] = useState(null);

  const load = () => {
    templatesApi.list().then((r) => setItems(r || [])).catch(() => setItems([]));
  };
  useEffect(() => { load(); }, []);

  const handleDelete = async (t) => {
    try {
      await templatesApi.remove(t.id);
      setItems((prev) => (prev || []).filter((x) => x.id !== t.id));
      toast.success("Şablon silindi");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const handleUse = async (t) => {
    setUsingId(t.id);
    try {
      const task = await templatesApi.instantiate(t.id);
      toast.success(`"${t.name}" şablonundan görev oluşturuldu — düzenleyin`);
      onUse?.(task);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Oluşturulamadı");
    } finally {
      setUsingId(null);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[120] bg-sertex-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[125] flex items-center justify-center pointer-events-none px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-auto w-full max-w-[520px] max-h-[86vh] overflow-y-auto glass-panel corner-bracket p-4 space-y-3"
          data-testid="templates-modal"
        >
          <div className="flex items-center justify-between border-b border-sertex-cyan/20 pb-2">
            <div className="display-text text-sertex-cyan neon-glow tracking-[0.2em] flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4" /> ŞABLON KÜTÜPHANESİ
            </div>
            <button onClick={onClose} data-testid="templates-close" className="p-1 hover:bg-sertex-cyan/10 rounded text-sertex-textMuted hover:text-sertex-cyan">
              <X className="h-4 w-4" />
            </button>
          </div>

          <button onClick={() => setForm({})} data-testid="template-new-btn"
            className="w-full flex items-center justify-center gap-2 py-2 rounded-md border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors">
            <Plus className="h-4 w-4" /> YENİ ŞABLON
          </button>

          {items === null ? (
            <div className="hud-text text-sertex-textMuted py-4 text-center">Yükleniyor…</div>
          ) : items.length === 0 ? (
            <div className="hud-text text-sertex-textMuted/70 py-6 text-center" data-testid="templates-empty">
              Henüz şablon yok. "Yeni Şablon" ile sık kullandığın görevleri kaydet.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((t) => (
                <div key={t.id} data-testid={`template-row-${t.id}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-sertex-cyan/15 hover:border-sertex-cyan/40 bg-sertex-surface/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-mono text-sertex-text truncate flex items-center gap-1.5">
                      {t.scope === "shared" ? <Users className="h-3 w-3 text-sertex-cyan/80 shrink-0" /> : <User className="h-3 w-3 text-sertex-textMuted shrink-0" />}
                      {t.name}
                    </div>
                    <div className="hud-text text-sertex-textMuted/70 truncate">
                      {t.title || "(başlık yok)"}
                      {(t.subtasks?.length || 0) > 0 ? ` · ${t.subtasks.length} alt görev` : ""}
                    </div>
                  </div>
                  <button onClick={() => handleUse(t)} disabled={usingId === t.id} data-testid={`template-use-${t.id}`} title="Bu şablondan görev oluştur"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/15 hud-text transition-colors disabled:opacity-40 shrink-0">
                    <Play className="h-3 w-3" /> Kullan
                  </button>
                  <button onClick={() => setForm({ template: t })} data-testid={`template-edit-${t.id}`} title="Düzenle"
                    className="p-1 text-sertex-textMuted hover:text-sertex-cyan transition-colors shrink-0">
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(t)} data-testid={`template-delete-${t.id}`} title="Sil"
                    className="p-1 text-sertex-textMuted hover:text-rose-400 transition-colors shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {form && (
        <TemplateFormModal
          template={form.template}
          categories={categories}
          currentUser={currentUser}
          onClose={() => setForm(null)}
          onSaved={load}
        />
      )}
    </>,
    document.body,
  );
};

export default TemplatesModal;
