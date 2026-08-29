import React, { useEffect, useMemo, useState, useCallback } from "react";
import { UserPlus, Users, Trash2, KeyRound, Shield, User as UserIcon, X, Eye, HardDrive, Building2, ChevronDown, ChevronRight, Briefcase, Grid3x3, List, Lock } from "lucide-react";
import { api, managerVisibilityApi } from "../lib/api";
import { companiesApi } from "../lib/api";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { isAdminLike, isSuperAdmin, roleLabel } from "../lib/roles";
import { parseCapacityToMb, formatMb } from "../lib/capacity";
import { promptDialog } from "../lib/confirm";
// Faz 9 CP5 — UserLockPolicyModal extracted (behavior unchanged).
import { UserLockPolicyModal } from "./users/UserLockPolicyModal";

const NO_COMPANY_KEY = "__no_company__";

// Role display metadata — single source of truth for badges + role picker.
const ROLE_META = {
  super_admin: { label: "SÜPER YÖNETİCİ", color: "text-purple-200", Icon: Shield },
  admin:    { label: "YÖNETİCİ", color: "text-yellow-300",  Icon: Shield },
  manager:  { label: "MÜDÜR",    color: "text-purple-300",  Icon: Briefcase },
  employee: { label: "ÇALIŞAN",  color: "text-sertex-cyan", Icon: UserIcon },
};
// Cycle order for the inline Shield-button role changer.
const ROLE_CYCLE = { admin: "employee", employee: "manager", manager: "admin" };

// Faz 9 CP5 — UserLockPolicyModal moved to /components/users/UserLockPolicyModal.jsx
// (imported at the top of this file).


