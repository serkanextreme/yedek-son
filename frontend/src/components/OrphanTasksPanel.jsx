import { confirmDialog } from "@/lib/confirm";
import React, { useEffect, useState } from "react";
import { AlertOctagon, Clock, RotateCcw, Trash2, Building2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { orphanTasksApi, tasksApi, teamApi } from "../lib/api";

/**
 * Faz 8 CP6 — "Yarım Kalan İşler" panel.
 *
 * When an employee is removed from a company (or their account is soft-deleted),
 * their active tasks in that company are flagged with `orphaned=True`. This
 * panel surfaces the orphan pool for managers + admin so they can reclaim
 * each task by reassigning it to another visible team member. Admin sees all
 * orphans across every company; a manager only sees orphans whose
 * `orphaned_from_company_id` is one of their own companies.
 */
const OrphanTasksPanel = ({ onDataChanged, refreshSignal = 0 }) => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);
  const [assigning, setAssigning] = useState(null); // task.id
  const [pickTarget, setPickTarget] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      orphanTasksApi.list().catch(() => []),
      teamApi.members().catch(() => []),
    ]).then(([list, members]) => {
      setTasks(list);
      setTeamMembers(members);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, [refreshSignal]);

  const reclaim = async (task) => {
    if (!pickTarget) {
      toast.error("Yeni sahibi seçin");
      return;
    }
    try {
      await tasksApi.reassign(task.id, pickTarget);
      toast.success(`Görev devralındı`);
      setAssigning(null);
      setPickTarget("");
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Devralınamadı");
    }
  };

  const discard = async (task) => {
    if (!(await confirmDialog({ message: `"${task.title}" görevini kalıcı olarak silmek istiyor musun?`, danger: true }))) return;
    try {
      await tasksApi.delete(task.id);
      toast.success("Görev silindi");
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error("Silinemedi");
    }
  };

  if (loading) {
    return (
      <div className="hud-text text-sertex-textMuted text-center py-6" data-testid="orphan-loading">
        Yükleniyor...
      </div>
    );
  }

  if (!tasks.length) {
    return (
      <div className="glass-panel corner-bracket p-4 text-center space-y-2" data-testid="orphan-empty">
        <div className="text-emerald-300 hud-text">✅ SİCİLİN TEMİZ</div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
          Şu an yarım kalmış görev yok. Bir çalışan şirketten çıkarıldığında görevleri buraya düşer.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="orphan-list">
      <div className="glass-panel p-2 border-rose-500/25 flex items-center gap-2">
        <AlertOctagon className="h-4 w-4 text-rose-400" />
        <div className="hud-text text-rose-300">
          {tasks.length} YARIM KALAN GÖREV
        </div>
      </div>
      {tasks.map((t) => (
        <div
          key={t.id}
          data-testid={`orphan-task-${t.id}`}
          className="p-2 border border-rose-500/30 rounded-md bg-rose-500/5 space-y-1.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-mono text-sertex-text flex-1">{t.title}</div>
            <button
              onClick={() => discard(t)}
              title="Görevi sil"
              data-testid={`orphan-discard-${t.id}`}
              className="text-sertex-textMuted hover:text-rose-400 shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px] flex flex-wrap items-center gap-1.5">
            {t.prev_assignee_name && (
              <span className="flex items-center gap-0.5">
                <UserIcon className="h-3 w-3" /> {t.prev_assignee_name}
              </span>
            )}
            {t.company_name && (
              <span className="flex items-center gap-0.5">
                <Building2 className="h-3 w-3" /> {t.company_name}
              </span>
            )}
            {t.due_date && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {new Date(t.due_date).toLocaleString("tr-TR", {
                  day: "2-digit", month: "short",
                })}
              </span>
            )}
            {t.orphaned_at && (
              <span className="text-rose-300">
                · {new Date(t.orphaned_at).toLocaleString("tr-TR", { day: "2-digit", month: "short" })} den beri sahipsiz
              </span>
            )}
          </div>
          {assigning === t.id ? (
            <div className="flex gap-1.5 items-center">
              <select
                value={pickTarget}
                onChange={(e) => setPickTarget(e.target.value)}
                data-testid={`orphan-target-${t.id}`}
                className="flex-1 bg-sertex-surface border border-sertex-cyan/25 rounded-md px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
              >
                <option value="">Yeni sahibi seç…</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.username}{m.company_name ? ` · ${m.company_name}` : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={() => reclaim(t)}
                data-testid={`orphan-reclaim-${t.id}`}
                className="px-2 py-1 border border-emerald-400 text-emerald-300 hover:bg-emerald-400 hover:text-sertex-bg rounded hud-text transition-colors"
              >
                DEVRET
              </button>
              <button
                onClick={() => { setAssigning(null); setPickTarget(""); }}
                className="px-2 py-1 border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAssigning(t.id)}
              data-testid={`orphan-open-${t.id}`}
              className="w-full py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded hud-text transition-colors flex items-center justify-center gap-1"
            >
              <RotateCcw className="h-3 w-3" /> BAŞKA ÇALIŞANA DEVRET
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default OrphanTasksPanel;
