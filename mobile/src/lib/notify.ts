// Notification presentation helpers (Turkish) + relative time formatting.

import { colors } from "@/src/theme/colors";

export function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} gün önce`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

type NotifMeta = { icon: string; color: string; label: string };

export function notificationMeta(
  type: string,
  daysUntilDue?: number | null,
): NotifMeta {
  switch (type) {
    case "overdue_task":
      return { icon: "alert-circle", color: colors.danger, label: "Gecikmiş görev" };
    case "due_soon_task": {
      const d = daysUntilDue ?? null;
      const label =
        d === 0 ? "Bugün son tarih" : d != null ? `${d} gün kaldı` : "Yaklaşan görev";
      return { icon: "time", color: colors.warning, label };
    }
    case "task_assigned":
    case "assigned":
      return { icon: "person-add", color: colors.primary, label: "Yeni görev atandı" };
    case "task_nudge":
    case "nudge":
      return { icon: "hand-left", color: colors.secondary, label: "Hatırlatma" };
    case "task_completed":
      return { icon: "checkmark-done", color: colors.success, label: "Görev tamamlandı" };
    case "super_admin_expiring":
      return { icon: "shield-half", color: colors.warning, label: "Süper yönetici süresi doluyor" };
    case "super_admin_expired":
      return { icon: "shield-checkmark", color: colors.primary, label: "Süper yönetici süresi doldu" };
    default:
      return { icon: "notifications", color: colors.textSecondary, label: "Bildirim" };
  }
}
