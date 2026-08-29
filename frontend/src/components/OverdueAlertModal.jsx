import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  X,
  BellOff,
  Bell,
  CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { tasksApi } from "../lib/api";
import { playAlarm, stopAlarm } from "../lib/alarmSounds";
import { CustomSnoozeInput } from "./tasks/CustomSnoozeInput";
import { formatDurationTr } from "../lib/reminderUtils";

const DISMISSED_KEY = "sertex_overdue_dismissed_v1";

const loadDismissed = () => {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

const saveDismissed = (set) => {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch (e) { console.warn("[OverdueAlertModal.jsx] hata bastırıldı:", e); }
};

const isTaskOverdue = (t) => {
  if (!t) return false;
  if (t.status === "done" || t.status === "paused" || t.archived) return false;
  if (t.snoozed_until && new Date(t.snoozed_until) > new Date()) return false;
  if (t.status === "overdue") return true;
  if (!t.due_date) return false;
  return new Date(t.due_date) < new Date();
};

const humanTimePast = (iso) => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
};

const SNOOZE_OPTIONS = [
  { key: "5m", label: "5 dk", mins: 5 },
  { key: "30m", label: "30 dk", mins: 30 },
  { key: "1h", label: "1 saat", mins: 60 },
  { key: "1d", label: "1 gün", mins: 60 * 24 },
];

