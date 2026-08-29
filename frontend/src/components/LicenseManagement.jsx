import { confirmDialog } from "@/lib/confirm";
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  KeyRound,
  Plus,
  RefreshCw,
  Loader2,
  Copy,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Clock,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { adminLicenseApi } from "../lib/api";

const TYPES = [
  { value: "trial", label: "Deneme (30 gün)" },
  { value: "monthly", label: "Aylık" },
  { value: "yearly", label: "Yıllık" },
  { value: "lifetime", label: "Ömür Boyu" },
];

const STATUS_META = {
  active: { label: "AKTİF", color: "text-emerald-300", icon: CheckCircle2 },
  suspended: { label: "ASKIDA", color: "text-amber-300", icon: PauseCircle },
  revoked: { label: "İPTAL", color: "text-rose-300", icon: XCircle },
};

const copy = (t) => {
  try {
    navigator.clipboard.writeText(t);
    toast.success("Panoya kopyalandı");
  } catch {
    toast.error("Kopyalanamadı");
  }
};

const fmt = (iso) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("tr-TR", {
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

const LicenseManagement = () => {
  const [list, setList] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ status: "", type: "" });
  const [newType, setNewType] = useState("trial");
  const [newCount, setNewCount] = useState(1);
  const [newNotes, setNewNotes] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        adminLicenseApi.list(filter),
        adminLicenseApi.stats(),
      ]);
      setList(r.licenses || []);
      setStats(s);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Lisanslar yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.status, filter.type]);

  const generate = async () => {
    setGenBusy(true);
    try {
      const r = await adminLicenseApi.generate({
        type: newType,
        count: newCount,
        notes: newNotes.trim() || null,
      });
      toast.success(`${r.created} kod üretildi`);
      // Auto-copy the newly generated keys to clipboard as a batch
      try {
        const keys = r.licenses.map((l) => l.key).join("\n");
        await navigator.clipboard.writeText(keys);
        toast.info(`${r.licenses.length} kod panoya kopyalandı`);
      } catch (e) { console.warn("[LicenseManagement.jsx] hata bastırıldı:", e); }
      setNewNotes("");
      setNewCount(1);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Üretim başarısız");
    } finally {
      setGenBusy(false);
    }
  };

  const suspend = async (l) => {
    try {
      await adminLicenseApi.patch(l.id, { status: "suspended" });
      toast.success("Askıya alındı");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "İşlem başarısız");
    }
  };
  const activate = async (l) => {
    try {
      await adminLicenseApi.patch(l.id, { status: "active" });
      toast.success("Aktifleştirildi");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "İşlem başarısız");
    }
  };
  const revoke = async (l) => {
    if (!(await confirmDialog({ message: "Lisansı iptal et? Kullanıcı erişimini hemen kaybeder.", danger: true })))
      return;
    try {
      await adminLicenseApi.patch(l.id, { status: "revoked" });
      toast.success("İptal edildi");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "İşlem başarısız");
    }
  };
  const extend = async (l, days) => {
    try {
      await adminLicenseApi.patch(l.id, { extend_days: days });
      toast.success(`+${days} gün eklendi`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "İşlem başarısız");
    }
  };
  const del = async (l) => {
    if (!(await confirmDialog({ message: `Kullanılmamış kodu sil: ${l.key}?`, danger: true }))) return;
    try {
      await adminLicenseApi.delete(l.id);
      toast.success("Silindi");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "İşlem başarısız");
    }
  };

  return (
    <div className="space-y-3" data-testid="license-management">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-2">
          <div className="border border-sertex-cyan/25 rounded-md p-2 text-center">
            <div className="text-lg font-mono text-sertex-cyan">
              {stats.total}
            </div>
            <div className="text-[9px] font-mono text-sertex-textMuted">
              TOPLAM
            </div>
          </div>
          <div className="border border-emerald-300/25 rounded-md p-2 text-center">
            <div className="text-lg font-mono text-emerald-300">
              {stats.active_used}
            </div>
            <div className="text-[9px] font-mono text-sertex-textMuted">
              AKTİF KULLANICI
            </div>
          </div>
          <div className="border border-amber-300/25 rounded-md p-2 text-center">
            <div className="text-lg font-mono text-amber-300">
              {stats.unused}
            </div>
            <div className="text-[9px] font-mono text-sertex-textMuted">
              KULLANILMAMIŞ
            </div>
          </div>
          <div className="border border-sertex-cyan/25 rounded-md p-2 text-center">
            <div className="text-lg font-mono text-sertex-cyan">
              {stats.used}
            </div>
            <div className="text-[9px] font-mono text-sertex-textMuted">
              KULLANILMIŞ
            </div>
          </div>
        </div>
      )}

      {/* Generator */}
      <div className="border border-sertex-cyan/25 rounded-md p-3 space-y-2">
        <div className="hud-text text-sertex-cyan flex items-center gap-2">
          <Plus className="h-3 w-3" /> YENİ KOD ÜRET
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
            data-testid="license-new-type"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={500}
            value={newCount}
            onChange={(e) => setNewCount(parseInt(e.target.value || "1", 10))}
            className="bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
            data-testid="license-new-count"
          />
          <button
            onClick={generate}
            disabled={genBusy}
            className="px-2 py-1 border border-sertex-cyan bg-sertex-cyan/10 hover:bg-sertex-cyan/20 disabled:opacity-50 rounded-md hud-text text-sertex-cyan flex items-center justify-center gap-1"
            data-testid="license-generate"
          >
            {genBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <KeyRound className="h-3 w-3" />
            )}
            Üret
          </button>
        </div>
        <input
          type="text"
          value={newNotes}
          onChange={(e) => setNewNotes(e.target.value)}
          placeholder="Not (opsiyonel — 'Müşteri: Ali')"
          className="w-full bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
          data-testid="license-new-notes"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
          className="bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-[10px] font-mono text-sertex-text"
          data-testid="license-filter-status"
        >
          <option value="">Tüm Durumlar</option>
          <option value="active">Aktif</option>
          <option value="suspended">Askıda</option>
          <option value="revoked">İptal</option>
        </select>
        <select
          value={filter.type}
          onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}
          className="bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-[10px] font-mono text-sertex-text"
          data-testid="license-filter-type"
        >
          <option value="">Tüm Türler</option>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md text-[10px] font-mono flex items-center gap-1"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </button>
      </div>

      {/* List */}
      <div className="space-y-1.5" data-testid="license-list">
        {list.map((l) => {
          const meta = STATUS_META[l.status] || STATUS_META.active;
          const Icon = meta.icon;
          return (
            <div
              key={l.id}
              className="border border-sertex-cyan/20 rounded-md p-2 bg-sertex-cyan/5"
              data-testid={`license-row-${l.id}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs font-mono text-sertex-cyan cursor-pointer hover:underline tracking-wider"
                  onClick={() => copy(l.key)}
                  title="Kopyala"
                >
                  {l.key}
                </span>
                <button
                  onClick={() => copy(l.key)}
                  className="text-sertex-textMuted hover:text-sertex-cyan"
                  data-testid={`license-copy-${l.id}`}
                >
                  <Copy className="h-3 w-3" />
                </button>
                <span
                  className={`text-[9px] font-mono ${meta.color} flex items-center gap-0.5`}
                >
                  <Icon className="h-2.5 w-2.5" /> {meta.label}
                </span>
                <span className="text-[9px] font-mono text-sertex-textMuted uppercase">
                  {l.type_label || l.type}
                </span>
                {l.assigned_username ? (
                  <span className="text-[9px] font-mono text-emerald-300 flex items-center gap-0.5">
                    <Users className="h-2.5 w-2.5" /> {l.assigned_username}
                  </span>
                ) : (
                  <span className="text-[9px] font-mono text-sertex-textMuted italic">
                    kullanılmamış
                  </span>
                )}
                {l.expires_at && (
                  <span className="text-[9px] font-mono text-sertex-textMuted">
                    <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                    bitiş {fmt(l.expires_at)}
                  </span>
                )}
              </div>
              {l.notes && (
                <div className="text-[10px] font-mono text-sertex-textMuted mt-0.5">
                  {l.notes}
                </div>
              )}
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {l.status === "active" ? (
                  <button
                    onClick={() => suspend(l)}
                    className="px-1.5 py-0.5 text-[9px] font-mono border border-amber-300/40 text-amber-300 hover:bg-amber-300/10 rounded"
                    data-testid={`license-suspend-${l.id}`}
                  >
                    Askıya Al
                  </button>
                ) : (
                  <button
                    onClick={() => activate(l)}
                    className="px-1.5 py-0.5 text-[9px] font-mono border border-emerald-300/40 text-emerald-300 hover:bg-emerald-300/10 rounded"
                    data-testid={`license-activate-${l.id}`}
                  >
                    Aktifleştir
                  </button>
                )}
                {l.status !== "revoked" && (
                  <button
                    onClick={() => revoke(l)}
                    className="px-1.5 py-0.5 text-[9px] font-mono border border-rose-400/40 text-rose-300 hover:bg-rose-400/10 rounded"
                    data-testid={`license-revoke-${l.id}`}
                  >
                    İptal
                  </button>
                )}
                {l.assigned_user_id && l.expires_at && (
                  <>
                    <button
                      onClick={() => extend(l, 7)}
                      className="px-1.5 py-0.5 text-[9px] font-mono border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
                    >
                      +7g
                    </button>
                    <button
                      onClick={() => extend(l, 30)}
                      className="px-1.5 py-0.5 text-[9px] font-mono border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
                    >
                      +30g
                    </button>
                    <button
                      onClick={() => extend(l, 365)}
                      className="px-1.5 py-0.5 text-[9px] font-mono border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
                    >
                      +365g
                    </button>
                  </>
                )}
                {!l.assigned_user_id && (
                  <button
                    onClick={() => del(l)}
                    className="px-1.5 py-0.5 text-[9px] font-mono border border-rose-400/40 text-rose-300 hover:bg-rose-400/10 rounded flex items-center gap-0.5"
                    data-testid={`license-delete-${l.id}`}
                  >
                    <Trash2 className="h-2.5 w-2.5" /> Sil
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {list.length === 0 && !loading && (
          <div className="text-center text-xs font-mono text-sertex-textMuted py-6">
            Henüz kod yok — yukarıdan üret.
          </div>
        )}
      </div>
    </div>
  );
};

export default LicenseManagement;
