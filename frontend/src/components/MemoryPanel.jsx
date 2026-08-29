import { confirmDialog } from "@/lib/confirm";
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Filter,
  Sparkles,
  User,
  Heart,
  Briefcase,
  Users,
  Activity,
  FolderKanban,
  MoreHorizontal,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { memoryApi } from "../lib/api";

const CATEGORIES = [
  { key: "personal", label: "Kişisel", icon: User, color: "text-cyan-300" },
  { key: "preference", label: "Tercih", icon: Heart, color: "text-pink-300" },
  { key: "work", label: "İş", icon: Briefcase, color: "text-amber-300" },
  { key: "family", label: "Aile", icon: Users, color: "text-emerald-300" },
  { key: "health", label: "Sağlık", icon: Activity, color: "text-rose-300" },
  { key: "project", label: "Proje", icon: FolderKanban, color: "text-violet-300" },
  { key: "other", label: "Diğer", icon: MoreHorizontal, color: "text-slate-300" },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

const SOURCE_LABELS = {
  auto: { label: "Otomatik", color: "text-sertex-cyan/70" },
  manual: { label: "Manuel", color: "text-amber-300/80" },
};

const ImportanceStars = ({ value = 3, editable = false, onChange }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <Star
        key={n}
        onClick={editable ? () => onChange?.(n) : undefined}
        className={`h-3 w-3 ${editable ? "cursor-pointer" : ""} ${
          n <= value
            ? "text-sertex-cyan fill-sertex-cyan"
            : "text-sertex-textMuted"
        }`}
        data-testid={editable ? `mem-star-${n}` : undefined}
      />
    ))}
  </div>
);

