import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Printer, FileSpreadsheet, FileText, CheckSquare, Square, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { printTasks, exportTasksExcel, exportTasksWord } from "../lib/taskExport";

// Görevleri tek tek seçip yalnızca seçilenleri yazdır / Excel / Word.
export const ExportSelectModal = ({ tasks = [], categories = [], onClose }) => {
  const catMap = useMemo(
    () => Object.fromEntries((categories || []).map((c) => [c.id, c.name])),
    [categories]
  );
  // Varsayılan: hepsi seçili (mevcut "tümünü aktar" davranışının üst kümesi).
  const [selected, setSelected] = useState(() => new Set(tasks.map((t) => t.id)));
  const [busy, setBusy] = useState(false);

  const allSelected = selected.size === tasks.length && tasks.length > 0;
  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(tasks.map((t) => t.id)));
  };

  const run = async (kind) => {
    const list = tasks.filter((t) => selected.has(t.id));
    if (!list.length) {
      toast.error("En az bir görev seçin");
      return;
    }
    const heading = `Görev Listesi (${list.length})`;
    setBusy(true);
    try {
      if (kind === "print") printTasks(list, catMap, { heading });
      else if (kind === "excel") exportTasksExcel(list, catMap);
      else if (kind === "word") await exportTasksWord(list, catMap, { heading });
      toast.success(`${list.length} görev dışa aktarıldı`);
      onClose?.();
    } catch (e) {
      console.error("[ExportSelectModal] hata:", e);
      toast.error(
        e?.message === "popup-blocked"
          ? "Yazdırma penceresi engellendi — açılır pencerelere izin verin"
          : "Dışa aktarılamadı"
      );
    } finally {
      setBusy(false);
    }
  };

  const fmtDue = (iso) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return null; }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      data-testid="export-select-modal"
    >
      <div
        className="glass-panel border border-sertex-cyan/40 rounded-lg w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-sertex-cyan/20">
          <div className="hud-text text-sertex-cyan flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> YAZDIR / DIŞA AKTAR — GÖREV SEÇ
          </div>
          <button
            onClick={onClose}
            data-testid="export-select-close"
            className="text-sertex-textMuted hover:text-sertex-cyan transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Select all */}
        <div className="px-4 py-2 border-b border-sertex-cyan/15 flex items-center justify-between">
          <button
            onClick={toggleAll}
            data-testid="export-select-all"
            className="hud-text text-sertex-text hover:text-sertex-cyan flex items-center gap-2 transition-colors"
          >
            {allSelected ? <CheckSquare className="h-4 w-4 text-sertex-cyan" /> : <Square className="h-4 w-4" />}
            {allSelected ? "Hiçbirini seçme" : "Tümünü seç"}
          </button>
          <span className="hud-text text-sertex-textMuted">{selected.size} / {tasks.length} seçili</span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {tasks.map((t, i) => {
            const on = selected.has(t.id);
            const cat = t.category_id ? catMap[t.category_id] : null;
            const due = fmtDue(t.due_date);
            return (
              <button
                key={t.id}
                onClick={() => toggle(t.id)}
                data-testid={`export-select-item-${t.id}`}
                className={`w-full text-left px-2 py-2 rounded-md flex items-start gap-2 transition-colors ${
                  on ? "bg-sertex-cyan/10 border border-sertex-cyan/30" : "border border-transparent hover:bg-sertex-cyan/5"
                }`}
              >
                {on ? <CheckSquare className="h-4 w-4 text-sertex-cyan shrink-0 mt-0.5" /> : <Square className="h-4 w-4 text-sertex-textMuted shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono text-sertex-text truncate">
                    {i + 1}. {t.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {cat && <span className="hud-text text-sertex-cyan/80">{cat}</span>}
                    {due && <span className="hud-text text-sertex-textMuted">{due}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="px-4 py-3 border-t border-sertex-cyan/20 flex items-center gap-2">
          <button
            onClick={() => run("print")}
            disabled={busy || selected.size === 0}
            data-testid="export-select-print"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer className="h-3.5 w-3.5" /> Yazdır / PDF
          </button>
          <button
            onClick={() => run("excel")}
            disabled={busy || selected.size === 0}
            data-testid="export-select-excel"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hud-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
          </button>
          <button
            onClick={() => run("word")}
            disabled={busy || selected.size === 0}
            data-testid="export-select-word"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border border-blue-500/40 text-blue-300 hover:bg-blue-500/10 hud-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileText className="h-3.5 w-3.5" /> Word
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ExportSelectModal;
