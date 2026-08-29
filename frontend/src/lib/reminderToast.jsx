// Sertex — hatırlatma toast'ı (hızlı aksiyon butonlu).
//
// Hem TasksPanel (panel açıkken) hem ReminderWatcher (panel kapalı / arka
// plan) tarafından kullanılır — tek yerden tutarlı UX. Toast içinde çoklu
// erteleme seçeneği (5/15/30 dk · 1/3 saat) + "Tamamla" butonu vardır; böylece
// kullanıcı paneli açmadan bildirimin üstünden aksiyon alır.
//
// Aksiyon sonrası `sertex:reminder-action` global event'i yayılır → açık olan
// TasksPanel örnekleri listeyi tazeler.
import React from "react";
import { toast } from "sonner";
import { Sunrise } from "lucide-react";
import { tasksApi } from "./api";
import { CustomSnoozeInput } from "../components/tasks/CustomSnoozeInput";
import { formatDurationTr } from "./reminderUtils";

const SNOOZE_OPTIONS = [
  { label: "5 dk", min: 5 },
  { label: "15 dk", min: 15 },
  { label: "30 dk", min: 30 },
  { label: "1 saat", min: 60 },
  { label: "3 saat", min: 180 },
];

// Bir sonraki 09:00 (yerel). Şu an 09:00'dan önceyse bugün, sonraysa yarın.
const nextMorningIso = () => {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
};

const notifyRefresh = () => {
  try {
    window.dispatchEvent(new CustomEvent("sertex:reminder-action"));
  } catch {
    /* ok */
  }
};

const ReminderToastBody = ({ task, headline, dismiss }) => {
  const btnBase = "px-2 py-0.5 rounded border hud-text transition-colors";

  const snoozeTo = async (iso, label) => {
    try {
      // reminder_at + reminder_fired:false → tekrarlı ise interval/repeat
      // alanları korunur (yalnızca bir sonraki tetik zamanı değişir).
      await tasksApi.update(task.id, { reminder_at: iso, reminder_fired: false });
      toast.success(`Hatırlatma ertelendi (${label})`);
      dismiss();
      notifyRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Ertelenemedi");
    }
  };

  const complete = async () => {
    try {
      await tasksApi.setStatus(task.id, "done");
      toast.success("Görev tamamlandı");
      dismiss();
      notifyRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Tamamlanamadı");
    }
  };

  return (
    <div className="min-w-[248px]">
      <div className="font-mono text-sertex-cyan neon-glow mb-1">{headline}</div>
      <div className="font-mono text-sm">{task.title}</div>
      {task.description && (
        <div className="font-mono text-xs text-sertex-textMuted mt-1">{task.description}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="hud-text text-sertex-textMuted mr-0.5">ERTELE:</span>
        {SNOOZE_OPTIONS.map((o) => (
          <button
            key={o.min}
            type="button"
            onClick={() =>
              snoozeTo(new Date(Date.now() + o.min * 60 * 1000).toISOString(), o.label)
            }
            data-testid={`reminder-snooze-${o.min}-${task.id}`}
            className={`${btnBase} border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10`}
          >
            {o.label}
          </button>
        ))}
        {/* Akıllı kısayol — gece gelen hatırlatmayı ertesi sabaha taşı. */}
        <button
          type="button"
          onClick={() => snoozeTo(nextMorningIso(), "sabah 09:00")}
          data-testid={`reminder-snooze-morning-${task.id}`}
          className={`${btnBase} border-amber-400/40 text-amber-300 hover:bg-amber-400/10 flex items-center gap-1`}
        >
          <Sunrise className="h-3 w-3" />
          Sabah 09:00
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        <span className="hud-text text-sertex-textMuted">ÖZEL:</span>
        <CustomSnoozeInput
          onApply={(min) =>
            snoozeTo(new Date(Date.now() + min * 60 * 1000).toISOString(), formatDurationTr(min))
          }
          testPrefix={`reminder-custom-${task.id}`}
        />
      </div>
      <button
        type="button"
        onClick={complete}
        data-testid={`reminder-complete-${task.id}`}
        className={`${btnBase} mt-1.5 w-full border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10 flex items-center justify-center gap-1`}
      >
        ✓ Tamamla
      </button>
    </div>
  );
};

// Parent-task hatırlatma toast'ını gösterir (hızlı aksiyonlu).
export const showReminderToast = (task, headline = "🔔 HATIRLATMA") => {
  let id;
  const body = (
    <ReminderToastBody task={task} headline={headline} dismiss={() => toast.dismiss(id)} />
  );
  id = toast(body, { duration: 30000 });
  return id;
};