const MemoryPanel = ({ refreshSignal, onDataChanged }) => {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("other");
  const [newImportance, setNewImportance] = useState(3);
  const [filter, setFilter] = useState("all");
  const [editId, setEditId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("other");
  const [editImportance, setEditImportance] = useState(3);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await memoryApi.list();
      setMemories(data);
    } catch (e) {
      toast.error("Hafızalar yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [refreshSignal]);

  const filtered = useMemo(() => {
    if (filter === "all") return memories;
    return memories.filter((m) => m.category === filter);
  }, [memories, filter]);

  const stats = useMemo(() => {
    const byCat = {};
    for (const m of memories) {
      byCat[m.category] = (byCat[m.category] || 0) + 1;
    }
    return byCat;
  }, [memories]);

  const addMemory = async () => {
    const content = newContent.trim();
    if (content.length < 3) {
      toast.error("En az 3 karakter yazın");
      return;
    }
    try {
      await memoryApi.create(content, newCategory, newImportance);
      setNewContent("");
      setNewCategory("other");
      setNewImportance(3);
      setShowForm(false);
      toast.success("Hafızaya eklendi");
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Ekleme başarısız");
    }
  };

  const startEdit = (m) => {
    setEditId(m.id);
    setEditContent(m.content);
    setEditCategory(m.category);
    setEditImportance(m.importance);
  };

  const saveEdit = async () => {
    if (!editId) return;
    try {
      await memoryApi.update(editId, {
        content: editContent.trim(),
        category: editCategory,
        importance: editImportance,
      });
      setEditId(null);
      toast.success("Güncellendi");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Güncelleme başarısız");
    }
  };

  const removeMemory = async (id) => {
    try {
      await memoryApi.delete(id);
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error("Silme başarısız");
    }
  };

  const clearAll = async () => {
    if (!(await confirmDialog({ message: "TÜM hafıza kayıtlarını silmek istediğinize emin misiniz?", danger: true }))) return;
    try {
      const r = await memoryApi.deleteAll();
      toast.success(`${r.deleted} hafıza silindi`);
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error("Toplu silme başarısız");
    }
  };

  return (
    <div className="space-y-2" data-testid="memory-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-sertex-cyan" />
          <span className="hud-text text-sertex-cyan">
            {memories.length} HAFIZA
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text flex items-center gap-1 transition-colors"
            data-testid="memory-add-toggle"
            title="Yeni hafıza ekle"
          >
            <Plus className="h-3 w-3" /> Ekle
          </button>
          {memories.length > 0 && (
            <button
              onClick={clearAll}
              className="p-1 border border-sertex-danger/30 text-sertex-danger/80 hover:bg-sertex-danger/10 rounded-md transition-colors"
              data-testid="memory-clear-all"
              title="Tüm hafızayı sil"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border border-sertex-cyan/30 rounded-md bg-sertex-cyan/5"
          >
            <div className="p-2 space-y-2">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Örn: Serkan CAD-CAM operatörü ve İstanbul'da yaşıyor"
                rows={2}
                maxLength={300}
                data-testid="memory-new-content"
                className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none resize-none"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  data-testid="memory-new-category"
                  className="bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <span className="hud-text text-sertex-textMuted">Önem:</span>
                  <ImportanceStars
                    value={newImportance}
                    editable
                    onChange={setNewImportance}
                  />
                </div>
                <div className="flex gap-1 ml-auto">
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setNewContent("");
                    }}
                    className="px-2 py-1 border border-sertex-textMuted/40 text-sertex-textMuted hover:text-sertex-text rounded-md hud-text"
                    data-testid="memory-cancel"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <button
                    onClick={addMemory}
                    className="px-3 py-1 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/20 rounded-md hud-text flex items-center gap-1"
                    data-testid="memory-save"
                  >
                    <Save className="h-3 w-3" /> Kaydet
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-sertex-textMuted">
                {newContent.length}/300
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter chips */}
      <div className="flex items-center gap-1 flex-wrap px-1">
        <button
          onClick={() => setFilter("all")}
          className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
            filter === "all"
              ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
              : "border-sertex-cyan/20 text-sertex-textMuted hover:border-sertex-cyan/50"
          }`}
          data-testid="memory-filter-all"
        >
          Tümü ({memories.length})
        </button>
        {CATEGORIES.map((c) => {
          const count = stats[c.key] || 0;
          if (count === 0 && filter !== c.key) return null;
          return (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors flex items-center gap-1 ${
                filter === c.key
                  ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                  : "border-sertex-cyan/20 text-sertex-textMuted hover:border-sertex-cyan/50"
              }`}
              data-testid={`memory-filter-${c.key}`}
            >
              <c.icon className="h-2.5 w-2.5" /> {c.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Info banner */}
      {memories.length === 0 && !loading && (
        <div className="border border-sertex-cyan/20 rounded-md p-3 text-center bg-sertex-cyan/5">
          <Sparkles className="h-5 w-5 mx-auto text-sertex-cyan mb-1" />
          <div className="hud-text text-sertex-cyan mb-1">HAFIZA BOŞ</div>
          <div className="text-xs text-sertex-textMuted font-mono">
            Sohbet ederken Sertex önemli bilgileri otomatik hatırlar.
            <br />
            Ya da <span className="text-sertex-cyan">"bunu hatırla: ..."</span> diye söyle.
          </div>
        </div>
      )}

      {/* Memory list */}
      <div className="space-y-1.5" data-testid="memory-list">
        {filtered.map((m) => {
          const cat = CATEGORY_MAP[m.category] || CATEGORY_MAP.other;
          const src = SOURCE_LABELS[m.source] || SOURCE_LABELS.manual;
          const isEditing = editId === m.id;

          return (
            <div
              key={m.id}
              data-testid={`memory-item-${m.id}`}
              className="p-2 border border-sertex-cyan/15 hover:border-sertex-cyan/40 rounded-md transition-colors group bg-black/20"
            >
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={2}
                    maxLength={300}
                    data-testid={`memory-edit-content-${m.id}`}
                    className="w-full bg-sertex-surface border border-sertex-cyan/40 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none resize-none"
                  />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      data-testid={`memory-edit-category-${m.id}`}
                      className="bg-sertex-surface border border-sertex-cyan/25 rounded px-1.5 py-0.5 text-[10px] font-mono text-sertex-text"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <ImportanceStars value={editImportance} editable onChange={setEditImportance} />
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditId(null)}
                        className="px-1.5 py-0.5 border border-sertex-textMuted/40 text-sertex-textMuted hover:text-sertex-text rounded text-[10px]"
                        data-testid={`memory-edit-cancel-${m.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <button
                        onClick={saveEdit}
                        className="px-2 py-0.5 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/20 rounded text-[10px] flex items-center gap-0.5"
                        data-testid={`memory-edit-save-${m.id}`}
                      >
                        <Save className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <cat.icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cat.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-sertex-text font-mono leading-relaxed">
                        {m.content}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-[9px] font-mono ${cat.color} uppercase tracking-wide`}>
                          {cat.label}
                        </span>
                        <ImportanceStars value={m.importance} />
                        <span className={`text-[9px] font-mono ${src.color}`}>
                          {src.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(m)}
                        className="text-sertex-textMuted hover:text-sertex-cyan"
                        data-testid={`memory-edit-${m.id}`}
                        title="Düzenle"
                      >
                        <Edit3 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeMemory(m.id)}
                        className="text-sertex-textMuted hover:text-sertex-danger"
                        data-testid={`memory-delete-${m.id}`}
                        title="Sil"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer tip */}
      {memories.length > 0 && (
        <div className="text-[10px] font-mono text-sertex-textMuted text-center pt-1 border-t border-sertex-cyan/10">
          İpucu: "bunu hatırla: X" veya "X'i unut" komutlarını kullanabilirsiniz.
        </div>
      )}
    </div>
  );
};

export default MemoryPanel;
