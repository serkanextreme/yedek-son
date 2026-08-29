import { confirmDialog } from "@/lib/confirm";
import React, { useEffect, useMemo, useState } from "react";
import { Tag, Plus, Pencil, Trash2, Check, X, Building2, Send, Lock, Users, ChevronRight, ChevronDown, FolderInput, FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { api, taskCategoriesApi, companiesApi, companyPermissionsApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isAdminLike } from "../lib/roles";
import { rollupCategoryStats, getDescendantIds, getCategoryPathLabel } from "../lib/categoryTree";
import { exportCategoryReportExcel, printCategoryReport } from "../lib/categoryExport";

/**
 * Faz 8 CP4 · Admin/manager "İş Kolları" tab.
 *  - Şirket kendi kollarını serbest tanımlar (Kargolama, Transfer, Fason vs.).
 *  - Employee sekmeyi göremez (SettingsPanel'de guard var).
 *  - Silme cascade: task.category_id o kategoriyi işaret ediyorsa temizlenir
 *    (backend $unset — kullanıcı görev'i kaybetmez, sadece etiket sıfırlanır).
 *
 * Faz 9 CP4.15 — şirket seçimi:
 *  - Admin: tüm şirketler arasından seçebilir.
 *  - Manager: kendi şirketi + `company_permissions.status='active'` olan
 *    hedef şirketler arasından seçebilir. Dropdown'da sadece izinli şirketler
 *    listelenir → izin verilmeyen şirket seçilmesi mümkün olmadığı için
 *    backend 403'e kullanıcı normalde çarpmaz.
 */
const NO_COMPANY_KEY = "__no_company__";
// İş kolu renk paleti (kendi rengini seç — 5b).
const CAT_COLORS = ["#22d3ee", "#34d399", "#f59e0b", "#f43f5e", "#a78bfa", "#60a5fa", "#f472b6", "#facc15", "#4ade80", "#fb923c"];

const TaskCategoriesManagement = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]); // [{id,name}] — only companies visible to caller
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // {id, name, color}
  const [newColor, setNewColor] = useState(null); // top-level create color
  const [expanded, setExpanded] = useState(() => new Set()); // açık düğüm id'leri
  const [addChildFor, setAddChildFor] = useState(null); // alt kol eklenen düğüm id
  const [childName, setChildName] = useState("");
  const [childColor, setChildColor] = useState(null);
  const [stats, setStats] = useState({}); // {catId: {total, done}} — doğrudan sayılar
  const [moveFor, setMoveFor] = useState(null); // taşınan kol id
  const [moveTarget, setMoveTarget] = useState(""); // "" = kök (ana seviye)

  const isAdmin = isAdminLike(user);
  const isManager = user?.role === "manager";

  // Faz 9 CP4.15 — cross-company permission request (manager only).
  // Populated with all companies + the manager's own set of pending/active
  // grants so the "İzin Talep Et" panel can filter out those already handled.
  const [allCompanies, setAllCompanies] = useState([]); // every company on the platform (manager can see this list)
  const [grants, setGrants] = useState([]);              // grants where viewer_company_id === own
  const [requestOpen, setRequestOpen] = useState(false); // toggle the request panel
  const [requestTarget, setRequestTarget] = useState(""); // company_id to request access to
  const [requesting, setRequesting] = useState(false);

  // Faz 9 CP4.23 — visibility modal state. `visEditing` holds the category
  // whose visibility is being edited. `allUsers` and `allCompanies` back
  // the two multi-selects.
  const [visEditing, setVisEditing] = useState(null); // {id, name, ...}
  const [visCompanyIds, setVisCompanyIds] = useState([]);
  const [visUserIds, setVisUserIds] = useState([]);
  const [visSaving, setVisSaving] = useState(false);
  const [allUsers, setAllUsers] = useState([]);

  const loadAllUsers = async () => {
    // Admin can list every user; managers list is limited server-side.
    if (!isAdmin && !isManager) return;
    try {
      const r = await api.get("/admin/users");
      setAllUsers(r.data || []);
    } catch {
      setAllUsers([]);
    }
  };

  const openVisibility = (row) => {
    setVisEditing(row);
    setVisCompanyIds(Array.isArray(row.visible_to_company_ids) ? [...row.visible_to_company_ids] : []);
    setVisUserIds(Array.isArray(row.visible_to_user_ids) ? [...row.visible_to_user_ids] : []);
    if (allUsers.length === 0) loadAllUsers();
  };

  const closeVisibility = () => {
    setVisEditing(null);
    setVisCompanyIds([]);
    setVisUserIds([]);
  };

  const saveVisibility = async () => {
    if (!visEditing) return;
    setVisSaving(true);
    try {
      // Owner company is always implicit — remove it from the extra list
      // so the DB doesn't store redundant entries.
      const extraCompanies = visCompanyIds.filter((cid) => cid !== visEditing.company_id);
      await taskCategoriesApi.update(visEditing.id, {
        visible_to_company_ids: extraCompanies,
        visible_to_user_ids: visUserIds,
      });
      toast.success(`${visEditing.name} görünürlük güncellendi`);
      loadCategories();
      closeVisibility();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setVisSaving(false);
    }
  };

  const toggleInList = (list, id) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const loadCategories = async () => {
    try {
      setRows(await taskCategoriesApi.list("manage"));
    } catch {
      toast.error("İş kolları yüklenemedi");
    }
    try {
      setStats(await taskCategoriesApi.stats());
    } catch {
      /* rapor yoksa mini-panel gizlenir */
    }
  };

  // Faz 9 CP4.15 — build the list of companies the caller may create
  // categories for. Admin sees everything; a manager sees their own
  // company plus every target company on an active cross-company grant.
  const loadCompanies = async () => {
    try {
      const all = await companiesApi.list();
      setAllCompanies(all);
      if (isAdmin) {
        setCompanies(all);
      } else if (isManager) {
        const own = user?.company_id;
        const grantList = await companyPermissionsApi.list().catch(() => []);
        setGrants(grantList || []);
        const permitted = new Set(
          (grantList || [])
            .filter((g) => g.viewer_company_id === own && (g.status || "active") === "active")
            .map((g) => g.target_company_id)
        );
        if (own) permitted.add(own);
        setCompanies(all.filter((c) => permitted.has(c.id)));
      } else {
        setCompanies([]);
      }
    } catch {
      setCompanies([]);
    }
  };

  useEffect(() => {
    loadCategories();
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preselect the caller's own company for managers, or the first company
  // for admins with a single option. Runs when the list arrives.
  useEffect(() => {
    if (selectedCompanyId) return;
    if (isManager && user?.company_id) {
      setSelectedCompanyId(user.company_id);
    } else if (companies.length === 1) {
      setSelectedCompanyId(companies[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  const create = async () => {
    const name = newName.trim();
    if (name.length < 2) { toast.error("Ad en az 2 karakter"); return; }
    // Admin/manager with >1 permitted company must pick one first.
    if (companies.length > 1 && !selectedCompanyId) {
      toast.warning("Önce iş kolunu ekleyeceğiniz şirketi seçin");
      return;
    }
    setSaving(true);
    try {
      await taskCategoriesApi.create(name, newColor || null, selectedCompanyId || null);
      setNewName("");
      setNewColor(null);
      const cname = companies.find((c) => c.id === selectedCompanyId)?.name;
      toast.success(cname ? `${name} eklendi · ${cname}` : `${name} eklendi`);
      loadCategories();
    } catch (e) {
      // Backend detail is Turkish; surface it as a friendly warning so the
      // raw "403" number never appears in the UI.
      const detail = e?.response?.data?.detail;
      const status = e?.response?.status;
      if (status === 403 || (detail && detail.startsWith("İzniniz yok"))) {
        toast.warning(detail || "İzniniz yok — bu şirket için iş kolu oluşturamazsınız");
      } else {
        toast.error(detail || "Eklenemedi");
      }
    } finally { setSaving(false); }
  };

  // Alt iş kolu oluştur (parent altında, aynı şirket).
  const createChild = async (parent) => {
    const name = childName.trim();
    if (name.length < 2) { toast.error("Ad en az 2 karakter"); return; }
    try {
      await taskCategoriesApi.create(name, childColor || null, parent.company_id, parent.id);
      toast.success(`${name} eklendi · ${parent.name} altına`);
      setChildName("");
      setChildColor(null);
      setAddChildFor(null);
      setExpanded((s) => new Set(s).add(parent.id));
      loadCategories();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Alt iş kolu eklenemedi");
    }
  };

  const toggleExpand = (id) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const startAddChild = (r) => {
    setAddChildFor(r.id);
    setChildName("");
    setChildColor(null);
    setExpanded((s) => new Set(s).add(r.id));
  };

  // İş kolunu başka üst kola / köke taşı (re-parent). Backend döngü + şirket
  // + ad-çakışması doğrulamalarını yapar; hata mesajını toast'a yansıtırız.
  const startMove = (r) => {
    setMoveFor(r.id);
    setMoveTarget(r.parent_id || "");
    setEditing(null);
    setAddChildFor(null);
  };

  const submitMove = async (r) => {
    try {
      await taskCategoriesApi.update(r.id, { parent_id: moveTarget || null });
      toast.success(moveTarget ? `${r.name} taşındı` : `${r.name} ana seviyeye alındı`);
      if (moveTarget) setExpanded((s) => new Set(s).add(moveTarget));
      setMoveFor(null);
      setMoveTarget("");
      loadCategories();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 403) toast.warning(detail || "İzniniz yok");
      else toast.error(detail || "Taşınamadı");
    }
  };

  const rename = async (id) => {
    const name = (editing?.name || "").trim();
    if (name.length < 2) { toast.error("Ad en az 2 karakter"); return; }
    try {
      await taskCategoriesApi.update(id, { name, color: editing?.color || null });
      toast.success("Güncellendi");
      setEditing(null);
      loadCategories();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 403) {
        toast.warning(detail || "İzniniz yok");
      } else {
        toast.error(detail || "Güncellenemedi");
      }
    }
  };

  const remove = async (r) => {
    const kidCount = rows.filter((x) => (x.parent_id || null) === r.id).length;
    const msg = kidCount > 0
      ? `${r.name} ve TÜM alt iş kolları (${kidCount}) silinsin mi?\nBu kollardaki görevlerin etiketi temizlenir (görev silinmez).`
      : `${r.name} silinsin mi?\nBu iş kolundaki görevlerin etiketi temizlenir (görev silinmez).`;
    if (!(await confirmDialog({ message: msg, danger: true }))) return;
    try {
      await taskCategoriesApi.delete(r.id);
      toast.success(`${r.name} silindi`);
      loadCategories();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 403) {
        toast.warning(detail || "İzniniz yok");
      } else {
        toast.error(detail || "Silinemedi");
      }
    }
  };

  // Group categories by company_id so admins/managers see who owns what.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.company_id || NO_COMPANY_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    const nameOf = (cid) => companies.find((c) => c.id === cid)?.name || "Bilinmeyen şirket";
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === NO_COMPANY_KEY) return 1;
      if (b === NO_COMPANY_KEY) return -1;
      return nameOf(a).localeCompare(nameOf(b), "tr");
    });
  }, [rows, companies]);

  const showCompanyPicker = companies.length > 1;

  // Kategori raporu dışa aktarma — Excel / Yazdır(PDF). Rakamlar rollup.
  const companyNameOf = (cid) =>
    cid === NO_COMPANY_KEY
      ? "Şirketsiz"
      : companies.find((c) => c.id === cid)?.name || "Bilinmeyen şirket";

  const handleExportExcel = () => {
    if (!rows.length) return toast.warning("Dışa aktarılacak iş kolu yok");
    try {
      exportCategoryReportExcel(grouped, stats, companyNameOf);
      toast.success("Excel raporu indirildi");
    } catch (e) {
      console.error("[TaskCategoriesManagement] Excel dışa aktarma hatası:", e);
      toast.error("Excel oluşturulamadı");
    }
  };

  const handleExportPdf = () => {
    if (!rows.length) return toast.warning("Dışa aktarılacak iş kolu yok");
    try {
      printCategoryReport(grouped, stats, companyNameOf);
    } catch (e) {
      toast.error(e?.message === "popup-blocked" ? "Açılır pencere engellendi — izin verin" : "Rapor oluşturulamadı");
    }
  };

  // İş kolu mini-rapor toplaması (rollup) — her kol kendisi + alt kollarını toplar.
  const rollup = useMemo(() => rollupCategoryStats(stats, rows), [stats, rows]);

  // Faz 9 CP4.15 — companies a manager doesn't yet have access to. Excludes
  // their own company plus any already-permitted or already-pending targets
  // so the "İzin Talep Et" picker only shows companies where a new request
  // is actionable. Admins skip this block entirely (they already own all).
  const requestableCompanies = useMemo(() => {
    if (!isManager || !user?.company_id) return [];
    const own = user.company_id;
    const handledTargets = new Set(
      grants
        .filter((g) => g.viewer_company_id === own && ["active", "pending"].includes(g.status || "active"))
        .map((g) => g.target_company_id)
    );
    return allCompanies.filter((c) => c.id !== own && !handledTargets.has(c.id));
  }, [isManager, user?.company_id, allCompanies, grants]);

  const submitPermissionRequest = async () => {
    if (!requestTarget) {
      toast.warning("Önce hedef şirketi seçin");
      return;
    }
    setRequesting(true);
    try {
      await companyPermissionsApi.request(user.company_id, requestTarget);
      const cname = allCompanies.find((c) => c.id === requestTarget)?.name || "Hedef şirket";
      toast.success(`İzin talebi gönderildi — ${cname} müdürünün onayı bekleniyor`);
      setRequestTarget("");
      setRequestOpen(false);
      // Refresh grants so the request disappears from the requestable list.
      loadCompanies();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Talep gönderilemedi");
    } finally {
      setRequesting(false);
    }
  };

  const renderNode = (r, groupRows, depth) => {
    const kids = groupRows
      .filter((x) => (x.parent_id || null) === r.id)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
    const hasKids = kids.length > 0;
    const isOpen = expanded.has(r.id);
    const dot = r.color || "#22d3ee";
    const st = rollup[r.id];
    return (
      <div key={r.id}>
        <div
          data-testid={`category-row-${r.name}`}
          className="flex items-center gap-2 border border-sertex-cyan/20 rounded-md bg-sertex-bg/40 p-2"
          style={{ marginLeft: depth * 18 }}
        >
          {hasKids ? (
            <button
              onClick={() => toggleExpand(r.id)}
              data-testid={`category-expand-${r.name}`}
              className="p-0.5 text-sertex-cyan/70 hover:text-sertex-cyan shrink-0"
              title={isOpen ? "Kapat" : "Aç"}
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dot }} />
          {editing?.id === r.id ? (
            <>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                autoFocus
                data-testid={`category-edit-input-${r.name}`}
                className="flex-1 bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
              />
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setEditing({ ...editing, color: null })} title="Renksiz" className={`h-4 w-4 rounded-full border flex items-center justify-center ${editing.color == null ? "border-sertex-cyan ring-1 ring-sertex-cyan" : "border-sertex-cyan/30"}`}><X className="h-2.5 w-2.5 text-sertex-textMuted" /></button>
                {CAT_COLORS.map((col) => (
                  <button key={col} type="button" onClick={() => setEditing({ ...editing, color: col })} title={col} className={`h-4 w-4 rounded-full border ${editing.color === col ? "ring-2 ring-white/70 border-white" : "border-black/20"}`} style={{ background: col }} />
                ))}
              </div>
              <button onClick={() => rename(r.id)} data-testid={`category-save-${r.name}`} className="p-1.5 border border-green-400/40 text-green-300 hover:bg-green-500/10 rounded"><Check className="h-3 w-3" /></button>
              <button onClick={() => setEditing(null)} className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"><X className="h-3 w-3" /></button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm font-mono text-sertex-text truncate">
                {r.name}
                {(r.visible_to_company_ids?.length > 0 || r.visible_to_user_ids?.length > 0) && (
                  <span className="ml-2 text-[9px] font-mono text-sertex-cyan/70">+{(r.visible_to_company_ids?.length || 0) + (r.visible_to_user_ids?.length || 0)} paylaşım</span>
                )}
              </span>
              {st && st.total > 0 && (
                <div
                  className="flex items-center gap-1.5 shrink-0"
                  data-testid={`category-rollup-${r.name}`}
                  title={`${st.done}/${st.total} tamamlandı · %${st.pct}${hasKids ? " (alt kollar dahil)" : ""}`}
                >
                  <div className="w-14 h-1.5 rounded-full bg-sertex-cyan/10 overflow-hidden">
                    <div className="h-full bg-emerald-400/80 transition-all" style={{ width: `${st.pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-sertex-textMuted tabular-nums">{st.done}/{st.total}</span>
                </div>
              )}
              <button onClick={() => startAddChild(r)} title="Alt iş kolu ekle" data-testid={`category-add-child-${r.name}`} className="p-1.5 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10 rounded"><Plus className="h-3 w-3" /></button>
              <button onClick={() => startMove(r)} title="Başka üst kola / köke taşı" data-testid={`category-move-${r.name}`} className="p-1.5 border border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/10 rounded"><FolderInput className="h-3 w-3" /></button>
              <button onClick={() => openVisibility(r)} title="Görünürlük ayarları" data-testid={`category-visibility-${r.name}`} className="p-1.5 border border-purple-400/40 text-purple-300 hover:bg-purple-500/10 rounded"><Lock className="h-3 w-3" /></button>
              <button onClick={() => setEditing({ id: r.id, name: r.name, color: r.color || null })} data-testid={`category-rename-${r.name}`} className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"><Pencil className="h-3 w-3" /></button>
              <button onClick={() => remove(r)} data-testid={`category-delete-${r.name}`} className="p-1.5 border border-sertex-danger/40 text-sertex-danger hover:bg-sertex-danger/10 rounded"><Trash2 className="h-3 w-3" /></button>
            </>
          )}
        </div>
        {addChildFor === r.id && (
          <div className="flex items-center gap-2 mt-1 mb-1" style={{ marginLeft: (depth + 1) * 18 }} data-testid={`category-add-child-form-${r.name}`}>
            <span className="hud-text text-emerald-300 shrink-0">↳ ALT:</span>
            <input
              type="text"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createChild(r); if (e.key === "Escape") setAddChildFor(null); }}
              autoFocus
              placeholder={`${r.name} altına yeni alt iş kolu`}
              data-testid={`category-child-name-${r.name}`}
              className="flex-1 bg-sertex-surface border border-emerald-400/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
            />
            <div className="flex items-center gap-1">
              {CAT_COLORS.slice(0, 6).map((col) => (
                <button key={col} type="button" onClick={() => setChildColor(col)} title={col} className={`h-4 w-4 rounded-full border ${childColor === col ? "ring-2 ring-white/70 border-white" : "border-black/20"}`} style={{ background: col }} />
              ))}
            </div>
            <button onClick={() => createChild(r)} data-testid={`category-child-save-${r.name}`} className="p-1.5 border border-emerald-400/60 text-emerald-300 hover:bg-emerald-500/15 rounded"><Check className="h-3 w-3" /></button>
            <button onClick={() => setAddChildFor(null)} className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"><X className="h-3 w-3" /></button>
          </div>
        )}
        {moveFor === r.id && (() => {
          const excluded = getDescendantIds(r.id, rows); // kendisi + tüm alt kolları
          const options = rows
            .filter((x) => x.company_id === r.company_id && !excluded.has(x.id))
            .sort((a, b) => getCategoryPathLabel(a.id, rows).localeCompare(getCategoryPathLabel(b.id, rows), "tr"));
          return (
            <div className="flex items-center gap-2 mt-1 mb-1" style={{ marginLeft: (depth + 1) * 18 }} data-testid={`category-move-form-${r.name}`}>
              <span className="hud-text text-cyan-300 shrink-0">↳ TAŞI:</span>
              <select
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
                data-testid={`category-move-select-${r.name}`}
                className="flex-1 bg-sertex-surface border border-cyan-400/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
              >
                <option value="">— Kök (ana seviye) —</option>
                {options.map((x) => (
                  <option key={x.id} value={x.id}>{getCategoryPathLabel(x.id, rows)}</option>
                ))}
              </select>
              <button onClick={() => submitMove(r)} data-testid={`category-move-save-${r.name}`} className="p-1.5 border border-cyan-400/60 text-cyan-300 hover:bg-cyan-500/15 rounded"><Check className="h-3 w-3" /></button>
              <button onClick={() => { setMoveFor(null); setMoveTarget(""); }} className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"><X className="h-3 w-3" /></button>
            </div>
          );
        })()}
        {hasKids && isOpen && kids.map((k) => renderNode(k, groupRows, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-3" data-testid="task-categories-management">
      <div className="flex items-center justify-between gap-2">
        <div className="hud-text text-sertex-cyan flex items-center gap-1">
          <Tag className="h-3 w-3" /> İŞ KOLLARI ({rows.length})
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExportExcel}
            disabled={!rows.length}
            title="Tamamlanma raporunu Excel olarak indir"
            data-testid="category-export-excel"
            className="flex items-center gap-1 px-2 py-1 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10 rounded text-[10px] font-mono uppercase disabled:opacity-40 transition-colors"
          >
            <FileSpreadsheet className="h-3 w-3" /> Excel
          </button>
          <button
            onClick={handleExportPdf}
            disabled={!rows.length}
            title="Tamamlanma raporunu yazdır / PDF"
            data-testid="category-export-pdf"
            className="flex items-center gap-1 px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded text-[10px] font-mono uppercase disabled:opacity-40 transition-colors"
          >
            <Printer className="h-3 w-3" /> PDF
          </button>
        </div>
      </div>
      {/* Faz 9 CP4.15 — company picker (visible when >1 company is available). */}
      {showCompanyPicker && (
        <div className="flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5 text-sertex-cyan/70 shrink-0" />
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            data-testid="category-company-picker"
            className="flex-1 bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1.5 text-xs font-mono text-sertex-text"
          >
            <option value="">— Şirket seç —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {isManager && c.id === user?.company_id ? " (kendi şirketiniz)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Faz 9 CP4.15 — cross-company permission request panel (manager only).
          Hidden when no additional companies remain (already permitted or pending). */}
      {isManager && requestableCompanies.length > 0 && (
        <div
          className="border border-purple-400/25 rounded-md bg-purple-500/[0.03] p-2 space-y-1.5"
          data-testid="permission-request-panel"
        >
          {!requestOpen ? (
            <button
              onClick={() => setRequestOpen(true)}
              data-testid="permission-request-toggle"
              className="w-full flex items-center gap-2 hud-text text-purple-300 hover:text-purple-200 transition-colors"
            >
              <Send className="h-3 w-3" />
              <span>Başka bir şirket için izin talep et</span>
              <span className="ml-auto text-purple-300/60 normal-case tracking-normal">
                ({requestableCompanies.length} müsait)
              </span>
            </button>
          ) : (
            <>
              <div className="hud-text text-purple-300 flex items-center gap-1">
                <Send className="h-3 w-3" /> İZİN TALEBİ
              </div>
              <div className="text-[10px] font-mono text-sertex-textMuted leading-snug">
                Seçtiğin şirketin müdürü onaylarsa, o şirket için de iş kolu oluşturabilir ve görevlerini görüntüleyebilirsin.
              </div>
              <div className="flex gap-2">
                <select
                  value={requestTarget}
                  onChange={(e) => setRequestTarget(e.target.value)}
                  data-testid="permission-request-target"
                  className="flex-1 bg-sertex-surface border border-purple-400/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
                >
                  <option value="">— Hedef şirket seç —</option>
                  {requestableCompanies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  onClick={submitPermissionRequest}
                  disabled={requesting || !requestTarget}
                  data-testid="permission-request-submit"
                  className="px-3 py-1 bg-purple-500/20 border border-purple-400/60 text-purple-200 hover:bg-purple-500/30 rounded text-[10px] font-mono uppercase disabled:opacity-40 transition-colors"
                >
                  GÖNDER
                </button>
                <button
                  onClick={() => { setRequestOpen(false); setRequestTarget(""); }}
                  data-testid="permission-request-cancel"
                  className="px-2 py-1 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded text-[10px] font-mono"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder="Yeni iş kolu adı (Kargolama, Transfer...)"
          data-testid="category-new-name"
          className="flex-1 bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1.5 text-xs font-mono text-sertex-text placeholder:text-sertex-textMuted"
        />
        <button
          onClick={create}
          disabled={saving || newName.trim().length < 2}
          data-testid="category-create-btn"
          className="px-3 py-1.5 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded hud-text disabled:opacity-40 transition-colors flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> EKLE
        </button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="category-new-colors">
        <span className="hud-text text-sertex-textMuted mr-1">Renk:</span>
        <button
          type="button"
          onClick={() => setNewColor(null)}
          title="Renksiz"
          className={`h-4 w-4 rounded-full border flex items-center justify-center ${newColor === null ? "border-sertex-cyan ring-1 ring-sertex-cyan" : "border-sertex-cyan/30"}`}
        >
          <X className="h-2.5 w-2.5 text-sertex-textMuted" />
        </button>
        {CAT_COLORS.map((col) => (
          <button
            key={col}
            type="button"
            onClick={() => setNewColor(col)}
            title={col}
            data-testid={`category-new-color-${col}`}
            className={`h-4 w-4 rounded-full border ${newColor === col ? "ring-2 ring-white/70 border-white" : "border-black/20"}`}
            style={{ background: col }}
          />
        ))}
      </div>
      {rows.length === 0 && (
        <div className="text-center py-6 text-sertex-textMuted hud-text border border-sertex-cyan/15 rounded-md">
          Henüz iş kolu yok. İlkini ekleyerek başla.
        </div>
      )}
      {grouped.map(([cid, groupRows]) => {
        const cname = cid === NO_COMPANY_KEY
          ? "BİLİNMEYEN"
          : (companies.find((c) => c.id === cid)?.name || "BİLİNMEYEN ŞİRKET");
        return (
          <div
            key={cid}
            data-testid={`category-company-group-${cid === NO_COMPANY_KEY ? "none" : cname}`}
            className="border border-sertex-cyan/15 rounded-md bg-sertex-cyan/[0.02]"
          >
            <div className="flex items-center gap-2 px-3 py-2 hud-text text-sertex-cyan/80 border-b border-sertex-cyan/10">
              <Building2 className="h-3 w-3" />
              <span>{cname}</span>
              <span className="ml-auto text-sertex-textMuted">({groupRows.length})</span>
            </div>
            <div className="p-2 space-y-1">
              {groupRows
                .filter((r) => !r.parent_id)
                .sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"))
                .map((r) => renderNode(r, groupRows, 0))}
            </div>
          </div>
        );
      })}
      {/* Faz 9 CP4.23 — visibility modal */}
      {visEditing && (
        <div
          className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeVisibility}
          data-testid="category-visibility-modal"
        >
          <div
            className="w-full max-w-md bg-sertex-bg border border-sertex-cyan/40 rounded-lg p-4 space-y-3 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="hud-text text-sertex-cyan flex items-center gap-1">
                <Lock className="h-3 w-3" /> {visEditing.name} — GÖRÜNÜRLÜK
              </div>
              <button onClick={closeVisibility} className="text-sertex-textMuted hover:text-sertex-cyan">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-[10px] font-mono text-sertex-textMuted">
              Sahibi şirket ({allCompanies.find((c) => c.id === visEditing.company_id)?.name || "?"}) her zaman görür.
            </div>
            {/* Companies section */}
            <div className="space-y-1">
              <div className="hud-text text-sertex-cyan/80 flex items-center gap-1">
                <Building2 className="h-3 w-3" /> EK GÖRECEK ŞİRKETLER
              </div>
              <div className="max-h-40 overflow-y-auto border border-sertex-cyan/15 rounded p-1 space-y-0.5">
                {allCompanies.filter((c) => c.id !== visEditing.company_id).length === 0 && (
                  <div className="text-[10px] text-sertex-textMuted p-1">Başka şirket yok</div>
                )}
                {allCompanies.filter((c) => c.id !== visEditing.company_id).map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-xs font-mono text-sertex-text px-1.5 py-1 hover:bg-sertex-cyan/5 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visCompanyIds.includes(c.id)}
                      onChange={() => setVisCompanyIds(toggleInList(visCompanyIds, c.id))}
                      data-testid={`category-vis-company-${c.name}`}
                      className="accent-purple-500"
                    />
                    <span className="flex-1">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* Users section */}
            <div className="space-y-1">
              <div className="hud-text text-sertex-cyan/80 flex items-center gap-1">
                <Users className="h-3 w-3" /> EK OLARAK GÖRECEK KİŞİLER
              </div>
              <div className="max-h-40 overflow-y-auto border border-sertex-cyan/15 rounded p-1 space-y-0.5">
                {allUsers.length === 0 && (
                  <div className="text-[10px] text-sertex-textMuted p-1">Yükleniyor…</div>
                )}
                {allUsers.map((u) => {
                  const cName = allCompanies.find((c) => c.id === u.company_id)?.name;
                  return (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 text-xs font-mono text-sertex-text px-1.5 py-1 hover:bg-sertex-cyan/5 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visUserIds.includes(u.id)}
                        onChange={() => setVisUserIds(toggleInList(visUserIds, u.id))}
                        data-testid={`category-vis-user-${u.username}`}
                        className="accent-purple-500"
                      />
                      <span className="flex-1">{u.username}</span>
                      {cName && (
                        <span className="text-[9px] text-sertex-textMuted">{cName}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={closeVisibility}
                className="flex-1 py-1.5 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded text-xs font-mono uppercase"
              >
                İptal
              </button>
              <button
                onClick={saveVisibility}
                disabled={visSaving}
                data-testid="category-visibility-save"
                className="flex-1 py-1.5 bg-purple-500/20 border border-purple-400/60 text-purple-200 hover:bg-purple-500/30 rounded text-xs font-mono uppercase disabled:opacity-40"
              >
                {visSaving ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskCategoriesManagement;
