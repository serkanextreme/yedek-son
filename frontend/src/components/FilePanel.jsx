import { confirmDialog } from "@/lib/confirm";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileAudio,
  Presentation,
  File as FileIcon,
  Upload,
  Trash2,
  Sparkles,
  MessageSquareText,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  Download,
  CheckCircle2,
  AlertTriangle,
  Database,
  RefreshCw,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import { filesApi } from "../lib/api";
import { getToken } from "../lib/auth";
import ExcelModal from "./ExcelModal";

const CATEGORY_ICON = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  image: FileImage,
  audio: FileAudio,
  other: FileIcon,
};

const CATEGORY_COLOR = {
  document: "text-cyan-300",
  spreadsheet: "text-emerald-300",
  presentation: "text-amber-300",
  image: "text-pink-300",
  audio: "text-violet-300",
  other: "text-slate-300",
};

const CATEGORY_LABEL = {
  document: "Belge",
  spreadsheet: "Tablo",
  presentation: "Sunum",
  image: "Görsel",
  audio: "Ses",
  other: "Diğer",
};

const STATUS_META = {
  ok: { label: "Hazır", color: "text-emerald-300" },
  partial: { label: "Kısmi", color: "text-amber-300" },
  failed: { label: "Hata", color: "text-rose-300" },
  unsupported: { label: "Desteksiz", color: "text-slate-400" },
  pending: { label: "İşleniyor", color: "text-sertex-cyan" },
};

const RAG_META = {
  ok: { label: "İndeksli", color: "text-sertex-cyan", icon: "database" },
  indexing: { label: "İndeksleniyor…", color: "text-amber-300", icon: "spinner" },
  pending: { label: "Bekliyor", color: "text-slate-400", icon: "database" },
  empty: { label: "Boş", color: "text-slate-500", icon: "database" },
  failed: { label: "İndeks Hatası", color: "text-rose-300", icon: "alert" },
};

const ACCEPT =
  ".pdf,.docx,.xlsx,.xls,.csv,.pptx,.txt,.md,.rtf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.mp3,.wav,.m4a,.webm,.ogg,.mp4";

const MAX_SIZE = 50 * 1024 * 1024;