const OverdueAlertModal = () => {
  const [tasks, setTasks] = useState([]);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [open, setOpen] = useState(false);
  const previousIdsRef = useRef(new Set());
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const list = await tasksApi.list(false);
      setTasks(list);
    } catch {
      // silent — user may be offline / logged out
    }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 30000); // poll every 30s
    return () => clearInterval(timerRef.current);
  }, [load]);

  const overdueTasks = useMemo(
    () => tasks.filter(isTaskOverdue).filter((t) => !dismissed.has(t.id)),
    [tasks, dismissed]
  );

  // Detect newly-overdue tasks → open + beep
  useEffect(() => {
    const currentIds = new Set(overdueTasks.map((t) => t.id));
    const previous = previousIdsRef.current;
    const isNew = [...currentIds].some((id) => !previous.has(id));
    if (overdueTasks.length > 0 && isNew) {
      setOpen(true);
      playAlarm();
    }
    if (overdueTasks.length === 0) {
      setOpen(false);
      stopAlarm();
    }
    previousIdsRef.current = currentIds;
  }, [overdueTasks]);

  const dismissOne = (id) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  };

  const snooze = async (task, mins) => {
    const iso = new Date(Date.now() + mins * 60000).toISOString();
    try {
      await tasksApi.snooze(task.id, iso);
      toast.success(`"${task.title}" — ${formatDurationTr(mins)} sonra tekrar hatırlatılacak`);
      load();
    } catch {
      toast.error("Erteleme başarısız");
    }
  };

  const markDone = async (task) => {
    try {
      await tasksApi.setStatus(task.id, "done");
      toast.success(`"${task.title}" tamamlandı`);
      load();
    } catch {
      toast.error("Tamamlanamadı");
    }
  };

  const dismissAll = () => {
    setDismissed((prev) => {
      const next = new Set(prev);
      overdueTasks.forEach((t) => next.add(t.id));
      saveDismissed(next);
      return next;
    });
    setOpen(false);
    stopAlarm();
  };

  const snoozeAll = async (mins) => {
    const iso = new Date(Date.now() + mins * 60000).toISOString();
    try {
      await Promise.all(overdueTasks.map((t) => tasksApi.snooze(t.id, iso)));
      toast.success(`Tüm gecikmiş görevler ${formatDurationTr(mins)} sonra ertelendi`);
      load();
    } catch {
      toast.error("Toplu erteleme başarısız");
    }
  };

  if (!open || overdueTasks.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        data-testid="overdue-alert-overlay"
      >
        <motion.div
          initial={{ scale: 0.92, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.92, y: 20, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className="relative w-full max-w-lg glass-panel border border-rose-400/50 rounded-lg shadow-[0_0_40px_rgba(244,63,94,0.35)] overflow-hidden"
          data-testid="overdue-alert-modal"
        >
          {/* pulsing top border */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-rose-400 to-transparent animate-pulse" />

          {/* Header */}
          <div className="px-4 py-3 border-b border-rose-400/25 flex items-center justify-between bg-rose-500/5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-full bg-rose-500/15 border border-rose-400/40">
                <AlertTriangle className="h-4 w-4 text-rose-300" />
              </div>
              <div>
                <div className="display-text text-rose-300 tracking-[0.15em] text-sm">
                  SÜRESİ GEÇMİŞ GÖREV
                </div>
                <div className="text-[10px] font-mono text-rose-200/60">
                  {overdueTasks.length} görev bekliyor efendim
                </div>
              </div>
            </div>
            <button
              onClick={dismissAll}
              className="text-sertex-textMuted hover:text-sertex-text transition-colors"
              data-testid="overdue-alert-close"
              title="Bu oturum için kapat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Task list */}
          <div className="max-h-[60vh] overflow-y-auto scrollbar-sertex divide-y divide-rose-400/10">
            {overdueTasks.map((task) => (
              <div
                key={task.id}
                data-testid={`overdue-task-${task.id}`}
                className="px-4 py-3 hover:bg-rose-500/5 transition-colors"
              >
                <div className="flex items-start gap-2 mb-2">
                  <CalendarClock className="h-3.5 w-3.5 text-rose-300 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-sertex-text font-mono">
                      {task.title}
                    </div>
                    {task.description && (
                      <div className="text-[11px] text-sertex-textMuted font-mono mt-0.5 line-clamp-2">
                        {task.description}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-rose-300 mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {task.due_date && (
                        <>
                          {new Date(task.due_date).toLocaleString("tr-TR", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          · {humanTimePast(task.due_date)}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pl-5">
                  <button
                    onClick={() => markDone(task)}
                    data-testid={`overdue-done-${task.id}`}
                    className="px-2 py-1 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10 rounded text-[10px] font-mono flex items-center gap-1 transition-colors"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Tamamlandı
                  </button>
                  {SNOOZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => snooze(task, opt.mins)}
                      data-testid={`overdue-snooze-${opt.key}-${task.id}`}
                      className="px-2 py-1 border border-sertex-cyan/30 text-sertex-cyan/90 hover:bg-sertex-cyan/10 rounded text-[10px] font-mono flex items-center gap-1 transition-colors"
                    >
                      <Bell className="h-3 w-3" /> {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => dismissOne(task.id)}
                    data-testid={`overdue-dismiss-${task.id}`}
                    className="px-2 py-1 border border-sertex-textMuted/30 text-sertex-textMuted hover:text-sertex-text hover:border-sertex-textMuted/60 rounded text-[10px] font-mono flex items-center gap-1 transition-colors ml-auto"
                    title="Bu oturum için kapat"
                  >
                    <BellOff className="h-3 w-3" /> Kapat
                  </button>
                </div>
                <div className="flex items-center gap-1 pl-5 mt-1.5 flex-wrap">
                  <span className="text-[10px] font-mono text-sertex-textMuted">Özel süre:</span>
                  <CustomSnoozeInput
                    onApply={(min) => snooze(task, min)}
                    label="Ertele"
                    testPrefix={`overdue-custom-${task.id}`}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Footer bulk actions */}
          {overdueTasks.length > 1 && (
            <div className="px-4 py-2 border-t border-rose-400/20 bg-rose-500/5 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] font-mono text-rose-200/70">
                Toplu erteleme:
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {SNOOZE_OPTIONS.map((opt) => (
                  <button
                    key={`bulk-${opt.key}`}
                    onClick={() => snoozeAll(opt.mins)}
                    data-testid={`overdue-snooze-all-${opt.key}`}
                    className="px-2 py-1 border border-sertex-cyan/30 text-sertex-cyan/90 hover:bg-sertex-cyan/10 rounded text-[10px] font-mono transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  onClick={dismissAll}
                  data-testid="overdue-dismiss-all"
                  className="px-2 py-1 border border-sertex-textMuted/30 text-sertex-textMuted hover:text-sertex-text rounded text-[10px] font-mono transition-colors"
                >
                  Tümünü kapat
                </button>
              </div>
              <div className="w-full flex items-center gap-1 mt-1 flex-wrap">
                <span className="text-[10px] font-mono text-rose-200/70">Özel süre (toplu):</span>
                <CustomSnoozeInput
                  onApply={(min) => snoozeAll(min)}
                  label="Ertele"
                  testPrefix="overdue-custom-all"
                />
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default OverdueAlertModal;
