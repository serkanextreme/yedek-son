// Sertex — global (her zaman mount'lu) hatırlatma gözcüsü.
//
// Neden gerekli? Hatırlatma zamanlayıcısı eskiden yalnızca `TasksPanel`
// içindeydi; sidebar kapandığında veya başka bir sekmedeyken TasksPanel
// unmount olur ve tekrarlı hatırlatmalar HİÇ çalışmazdı. Bu bileşen
// SertexMain'de her zaman mount'lu kalır; böylece Sertex tarayıcı sekmesi
// arka plandayken bile masaüstü bildirimi + JARVIS-vari ses tetiklenir.
//
// Çift tetiklemeyi önlemek için: TasksPanel mount olduğunda global bir
// sayaç (`window.__sertexTaskPanels`) artırır. Sayaç > 0 iken (yani panel
// açıkken) bu gözcü PAS geçer — firing'i TasksPanel'in kendi zamanlayıcısı
// yapar (davranış birebir korunur). Panel kapalıyken gözcü devreye girer.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { tasksApi } from "../lib/api";
import { playReminderChime } from "../lib/reminderChime";
import { showReminderToast } from "../lib/reminderToast";

const WINDOW_MS = 5 * 60 * 1000; // reminder_at bu pencere içindeyse tetikle
const POLL_MS = 30000;

export const ReminderWatcher = ({ enabled }) => {
  const seenRef = useRef(new Set());

  useEffect(() => {
    if (!enabled) return;

    // Bildirim izni — kullanıcı henüz karar vermediyse iste (best-effort).
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    let alive = true;

    const notify = (title, body, tag) => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      try {
        const n = new Notification(title, { body, icon: "/favicon.ico", tag });
        n.onclick = () => {
          try {
            window.focus();
            n.close();
          } catch { /* ok */ }
        };
      } catch { /* ok */ }
    };

    const fireTask = async (t) => {
      showReminderToast(t);
      playReminderChime();
      const repeatLeft = t.reminder_repeat_left;
      const intervalMin = t.reminder_interval_min;
      const isRecurring = intervalMin && repeatLeft && repeatLeft > 1;
      notify(
        "SERTEX Hatırlatma",
        t.title + (t.description ? "\n" + t.description : ""),
        `sertex-${t.id}-${repeatLeft || 0}`
      );
      try {
        if (isRecurring) {
          const nextIso = new Date(Date.now() + intervalMin * 60 * 1000).toISOString();
          await tasksApi.rescheduleReminder(t.id, nextIso, repeatLeft - 1);
        } else {
          await tasksApi.markReminderFired(t.id);
        }
      } catch (e) {
        console.warn("[ReminderWatcher] reschedule hatası:", e);
      }
    };

    const fireSub = async (t, idx) => {
      const sub = t.subtasks?.[idx];
      if (!sub) return;
      toast(
        <div>
          <div className="font-mono text-sertex-cyan neon-glow mb-1">🔔 ALT GÖREV HATIRLATMA</div>
          <div className="font-mono text-xs text-sertex-textMuted">{t.title}</div>
          <div className="font-mono text-sm">↳ {sub.text}</div>
        </div>,
        { duration: 15000 }
      );
      playReminderChime();
      notify("SERTEX · Alt görev", `${t.title}\n↳ ${sub.text}`, `sertex-sub-${sub.id}`);
      const nextSubs = (t.subtasks || []).map((s, i) =>
        i === idx ? { ...s, reminder_fired: true } : s
      );
      try {
        await tasksApi.setSubtasks(t.id, nextSubs);
      } catch (e) {
        console.warn("[ReminderWatcher] alt görev güncelleme hatası:", e);
      }
    };

    const check = async () => {
      if (!alive) return;
      // Panel açıksa (herhangi bir TasksPanel örneği mount'luysa) firing'i
      // ona bırak — çift tetiklemeyi önler.
      if ((window.__sertexTaskPanels || 0) > 0) return;
      let tasks = [];
      try {
        tasks = await tasksApi.list();
      } catch {
        return;
      }
      if (!alive || !Array.isArray(tasks)) return;
      const now = Date.now();
      const seen = seenRef.current;
      for (const t of tasks) {
        if (t.archived) continue;
        if (t.reminder_at && !t.reminder_fired && t.status !== "done") {
          const when = new Date(t.reminder_at).getTime();
          const key = `${t.id}:${t.reminder_at}`;
          if (when <= now && when > now - WINDOW_MS && !seen.has(key)) {
            seen.add(key);
            await fireTask(t);
          }
        }
        const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
        subs.forEach((s, idx) => {
          if (!s.due_date || s.reminder_fired) return;
          if (s.done || s.status === "done" || s.status === "paused") return;
          const when = new Date(s.due_date).getTime();
          const key = `sub:${s.id}:${s.due_date}`;
          if (when <= now && when > now - WINDOW_MS && !seen.has(key)) {
            seen.add(key);
            fireSub(t, idx);
          }
        });
      }
      // seen set'i sınırla (kalıcı büyümeyi önle).
      if (seen.size > 300) {
        seenRef.current = new Set(Array.from(seen).slice(-150));
      }
    };

    check();
    const iv = setInterval(check, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);

  return null;
};

export default ReminderWatcher;
