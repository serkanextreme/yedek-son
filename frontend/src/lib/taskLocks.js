// Faz 9 CP4.30 — Shared task-lock constants. Used by both TasksPanel and
// UserManagement so the checkbox order + labels stay consistent between the
// task-level modal and the user-policy modal.

export const LOCK_KEY_LABELS = {
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

export const LOCK_KEY_ORDER = [
  "lock_edit", "lock_delete", "lock_complete", "lock_pause", "lock_mark_overdue",
  "lock_transfer", "lock_move_category", "lock_change_date", "lock_reminder",
  "lock_upcoming_alert", "lock_archive", "lock_subtask", "lock_reset_size",
];