const humanSize = (b) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const FileCard = ({ f, onDelete, onSummarize, onAsk, onDownload, onReindex, onExcel, expanded, setExpanded }) => {
  const Icon = CATEGORY_ICON[f.category] || FileIcon;
  const status = STATUS_META[f.extraction_status] || STATUS_META.pending;
  const isOpen = expanded === f.id;
  return (
    <div
      data-testid={`file-item-${f.id}`}
      className="border border-sertex-cyan/15 hover:border-sertex-cyan/40 rounded-md bg-black/20 group transition-colors"
    >
      <div className="p-2">
        <div className="flex items-start gap-2">
          <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${CATEGORY_COLOR[f.category] || ""}`} />
          <div className="flex-1 min-w-0">
            <div
              className="text-xs text-sertex-text font-mono truncate cursor-pointer"
              title={f.original_filename}
              onClick={() => setExpanded(isOpen ? null : f.id)}
              data-testid={`file-toggle-${f.id}`}
            >
              {f.original_filename}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-[9px] font-mono uppercase tracking-wide ${CATEGORY_COLOR[f.category]}`}>
                {CATEGORY_LABEL[f.category] || "Diğer"}
              </span>
              <span className="text-[9px] font-mono text-sertex-textMuted">
                {humanSize(f.size)}
              </span>
              <span className={`text-[9px] font-mono ${status.color} flex items-center gap-0.5`}>
                {f.extraction_status === "ok" ? (
                  <CheckCircle2 className="h-2.5 w-2.5" />
                ) : f.extraction_status === "failed" ? (
                  <AlertTriangle className="h-2.5 w-2.5" />
                ) : null}
                {status.label}
              </span>
              {f.extracted_chars > 0 && (
                <span className="text-[9px] font-mono text-sertex-textMuted">
                  {f.extracted_chars.toLocaleString("tr-TR")} kar.
                </span>
              )}
              {f.rag_status && (RAG_META[f.rag_status] || null) && (
                <span
                  className={`text-[9px] font-mono ${RAG_META[f.rag_status].color} flex items-center gap-0.5`}
                  title={
                    f.rag_status === "ok"
                      ? `Bilgi bankasında ${f.rag_chunks || 0} parça`
                      : f.rag_error || RAG_META[f.rag_status].label
                  }
                  data-testid={`file-rag-status-${f.id}`}
                >
                  {f.rag_status === "indexing" ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : f.rag_status === "failed" ? (
                    <AlertTriangle className="h-2.5 w-2.5" />
                  ) : (
                    <Database className="h-2.5 w-2.5" />
                  )}
                  {RAG_META[f.rag_status].label}
                  {f.rag_status === "ok" && f.rag_chunks
                    ? ` · ${f.rag_chunks}`
                    : ""}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setExpanded(isOpen ? null : f.id)}
              className="text-sertex-textMuted hover:text-sertex-cyan"
              data-testid={`file-expand-${f.id}`}
              title={isOpen ? "Kapat" : "Aç"}
            >
              {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            <button
              onClick={() => onDownload(f)}
              className="text-sertex-textMuted hover:text-sertex-cyan"
              data-testid={`file-download-${f.id}`}
              title="İndir"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              onClick={() => onDelete(f)}
              className="text-sertex-textMuted hover:text-sertex-danger"
              data-testid={`file-delete-${f.id}`}
              title="Sil"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-sertex-cyan/15"
          >
            <div className="p-2 space-y-2">
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => onSummarize(f)}
                  disabled={f.extraction_status !== "ok" && f.extraction_status !== "partial"}
                  className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-[10px] font-mono flex items-center gap-1 transition-colors"
                  data-testid={`file-summarize-${f.id}`}
                >
                  <Sparkles className="h-3 w-3" /> Özetle
                </button>
                <button
                  onClick={() => onAsk(f)}
                  disabled={f.extraction_status !== "ok" && f.extraction_status !== "partial"}
                  className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-[10px] font-mono flex items-center gap-1 transition-colors"
                  data-testid={`file-ask-${f.id}`}
                >
                  <MessageSquareText className="h-3 w-3" /> Sor
                </button>
                <button
                  onClick={() => onReindex(f)}
                  disabled={
                    f.rag_status === "indexing" ||
                    (f.extraction_status !== "ok" && f.extraction_status !== "partial")
                  }
                  className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-[10px] font-mono flex items-center gap-1 transition-colors"
                  data-testid={`file-reindex-${f.id}`}
                  title="Bilgi bankasına yeniden ekle (chat için indeksle)"
                >
                  {f.rag_status === "indexing" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  İndeksle
                </button>
                {f.category === "spreadsheet" && (
                  <button
                    onClick={() => onExcel(f)}
                    className="px-2 py-1 border border-emerald-300/40 text-emerald-300 hover:bg-emerald-300/10 rounded-md text-[10px] font-mono flex items-center gap-1 transition-colors"
                    data-testid={`file-excel-${f.id}`}
                    title="Excel otomasyonu: analiz, formül, pivot, grafik"
                  >
                    <Table2 className="h-3 w-3" /> Excel
                  </button>
                )}
              </div>

              {f.extraction_error && (
                <div className="text-[10px] font-mono text-rose-300 border border-rose-300/30 rounded p-1.5 bg-rose-300/5">
                  {f.extraction_error}
                </div>
              )}

              {f.summary && (
                <div className="border border-sertex-cyan/20 rounded p-2 bg-sertex-cyan/5">
                  <div className="text-[9px] font-mono text-sertex-cyan uppercase tracking-wider mb-1">
                    Özet
                  </div>
                  <div className="text-xs text-sertex-text font-mono whitespace-pre-wrap leading-relaxed">
                    {f.summary}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AskModal = ({ file, onClose, onAnswer }) => {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");

  const ask = async () => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      toast.error("Sorunuzu yazın");
      return;
    }
    setBusy(true);
    setAnswer("");
    try {
      const r = await filesApi.ask(file.id, trimmed);
      setAnswer(r.answer);
      onAnswer?.(trimmed, r.answer);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Yanıt alınamadı");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="file-ask-modal"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg glass-panel border border-sertex-cyan/40 rounded-lg p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="hud-text text-sertex-cyan neon-glow">
            DOSYAYA SOR — {file.original_filename}
          </div>
          <button
            onClick={onClose}
            className="text-sertex-textMuted hover:text-sertex-text"
            data-testid="file-ask-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) ask();
          }}
          placeholder="Örn: bu belgenin ana noktası nedir? veya toplam tutarı hesapla"
          rows={3}
          data-testid="file-ask-input"
          className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded-md px-3 py-2 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none resize-none"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-sertex-textMuted/40 text-sertex-textMuted hover:text-sertex-text rounded-md hud-text"
          >
            Kapat
          </button>
          <button
            onClick={ask}
            disabled={busy}
            className="px-4 py-1.5 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/20 disabled:opacity-50 rounded-md hud-text flex items-center gap-2"
            data-testid="file-ask-submit"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquareText className="h-3 w-3" />}
            Sor
          </button>
        </div>
        {answer && (
          <div className="border border-sertex-cyan/25 rounded-md p-3 bg-sertex-cyan/5 max-h-64 overflow-y-auto scrollbar-sertex">
            <div className="text-[9px] font-mono text-sertex-cyan uppercase tracking-wider mb-1">
              Yanıt
            </div>
            <div
              className="text-sm text-sertex-text font-mono whitespace-pre-wrap leading-relaxed"
              data-testid="file-ask-answer"
            >
              {answer}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

const FilePanel = ({ refreshSignal, onDataChanged }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [askFile, setAskFile] = useState(null);
  const [excelFile, setExcelFile] = useState(null);
  const [ragBusy, setRagBusy] = useState(false);
  const [ragStats, setRagStats] = useState({ total_chunks: 0, buckets: {} });
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, stats] = await Promise.all([
        filesApi.list(),
        filesApi.ragStatus().catch(() => ({ total_chunks: 0, buckets: {} })),
      ]);
      setFiles(data);
      setRagStats(stats);
    } catch (e) {
      toast.error("Dosyalar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const doUpload = async (fileList) => {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;
    setUploading(true);
    setProgress(0);
    let ok = 0;
    let failed = 0;
    for (const file of arr) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name}: 50 MB sınırını aşıyor`);
        failed++;
        continue;
      }
      try {
        await filesApi.upload(file, setProgress);
        ok++;
      } catch (e) {
        failed++;
        toast.error(
          `${file.name}: ${e.response?.data?.detail || "yükleme hatası"}`
        );
      }
    }
    setUploading(false);
    setProgress(0);
    if (ok > 0) toast.success(`${ok} dosya yüklendi`);
    load();
    if (ok > 0) onDataChanged?.();
  };

  const onSelect = (e) => {
    doUpload(e.target.files);
    e.target.value = "";
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    doUpload(e.dataTransfer.files);
  };

  const onDelete = async (f) => {
    if (!(await confirmDialog({ message: `"${f.original_filename}" dosyasını silmek istiyor musunuz?`, danger: true }))) return;
    try {
      await filesApi.delete(f.id);
      toast.success("Silindi");
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error("Silinemedi");
    }
  };

  const onSummarize = async (f) => {
    const toastId = toast.loading("Özetleniyor...");
    try {
      const r = await filesApi.summarize(f.id);
      toast.success(r.cached ? "Önceki özet" : "Özet hazır", { id: toastId });
      setFiles((prev) =>
        prev.map((x) => (x.id === f.id ? { ...x, summary: r.summary } : x))
      );
      setExpanded(f.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Özetleme başarısız", { id: toastId });
    }
  };

  const onReindex = async (f) => {
    try {
      await filesApi.reindex(f.id);
      toast.success("Bilgi bankasına ekleniyor…");
      setFiles((prev) =>
        prev.map((x) => (x.id === f.id ? { ...x, rag_status: "indexing" } : x))
      );
      setTimeout(load, 3000);
      setTimeout(load, 8000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "İndeksleme başlatılamadı");
    }
  };

  const onDownload = async (f) => {
    try {
      const token = getToken();
      const res = await fetch(filesApi.downloadUrl(f.id), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("İndirilemedi");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.original_filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("İndirme başarısız");
    }
  };

  const onReindexAll = async () => {
    setRagBusy(true);
    try {
      const r = await filesApi.reindexAll();
      if (r.scheduled === 0) {
        toast.info("İndekslenecek yeni dosya yok");
      } else {
        toast.success(`${r.scheduled} dosya için indeksleme başladı`);
      }
      setTimeout(load, 4000);
      setTimeout(load, 12000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Toplu indeksleme başarısız");
    } finally {
      setRagBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="file-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 flex-wrap">
          <FileText className="h-4 w-4 text-sertex-cyan" />
          <span className="hud-text text-sertex-cyan">
            {files.length} DOSYA
          </span>
          <span
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sertex-cyan/10 border border-sertex-cyan/30 text-sertex-cyan flex items-center gap-1"
            title={`Bilgi bankasında ${ragStats.total_chunks} parça — chat sorgularında otomatik kullanılır`}
            data-testid="rag-stats-chip"
          >
            <Database className="h-2.5 w-2.5" />
            RAG · {ragStats.total_chunks || 0}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onReindexAll}
            disabled={ragBusy}
            className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-50 rounded-md hud-text flex items-center gap-1 transition-colors"
            data-testid="reindex-all-btn"
            title="Henüz indekslenmemiş tüm dosyaları bilgi bankasına ekle"
          >
            {ragBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Database className="h-3 w-3" />
            )}
            Tümünü İndeksle
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-50 rounded-md hud-text flex items-center gap-1 transition-colors"
            data-testid="file-upload-btn"
          >
            <Upload className="h-3 w-3" /> Yükle
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={onSelect}
          className="hidden"
          data-testid="file-upload-input"
        />
      </div>

      {/* Drag & drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        data-testid="file-drop-zone"
        className={`border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-sertex-cyan bg-sertex-cyan/10"
            : "border-sertex-cyan/25 hover:border-sertex-cyan/50 bg-sertex-cyan/5"
        }`}
      >
        {uploading ? (
          <div className="space-y-1">
            <Loader2 className="h-5 w-5 mx-auto text-sertex-cyan animate-spin" />
            <div className="hud-text text-sertex-cyan">YÜKLENİYOR %{progress}</div>
            <div className="h-1 bg-sertex-cyan/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-sertex-cyan transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <Upload className="h-5 w-5 mx-auto text-sertex-cyan mb-1" />
            <div className="hud-text text-sertex-cyan mb-0.5">
              DOSYA SÜRÜKLE VEYA TIKLA
            </div>
            <div className="text-[10px] text-sertex-textMuted font-mono">
              PDF · Word · Excel · PPT · Görsel · Ses (maks 50 MB)
            </div>
          </>
        )}
      </div>

      {/* Empty state */}
      {files.length === 0 && !loading && !uploading && (
        <div className="text-[10px] font-mono text-sertex-textMuted text-center py-2">
          Henüz dosya yok. Bir dosya yükleyin — Sertex içeriği okur, özetler ve sorularınızı yanıtlar.
        </div>
      )}

      {/* File list */}
      <div className="space-y-1.5" data-testid="file-list">
        {files.map((f) => (
          <FileCard
            key={f.id}
            f={f}
            onDelete={onDelete}
            onSummarize={onSummarize}
            onAsk={setAskFile}
            onDownload={onDownload}
            onReindex={onReindex}
            onExcel={setExcelFile}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        ))}
      </div>

      {askFile && <AskModal file={askFile} onClose={() => setAskFile(null)} />}
      {excelFile && (
        <ExcelModal file={excelFile} onClose={() => setExcelFile(null)} />
      )}
    </div>
  );
};

export default FilePanel;
