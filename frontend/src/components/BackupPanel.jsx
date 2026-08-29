import { confirmDialog } from "@/lib/confirm";
import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Database,
  Download,
  Trash2,
  Loader2,
  RefreshCw,
  Play,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Archive,
  HardDrive,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { backupApi } from "../lib/api";
import { getToken } from "../lib/auth";

const humanBytes = (n) => {
  if (!n && n !== 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

const formatDate = (iso) => {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const cardCls = "border border-sertex-cyan/20 rounded-md p-3 bg-sertex-cyan/5";

const BackupCard = ({ b, expanded, setExpanded, onDelete, onDownload }) => {
  const isOk = b.status === "ok" && b.exists;
  const isOpen = expanded === b.id;
  return (
    <div
      className={`${cardCls} ${!isOk ? "border-rose-400/30" : ""}`}
      data-testid={`backup-card-${b.id}`}
    >
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(isOpen ? null : b.id)}
      >
        <Archive
          className={`h-4 w-4 ${isOk ? "text-sertex-cyan" : "text-rose-300"}`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono text-sertex-text truncate">
            {b.filename}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[9px] font-mono text-sertex-textMuted">
              {formatDate(b.created_at)}
            </span>
            <span className="text-[9px] font-mono text-sertex-cyan">
              {b.size_human}
            </span>
            <span
              className={`text-[9px] font-mono uppercase ${
                b.trigger === "scheduled" ? "text-emerald-300" : "text-amber-300"
              }`}
            >
              {b.trigger === "scheduled" ? "OTOMATİK" : "MANUEL"}
            </span>
            {isOk ? (
              <span className="text-[9px] font-mono text-emerald-300 flex items-center gap-0.5">
                <CheckCircle2 className="h-2.5 w-2.5" /> Sağlam
              </span>
            ) : (
              <span className="text-[9px] font-mono text-rose-300 flex items-center gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" /> Diskte Yok
              </span>
            )}
          </div>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-sertex-textMuted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-sertex-textMuted" />
        )}
      </div>

      {isOpen && (
        <div className="mt-2 pt-2 border-t border-sertex-cyan/20 space-y-1">
          <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
            <div>
              <span className="text-sertex-textMuted">MongoDB: </span>
              <span className="text-sertex-cyan">
                {b.mongo_collections} koleksiyon
              </span>
              <span className="text-sertex-textMuted">
                {" "}({humanBytes(b.mongo_bytes)})
              </span>
            </div>
            <div>
              <span className="text-sertex-textMuted">Dosya: </span>
              <span className="text-sertex-cyan">{b.files_count}</span>
              <span className="text-sertex-textMuted">
                {" "}({humanBytes(b.files_bytes)})
              </span>
            </div>
            <div>
              <span className="text-sertex-textMuted">Süre: </span>
              <span className="text-sertex-text">{b.duration_sec}s</span>
            </div>
            <div>
              <span className="text-sertex-textMuted">Hatalar: </span>
              <span
                className={
                  b.file_errors > 0 ? "text-rose-300" : "text-emerald-300"
                }
              >
                {b.file_errors}
              </span>
            </div>
          </div>
          <div className="text-[9px] font-mono text-sertex-textMuted break-all">
            sha256: {b.sha256}
          </div>
          <div className="flex items-center gap-1 mt-2">
            <button
              onClick={() => onDownload(b)}
              disabled={!isOk}
              className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-40 rounded-md text-[10px] font-mono flex items-center gap-1"
              data-testid={`backup-download-${b.id}`}
            >
              <Download className="h-3 w-3" /> İndir
            </button>
            <button
              onClick={() => onDelete(b)}
              className="px-2 py-1 border border-rose-400/40 text-rose-300 hover:bg-rose-400/10 rounded-md text-[10px] font-mono flex items-center gap-1"
              data-testid={`backup-delete-${b.id}`}
            >
              <Trash2 className="h-3 w-3" /> Sil
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const BackupPanel = () => {
  const [status, setStatus] = useState(null);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        backupApi.status().catch(() => null),
        backupApi.list().catch(() => ({ backups: [] })),
      ]);
      setStatus(s);
      setBackups(l.backups || []);
    } catch (e) {
      const msg = e.response?.data?.detail || "Yedekler yüklenemedi";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const onRunNow = async () => {
    setRunning(true);
    try {
      await backupApi.runNow();
      toast.success("Yedek başlatıldı… ~10-30 saniye sürebilir");
      // Poll for completion
      setTimeout(load, 5000);
      setTimeout(load, 15000);
      setTimeout(load, 30000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Yedek başlatılamadı");
    } finally {
      setRunning(false);
    }
  };

  const onPrune = async () => {
    setPruning(true);
    try {
      const r = await backupApi.prune();
      toast.success(`${r.kept} yedek tutuldu, ${r.removed} silindi`);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Temizleme başarısız");
    } finally {
      setPruning(false);
    }
  };

  const onDelete = async (b) => {
    if (!(await confirmDialog({ message: `"${b.filename}" silinsin mi?`, danger: true }))) return;
    try {
      await backupApi.remove(b.id);
      toast.success("Silindi");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Silinemedi");
    }
  };

  const onDownload = async (b) => {
    // Fetch with auth header, save via blob
    try {
      const token = getToken();
      const res = await fetch(backupApi.downloadUrl(b.id), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = b.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("İndirme başladı");
    } catch (e) {
      toast.error(`İndirme başarısız: ${e.message}`);
    }
  };

  const nextRun = status?.scheduler?.jobs?.[0]?.next_run;

  return (
    <div className="space-y-3" data-testid="backup-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-1 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <HardDrive className="h-4 w-4 text-sertex-cyan" />
          <span className="hud-text text-sertex-cyan neon-glow">YEDEKLEME</span>
          <span
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sertex-cyan/10 border border-sertex-cyan/30 text-sertex-cyan"
            data-testid="backup-count-chip"
          >
            {backups.length} YEDEK · {humanBytes(status?.total_bytes || 0)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRunNow}
            disabled={running}
            className="px-2 py-1 border border-emerald-300/50 text-emerald-300 hover:bg-emerald-300/10 disabled:opacity-50 rounded-md hud-text flex items-center gap-1 transition-colors"
            data-testid="backup-run-now"
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Şimdi Yedekle
          </button>
          <button
            onClick={onPrune}
            disabled={pruning}
            className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-50 rounded-md hud-text flex items-center gap-1 transition-colors"
            data-testid="backup-prune"
            title="Grandfather-Father-Son retention (7g+4h+12a) uygula"
          >
            {pruning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Temizle
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-50 rounded-md hud-text flex items-center gap-1 transition-colors"
            data-testid="backup-refresh"
          >
            <RefreshCw
              className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Scheduler status */}
      <div className={cardCls}>
        <div className="flex items-center gap-2 text-xs font-mono">
          <Clock className="h-3 w-3 text-sertex-cyan" />
          <span className="text-sertex-textMuted">Sonraki otomatik yedek:</span>
          <span className="text-sertex-cyan" data-testid="backup-next-run">
            {nextRun ? formatDate(nextRun) : "Zamanlayıcı kapalı"}
          </span>
        </div>
        <div className="text-[10px] font-mono text-sertex-textMuted mt-1">
          Otomatik yedek her gün 03:00 UTC · Retention: 7 gün + 4 hafta + 12 ay
        </div>
      </div>

      {/* Info banner */}
      <div className={cardCls}>
        <div className="text-[11px] font-mono text-sertex-text leading-relaxed">
          Yedekler MongoDB + tüm kullanıcı dosyalarını tek `.zip` içinde
          topluyor. İndir butonuyla bilgisayarına al →{" "}
          <span className="text-sertex-cyan">Internxt Drive Sertex klasörüne</span>{" "}
          sürükle-bırak yap.
        </div>
      </div>

      {/* Backup list */}
      {backups.length === 0 && !loading && (
        <div className="text-center text-xs font-mono text-sertex-textMuted py-6">
          Henüz yedek yok — "Şimdi Yedekle" ile ilk yedeğini oluştur.
        </div>
      )}
      <div className="space-y-1.5" data-testid="backup-list">
        {backups.map((b) => (
          <BackupCard
            key={b.id}
            b={b}
            expanded={expanded}
            setExpanded={setExpanded}
            onDelete={onDelete}
            onDownload={onDownload}
          />
        ))}
      </div>
    </div>
  );
};

export default BackupPanel;
