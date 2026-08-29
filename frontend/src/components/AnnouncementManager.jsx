import { confirmDialog } from "@/lib/confirm";
// Faz 9 CP6 — Admin: Global Announcement Manager.
//
// Simple CRUD UI: list all announcements, publish a new one, edit / soft-
// delete / hard-purge existing rows, view per-row stats (delivery + ack).
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone, Plus, Trash2, X, Users, Check, AlertTriangle, AlertOctagon, RefreshCw, Send, Edit3 } from "lucide-react";
import { announcementsApi, companiesApi } from "../lib/api";

const SEVERITY_OPTS = [
  { key: "info",     label: "BİLGİ",  icon: Megaphone,     color: "text-cyan-300" },
  { key: "warning",  label: "UYARI",  icon: AlertTriangle, color: "text-amber-300" },
  { key: "critical", label: "KRİTİK", icon: AlertOctagon,  color: "text-rose-300" },
];

const TARGET_OPTS = [
  { key: "all",     label: "Tüm kullanıcılar" },
  { key: "role",    label: "Belirli bir role" },
  { key: "company", label: "Belirli bir şirkete" },
];

const ROLE_OPTS = [
  { value: "admin",    label: "Admin" },
  { value: "manager",  label: "Yönetici" },
  { value: "employee", label: "Çalışan" },
];

const _fmt = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
};

