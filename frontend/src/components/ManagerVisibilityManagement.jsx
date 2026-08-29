import React, { useEffect, useMemo, useState } from "react";
import { Briefcase, ChevronDown, ChevronRight, Users } from "lucide-react";
import { toast } from "sonner";
import { api, managerVisibilityApi } from "../lib/api";

/**
 * Faz 8 · Admin-only "Müdür Yetkileri" tab.
 * ---------------------------------------------------------------------
 * For each user with role=manager, show a collapsible card listing every
 * non-admin user in the system with a checkbox: "Görebilsin mi?".
 *
 * Toggling the checkbox calls the manager-visibility CRUD endpoints.
 */
const ManagerVisibilityManagement = () => {
  const [users, setUsers] = useState([]);
  const [visibility, setVisibility] = useState([]); // all manager_visibility rows
  const [expanded, setExpanded] = useState(null);   // manager id currently open
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [uRes, mvRes] = await Promise.all([
        api.get("/admin/users"),
        managerVisibilityApi.list(),
      ]);
      setUsers(uRes.data || []);
      setVisibility(mvRes || []);
    } catch (e) {
      toast.error("Yükleme başarısız");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const managers = useMemo(() => users.filter((u) => u.role === "manager"), [users]);
  const employees = useMemo(() => users.filter((u) => u.role !== "admin" && u.role !== "super_admin" && !u.is_owner), [users]);

  const hasVis = (mgrId, empId) =>
    visibility.some((v) => v.manager_user_id === mgrId && v.employee_user_id === empId);

  const findVis = (mgrId, empId) =>
    visibility.find((v) => v.manager_user_id === mgrId && v.employee_user_id === empId);

  const toggle = async (mgrId, empId) => {
    const existing = findVis(mgrId, empId);
    try {
      if (existing) {
        await managerVisibilityApi.revoke(existing.id);
        toast.success("Yetki kaldırıldı");
      } else {
        await managerVisibilityApi.grant(mgrId, empId);
        toast.success("Yetki verildi");
      }
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "İşlem başarısız");
    }
  };

  if (loading) {
    return <div className="text-center text-sertex-textMuted hud-text py-6">Yükleniyor...</div>;
  }

  return (
    <div className="space-y-3" data-testid="manager-visibility-management">
      <div className="hud-text text-sertex-cyan flex items-center gap-1">
        <Briefcase className="h-3 w-3" /> MÜDÜRLER ({managers.length})
      </div>

      {managers.length === 0 && (
        <div className="text-center py-6 text-sertex-textMuted hud-text">
          Henüz müdür rolünde kullanıcı yok. Kullanıcılar sekmesinden bir kullanıcının
          rolünü "MÜDÜR" olarak ayarlayın.
        </div>
      )}

      {managers.map((mgr) => {
        const isOpen = expanded === mgr.id;
        const count = visibility.filter((v) => v.manager_user_id === mgr.id).length;
        return (
          <div
            key={mgr.id}
            data-testid={`manager-row-${mgr.username}`}
            className="border border-purple-400/25 rounded-md bg-purple-500/[0.03]"
          >
            <button
              onClick={() => setExpanded(isOpen ? null : mgr.id)}
              data-testid={`manager-expand-${mgr.username}`}
              className="w-full flex items-center gap-2 px-3 py-2 text-purple-300 hover:bg-purple-500/5 transition-colors"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Briefcase className="h-3.5 w-3.5" />
              <span className="text-sm font-mono">{mgr.username}</span>
              {mgr.company_name && (
                <span className="hud-text text-purple-300/70">{mgr.company_name}</span>
              )}
              <span className="ml-auto hud-text text-purple-300/70 flex items-center gap-1">
                <Users className="h-3 w-3" />
                {count} çalışan görebiliyor
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-purple-400/20 p-2 space-y-1">
                {employees.filter((e) => e.id !== mgr.id).length === 0 && (
                  <div className="text-xs text-sertex-textMuted italic">
                    Yetkilendirilecek başka kullanıcı yok.
                  </div>
                )}
                {employees.filter((e) => e.id !== mgr.id).map((emp) => {
                  const on = hasVis(mgr.id, emp.id);
                  return (
                    <label
                      key={emp.id}
                      data-testid={`visibility-row-${mgr.username}-${emp.username}`}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer transition-colors ${
                        on
                          ? "border-green-400/40 bg-green-500/10"
                          : "border-sertex-cyan/15 hover:border-sertex-cyan/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(mgr.id, emp.id)}
                        data-testid={`visibility-toggle-${mgr.username}-${emp.username}`}
                        className="accent-green-400"
                      />
                      <span className="text-xs font-mono text-sertex-text flex-1">
                        {emp.username}
                        {emp.role === "manager" && (
                          <span className="hud-text text-purple-300/70 ml-2">MÜDÜR</span>
                        )}
                      </span>
                      {emp.company_name && (
                        <span className="hud-text text-sertex-textMuted">{emp.company_name}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ManagerVisibilityManagement;
