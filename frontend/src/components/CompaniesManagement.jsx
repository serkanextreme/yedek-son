import { confirmDialog } from "@/lib/confirm";
import React, { useEffect, useState } from "react";
import { Building2, Plus, Pencil, Trash2, Check, X, Link2, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { companiesApi, companyPermissionsApi } from "../lib/api";

/**
 * Faz 8 · Admin-only "Şirketler" tab.
 * ---------------------------------------------------------------------
 *  - List / create / rename / delete companies (backend: /api/companies)
 *  - Per-company "hangi şirketleri görebilsin?" cross-company permission
 *    toggles (backend: /api/company-permissions).
 */
const CompaniesManagement = () => {
  const [companies, setCompanies] = useState([]);
  const [perms, setPerms] = useState([]);             // all company_permissions
  const [expanded, setExpanded] = useState(null);     // company id currently expanded
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null);       // {id, name}
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [c, p] = await Promise.all([
        companiesApi.list(),
        companyPermissionsApi.list(),
      ]);
      setCompanies(c || []);
      setPerms(p || []);
    } catch (e) {
      toast.error("Şirketler yüklenemedi");
    }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const name = newName.trim();
    if (name.length < 2) { toast.error("Şirket adı en az 2 karakter"); return; }
    setSaving(true);
    try {
      await companiesApi.create(name);
      setNewName("");
      toast.success(`${name} eklendi`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Eklenemedi");
    } finally { setSaving(false); }
  };

  const rename = async (id) => {
    const name = (editing?.name || "").trim();
    if (name.length < 2) { toast.error("Şirket adı en az 2 karakter"); return; }
    try {
      await companiesApi.update(id, name);
      toast.success(`${name} olarak güncellendi`);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Güncellenemedi");
    }
  };

  const remove = async (c) => {
    if (!(await confirmDialog({ message: `${c.name} silinsin mi?\nÜyeler varsa silme reddedilir.`, danger: true }))) return;
    try {
      await companiesApi.delete(c.id);
      toast.success(`${c.name} silindi`);
      if (expanded === c.id) setExpanded(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const togglePermission = async (viewerId, targetId) => {
    const existing = perms.find(
      (p) => p.viewer_company_id === viewerId && p.target_company_id === targetId,
    );
    try {
      if (existing && existing.status === "active") {
        await companyPermissionsApi.revoke(existing.id);
        toast.success("İzin kaldırıldı");
      } else if (existing && existing.status === "pending") {
        // Pending request → toggle back to revoked to cancel it.
        await companyPermissionsApi.revoke(existing.id);
        toast.success("İstek iptal edildi");
      } else {
        // Fresh request (admin gets instant active, manager gets pending).
        await companyPermissionsApi.request(viewerId, targetId);
        toast.success("İzin/istek kaydedildi");
      }
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "İşlem başarısız");
    }
  };

  const permStatus = (viewerId, targetId) => {
    const p = perms.find(
      (x) => x.viewer_company_id === viewerId && x.target_company_id === targetId,
    );
    return p?.status || null;
  };

  const hasPerm = (viewerId, targetId) =>
    perms.some((p) =>
      p.viewer_company_id === viewerId &&
      p.target_company_id === targetId &&
      (p.status || "active") === "active",
    );

  return (
    <div className="space-y-3" data-testid="companies-management">
      <div className="hud-text text-sertex-cyan flex items-center gap-1">
        <Building2 className="h-3 w-3" /> ŞİRKETLER ({companies.length})
      </div>

      {/* Create */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder="Yeni şirket adı"
          data-testid="companies-new-name"
          className="flex-1 bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1.5 text-xs font-mono text-sertex-text placeholder:text-sertex-textMuted"
        />
        <button
          onClick={create}
          disabled={saving || newName.trim().length < 2}
          data-testid="companies-create-btn"
          className="px-3 py-1.5 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded hud-text disabled:opacity-40 transition-colors flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> EKLE
        </button>
      </div>

      {companies.length === 0 && (
        <div className="text-center py-6 text-sertex-textMuted hud-text">
          Henüz şirket yok. İlkini ekleyin.
        </div>
      )}

      <div className="space-y-2">
        {companies.map((c) => (
          <div
            key={c.id}
            data-testid={`company-row-${c.name}`}
            className="border border-sertex-cyan/20 rounded-md bg-sertex-cyan/[0.02]"
          >
            <div className="flex items-center gap-2 p-2">
              <Building2 className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
              {editing?.id === c.id ? (
                <>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    autoFocus
                    data-testid={`company-edit-input-${c.name}`}
                    className="flex-1 bg-sertex-surface border border-sertex-cyan/30 rounded px-2 py-1 text-xs font-mono text-sertex-text"
                  />
                  <button
                    onClick={() => rename(c.id)}
                    data-testid={`company-save-${c.name}`}
                    className="p-1.5 border border-green-400/40 text-green-300 hover:bg-green-500/10 rounded"
                  ><Check className="h-3 w-3" /></button>
                  <button
                    onClick={() => setEditing(null)}
                    className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
                  ><X className="h-3 w-3" /></button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                    data-testid={`company-expand-${c.name}`}
                    className="flex-1 text-left text-sm font-mono text-sertex-text hover:text-sertex-cyan truncate"
                  >
                    {c.name}
                  </button>
                  <span className="hud-text text-sertex-textMuted/70">
                    {perms.filter((p) => p.viewer_company_id === c.id).length} izin
                  </span>
                  <button
                    onClick={() => setEditing({ id: c.id, name: c.name })}
                    data-testid={`company-rename-${c.name}`}
                    title="Yeniden adlandır"
                    className="p-1.5 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
                  ><Pencil className="h-3 w-3" /></button>
                  <button
                    onClick={() => remove(c)}
                    data-testid={`company-delete-${c.name}`}
                    title="Sil"
                    className="p-1.5 border border-sertex-danger/40 text-sertex-danger hover:bg-sertex-danger/10 rounded"
                  ><Trash2 className="h-3 w-3" /></button>
                </>
              )}
            </div>

            {/* Cross-company permission toggles */}
            {expanded === c.id && (
              <div
                className="border-t border-sertex-cyan/15 p-2 space-y-1"
                data-testid={`company-permissions-${c.name}`}
              >
                <div className="hud-text text-sertex-textMuted mb-1">
                  {c.name} müdürleri hangi şirketleri de görebilsin?
                </div>
                {companies.filter((x) => x.id !== c.id).length === 0 && (
                  <div className="text-xs text-sertex-textMuted italic">
                    Karşılıklı görülecek başka şirket yok.
                  </div>
                )}
                {companies.filter((x) => x.id !== c.id).map((other) => {
                  const st = permStatus(c.id, other.id);
                  const on = st === "active";
                  const pending = st === "pending";
                  return (
                    <button
                      key={other.id}
                      onClick={() => togglePermission(c.id, other.id)}
                      data-testid={`perm-toggle-${c.name}-to-${other.name}`}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded border transition-colors ${
                        on
                          ? "border-green-400/40 bg-green-500/10 text-green-300"
                          : pending
                          ? "border-yellow-400/40 bg-yellow-500/10 text-yellow-300"
                          : "border-sertex-cyan/20 text-sertex-textMuted hover:border-sertex-cyan/40 hover:text-sertex-cyan"
                      }`}
                    >
                      {on ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
                      <span className="text-xs font-mono flex-1 text-left">{other.name}</span>
                      <span className="hud-text">
                        {on ? "GÖRÜR" : pending ? "BEKLEMEDE" : "GÖRMÜYOR"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CompaniesManagement;
