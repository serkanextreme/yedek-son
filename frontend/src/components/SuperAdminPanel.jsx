import React, { useEffect, useState, useCallback } from "react";
import { ShieldCheck, Crown, Clock, Building2, Eye, PlusSquare, Timer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, companiesApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isOwner, roleLabel } from "../lib/roles";
import { confirmDialog } from "@/lib/confirm";

/**
 * Süper Yönetici paneli (yalnızca süper yönetici görür).
 *  - Aktif süper yöneticiler (Kurucu + süreli atamalar) listelenir.
 *  - Yöneticilere (admin) özel fonksiyon tanınır: ek şirket görme, yeni şirket
 *    açma, şirket görevlerini görme (PATCH /admin/users/{id}/admin-caps).
 *  - KURUCU: birini SÜRELİ süper yönetici yapar / erken geri alır
 *    (POST/DELETE /admin/users/{id}/super-admin). Süre bitince otomatik döner.
 */
const HOUR_OPTIONS = [
  { label: "2 saat", value: 2 },
  { label: "8 saat", value: 8 },
  { label: "1 gün", value: 24 },
  { label: "3 gün", value: 72 },
  { label: "1 hafta", value: 168 },
];

const fmtUntil = (iso) => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const mins = Math.round((d.getTime() - Date.now()) / 60000);
    if (mins <= 0) return "süresi doldu";
    if (mins < 60) return `${mins} dk kaldı`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs} saat kaldı`;
    return `${Math.round(hrs / 24)} gün kaldı`;
  } catch (e) {
    return null;
  }
};

const SuperAdminPanel = () => {
  const { user } = useAuth();
  const owner = isOwner(user);
  const [companies, setCompanies] = useState([]);
  const [supers, setSupers] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grantHours, setGrantHours] = useState({}); // uid -> hours
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [comp, sa, usersRes] = await Promise.all([
        companiesApi.list().catch(() => []),
        api.get("/admin/super-admins").then((r) => r.data.super_admins || []),
        api.get("/admin/users").then((r) => r.data || []),
      ]);
      setCompanies(comp || []);
      setSupers(sa);
      setAdmins((usersRes || []).filter((u) => u.role === "admin"));
    } catch (e) {
      toast.error("Süper yönetici verileri yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patchCaps = async (uid, patch) => {
    setBusy(uid);
    try {
      await api.patch(`/admin/users/${uid}/admin-caps`, patch);
      toast.success("Yetki güncellendi");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Güncellenemedi");
    } finally {
      setBusy(null);
    }
  };

  const toggleExtraCompany = (adminUser, cid) => {
    const cur = adminUser.admin_caps?.extra_company_ids || [];
    const own = adminUser.company_id;
    if (cid === own) return; // own company always visible
    const next = cur.includes(cid) ? cur.filter((c) => c !== cid) : [...cur, cid];
    patchCaps(adminUser.id, { extra_company_ids: next });
  };

  const promote = async (uid) => {
    const hours = grantHours[uid] || 24;
    setBusy(uid);
    try {
      await api.post(`/admin/users/${uid}/super-admin`, { hours });
      toast.success("Süreli süper yönetici atandı");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Atanamadı");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (uid, username) => {
    const ok = await confirmDialog({
      title: "Süper yönetici geri alınsın mı?",
      body: `${username} kullanıcısı eski rolüne dönecek.`,
      confirmText: "Geri Al",
    });
    if (!ok) return;
    setBusy(uid);
    try {
      await api.delete(`/admin/users/${uid}/super-admin`);
      toast.success("Geri alındı — eski rolüne döndü");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Geri alınamadı");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5" data-testid="super-admin-panel">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-purple-300" />
        <div className="hud-text text-purple-200">SÜPER YÖNETİCİ YÖNETİMİ</div>
      </div>

      {/* Aktif süper yöneticiler */}
      <div className="glass-panel p-3 border-purple-400/20">
        <div className="hud-text text-sertex-textMuted mb-2">AKTİF SÜPER YÖNETİCİLER</div>
        {loading ? (
          <div className="hud-text text-sertex-textMuted normal-case">Yükleniyor…</div>
        ) : (
          <div className="space-y-2" data-testid="super-admins-list">
            {supers.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-sertex-surface/40 border border-purple-400/10">
                <div className="flex items-center gap-2 min-w-0">
                  {s.is_owner ? (
                    <Crown className="h-4 w-4 text-yellow-300 shrink-0" />
                  ) : (
                    <Timer className="h-4 w-4 text-purple-300 shrink-0" />
                  )}
                  <span className="text-sertex-cyan font-mono truncate">{s.username}</span>
                  <span className="hud-text text-[10px] text-purple-300/80">
                    {s.is_owner ? "KURUCU" : "SÜRELİ"}
                  </span>
                  {!s.is_owner && s.super_admin_until && (
                    <span className="hud-text text-[10px] text-orange-300/80 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {fmtUntil(s.super_admin_until)}
                    </span>
                  )}
                </div>
                {!s.is_owner && owner && (
                  <button
                    onClick={() => revoke(s.id, s.username)}
                    disabled={busy === s.id}
                    data-testid={`revoke-super-${s.id}`}
                    className="hud-text text-[10px] px-2 py-1 rounded border border-red-400/40 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    <RotateCcw className="h-3 w-3 inline mr-1" /> Geri Al
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Yöneticiler + özel fonksiyonlar */}
      <div className="glass-panel p-3 border-yellow-400/20">
        <div className="hud-text text-sertex-textMuted mb-1">YÖNETİCİLER — ÖZEL FONKSİYONLAR</div>
        <div className="hud-text text-[10px] text-sertex-textMuted normal-case tracking-normal mb-3">
          Her yönetici yalnızca kendi şirketini görür. Aşağıdan ek şirket görme,
          yeni şirket açma ve şirket görevlerini görme yetkisi tanıyabilirsin.
          {!owner && " (Süreli süper yönetici atama yalnızca Kurucu'ya aittir.)"}
        </div>

        {!loading && admins.length === 0 && (
          <div className="hud-text text-sertex-textMuted normal-case">Henüz yönetici yok.</div>
        )}

        <div className="space-y-3" data-testid="admins-caps-list">
          {admins.map((a) => {
            const caps = a.admin_caps || {};
            const extra = caps.extra_company_ids || [];
            return (
              <div key={a.id} className="rounded-lg border border-yellow-400/15 bg-sertex-surface/30 p-3" data-testid={`admin-caps-${a.id}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sertex-cyan font-mono truncate">{a.username}</span>
                    <span className="hud-text text-[10px] text-yellow-300/80">{roleLabel(a.role)}</span>
                    {a.company_name && (
                      <span className="hud-text text-[10px] text-sertex-textMuted">· {a.company_name}</span>
                    )}
                  </div>
                </div>

                {/* Toggle capabilities */}
                <div className="flex flex-wrap gap-2 mb-2">
                  <button
                    onClick={() => patchCaps(a.id, { can_view_company_tasks: !caps.can_view_company_tasks })}
                    disabled={busy === a.id}
                    data-testid={`cap-view-tasks-${a.id}`}
                    className={`hud-text text-[10px] px-2 py-1 rounded border flex items-center gap-1 disabled:opacity-40 ${caps.can_view_company_tasks ? "border-emerald-400/60 text-emerald-300 bg-emerald-500/10" : "border-sertex-cyan/20 text-sertex-textMuted"}`}
                  >
                    <Eye className="h-3 w-3" /> Şirket görevlerini gör
                  </button>
                  <button
                    onClick={() => patchCaps(a.id, { can_create_company: !caps.can_create_company })}
                    disabled={busy === a.id}
                    data-testid={`cap-create-company-${a.id}`}
                    className={`hud-text text-[10px] px-2 py-1 rounded border flex items-center gap-1 disabled:opacity-40 ${caps.can_create_company ? "border-emerald-400/60 text-emerald-300 bg-emerald-500/10" : "border-sertex-cyan/20 text-sertex-textMuted"}`}
                  >
                    <PlusSquare className="h-3 w-3" /> Yeni şirket açabilsin
                  </button>
                </div>

                {/* Extra company visibility */}
                <div className="hud-text text-[10px] text-sertex-textMuted mb-1 flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> EK ŞİRKET GÖRME
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {companies.map((c) => {
                    const isOwn = c.id === a.company_id;
                    const active = isOwn || extra.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleExtraCompany(a, c.id)}
                        disabled={busy === a.id || isOwn}
                        data-testid={`extra-company-${a.id}-${c.id}`}
                        className={`hud-text text-[10px] px-2 py-1 rounded border disabled:opacity-60 ${active ? "border-cyan-400/60 text-cyan-200 bg-cyan-500/10" : "border-sertex-cyan/20 text-sertex-textMuted hover:border-cyan-400/40"}`}
                        title={isOwn ? "Kendi şirketi (her zaman görünür)" : ""}
                      >
                        {c.name}{isOwn ? " ★" : ""}
                      </button>
                    );
                  })}
                </div>

                {/* Owner-only: temp super admin promotion */}
                {owner && (
                  <div className="mt-3 pt-2 border-t border-yellow-400/10 flex items-center gap-2 flex-wrap">
                    <span className="hud-text text-[10px] text-purple-300/90">SÜRELİ SÜPER YÖNETİCİ YAP:</span>
                    <select
                      value={grantHours[a.id] || 24}
                      onChange={(e) => setGrantHours((p) => ({ ...p, [a.id]: parseInt(e.target.value, 10) }))}
                      data-testid={`grant-hours-${a.id}`}
                      className="bg-sertex-surface border border-purple-400/30 rounded px-2 py-1 text-[11px] text-sertex-text"
                    >
                      {HOUR_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => promote(a.id)}
                      disabled={busy === a.id}
                      data-testid={`promote-super-${a.id}`}
                      className="hud-text text-[10px] px-2 py-1 rounded border border-purple-400/50 text-purple-200 hover:bg-purple-500/10 disabled:opacity-40 flex items-center gap-1"
                    >
                      <ShieldCheck className="h-3 w-3" /> Ata
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SuperAdminPanel;