export default function AnnouncementManager() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(null); // null | { mode: "create"|"edit", ...fields }
  const [statsFor, setStatsFor] = useState(null); // { id, target_count, ack_count, ack_ratio }

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await announcementsApi.listAll();
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Duyurular yüklenemedi");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Fetch companies once for the target-value dropdown.
  useEffect(() => {
    let alive = true;
    companiesApi.list()
      .then((list) => { if (alive) setCompanies(Array.isArray(list) ? list : []); })
      .catch(() => { if (alive) setCompanies([]); });
    return () => { alive = false; };
  }, []);

  const openCreate = () => setForm({
    mode: "create",
    title: "",
    message: "",
    severity: "info",
    target_type: "all",
    target_value: "",
    require_ack: false,
    expires_at: "",
  });

  const openEdit = (row) => setForm({
    mode: "edit",
    id: row.id,
    title: row.title || "",
    message: row.message || "",
    severity: row.severity || "info",
    target_type: row.target_type || "all",
    target_value: row.target_value || "",
    require_ack: !!row.require_ack,
    expires_at: row.expires_at ? row.expires_at.slice(0, 16) : "",
  });

  const submit = async () => {
    const f = form;
    if (!f) return;
    if (!f.title.trim()) { toast.error("Başlık gerekli"); return; }
    if (!f.message.trim()) { toast.error("Mesaj gerekli"); return; }
    if (f.target_type === "role" && !f.target_value) { toast.error("Rol seçimi gerekli"); return; }
    if (f.target_type === "company" && !f.target_value) { toast.error("Şirket seçimi gerekli"); return; }
    const payload = {
      title: f.title.trim(),
      message: f.message.trim(),
      severity: f.severity,
      target_type: f.target_type,
      target_value: f.target_type === "all" ? null : f.target_value,
      require_ack: !!f.require_ack || f.severity === "critical",
      expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : null,
    };
    try {
      if (f.mode === "create") {
        await announcementsApi.create(payload);
        toast.success("Duyuru yayınlandı — abonelere anlık iletildi");
      } else {
        await announcementsApi.update(f.id, payload);
        toast.success("Duyuru güncellendi");
      }
      setForm(null);
      await reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    }
  };

  const softDelete = async (row) => {
    if (!(await confirmDialog({ message: `"${row.title}" pasifleştirilsin mi?`, danger: true }))) return;
    try {
      await announcementsApi.softDelete(row.id);
      toast.success("Duyuru pasifleştirildi");
      await reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const hardPurge = async (row) => {
    if (!(await confirmDialog({ message: `"${row.title}" TAMAMEN silinsin mi? (geri alınamaz)`, danger: true }))) return;
    try {
      await announcementsApi.purge(row.id);
      toast.success("Duyuru silindi");
      setStatsFor(null);
      await reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const loadStats = async (row) => {
    try {
      const s = await announcementsApi.stats(row.id);
      setStatsFor(s);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "İstatistik alınamadı");
    }
  };

  return (
    <div className="space-y-3" data-testid="announcement-manager">
      <div className="flex items-center justify-between">
        <div className="hud-text text-sertex-cyan flex items-center gap-2">
          <Megaphone className="h-4 w-4" /> GLOBAL DUYURULAR
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reload}
            data-testid="ann-refresh"
            className="p-1 rounded border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10"
            title="Yenile"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={openCreate}
            data-testid="ann-create-open"
            className="px-2 py-1 rounded border border-emerald-400/60 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hud-text flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> YENİ DUYURU
          </button>
        </div>
      </div>

      <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
        Yeni bir duyuru yayınladığında SSE üzerinden bağlı tüm hedef kullanıcılara
        anında bildirim düşer. Çevrimdışı olanlar bir sonraki sayfa açılışında görür.
      </div>

      {loading && (
        <div className="text-center text-sertex-textMuted text-xs py-6 hud-text animate-pulse">
          YÜKLENİYOR...
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div
          className="text-center text-sertex-textMuted text-xs py-6 normal-case font-mono italic border border-sertex-cyan/15 rounded"
          data-testid="ann-empty"
        >
          Henüz duyuru yok — yukarıdaki "YENİ DUYURU" ile başla.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => {
            const meta = SEVERITY_OPTS.find((s) => s.key === row.severity) || SEVERITY_OPTS[0];
            const SIcon = meta.icon;
            return (
              <div
                key={row.id}
                data-testid={`ann-row-${row.id}`}
                className={`border rounded p-2 ${row.is_active ? "border-sertex-cyan/30 bg-sertex-surface/40" : "border-sertex-textMuted/20 opacity-60"}`}
              >
                <div className="flex items-start gap-2">
                  <SIcon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${meta.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`hud-text ${meta.color} flex items-center gap-2 flex-wrap`}>
                      <span>{meta.label}</span>
                      <span className="opacity-60">·</span>
                      <span className="text-sertex-text font-semibold truncate">{row.title}</span>
                      {!row.is_active && (
                        <span className="px-1 py-0.5 rounded border border-sertex-textMuted/30 text-[9px] hud-text">
                          PASİF
                        </span>
                      )}
                      {row.require_ack && (
                        <span className="px-1 py-0.5 rounded border border-emerald-400/40 text-emerald-300 text-[9px] hud-text">
                          ONAY GEREKLİ
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-sertex-textMuted normal-case mt-0.5 line-clamp-2">
                      {row.message}
                    </div>
                    <div className="text-[10px] font-mono text-sertex-textMuted/70 normal-case mt-1 flex items-center gap-2 flex-wrap">
                      <span>
                        {row.target_type === "all"
                          ? "Tüm kullanıcılar"
                          : row.target_type === "role"
                          ? `Rol: ${row.target_value}`
                          : `Şirket: ${(companies.find((c) => c.id === row.target_value) || {}).name || row.target_value}`}
                      </span>
                      <span>·</span>
                      <span>{row.created_by_username || "?"}</span>
                      <span>·</span>
                      <span>{_fmt(row.created_at)}</span>
                      {row.expires_at && (<><span>·</span><span>Bitiş: {_fmt(row.expires_at)}</span></>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => loadStats(row)}
                      data-testid={`ann-stats-${row.id}`}
                      title="Kaç kişi gördü?"
                      className="p-1 rounded border border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/10"
                    >
                      <Users className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      data-testid={`ann-edit-${row.id}`}
                      title="Düzenle"
                      className="p-1 rounded border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    {row.is_active && (
                      <button
                        type="button"
                        onClick={() => softDelete(row)}
                        data-testid={`ann-softdelete-${row.id}`}
                        title="Pasifleştir"
                        className="p-1 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-500/10"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => hardPurge(row)}
                      data-testid={`ann-purge-${row.id}`}
                      title="Kalıcı sil"
                      className="p-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {statsFor && statsFor.announcement_id === row.id && (
                  <div className="mt-2 pt-2 border-t border-sertex-cyan/15 text-[11px] font-mono normal-case flex items-center gap-3">
                    <span className="text-cyan-300">Hedef: {statsFor.target_count}</span>
                    <span className="text-emerald-300">Onaylayan: {statsFor.ack_count}</span>
                    <span className="text-sertex-textMuted">
                      Oran: {(statsFor.ack_ratio * 100).toFixed(1)}%
                    </span>
                    <button
                      onClick={() => setStatsFor(null)}
                      className="ml-auto text-sertex-textMuted hover:text-sertex-cyan"
                    >
                      Kapat
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit modal */}
      {form && (
        <div
          className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setForm(null)}
          data-testid="ann-form-modal"
        >
          <div
            className="glass-panel corner-bracket p-4 max-w-lg w-full space-y-3 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="hud-text text-sertex-cyan flex items-center gap-2 neon-glow">
                <Megaphone className="h-4 w-4" />
                {form.mode === "create" ? "YENİ DUYURU" : "DUYURU DÜZENLE"}
              </div>
              <button
                onClick={() => setForm(null)}
                className="text-sertex-textMuted hover:text-sertex-cyan"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <div className="hud-text text-sertex-textMuted mb-1">ÖNEM DÜZEYİ</div>
              <div className="flex items-center gap-1.5">
                {SEVERITY_OPTS.map((s) => {
                  const SIcon2 = s.icon;
                  const active = form.severity === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, severity: s.key }))}
                      data-testid={`ann-severity-${s.key}`}
                      className={`flex-1 py-1.5 rounded border text-[11px] font-mono hud-text flex items-center justify-center gap-1 ${
                        active
                          ? `${s.color} border-current bg-current/10`
                          : "text-sertex-textMuted border-sertex-cyan/25 hover:text-sertex-cyan"
                      }`}
                    >
                      <SIcon2 className="h-3 w-3" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="hud-text text-sertex-textMuted mb-1">BAŞLIK ({(form.title || "").length}/120)</div>
              <input
                type="text"
                value={form.title}
                maxLength={120}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                data-testid="ann-title-input"
                placeholder="Örn: Yarın 02:00–04:00 arası bakım"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
              />
            </div>

            <div>
              <div className="hud-text text-sertex-textMuted mb-1">MESAJ ({(form.message || "").length}/2000)</div>
              <textarea
                value={form.message}
                maxLength={2000}
                rows={4}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                data-testid="ann-message-input"
                placeholder="Detaylı açıklama..."
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none resize-none"
              />
            </div>

            <div>
              <div className="hud-text text-sertex-textMuted mb-1">HEDEF</div>
              <select
                value={form.target_type}
                onChange={(e) => setForm((f) => ({ ...f, target_type: e.target.value, target_value: "" }))}
                data-testid="ann-target-type"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
              >
                {TARGET_OPTS.map((t) => (<option key={t.key} value={t.key}>{t.label}</option>))}
              </select>
            </div>

            {form.target_type === "role" && (
              <div>
                <div className="hud-text text-sertex-textMuted mb-1">ROL</div>
                <select
                  value={form.target_value}
                  onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))}
                  data-testid="ann-target-value-role"
                  className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                >
                  <option value="">— seç —</option>
                  {ROLE_OPTS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
                </select>
              </div>
            )}

            {form.target_type === "company" && (
              <div>
                <div className="hud-text text-sertex-textMuted mb-1">ŞİRKET</div>
                <select
                  value={form.target_value}
                  onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))}
                  data-testid="ann-target-value-company"
                  className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                >
                  <option value="">— seç —</option>
                  {(companies || []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
                {(!companies || companies.length === 0) && (
                  <div className="text-[10px] font-mono text-amber-300 mt-1 normal-case">
                    Şirket listesi boş — Ayarlar → Şirketler'den oluştur.
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-mono text-sertex-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.require_ack || form.severity === "critical"}
                  disabled={form.severity === "critical"}
                  onChange={(e) => setForm((f) => ({ ...f, require_ack: e.target.checked }))}
                  data-testid="ann-require-ack"
                  className="accent-emerald-500 cursor-pointer"
                />
                Onay gerekli (kritik = otomatik)
              </label>
            </div>

            <div>
              <div className="hud-text text-sertex-textMuted mb-1">SON GEÇERLİLİK (opsiyonel)</div>
              <input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                data-testid="ann-expires-at"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
              />
            </div>

            <div className="flex gap-2 pt-2 border-t border-sertex-cyan/15">
              <button
                type="button"
                onClick={() => setForm(null)}
                data-testid="ann-form-cancel"
                className="flex-1 py-2 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded-md hud-text"
              >
                İPTAL
              </button>
              <button
                type="button"
                onClick={submit}
                data-testid="ann-form-submit"
                className="flex-1 py-2 bg-emerald-500/20 border border-emerald-400 text-emerald-200 hover:bg-emerald-500/40 rounded-md hud-text flex items-center justify-center gap-1"
              >
                {form.mode === "create" ? (<><Send className="h-3 w-3" /> YAYINLA</>) : (<><Check className="h-3 w-3" /> KAYDET</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
