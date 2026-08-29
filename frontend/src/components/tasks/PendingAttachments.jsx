import React, { useRef } from "react";
import { Paperclip, Plus, X, FileText } from "lucide-react";
import { toast } from "sonner";

const fmtSize = (b) => {
  if (b == null) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

// Yeni Görev formu için "bekleyen" dosyalar — henüz yüklenmez; görev
// oluşturulduğunda parent (addTask) bu dosyaları göreve yükler.
export const PendingAttachments = ({ files = [], onChange }) => {
  const inputRef = useRef(null);

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    const ok = [];
    for (const f of incoming) {
      if (f.size > 100 * 1024 * 1024) {
        toast.error(`${f.name}: dosya çok büyük (maks 100 MB)`);
        continue;
      }
      ok.push(f);
    }
    if (ok.length) onChange([...files, ...ok]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeAt = (idx) => onChange(files.filter((_, i) => i !== idx));

  return (
    <div className="border-t border-sertex-cyan/15 pt-1.5" data-testid="pending-attachments">
      <div className="flex items-center justify-between mb-1">
        <div className="hud-text text-sertex-textMuted flex items-center gap-1">
          <Paperclip className="h-3 w-3" /> DOSYALAR{files.length > 0 ? ` (${files.length})` : ""}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid="pending-attach-btn"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors"
        >
          <Plus className="h-3 w-3" /> DOSYA EKLE
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={(e) => addFiles(e.target.files)}
          data-testid="pending-attach-input"
          className="hidden"
        />
      </div>
      {files.length === 0 ? (
        <div className="hud-text text-sertex-textMuted/70 py-0.5">
          İsteğe bağlı — görev oluşturulunca yüklenir.
        </div>
      ) : (
        <div className="space-y-1">
          {files.map((f, idx) => (
            <div
              key={`${f.name}-${idx}`}
              data-testid={`pending-attach-item-${idx}`}
              className="flex items-center gap-2 px-2 py-1 rounded border border-sertex-cyan/15 bg-sertex-surface/40"
            >
              <FileText className="h-3.5 w-3.5 text-sertex-cyan/80 shrink-0" />
              <span className="flex-1 min-w-0 text-[12px] font-mono text-sertex-text truncate">
                {f.name}
              </span>
              <span className="hud-text text-sertex-textMuted/60 shrink-0">{fmtSize(f.size)}</span>
              <button
                type="button"
                onClick={() => removeAt(idx)}
                data-testid={`pending-attach-remove-${idx}`}
                title="Kaldır"
                className="p-1 text-sertex-textMuted hover:text-rose-400 transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PendingAttachments;
