// Shared task-lock constants — mirrors the web `lib/taskLocks.js` so the
// checkbox order + Turkish labels stay identical between platforms.

import { Task } from "@/src/api/types";

export const LOCK_KEY_LABELS: Record<string, string> = {
  lock_complete: "Tamamlandı işaretleme",
  lock_pause: "Beklemeye alma",
  lock_mark_overdue: "Tarihi geçmiş işaretleme",
  lock_edit: "Düzenleme (başlık / açıklama)",
  lock_transfer: "Devret (başkasına aktar)",
  lock_move_category: "İş koluna taşıma",
  lock_reset_size: "Boyutu sıfırlama",
  lock_reminder: "Hatırlatma ayarları",
  lock_upcoming_alert: "Yaklaşan uyarısı",
  lock_archive: "Arşivleme",
  lock_delete: "Silme",
  lock_change_date: "Tarih değiştirme",
  lock_subtask: "Alt-görev ekleme / silme",
};

export const LOCK_KEY_ORDER: string[] = [
  "lock_edit",
  "lock_delete",
  "lock_complete",
  "lock_pause",
  "lock_mark_overdue",
  "lock_transfer",
  "lock_move_category",
  "lock_change_date",
  "lock_reminder",
  "lock_upcoming_alert",
  "lock_archive",
  "lock_subtask",
  "lock_reset_size",
];

// KVKK-friendly labels for the lock audit trail event types.
export const LOCK_AUDIT_LABELS: Record<string, string> = {
  lock_set: "Kilit güncellendi",
  self_lock_set: "Kişisel kilit güncellendi",
  otp_issued: "Şifre üretildi",
  otp_verified: "Şifreyle açıldı",
  otp_consumed: "Kilit atlandı",
  otp_failed: "Hatalı şifre denemesi",
  otp_invalidated: "Şifre iptal edildi",
  otp_rate_limited: "Çok fazla deneme",
  unlock_simple: "OTP'siz açıldı",
  task_deleted: "Görev silindi",
};

// Combined active locks (managed + self), de-duplicated, in canonical order.
export function activeLockLabels(task: Pick<Task, "lock_flags" | "self_lock_flags">) {
  const managed = task.lock_flags || {};
  const self = task.self_lock_flags || {};
  return LOCK_KEY_ORDER.filter((k) => managed[k] || self[k]).map((k) => ({
    key: k,
    label: LOCK_KEY_LABELS[k] || k,
    self: !managed[k] && !!self[k],
  }));
}

export function hasActiveUnlockWindow(task: Pick<Task, "unlock_expires_at" | "unlock_uses_remaining">): boolean {
  if (!task.unlock_expires_at) return false;
  if ((task.unlock_uses_remaining ?? 0) <= 0) return false;
  const exp = new Date(task.unlock_expires_at).getTime();
  return !isNaN(exp) && exp > Date.now();
}
