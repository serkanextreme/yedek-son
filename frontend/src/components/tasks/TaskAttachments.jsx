import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Download, Trash2, Loader2, Plus, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { taskAttachmentsApi } from "../../lib/api";

const fmtSize = (b) => {
  if (b == null) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

// Görev kartına / Düzenle penceresine gömülen "📎 Dosyalar" bölümü.
// Yükle (parçalı) + listele + tıkla-indir + sil. Kendi verisini yükler.
export const TaskAttachments = ({ taskId, currentUserId, canManage = false, compact = false }) => {
  const [items, setItems] = useState(null); // null=loading
  const [uploading, setUploading] = useState(null); // {name, pct}
  const [downloadingId, setDownloadingId] = useState(null);
  const [preview, setPreview] = useState(null); // {att, url, kind: "image"|"pdf"}
  const inputRef = useRef(null);

  const load = useCallback(() => {
    taskAttachmentsApi.list(taskId)
      .then((r) => setItems(r || []))
      .catch(() => setItems([]));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const f of files) {
      if (f.size > 100 * 1024 * 1024) {
        toast.error(`${f.name}: dosya çok büyük (maks 100 MB)`);
        continue;
      }
      setUploading({ name: f.name, pct: 0 });
      try {
        await taskAttachmentsApi.upload(taskId, f, (pct) =>
          setUploading({ name: f.name, pct }),
        );
        toast.success(`Dosya eklendi: ${f.name}`);
      } catch (e) {
        toast.error(e?.response?.data?.detail || `Yüklenemedi: ${f.name}`);
      }
    }
    setUploading(null);
    if (inputRef.current) inputRef.current.value = "";
    load();
  };

  const handleDownload = async (att) => {
    setDownloadingId(att.id);
    try {
      const res = await taskAttachmentsApi.download(taskId, att.id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.original_filename || "dosya";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("İndirilemedi");
    } finally {
      setDownloadingId(null);
    }
  };

  const previewKind = (att) => {
    const ct = (att.content_type || "").toLowerCase();
    const name = (att.original_filename || "").toLowerCase();
    if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return "image";
    if (ct.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    return null;
  };

  const openPreview = async (att) => {
    const kind = previewKind(att);
    if (!kind) return handleDownload(att); // önizlenemeyen tür → indir
    setDownloadingId(att.id);
    try {
      const res = await taskAttachmentsApi.download(taskId, att.id);
      const url = URL.createObjectURL(res.data);
      setPreview({ att, url, kind });
    } catch (e) {
      toast.error("Önizleme açılamadı");
    } finally {
      setDownloadingId(null);
    }
  };

  const closePreview = () => {
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  };

  const handleDelete = async (att) => {
    try {
      await taskAttachmentsApi.remove(taskId, att.id);
      setItems((prev) => (prev || []).filter((x) => x.id !== att.id));
      toast.success("Dosya silindi");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const count = items ? items.length : 0;

  return (
    <div
      className="mt-2 border-t border-sertex-cyan/15 pt-1.5"
      data-testid={`task-attachments-${taskId}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="hud-text text-sertex-textMuted flex items-center gap-1">
          <Paperclip className="h-3 w-3" /> DOSYALAR{count > 0 ? ` (${count})` : ""}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
          disabled={!!uploading}
          data-testid={`attach-upload-btn-${taskId}`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> DOSYA EKLE
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          data-testid={`attach-upload-input-${taskId}`}
          className="hidden"
        />
      </div>

      {uploading && (
        <div
          className="flex items-center gap-2 px-2 py-1 rounded bg-sertex-cyan/5 border border-sertex-cyan/20 mb-1"
          data-testid={`attach-uploading-${taskId}`}
        >
          <Loader2 className="h-3 w-3 text-sertex-cyan animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-mono text-sertex-text truncate">{uploading.name}</div>
            <div className="h-1 bg-sertex-surface rounded overflow-hidden mt-0.5">
              <div
                className="h-full bg-sertex-cyan transition-all"
                style={{ width: `${uploading.pct}%` }}
              />
            </div>
          </div>
          <span className="hud-text text-sertex-cyan">%{uploading.pct}</span>
        </div>
      )}

      {items === null ? (
        <div className="hud-text text-sertex-textMuted py-1">Yükleniyor…</div>
      ) : items.length === 0 ? (
        !uploading && (
          <div
            className="hud-text text-sertex-textMuted/70 py-1"
            data-testid={`attach-empty-${taskId}`}
          >
            Henüz dosya yok — inceleme için dosya ekleyin.
          </div>
        )
      ) : (
        <div className="space-y-1">
          {items.map((att) => {
            const canDelete = canManage || att.uploaded_by === currentUserId;
            return (
              <div
                key={att.id}
                data-testid={`attach-item-${att.id}`}
                className="flex items-center gap-2 px-2 py-1 rounded border border-sertex-cyan/15 hover:border-sertex-cyan/40 bg-sertex-surface/40 transition-colors group"
              >
                <FileText className="h-3.5 w-3.5 text-sertex-cyan/80 shrink-0" />
                <button
                  onClick={() => openPreview(att)}
                  data-testid={`attach-open-${att.id}`}
                  title="Önizle"
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="text-[12px] font-mono text-sertex-text truncate group-hover:text-sertex-cyan transition-colors">
                    {att.original_filename}
                  </div>
                  {!compact && (
                    <div className="hud-text text-sertex-textMuted/60 truncate">
                      {fmtSize(att.size)}
                      {att.uploaded_by_name ? ` · ${att.uploaded_by_name}` : ""}
                    </div>
                  )}
                </button>
                {downloadingId === att.id ? (
                  <Loader2 className="h-3.5 w-3.5 text-sertex-cyan animate-spin shrink-0" />
                ) : (
                  <button
                    onClick={() => handleDownload(att)}
                    data-testid={`attach-download-icon-${att.id}`}
                    title="İndir"
                    className="p-1 text-sertex-textMuted hover:text-sertex-cyan transition-colors shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => handleDelete(att)}
                    data-testid={`attach-delete-${att.id}`}
                    title="Sil"
                    className="p-1 text-sertex-textMuted hover:text-rose-400 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {preview &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] bg-black/90 flex flex-col"
            data-testid="attach-preview-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
              <span className="flex-1 min-w-0 truncate text-sm font-mono text-white">
                {preview.att.original_filename}
              </span>
              <button
                onClick={() => handleDownload(preview.att)}
                title="İndir"
                data-testid="attach-preview-download"
                className="p-2 text-white/80 hover:text-sertex-cyan transition-colors"
              >
                <Download className="h-5 w-5" />
              </button>
              <button
                onClick={closePreview}
                title="Kapat"
                data-testid="attach-preview-close"
                className="p-2 text-white/80 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center p-2">
              {preview.kind === "image" ? (
                <img
                  src={preview.url}
                  alt={preview.att.original_filename}
                  data-testid="attach-preview-image"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <iframe
                  src={preview.url}
                  title={preview.att.original_filename}
                  data-testid="attach-preview-frame"
                  className="w-full h-full bg-white rounded"
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default TaskAttachments;
