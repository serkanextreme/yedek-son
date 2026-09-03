import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Copy, X, Check } from "lucide-react";
import { toast } from "sonner";
import { taskAttachmentsApi } from "../../lib/api";
import { setTaskClipboard } from "../../lib/taskClipboard";

// Görev Kopyalama penceresi — sağ tık → "Kopyala" ile açılır. Alt görev ve
// dosya eklerinin de kopyalanıp kopyalanmayacağı seçilir (görevde yoksa o
// seçenek gizli). Onayla → görev panoya alınır; kullanıcı bir iş koluna sağ
// tıklayıp "Yapıştır" der.
export const CopyTaskModal = ({ task, onClose }) => {
  const subtaskCount = (task?.subtasks || []).length;
  const [attCount, setAttCount] = useState(null); // null = yükleniyor
  const [includeSubtasks, setIncludeSubtasks] = useState(true);
  const [includeAttachments, setIncludeAttachments] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await taskAttachmentsApi.list(task.id);
        if (alive) setAttCount(Array.isArray(rows) ? rows.length : 0);
      } catch {
        if (alive) setAttCount(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [task?.id]);

  const confirm = () => {
    setTaskClipboard({
      sourceId: task.id,
      title: task.title,
      includeSubtasks: subtaskCount > 0 ? includeSubtasks : false,
      includeAttachments: attCount > 0 ? includeAttachments : false,
    });
    toast.success("Görev panoya kopyalandı — bir iş koluna sağ tıklayıp Yapıştır'ı seçin.");
    onClose();
  };

  const Row = ({ checked, onToggle, label, testid }) => (
    <button
      type="button"
      onClick={onToggle}
      data-testid={testid}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-sertex-cyan/25 hover:border-sertex-cyan/60 hover:bg-sertex-cyan/5 transition-colors text-left"
    >
      <span
        className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${
          checked ? "bg-sertex-cyan/20 border-sertex-cyan" : "border-sertex-textMuted/40"
        }`}
      >
        {checked && <Check className="h-3.5 w-3.5 text-sertex-cyan" />}
      </span>
      <span className="hud-text text-sertex-text">{label}</span>
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      data-testid="copy-task-modal"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel border border-sertex-cyan/40 rounded-lg w-full max-w-sm p-5 shadow-xl"
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 text-sertex-cyan">
            <Copy className="h-4 w-4" />
            <h3 className="hud-text text-sm font-semibold">GÖREVİ KOPYALA</h3>
          </div>
          <button onClick={onClose} data-testid="copy-task-close" className="text-sertex-textMuted hover:text-sertex-cyan">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="hud-text text-sertex-textMuted mb-4 truncate">"{task?.title}"</p>

        <div className="space-y-2">
          {subtaskCount > 0 && (
            <Row
              checked={includeSubtasks}
              onToggle={() => setIncludeSubtasks((v) => !v)}
              label={`Alt görevleri dahil et (${subtaskCount})`}
              testid="copy-include-subtasks"
            />
          )}
          {attCount > 0 && (
            <Row
              checked={includeAttachments}
              onToggle={() => setIncludeAttachments((v) => !v)}
              label={`Dosya eklerini dahil et (${attCount})`}
              testid="copy-include-attachments"
            />
          )}
          {subtaskCount === 0 && attCount === 0 && (
            <p className="hud-text text-sertex-textMuted/80 px-1 py-2">
              Görevin kendisi kopyalanacak (alt görev / dosya eki yok).
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            data-testid="copy-task-cancel"
            className="flex-1 py-2 rounded-md border border-sertex-textMuted/30 text-sertex-textMuted hover:text-sertex-text hover:border-sertex-textMuted/60 hud-text transition-colors"
          >
            VAZGEÇ
          </button>
          <button
            onClick={confirm}
            disabled={attCount === null}
            data-testid="copy-task-confirm"
            className="flex-1 py-2 rounded-md bg-sertex-cyan/15 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/25 hud-text transition-colors disabled:opacity-40"
          >
            KOPYALA
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
};