const UserManagement = ({ onClose }) => {
  const { user: currentUser, impersonate } = useAuth();
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]); // [{id, name}]
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  // Faz 9 CP4.14 — admin may leave password blank; backend generates a temp one.
  const [setPasswordManually, setSetPasswordManually] = useState(false);
  const [newRole, setNewRole] = useState("employee");
  const [newLicense, setNewLicense] = useState("trial");
  const [newQuotaGb, setNewQuotaGb] = useState(""); // optional per-user quota override (MB or GB text)
  const [newCompany, setNewCompany] = useState("");      // selected company id OR ""
  const [newCompanyMode, setNewCompanyMode] = useState("select"); // "select" | "custom"
  const [newCompanyCustom, setNewCompanyCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(null); // user id being reset

  // Faz 9 CP4.23 — manager assignment modal state. `mgrEditing` = employee
  // whose manager list is being configured. `mgrAssigned` = set of manager
  // user_ids currently linked to that employee.
  const [mgrEditing, setMgrEditing] = useState(null);
  const [mgrAssigned, setMgrAssigned] = useState(new Set());
  const [mgrExistingRows, setMgrExistingRows] = useState([]); // [{id, manager_user_id}]
  const [mgrSaving, setMgrSaving] = useState(false);

  const openManagerAssign = async (employee) => {
    setMgrEditing(employee);
    setMgrAssigned(new Set());
    setMgrExistingRows([]);
    try {
      // The endpoint accepts manager_user_id filter; pull ALL rows and
      // filter to the current employee client-side.
      const all = await managerVisibilityApi.list();
      const rows = (all || []).filter((r) => r.employee_user_id === employee.id);
      setMgrExistingRows(rows);
      setMgrAssigned(new Set(rows.map((r) => r.manager_user_id)));
    } catch {
      /* silent — modal still opens with empty set */
    }
  };

  const closeManagerAssign = () => {
    setMgrEditing(null);
    setMgrAssigned(new Set());
    setMgrExistingRows([]);
  };

  const saveManagerAssign = async () => {
    if (!mgrEditing) return;
    setMgrSaving(true);
    try {
      const original = new Set(mgrExistingRows.map((r) => r.manager_user_id));
      const wanted = mgrAssigned;
      // Diff: add newly-selected, remove newly-unselected.
      const toAdd = [...wanted].filter((mid) => !original.has(mid));
      const toRemove = mgrExistingRows.filter((r) => !wanted.has(r.manager_user_id));
      for (const mid of toAdd) {
        await managerVisibilityApi.grant(mid, mgrEditing.id);
      }
      for (const row of toRemove) {
        await managerVisibilityApi.revoke(row.id);
      }
      toast.success(`${mgrEditing.username} için müdürler güncellendi`);
      closeManagerAssign();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setMgrSaving(false);
    }
  };
  const [resetPw, setResetPw] = useState("");
  const [collapsedCompanies, setCollapsedCompanies] = useState({}); // {key: true}
  // Faz 9 CP8.6 — replaces the beyaz window.prompt() used by editCompany().
  // Holds the user whose company is being edited + the initial text value.
  // Rendered inline near the bottom of the component (dark glass-panel modal).
  const [companyEditState, setCompanyEditState] = useState(null); // { user, value }

  // Faz 9 CP4.24 — Atama Matrisi view. Toggles between the classic per-company
  // user list and a flat cross-company table where the admin can grant/revoke
  // manager visibility inline without opening a modal per user.
  const [viewMode, setViewMode] = useState("list"); // "list" | "matrix"
  const [mvAll, setMvAll] = useState([]); // all manager_visibility rows [{id, manager_user_id, employee_user_id}]
  const [mvLoading, setMvLoading] = useState(false);
  const [mvBusy, setMvBusy] = useState({}); // {`${employeeId}:${managerId}`: true}
  const [matrixFilter, setMatrixFilter] = useState(""); // free-text search
  // Faz 9 CP4.26 — Şirket chip filtresi. `matrixCompanyFilter` bir company_id
  // tutar; NO_COMPANY_KEY = bireysel (şirketsiz) grubu; boş string = tüm şirketler.
  const [matrixCompanyFilter, setMatrixCompanyFilter] = useState("");
  // Faz 9 CP4.25 — Toplu atama. `selectedEmp` = set of employee ids ticked in the
  // matrix; `bulkMgrId` = manager to grant to all selected. `bulkBusy` disables
  // the action bar while the batch is running.
  const [selectedEmp, setSelectedEmp] = useState(new Set());
  const [bulkMgrId, setBulkMgrId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Faz 9 CP4.30 — User-level default lock policy modal.
  const [lockUser, setLockUser] = useState(null); // { id, username } | null

  const loadMatrix = useCallback(async () => {
    setMvLoading(true);
    try {
      const rows = await managerVisibilityApi.list();
      setMvAll(rows || []);
    } catch {
      /* silent — table just renders empty */
    } finally {
      setMvLoading(false);
    }
  }, []);

  // Refresh matrix rows whenever we switch INTO matrix view (or after edits).
  useEffect(() => {
    if (viewMode === "matrix") loadMatrix();
  }, [viewMode, loadMatrix]);

  // Add manager assignment inline (grant). Idempotent-ish: skips if already set.
  const matrixGrant = async (employeeId, managerId) => {
    if (!employeeId || !managerId) return;
    const already = mvAll.some(
      (r) => r.employee_user_id === employeeId && r.manager_user_id === managerId,
    );
    if (already) return;
    const key = `${employeeId}:${managerId}`;
    setMvBusy((b) => ({ ...b, [key]: true }));
    try {
      const created = await managerVisibilityApi.grant(managerId, employeeId);
      // Optimistic append. `created` returns the new row {id, ...}.
      setMvAll((prev) => [...prev, created]);
      toast.success("Müdür atandı");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Atanamadı");
    } finally {
      setMvBusy((b) => {
        const n = { ...b };
        delete n[key];
        return n;
      });
    }
  };

  // Remove manager assignment inline (revoke) by manager_visibility row id.
  const matrixRevoke = async (row) => {
    if (!row?.id) return;
    const key = `${row.employee_user_id}:${row.manager_user_id}`;
    setMvBusy((b) => ({ ...b, [key]: true }));
    try {
      await managerVisibilityApi.revoke(row.id);
      setMvAll((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Müdür kaldırıldı");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaldırılamadı");
    } finally {
      setMvBusy((b) => {
        const n = { ...b };
        delete n[key];
        return n;
      });
    }
  };

  // Faz 9 CP4.25 — Bulk grant a single manager to every currently-selected
  // employee. Skips rows that already have the grant (idempotent). Reports a
  // consolidated toast with add / skip / fail counts.
  const bulkGrant = async () => {
    if (!bulkMgrId || selectedEmp.size === 0 || bulkBusy) return;
    const empIds = Array.from(selectedEmp).filter((eid) => eid !== bulkMgrId);
    if (empIds.length === 0) {
      toast.error("Bir müdürü kendisine atayamazsın");
      return;
    }
    setBulkBusy(true);
    let added = 0, skipped = 0, failed = 0;
    const created = [];
    // Sequential to keep the backend audit log readable and avoid burst 429s.
    for (const eid of empIds) {
      const already = mvAll.some(
        (r) => r.employee_user_id === eid && r.manager_user_id === bulkMgrId,
      );
      if (already) { skipped += 1; continue; }
      try {
        const row = await managerVisibilityApi.grant(bulkMgrId, eid);
        created.push(row);
        added += 1;
      } catch {
        failed += 1;
      }
    }
    if (created.length) setMvAll((prev) => [...prev, ...created]);
    const mgrName = users.find((u) => u.id === bulkMgrId)?.username || "müdür";
    if (failed === 0) {
      toast.success(`${mgrName} → ${added} yeni atama · ${skipped} zaten mevcut`);
    } else {
      toast.error(`${mgrName}: ${added} eklendi · ${skipped} atlandı · ${failed} başarısız`);
    }
    setBulkBusy(false);
    // Reset selection but keep the picked manager so admin can repeat quickly.
    setSelectedEmp(new Set());
  };

  const load = () => {
    api.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {});
    // Faz 8 — use the new canonical /api/companies (id + name objects) rather
    // than the legacy distinct-name endpoint.
    companiesApi.list().then((list) => setCompanies(list || [])).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const addUser = async () => {
    if (newUsername.trim().length < 3) {
      toast.error("Kullanıcı adı en az 3 karakter");
      return;
    }
    // Password is only validated when the admin chose to set it manually.
    // Otherwise the backend generates a secure temp password and returns it.
    if (setPasswordManually && newPassword.length < 6) {
      toast.error("Şifre en az 6 karakter");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        username: newUsername.trim(),
        role: newRole,
        // Only auto-issue a license for non-admin roles (employee/manager).
        with_license: newRole !== "admin" ? newLicense : null,
      };
      if (setPasswordManually && newPassword) {
        payload.password = newPassword;
      }
      // Optional per-user quota override. Accepts "500 MB", "3 GB", plain
      // number (defaults to GB), etc. Only sent for non-admin roles and
      // when value parses to a positive MB count.
      if (newRole !== "admin" && newQuotaGb.trim() !== "") {
        const mb = parseCapacityToMb(newQuotaGb, "gb");
        if (mb == null || mb <= 0) {
          toast.error("Kapasite geçersiz. Örn: 500 MB, 3 GB");
          setSaving(false);
          return;
        }
        payload.custom_quota_mb = mb;
      }
      // Company assignment. In select mode `newCompany` is a company_id (or empty);
      // in custom mode we ship a legacy `company_name` and let the backend upsert.
      if (newCompanyMode === "custom") {
        const custom = newCompanyCustom.trim();
        if (custom) payload.company_name = custom;
      } else if (newCompany) {
        payload.company_id = newCompany;
      }
      const displayCompany =
        newCompanyMode === "custom"
          ? newCompanyCustom.trim()
          : (companies.find((c) => c.id === newCompany)?.name || "");
      const res = await api.post("/admin/users", payload);
      const created = res?.data || {};
      const tempPw = created.temp_password || null;
      if (tempPw) {
        // Copy to clipboard so the admin can paste it into a chat/email.
        try { await navigator.clipboard.writeText(tempPw); } catch { /* clipboard may be blocked; ignore */ }
        toast.success(
          `${newUsername} eklendi${displayCompany ? ` · ${displayCompany}` : ""}`,
          {
            description: `🔑 Geçici şifre (panoya kopyalandı): ${tempPw}`,
            duration: 20000,
          }
        );
      } else {
        toast.success(
          `${newUsername} eklendi` +
          (payload.with_license ? ` · ${payload.with_license} lisansı` : "") +
          (payload.custom_quota_mb ? ` · ${formatMb(payload.custom_quota_mb)} kapasite` : "") +
          (displayCompany ? ` · ${displayCompany}` : "")
        );
      }
      setNewUsername("");
      setNewPassword("");
      setSetPasswordManually(false);
      setNewRole("employee");
      setNewLicense("trial");
      setNewQuotaGb("");
      setNewCompany("");
      setNewCompanyMode("select");
      setNewCompanyCustom("");
      setShowAdd(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Eklenemedi");
    } finally {
      setSaving(false);
    }
  };

  const editQuota = async (u) => {
    // Current effective quota (MB): user's custom override, else license default (backend authoritative).
    const currentMb = u.custom_quota_mb || 0;
    const currentText = currentMb > 0 ? formatMb(currentMb) : "";
    const answer = await promptDialog({
      title: "KULLANICI KAPASİTESİ",
      message:
      `${u.username} için kapasite\n\n` +
      `Mevcut özel değer: ${currentMb > 0 ? currentText : "yok (lisans varsayılanı)"}\n\n` +
      `Örnek: "500 MB", "3 GB", "1.5 GB"\n` +
      `Birim yazmazsan GB kabul edilir.\n` +
      `Boş bırak veya "0" gir → özel değer silinir (lisansa döner).`,
      defaultValue: currentText,
      confirmText: "KAYDET",
    });
    if (answer == null) return;
    const trimmed = String(answer).trim();
    // Empty or explicit "0" → clear override
    if (trimmed === "" || trimmed === "0") {
      try {
        await api.patch(`/admin/users/${u.id}`, { custom_quota_mb: 0 });
        toast.success(`${u.username} kapasitesi lisans varsayılanına döndürüldü`);
        load();
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Güncellenemedi");
      }
      return;
    }
    const mb = parseCapacityToMb(trimmed, "gb");
    if (mb == null || mb <= 0) {
      toast.error("Geçersiz değer. Örn: 500 MB veya 3 GB");
      return;
    }
    if (mb < 1 || mb > 10485760) {
      toast.error("Değer 1 MB — 10 TB aralığında olmalı");
      return;
    }
    try {
      await api.patch(`/admin/users/${u.id}`, { custom_quota_mb: mb });
      toast.success(`${u.username} kapasitesi ${formatMb(mb)} olarak ayarlandı`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Güncellenemedi");
    }
  };

  // Assign / change / clear the user's company. Faz 9 CP8.6 — opens a dark
  // glass-panel modal (see companyEditState below) instead of the native
  // window.prompt() which rendered as an ugly white OS dialog.
  const editCompany = (u) => {
    setCompanyEditState({ user: u, value: u.company_name || "" });
  };

  const submitCompanyEdit = async () => {
    if (!companyEditState) return;
    const { user: u, value } = companyEditState;
    const trimmed = (value || "").trim();
    try {
      // Prefer canonical company_id when the name exactly matches an existing
      // company (case-insensitive). Otherwise pass company_name and let the
      // backend upsert a new row.
      const matched = trimmed
        ? companies.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
        : null;
      const patch = trimmed === ""
        ? { company_id: "" }
        : matched
          ? { company_id: matched.id }
          : { company_name: trimmed };
      const res = await api.patch(`/admin/users/${u.id}`, patch);
      // Faz 10 — surface the automatic task offboarding summary if the company
      // actually changed (finished → archive, unfinished → orphan pool/manager).
      const ob = res?.data?._offboard;
      let extra = "";
      if (ob && (ob.orphaned || ob.archived)) {
        const parts = [];
        if (ob.orphaned) {
          parts.push(`${ob.orphaned} görev ${ob.manager_id ? "müdüre aktarıldı" : "boşta havuzuna alındı"}`);
        }
        if (ob.archived) parts.push(`${ob.archived} biten görev arşive taşındı`);
        extra = " · " + parts.join(", ");
      }
      toast.success((trimmed
        ? `${u.username} → ${trimmed}`
        : `${u.username} şirketten çıkarıldı`) + extra);
      setCompanyEditState(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Güncellenemedi");
    }
  };

  // Group users by company_name for the collapsible listing. Users without a
  // company go into a special "__no_company__" bucket rendered as "BİREYSEL".
  const grouped = useMemo(() => {
    const map = new Map();
    for (const u of users) {
      const key = u.company_name || NO_COMPANY_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(u);
    }
    // Sort groups: named companies first (alpha), "no company" last.
    const entries = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === NO_COMPANY_KEY) return 1;
      if (b[0] === NO_COMPANY_KEY) return -1;
      return a[0].toLowerCase().localeCompare(b[0].toLowerCase(), "tr");
    });
    return entries;
  }, [users]);

  // Card body for a single user — extracted so both the per-company groups
  // and any future flat-list variant can reuse it without duplication.
  const renderUserCardBody = (u, isMe, isAdmin) => {
    const roleKey = u.role in ROLE_META ? u.role : "employee";
    const meta = ROLE_META[roleKey];
    const RoleIcon = meta.Icon;
    // Next role in the cycle (used for the Shield-tooltip).
    const nextRole = ROLE_CYCLE[roleKey] || "employee";
    // Kurucu (owner) + süper yönetici dokunulmaz; impersonate yalnızca süper yönetici.
    const isProtected = !!u.is_owner || u.role === "super_admin";
    const canImpersonate = isSuperAdmin(currentUser) && !u.is_owner;
    return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <RoleIcon className={`h-4 w-4 ${meta.color} shrink-0`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-mono text-sertex-text truncate flex items-center gap-1.5 flex-wrap">
              <span className="truncate">{u.username}</span>
              {isMe && <span className="hud-text text-sertex-cyan">(SİZ)</span>}
              {/* Faz 9 CP4.14 — mark users still on their auto-generated temp
                  password so the admin can spot them at a glance. Field defaults
                  to undefined for legacy users; only false triggers the badge. */}
              {u.password_user_set === false && (
                <span
                  data-testid={`admin-temp-pw-badge-${u.username}`}
                  title="Şifre henüz kullanıcı tarafından değiştirilmedi — geçici şifre hâlâ aktif"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-yellow-400/50 bg-yellow-500/10 text-yellow-300 text-[9px] font-mono uppercase tracking-wide leading-none"
                >
                  <KeyRound className="h-2.5 w-2.5" /> Geçici şifre
                </span>
              )}
            </div>
            <div
              className={`hud-text ${meta.color}`}
              data-testid={`admin-role-badge-${u.username}`}
            >
              {u.is_owner ? "KURUCU" : meta.label}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              if (isMe) return;
              try {
                await impersonate(u.id);
                toast.success(`${u.username} hesabı görüntüleniyor`);
                if (onClose) onClose();
              } catch (e) {
                toast.error("Görüntülenemedi");
              }
            }}
            disabled={isMe || !canImpersonate}
            data-testid={`admin-view-${u.username}`}
            title="Hesaba gir ve görevlerini gör"
            className="p-1.5 border border-yellow-400/40 text-yellow-300 hover:bg-yellow-500/10 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => editCompany(u)}
            disabled={isAdmin}
            data-testid={`admin-company-${u.username}`}
            title={
              isAdmin
                ? "Yöneticilerde şirket ataması yok"
                : u.company_name
                ? `Şirket: ${u.company_name} — tıkla değiştir`
                : "Şirket ata (İş Ekibi elemanı yap)"
            }
            className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded relative disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Building2 className="h-3.5 w-3.5" />
            {u.company_name && (
              <span
                className="absolute -top-1 -right-1 bg-sertex-cyan text-sertex-bg text-[7px] leading-none px-1 py-0.5 rounded-sm font-mono max-w-[54px] truncate"
                data-testid={`admin-company-badge-${u.username}`}
              >
                {u.company_name.length > 6 ? u.company_name.slice(0, 6) + "…" : u.company_name}
              </span>
            )}
          </button>
          <button
            onClick={() => editQuota(u)}
            disabled={isAdmin}
            data-testid={`admin-quota-${u.username}`}
            title={
              isAdmin
                ? "Yöneticilerde per-user kapasite geçerli değil (sistem kotası kullanılır)"
                : u.custom_quota_mb
                ? `Özel kapasite: ${(u.custom_quota_mb / 1024).toFixed(u.custom_quota_mb % 1024 === 0 ? 0 : 2)} GB — tıkla düzenle`
                : "Kapasiteyi elle ayarla (lisans varsayılanını geçersiz kılar)"
            }
            className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded relative disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <HardDrive className="h-3.5 w-3.5" />
            {u.custom_quota_mb ? (
              <span
                className="absolute -top-1 -right-1 bg-sertex-cyan text-sertex-bg text-[7px] leading-none px-1 py-0.5 rounded-sm font-mono"
                data-testid={`admin-quota-badge-${u.username}`}
              >
                {u.custom_quota_mb >= 1024
                  ? `${(u.custom_quota_mb / 1024).toFixed(u.custom_quota_mb % 1024 === 0 ? 0 : 1)}G`
                  : `${u.custom_quota_mb}M`}
              </span>
            ) : null}
          </button>
          <button
            onClick={() => toggleRole(u)}
            disabled={isMe || isProtected}
            data-testid={`admin-toggle-role-${u.username}`}
            title={isProtected ? "Süper yönetici / kurucu rolü buradan değiştirilemez" : `Sonraki rol: ${ROLE_META[nextRole]?.label || nextRole}`}
            className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Shield className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setResetting(resetting === u.id ? null : u.id);
              setResetPw("");
            }}
            data-testid={`admin-reset-${u.username}`}
            title="Şifre sıfırla"
            className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
          >
            <KeyRound className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => openManagerAssign(u)}
            data-testid={`admin-managers-${u.username}`}
            title="Müdürleri ata"
            className="p-1.5 border border-purple-400/40 text-purple-300 hover:bg-purple-500/10 rounded"
          >
            <Briefcase className="h-3.5 w-3.5" />
          </button>
          {/* Faz 9 CP4.30 — user-level default lock policy */}
          <button
            onClick={() => setLockUser({ id: u.id, username: u.username, role: u.role })}
            data-testid={`admin-lock-${u.username}`}
            title="Varsayılan görev kilit politikası"
            className="p-1.5 border border-amber-400/40 text-amber-300 hover:bg-amber-500/10 rounded"
          >
            <Lock className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => removeUser(u)}
            disabled={isMe || isProtected}
            data-testid={`admin-delete-${u.username}`}
            title={isProtected ? "Kurucu / süper yönetici silinemez" : "Sil"}
            className="p-1.5 border border-rose-400/40 text-rose-300 hover:bg-rose-500/10 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {resetting === u.id && (
        <div className="mt-2 pt-2 border-t border-sertex-cyan/15 flex gap-2">
          <input
            type="password"
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            placeholder="Yeni şifre (en az 6 karakter)"
            autoFocus
            data-testid={`admin-reset-input-${u.username}`}
            className="flex-1 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          />
          <button
            onClick={() => applyReset(u)}
            data-testid={`admin-reset-apply-${u.username}`}
            className="px-3 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text"
          >
            KAYDET
          </button>
        </div>
      )}

      {/* Per-user storage usage mini-bar (unchanged) */}
      {!isAdmin && u.quota_mb ? (() => {
        const pct = Math.max(0, Math.min(100, Number(u.quota_percent || 0)));
        const isDanger = pct >= 90;
        const isWarn = !isDanger && pct >= 75;
        const barCls = isDanger ? "bg-sertex-danger" : isWarn ? "bg-amber-400" : "bg-sertex-cyan";
        const txtCls = isDanger ? "text-sertex-danger" : isWarn ? "text-amber-300" : "text-sertex-cyan";
        const useGb = u.quota_mb >= 1024;
        const denom = useGb ? (u.quota_mb / 1024) : u.quota_mb;
        const numer = useGb ? (u.usage_mb / 1024) : u.usage_mb;
        const unit = useGb ? "GB" : "MB";
        const denomStr = Number.isInteger(denom) ? String(denom) : denom.toFixed(2);
        return (
          <div
            className="mt-2 pt-2 border-t border-sertex-cyan/10"
            data-testid={`admin-usage-${u.username}`}
            title={`${u.quota_label || ""} · ${u.usage_mb} MB / ${u.quota_mb} MB`}
          >
            <div className="flex items-center justify-between text-[10px] font-mono mb-1 gap-2">
              <span className="text-sertex-textMuted truncate">
                {u.quota_label || ""}
              </span>
              <span className={`${txtCls} shrink-0`} data-testid={`admin-usage-pct-${u.username}`}>
                {numer.toFixed(2)} / {denomStr} {unit} · %{pct.toFixed(1)}
              </span>
            </div>
            <div className="h-1 rounded-sm bg-sertex-cyan/10 overflow-hidden border border-sertex-cyan/15">
              <div
                data-testid={`admin-usage-bar-${u.username}`}
                className={`h-full ${barCls} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })() : null}
    </>
    );
  };

  const toggleRole = async (u) => {
    // Cycle: employee → manager → admin → employee.
    const currentRole = u.role || "employee";
    const newR = ROLE_CYCLE[currentRole] || "employee";
    try {
      await api.patch(`/admin/users/${u.id}`, { role: newR });
      toast.success(`${u.username} → ${ROLE_META[newR]?.label || newR}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Değiştirilemedi");
    }
  };

  // Faz 8 CP6 — 3 modlu silme: soft_orphan | hard | purge. Modal state.
  const [deleting, setDeleting] = useState(null); // { u, mode }
  const [deleteMode, setDeleteMode] = useState("soft_orphan");

  const openDelete = (u) => {
    setDeleting(u);
    setDeleteMode("soft_orphan");
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/admin/users/${deleting.id}?mode=${deleteMode}`);
      toast.success(`${deleting.username} silindi (${deleteMode})`);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const removeUser = openDelete; // legacy call sites open the modal instead

  const applyReset = async (u) => {
    if (resetPw.length < 6) {
      toast.error("Şifre en az 6 karakter");
      return;
    }
    try {
      await api.patch(`/admin/users/${u.id}`, { new_password: resetPw });
      toast.success(`${u.username} şifresi sıfırlandı`);
      setResetting(null);
      setResetPw("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Sıfırlanamadı");
    }
  };

  return (
    <div className="space-y-3" data-testid="user-management">
      <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[11px]">
        Yönetici olarak kullanıcı ekleyebilir, rol değiştirebilir, şifre sıfırlayabilir veya silebilirsiniz.
      </div>

      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          data-testid="admin-add-toggle"
          className="w-full py-2 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text flex items-center justify-center gap-2 transition-colors"
        >
          <UserPlus className="h-3.5 w-3.5" /> YENİ KULLANICI EKLE
        </button>
      ) : (
        <div className="space-y-2 glass-panel corner-bracket p-2 relative">
          <button
            onClick={() => setShowAdd(false)}
            className="absolute top-1 right-1 p-0.5 text-sertex-textMuted hover:text-sertex-cyan"
          >
            <X className="h-3 w-3" />
          </button>
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Kullanıcı adı (ör: ahmet)"
            autoFocus
            data-testid="admin-new-username"
            className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
          />
          {/* Faz 9 CP4.14 — password is optional. Admin may either type one
              manually (min 6 chars) or leave it off and let the backend
              generate a secure temp password that is copied to clipboard. */}
          <label
            className="flex items-center gap-2 text-[11px] font-mono text-sertex-textMuted cursor-pointer select-none"
            data-testid="admin-new-password-toggle-label"
          >
            <input
              type="checkbox"
              checked={setPasswordManually}
              onChange={(e) => {
                setSetPasswordManually(e.target.checked);
                if (!e.target.checked) setNewPassword("");
              }}
              data-testid="admin-new-password-toggle"
              className="accent-sertex-cyan"
            />
            <span>
              Şifreyi ben belirleyeyim{" "}
              <span className="text-sertex-textMuted/70">
                (kapalıysa otomatik üretilir)
              </span>
            </span>
          </label>
          {setPasswordManually && (
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Başlangıç şifresi (en az 6 karakter)"
              data-testid="admin-new-password"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setNewRole("employee")}
              data-testid="admin-role-employee"
              className={`flex-1 py-1.5 rounded-md hud-text border transition-colors ${
                newRole === "employee"
                  ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                  : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
              }`}
            >
              <UserIcon className="h-3 w-3 inline mr-1" /> ÇALIŞAN
            </button>
            <button
              onClick={() => setNewRole("manager")}
              data-testid="admin-role-manager"
              className={`flex-1 py-1.5 rounded-md hud-text border transition-colors ${
                newRole === "manager"
                  ? "border-purple-400 text-purple-300 bg-purple-500/10"
                  : "border-sertex-cyan/25 text-sertex-textMuted hover:text-purple-300"
              }`}
            >
              <Briefcase className="h-3 w-3 inline mr-1" /> MÜDÜR
            </button>
            <button
              onClick={() => setNewRole("admin")}
              data-testid="admin-role-admin"
              className={`flex-1 py-1.5 rounded-md hud-text border transition-colors ${
                newRole === "admin"
                  ? "border-yellow-400 text-yellow-300 bg-yellow-500/10"
                  : "border-sertex-cyan/25 text-sertex-textMuted hover:text-yellow-300"
              }`}
            >
              <Shield className="h-3 w-3 inline mr-1" /> YÖNETİCİ
            </button>
          </div>
          {newRole !== "admin" && (
            <div>
              <label className="block text-[10px] font-mono text-sertex-textMuted mb-1">
                LİSANS (opsiyonel — kullanıcıya otomatik atanır)
              </label>
              <select
                value={newLicense}
                onChange={(e) => setNewLicense(e.target.value)}
                className="w-full bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
                data-testid="admin-add-license"
              >
                <option value="">Lisans verme (kullanıcı sonra kod girer)</option>
                <option value="trial">Trial (30 gün)</option>
                <option value="monthly">Aylık</option>
                <option value="yearly">Yıllık</option>
                <option value="lifetime">Ömür Boyu</option>
              </select>
            </div>
          )}
          {newRole !== "admin" && (
            <div>
              <label className="block text-[10px] font-mono text-sertex-textMuted mb-1">
                <Building2 className="inline h-3 w-3 mr-1" />
                ŞİRKET — opsiyonel (İş Ekibi elemanıysa)
              </label>
              {newCompanyMode === "select" ? (
                <div className="flex gap-1">
                  <select
                    value={newCompany}
                    onChange={(e) => {
                      if (e.target.value === "__add_new__") {
                        setNewCompanyMode("custom");
                        setNewCompany("");
                      } else {
                        setNewCompany(e.target.value);
                      }
                    }}
                    className="flex-1 bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
                    data-testid="admin-add-company-select"
                  >
                    <option value="">— Bireysel (şirket yok) —</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value="__add_new__">+ Yeni şirket ekle...</option>
                  </select>
                </div>
              ) : (
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={newCompanyCustom}
                    onChange={(e) => setNewCompanyCustom(e.target.value)}
                    placeholder="Yeni şirket adı"
                    data-testid="admin-add-company-custom"
                    autoFocus
                    className="flex-1 bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-xs font-mono text-sertex-text placeholder:text-sertex-textMuted"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setNewCompanyMode("select");
                      setNewCompanyCustom("");
                    }}
                    data-testid="admin-add-company-cancel-custom"
                    className="px-2 border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/10 rounded text-[10px] font-mono"
                    title="Vazgeç"
                  >
                    ↩
                  </button>
                </div>
              )}
            </div>
          )}
          {newRole !== "admin" && (
            <div>
              <label className="block text-[10px] font-mono text-sertex-textMuted mb-1">
                KAPASİTE — opsiyonel (lisans varsayılanını geçersiz kılar)
              </label>
              <input
                type="text"
                value={newQuotaGb}
                onChange={(e) => setNewQuotaGb(e.target.value)}
                placeholder='Örn: "500 MB", "3 GB", boş = lisans varsayılanı'
                data-testid="admin-new-quota-gb"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
              />
              <div className="hud-text text-sertex-textMuted/70 mt-0.5">
                Birim yazmazsan GB kabul edilir · MB / GB / TB desteklenir
              </div>
            </div>
          )}
          <button
            onClick={addUser}
            disabled={saving}
            data-testid="admin-add-submit"
            className="w-full py-1.5 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text disabled:opacity-40 transition-colors"
          >
            EKLE
          </button>
        </div>
      )}

      <div className="hud-text text-sertex-cyan flex items-center justify-between gap-2 pt-2 border-t border-sertex-cyan/15">
        <div className="flex items-center gap-1">
          <Users className="h-3 w-3" /> MEVCUT KULLANICILAR ({users.length})
        </div>
        <div className="flex items-center gap-1" data-testid="user-view-toggle">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            data-testid="user-view-toggle-list"
            title="Şirketlere göre gruplanmış liste"
            className={`px-2 py-1 rounded border text-[10px] font-mono flex items-center gap-1 transition-colors ${
              viewMode === "list"
                ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
            }`}
          >
            <List className="h-3 w-3" /> LİSTE
          </button>
          <button
            type="button"
            onClick={() => setViewMode("matrix")}
            data-testid="user-view-toggle-matrix"
            title="Tüm çalışan-müdür atamaları — tek tabloda hızlı düzenle"
            className={`px-2 py-1 rounded border text-[10px] font-mono flex items-center gap-1 transition-colors ${
              viewMode === "matrix"
                ? "border-purple-400 text-purple-300 bg-purple-500/10"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-purple-300"
            }`}
          >
            <Grid3x3 className="h-3 w-3" /> ATAMA MATRİSİ
          </button>
        </div>
      </div>

      {viewMode === "list" && grouped.map(([groupKey, groupUsers]) => {
        const isNoCompany = groupKey === NO_COMPANY_KEY;
        const label = isNoCompany ? "BİREYSEL" : groupKey;
        const collapsed = !!collapsedCompanies[groupKey];
        return (
          <div
            key={groupKey}
            data-testid={`admin-company-group-${isNoCompany ? "none" : groupKey}`}
            className="border border-sertex-cyan/15 rounded-md bg-sertex-cyan/[0.02]"
          >
            <button
              type="button"
              onClick={() => setCollapsedCompanies((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))}
              data-testid={`admin-company-toggle-${isNoCompany ? "none" : groupKey}`}
              className="w-full flex items-center gap-2 px-3 py-2 hud-text text-sertex-cyan/80 hover:bg-sertex-cyan/5 transition-colors"
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {!isNoCompany && <Building2 className="h-3.5 w-3.5" />}
              <span className={isNoCompany ? "italic" : ""}>{label}</span>
              <span className="ml-auto text-sertex-textMuted">
                ({groupUsers.length} kişi)
              </span>
            </button>
            {!collapsed && (
              <div className="p-2 space-y-2">
                {groupUsers.map((u) => {
                  const isMe = u.id === currentUser?.id;
                  const isAdmin = u.role === "admin" || u.role === "super_admin" || u.is_owner;
                  return (
                    <div
                      key={u.id}
                      data-testid={`admin-user-${u.username}`}
                      className="p-2 border border-sertex-cyan/20 rounded-md bg-sertex-bg/40"
                    >{renderUserCardBody(u, isMe, isAdmin)}</div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {viewMode === "matrix" && (() => {
        // Non-admin users are the ones the admin can assign managers to.
        const employees = users.filter((u) => u.role !== "admin" && u.role !== "super_admin" && !u.is_owner);
        // Only true managers can be assigned as employee supervisors — admins
        // already have global visibility and the backend rejects them.
        const managers = users.filter((u) => u.role === "manager");
        const companyName = (cid, fallback) =>
          companies.find((c) => c.id === cid)?.name || fallback || "";
        const f = matrixFilter.trim().toLowerCase();
        // Union filter: text search AND (optional) company chip.
        const filteredEmployees = employees.filter((u) => {
          if (matrixCompanyFilter) {
            const empCid = u.company_id || (u.company_name ? null : NO_COMPANY_KEY);
            if (matrixCompanyFilter === NO_COMPANY_KEY) {
              // Bireysel grup: only users with no company_id AND no company_name.
              if (u.company_id || u.company_name) return false;
            } else if (empCid !== matrixCompanyFilter) {
              // Fallback for legacy users that only have company_name string —
              // match by name if the chip corresponds to a known company id.
              const chipName = companies.find((c) => c.id === matrixCompanyFilter)?.name;
              if (!chipName || u.company_name !== chipName) return false;
            }
          }
          if (f) {
            const cn = companyName(u.company_id, u.company_name).toLowerCase();
            if (!u.username.toLowerCase().includes(f) && !cn.includes(f)) return false;
          }
          return true;
        });
        // Companies actually represented among non-admin users (with counts).
        // Includes legacy string-only company_name entries plus a bireysel bucket.
        const companyCounts = new Map(); // key -> {label, count}
        for (const u of employees) {
          let key, label;
          if (u.company_id) {
            key = u.company_id;
            label = companies.find((c) => c.id === u.company_id)?.name || u.company_name || "?";
          } else if (u.company_name) {
            // Legacy string-only assignments (rare, but keep filterable).
            const matched = companies.find((c) => c.name.toLowerCase() === u.company_name.toLowerCase());
            key = matched?.id || `__legacy__:${u.company_name}`;
            label = u.company_name;
          } else {
            key = NO_COMPANY_KEY;
            label = "Bireysel";
          }
          const cur = companyCounts.get(key);
          if (cur) cur.count += 1;
          else companyCounts.set(key, { label, count: 1 });
        }
        const companyChips = Array.from(companyCounts.entries()).sort((a, b) => {
          if (a[0] === NO_COMPANY_KEY) return 1;
          if (b[0] === NO_COMPANY_KEY) return -1;
          return a[1].label.toLowerCase().localeCompare(b[1].label.toLowerCase(), "tr");
        });
        return (
          <div className="space-y-2" data-testid="assignment-matrix">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={matrixFilter}
                onChange={(e) => setMatrixFilter(e.target.value)}
                placeholder="Kullanıcı veya şirket ara..."
                data-testid="matrix-filter"
                className="flex-1 min-w-[160px] bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1 text-xs font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
              />
              <div className="hud-text text-sertex-textMuted text-[10px]">
                {filteredEmployees.length} / {employees.length} çalışan · {mvAll.length} atama
              </div>
              {mvLoading && (
                <span className="text-[10px] font-mono text-sertex-cyan animate-pulse">yükleniyor...</span>
              )}
            </div>

            {/* Faz 9 CP4.26 — Şirket chip'leri. Bir chip'e tıklayınca sadece o
                şirketin çalışanları görünür; tekrar tıklayınca kalkar. Her chip'in
                yanında ⚡ mini butonu = "Bu şirketteki herkesi seç" (bulk için). */}
            {companyChips.length > 1 && (
              <div
                className="flex items-center gap-1.5 flex-wrap"
                data-testid="matrix-company-chips"
              >
                <span className="hud-text text-sertex-textMuted/70 text-[10px] shrink-0">
                  ŞİRKET:
                </span>
                <button
                  type="button"
                  onClick={() => setMatrixCompanyFilter("")}
                  data-testid="matrix-chip-all"
                  className={`px-2 py-0.5 rounded-full border text-[10px] font-mono transition-colors ${
                    matrixCompanyFilter === ""
                      ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                      : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
                  }`}
                >
                  Tümü ({employees.length})
                </button>
                {companyChips.map(([key, meta]) => {
                  const isNoCompany = key === NO_COMPANY_KEY;
                  const active = matrixCompanyFilter === key;
                  // "Bu şirkettekileri seç" — respects the current text search too.
                  const selectAllInCompany = () => {
                    const inGroup = employees.filter((u) => {
                      if (isNoCompany) return !u.company_id && !u.company_name;
                      if (u.company_id === key) return true;
                      // Legacy: match by company_name string vs chip label.
                      if (!u.company_id && u.company_name === meta.label) return true;
                      // For __legacy__ keys, key includes label suffix.
                      if (String(key).startsWith("__legacy__:") && u.company_name === meta.label) return true;
                      return false;
                    });
                    if (inGroup.length === 0) return;
                    const next = new Set(selectedEmp);
                    inGroup.forEach((u) => next.add(u.id));
                    setSelectedEmp(next);
                    toast.success(`${meta.label}: ${inGroup.length} kişi seçildi`);
                  };
                  return (
                    <span
                      key={key}
                      data-testid={`matrix-chip-${isNoCompany ? "none" : meta.label}`}
                      className={`inline-flex items-stretch rounded-full border overflow-hidden ${
                        active
                          ? "border-purple-400 bg-purple-500/15"
                          : "border-sertex-cyan/25 hover:border-purple-400/60"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setMatrixCompanyFilter(active ? "" : key)
                        }
                        data-testid={`matrix-chip-toggle-${isNoCompany ? "none" : meta.label}`}
                        title={active ? "Filtreyi kaldır" : "Bu şirketi filtrele"}
                        className={`px-2 py-0.5 text-[10px] font-mono flex items-center gap-1 ${
                          active
                            ? "text-purple-100"
                            : "text-sertex-textMuted hover:text-purple-300"
                        }`}
                      >
                        {!isNoCompany && <Building2 className="h-2.5 w-2.5" />}
                        <span className={isNoCompany ? "italic" : ""}>{meta.label}</span>
                        <span className="text-sertex-textMuted/70">({meta.count})</span>
                      </button>
                      <button
                        type="button"
                        onClick={selectAllInCompany}
                        data-testid={`matrix-chip-select-${isNoCompany ? "none" : meta.label}`}
                        title={`Bu ${isNoCompany ? "gruptaki" : "şirketteki"} herkesi toplu atama için seç`}
                        className="px-1.5 border-l border-sertex-cyan/20 text-purple-200 hover:bg-purple-500/25"
                      >
                        ✓
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Faz 9 CP4.25 — Toplu atama bar. Only rendered when at least one
                employee row is ticked. Uses the same POST endpoint per row. */}
            {selectedEmp.size > 0 && (
              <div
                data-testid="bulk-assign-bar"
                className="flex items-center gap-2 flex-wrap px-2 py-1.5 rounded-md border border-purple-400/40 bg-purple-500/10"
              >
                <span className="hud-text text-purple-200 text-[10px] shrink-0">
                  {selectedEmp.size} seçili
                </span>
                <select
                  value={bulkMgrId}
                  onChange={(e) => setBulkMgrId(e.target.value)}
                  disabled={bulkBusy}
                  data-testid="bulk-assign-manager"
                  className="flex-1 min-w-[140px] bg-sertex-surface/60 border border-purple-400/40 rounded px-2 py-1 text-[11px] font-mono text-purple-100 disabled:opacity-40"
                >
                  <option value="">— Atanacak müdürü seç —</option>
                  {managers.map((m) => {
                    const mcName = companyName(m.company_id, m.company_name);
                    return (
                      <option key={m.id} value={m.id}>
                        {m.username}{mcName ? ` — ${mcName}` : ""}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  onClick={bulkGrant}
                  disabled={!bulkMgrId || bulkBusy}
                  data-testid="bulk-assign-apply"
                  className="px-3 py-1 rounded border border-purple-400 bg-purple-500/30 text-purple-100 hover:bg-purple-500/50 hud-text text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {bulkBusy ? "ATANIYOR..." : "TOPLU ATA"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEmp(new Set())}
                  disabled={bulkBusy}
                  data-testid="bulk-assign-clear"
                  className="px-2 py-1 rounded border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hud-text text-[10px] disabled:opacity-40"
                  title="Seçimi temizle"
                >
                  <X className="h-3 w-3 inline" />
                </button>
              </div>
            )}

            <div className="border border-sertex-cyan/20 rounded-md bg-sertex-cyan/[0.02] overflow-x-auto">
              <table className="w-full text-xs font-mono" data-testid="matrix-table">
                <thead>
                  <tr className="border-b border-sertex-cyan/20 text-sertex-cyan/80 hud-text">
                    <th className="text-left px-2 py-1.5 w-6">
                      <input
                        type="checkbox"
                        data-testid="matrix-select-all"
                        checked={filteredEmployees.length > 0 && filteredEmployees.every((u) => selectedEmp.has(u.id))}
                        onChange={(e) => {
                          const next = new Set(selectedEmp);
                          if (e.target.checked) {
                            filteredEmployees.forEach((u) => next.add(u.id));
                          } else {
                            filteredEmployees.forEach((u) => next.delete(u.id));
                          }
                          setSelectedEmp(next);
                        }}
                        title="Görünen tüm satırları seç"
                        className="accent-purple-500 cursor-pointer"
                      />
                    </th>
                    <th className="text-left px-2 py-1.5">ÇALIŞAN</th>
                    <th className="text-left px-2 py-1.5">ROL</th>
                    <th className="text-left px-2 py-1.5">ŞİRKET</th>
                    <th className="text-left px-2 py-1.5">MÜDÜRLER</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-sertex-textMuted normal-case">
                        {employees.length === 0 ? "Henüz çalışan yok" : "Aramaya uygun kayıt yok"}
                      </td>
                    </tr>
                  )}
                  {filteredEmployees.map((emp) => {
                    const empRows = mvAll.filter((r) => r.employee_user_id === emp.id);
                    const assignedIds = new Set(empRows.map((r) => r.manager_user_id));
                    const eligible = managers.filter((m) => m.id !== emp.id && !assignedIds.has(m.id));
                    const roleMeta = ROLE_META[emp.role in ROLE_META ? emp.role : "employee"];
                    const RowIcon = roleMeta.Icon;
                    const cName = companyName(emp.company_id, emp.company_name);
                    return (
                      <tr
                        key={emp.id}
                        data-testid={`matrix-row-${emp.username}`}
                        className={`border-b border-sertex-cyan/10 hover:bg-sertex-cyan/[0.03] ${
                          selectedEmp.has(emp.id) ? "bg-purple-500/[0.06]" : ""
                        }`}
                      >
                        <td className="px-2 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={selectedEmp.has(emp.id)}
                            onChange={(e) => {
                              const next = new Set(selectedEmp);
                              if (e.target.checked) next.add(emp.id);
                              else next.delete(emp.id);
                              setSelectedEmp(next);
                            }}
                            data-testid={`matrix-select-${emp.username}`}
                            className="accent-purple-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-2 py-2 align-top text-sertex-text">
                          <div className="flex items-center gap-1.5">
                            <RowIcon className={`h-3 w-3 ${roleMeta.color} shrink-0`} />
                            <span>{emp.username}</span>
                          </div>
                        </td>
                        <td className={`px-2 py-2 align-top hud-text ${roleMeta.color}`}>
                          {roleMeta.label}
                        </td>
                        <td className="px-2 py-2 align-top text-sertex-textMuted normal-case">
                          {cName || <span className="italic text-sertex-textMuted/60">bireysel</span>}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="flex flex-wrap items-center gap-1">
                            {empRows.length === 0 && (
                              <span className="text-[10px] text-sertex-textMuted italic normal-case">
                                atanmamış
                              </span>
                            )}
                            {empRows.map((row) => {
                              const mgr = users.find((u) => u.id === row.manager_user_id);
                              const busyKey = `${emp.id}:${row.manager_user_id}`;
                              const busy = !!mvBusy[busyKey];
                              return (
                                <span
                                  key={row.id}
                                  data-testid={`matrix-badge-${emp.username}-${mgr?.username || row.manager_user_id}`}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-purple-400/40 bg-purple-500/10 text-purple-200 text-[10px]"
                                >
                                  <Briefcase className="h-2.5 w-2.5" />
                                  <span>{mgr?.username || "?"}</span>
                                  <button
                                    type="button"
                                    onClick={() => matrixRevoke(row)}
                                    disabled={busy}
                                    data-testid={`matrix-remove-${emp.username}-${mgr?.username || row.manager_user_id}`}
                                    title="Kaldır"
                                    className="ml-0.5 text-purple-300 hover:text-rose-300 disabled:opacity-40"
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </span>
                              );
                            })}
                            {eligible.length > 0 && (
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) matrixGrant(emp.id, e.target.value);
                                  e.target.value = "";
                                }}
                                data-testid={`matrix-add-select-${emp.username}`}
                                className="bg-sertex-surface/60 border border-purple-400/40 hover:border-purple-400 rounded px-1 py-0.5 text-[10px] font-mono text-purple-200"
                                title="Müdür ekle"
                              >
                                <option value="">+ müdür ekle</option>
                                {eligible.map((m) => {
                                  const mcName = companyName(m.company_id, m.company_name);
                                  return (
                                    <option key={m.id} value={m.id}>
                                      {m.username}{mcName ? ` — ${mcName}` : ""}
                                    </option>
                                  );
                                })}
                              </select>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hud-text text-sertex-textMuted/70 text-[10px] normal-case">
              İpucu: Şirket chip'ine tıkla → sadece o şirketin çalışanları görünsün.
              Chip'in yanındaki <b>✓</b> ile şirketteki herkesi tek tıkla seç.
              Birden fazla satırı işaretle ve <b>TOPLU ATA</b> ile hepsine aynı müdürü ata.
              Değişiklikler anında kaydedilir.
            </div>
          </div>
        );
      })()}
      {deleting && (
        <div
          className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDeleting(null)}
          data-testid="delete-user-modal"
        >
          <div
            className="glass-panel corner-bracket p-4 max-w-md w-full space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hud-text text-rose-300 neon-glow flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> KULLANICI SİL
            </div>
            <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
              <span className="text-sertex-text font-semibold">{deleting.username}</span> için silme yöntemini seç:
            </div>
            <div className="space-y-2">
              <label
                className={`block p-2 rounded border cursor-pointer transition-colors ${
                  deleteMode === "soft_orphan"
                    ? "border-orange-400 bg-orange-500/10"
                    : "border-sertex-cyan/25 hover:border-orange-400/60"
                }`}
                data-testid="delete-mode-soft"
              >
                <input
                  type="radio" name="del-mode" value="soft_orphan" className="mr-2"
                  checked={deleteMode === "soft_orphan"}
                  onChange={() => setDeleteMode("soft_orphan")}
                />
                <span className="hud-text text-orange-300">Adını Koru (önerilen)</span>
                <div className="text-[10px] font-mono text-sertex-textMuted normal-case ml-5 mt-1">
                  Hesap silinir. Aktif görevler "Yarım Kalan İşler"e düşer.
                  Tamamlanmış görevlerde <b>ismi kalır</b> (tarihçe korunur).
                </div>
              </label>
              <label
                className={`block p-2 rounded border cursor-pointer transition-colors ${
                  deleteMode === "purge"
                    ? "border-rose-500 bg-rose-500/10"
                    : "border-sertex-cyan/25 hover:border-rose-500/60"
                }`}
                data-testid="delete-mode-purge"
              >
                <input
                  type="radio" name="del-mode" value="purge" className="mr-2"
                  checked={deleteMode === "purge"}
                  onChange={() => setDeleteMode("purge")}
                />
                <span className="hud-text text-rose-300">Tam Sil (KVKK)</span>
                <div className="text-[10px] font-mono text-sertex-textMuted normal-case ml-5 mt-1">
                  Hesap silinir. Aktif görevler orphan. Tüm görevlerden ismi
                  <b> tamamen temizlenir</b> (iz kalmaz).
                </div>
              </label>
              <label
                className={`block p-2 rounded border cursor-pointer transition-colors ${
                  deleteMode === "hard"
                    ? "border-rose-600 bg-rose-600/10"
                    : "border-sertex-cyan/25 hover:border-rose-600/60"
                }`}
                data-testid="delete-mode-hard"
              >
                <input
                  type="radio" name="del-mode" value="hard" className="mr-2"
                  checked={deleteMode === "hard"}
                  onChange={() => setDeleteMode("hard")}
                />
                <span className="hud-text text-rose-500">Nükleer Sil (dikkat!)</span>
                <div className="text-[10px] font-mono text-sertex-textMuted normal-case ml-5 mt-1">
                  Hesap + <b>tüm görevler</b> silinir. Geri alınamaz.
                </div>
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setDeleting(null)}
                data-testid="delete-cancel"
                className="flex-1 py-1.5 border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
              >
                İPTAL
              </button>
              <button
                onClick={confirmDelete}
                data-testid="delete-confirm"
                className={`flex-1 py-1.5 border rounded hud-text transition-colors ${
                  deleteMode === "hard"
                    ? "border-rose-600 text-rose-500 hover:bg-rose-600 hover:text-sertex-bg"
                    : deleteMode === "purge"
                    ? "border-rose-500 text-rose-300 hover:bg-rose-500 hover:text-sertex-bg"
                    : "border-orange-400 text-orange-300 hover:bg-orange-400 hover:text-sertex-bg"
                }`}
              >
                SİL
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Faz 9 CP4.23 — manager assignment modal */}
      {mgrEditing && (
        <div
          className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeManagerAssign}
          data-testid="manager-assign-modal"
        >
          <div
            className="w-full max-w-md bg-sertex-bg border border-sertex-cyan/40 rounded-lg p-4 space-y-3 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="hud-text text-sertex-cyan flex items-center gap-1">
                <Briefcase className="h-3 w-3" /> {mgrEditing.username} — MÜDÜRLERİ
              </div>
              <button onClick={closeManagerAssign} className="text-sertex-textMuted hover:text-sertex-cyan">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-[10px] font-mono text-sertex-textMuted">
              Bu çalışanı görebilecek/görev atayabilecek yöneticileri seç. Birden fazla müdür seçebilirsin.
            </div>
            <div className="max-h-[50vh] overflow-y-auto border border-sertex-cyan/15 rounded p-1 space-y-0.5">
              {users.filter((u) => u.role === "manager" || u.role === "admin").length === 0 && (
                <div className="text-[10px] text-sertex-textMuted p-2">Sistemde müdür/yönetici yok</div>
              )}
              {users.filter((u) => u.role === "manager" || u.role === "admin").map((mgr) => {
                const cName = companies.find((c) => c.id === mgr.company_id)?.name;
                const checked = mgrAssigned.has(mgr.id);
                return (
                  <label
                    key={mgr.id}
                    className="flex items-center gap-2 text-xs font-mono text-sertex-text px-1.5 py-1 hover:bg-sertex-cyan/5 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(mgrAssigned);
                        if (checked) next.delete(mgr.id);
                        else next.add(mgr.id);
                        setMgrAssigned(next);
                      }}
                      data-testid={`mgr-assign-checkbox-${mgr.username}`}
                      className="accent-purple-500"
                    />
                    <span className="flex-1">{mgr.username}</span>
                    <span className="text-[9px] text-sertex-textMuted uppercase">
                      {mgr.role === "admin" ? "yönetici" : "müdür"}
                    </span>
                    {cName && <span className="text-[9px] text-sertex-textMuted">{cName}</span>}
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={closeManagerAssign}
                className="flex-1 py-1.5 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded text-xs font-mono uppercase"
              >
                İptal
              </button>
              <button
                onClick={saveManagerAssign}
                disabled={mgrSaving}
                data-testid="manager-assign-save"
                className="flex-1 py-1.5 bg-purple-500/20 border border-purple-400/60 text-purple-200 hover:bg-purple-500/30 rounded text-xs font-mono uppercase disabled:opacity-40"
              >
                {mgrSaving ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Faz 9 CP4.30 — user-level default lock policy modal */}
      {lockUser && (
        <UserLockPolicyModal
          user={lockUser}
          currentUser={currentUser}
          onClose={() => setLockUser(null)}
        />
      )}
      {/* Faz 9 CP8.6 — Şirket atama modalı (window.prompt yerine koyu tema).
          Kullanıcı için mevcut şirket listesinden seçim veya serbest metin.
          Boş kaydetmek şirketten çıkarır. */}
      {companyEditState && (
        <>
          <div
            className="fixed inset-0 z-[110] bg-sertex-bg/70 backdrop-blur-sm"
            onClick={() => setCompanyEditState(null)}
            data-testid="admin-company-edit-backdrop"
          />
          <div className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none px-4">
            <div
              className="pointer-events-auto w-full max-w-[420px] glass-panel corner-bracket p-4 space-y-3"
              data-testid="admin-company-edit-modal"
            >
              <div className="flex items-center justify-between border-b border-sertex-cyan/20 pb-2">
                <div className="display-text text-sertex-cyan neon-glow tracking-[0.2em] flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  ŞİRKET ATA
                </div>
                <button
                  onClick={() => setCompanyEditState(null)}
                  className="p-1 hover:bg-sertex-cyan/10 rounded text-sertex-textMuted hover:text-sertex-cyan"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="hud-text text-sertex-textMuted">
                <span className="text-sertex-cyan">{companyEditState.user.username}</span>{" "}
                için şirket seç veya yeni bir tane yaz.
              </div>
              {companies.length > 0 && (
                <div>
                  <div className="hud-text text-sertex-textMuted mb-1">MEVCUT ŞİRKETLER</div>
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
                    {companies.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setCompanyEditState((s) => (s ? { ...s, value: c.name } : s))
                        }
                        data-testid={`admin-company-edit-chip-${c.name}`}
                        className={`px-2 py-1 rounded hud-text border transition-colors ${
                          companyEditState.value.trim().toLowerCase() === c.name.toLowerCase()
                            ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                            : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="hud-text text-sertex-textMuted mb-1">ŞİRKET ADI</div>
                <input
                  type="text"
                  value={companyEditState.value}
                  onChange={(e) =>
                    setCompanyEditState((s) => (s ? { ...s, value: e.target.value } : s))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCompanyEdit();
                    else if (e.key === "Escape") setCompanyEditState(null);
                  }}
                  placeholder="Örn: Ege — boş bırak: bireysel"
                  autoFocus
                  data-testid="admin-company-edit-input"
                  className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
                />
                <div className="hud-text text-sertex-textMuted text-[10px] mt-1">
                  Boş kaydet → bireysel (gruptan çıkar)
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-sertex-cyan/15">
                <button
                  onClick={() => setCompanyEditState(null)}
                  data-testid="admin-company-edit-cancel"
                  className="flex-1 py-2 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50 rounded-md hud-text transition-colors"
                >
                  İPTAL
                </button>
                <button
                  onClick={submitCompanyEdit}
                  data-testid="admin-company-edit-save"
                  className="flex-1 py-2 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text transition-colors"
                >
                  KAYDET
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default UserManagement;
