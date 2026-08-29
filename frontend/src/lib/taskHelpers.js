// Faz 9 CP5 — Refactor: shared helpers extracted from TasksPanel.jsx.
// Behavior is BYTE-IDENTICAL to the original inline implementations.
// Do not add validation, side effects, or "improvements" here unless the
// call sites need them. This module is import-only from TasksPanel.jsx
// and its child modal components.

import { Check, Lock, Unlock, X, KeyRound, Trash2 } from "lucide-react";
import { LOCK_KEY_LABELS } from "./taskLocks";
import { playReminderChime } from "./reminderChime";

// Faz 8 CP5 — Whitelist of reminder-day overrides (task-level dropdowns).
// Kept identical to the backend allowlist to keep the UI honest.
export const REMINDER_DAY_CHOICES = [1, 2, 3, 5, 7, 14];

// Faz 9 CP4.27 — Task Lock system. Every context-menu action key that the
// backend guards against maps to its corresponding lock_flag. Actions not
// in this map are never blocked (e.g. edit modal open is a UI-only action).
export const ACTION_LOCK_MAP = {
  done: "lock_complete",
  paused: "lock_pause",
  pending: "lock_edit",
  overdue: "lock_mark_overdue",
  edit: "lock_edit",
  reassign: "lock_transfer",
  category: "lock_move_category",
  "reset-size": "lock_reset_size",
  reminder: "lock_reminder",
  "reminder-30m": "lock_reminder",
  "reminder-1h": "lock_reminder",
  "reminder-3h": "lock_reminder",
  "reminder-1d": "lock_reminder",
  "reminder-1w": "lock_reminder",
  "reminder-custom": "lock_reminder",
  "reminder-cancel": "lock_reminder",
  "due-soon": "lock_upcoming_alert",
  archive: "lock_archive",
  unarchive: "lock_archive",
  delete: "lock_delete",
};

// Faz 9 CP4.28 — Audit event meta (label + icon + color). Missing keys fall
// back to a neutral clock icon so unknown future events still render.
export const LOCK_AUDIT_EVENT_META = {
  lock_set:         { label: "Kilit ayarlandı",       icon: Lock,     color: "text-amber-300" },
  otp_issued:       { label: "OTP üretildi",           icon: KeyRound, color: "text-emerald-300" },
  otp_verified:     { label: "OTP doğrulandı",         icon: Unlock,   color: "text-emerald-300" },
  otp_consumed:     { label: "Kilit bypass edildi",    icon: Check,    color: "text-cyan-300" },
  otp_failed:       { label: "OTP hatası",             icon: X,        color: "text-rose-300" },
  otp_invalidated:  { label: "Önceki OTP iptal edildi", icon: X,       color: "text-sertex-textMuted" },
  task_deleted:     { label: "Görev silindi",          icon: Trash2,   color: "text-rose-300" },
};

// Compact human-readable payload for audit rows. Keeps the diff terse.
export const formatAuditPayload = (eventType, p) => {
  if (!p) return "";
  if (eventType === "lock_set") {
    const before = Object.keys(p.flags_before || {}).filter((k) => p.flags_before[k]);
    const after = Object.keys(p.flags_after || {}).filter((k) => p.flags_after[k]);
    const added = after.filter((k) => !before.includes(k));
    const removed = before.filter((k) => !after.includes(k));
    const parts = [];
    if (added.length) parts.push(`+ ${added.map((k) => LOCK_KEY_LABELS[k] || k).join(", ")}`);
    if (removed.length) parts.push(`− ${removed.map((k) => LOCK_KEY_LABELS[k] || k).join(", ")}`);
    return parts.join(" · ") || `${after.length} aktif kısıtlama`;
  }
  if (eventType === "otp_issued") return `→ ${p.issued_for_username || p.issued_for || "?"}`;
  if (eventType === "otp_verified") return "10 dk pencere açıldı";
  if (eventType === "otp_consumed") return `İşlem: ${p.action || "?"}`;
  if (eventType === "otp_failed") {
    const REASONS = { wrong_or_used: "yanlış / kullanılmış kod", expired: "süresi dolmuş", malformed: "hatalı format", malformed_expiry: "kayıt hatası" };
    return REASONS[p.reason] || p.reason || "";
  }
  if (eventType === "otp_invalidated") return `${p.count || 0} kod iptal (${p.reason || "?"})`;
  if (eventType === "task_deleted") return p.used_otp ? "(OTP ile)" : "";
  return "";
};

// Does the current user still have an active OTP unlock window on this task?
export const hasActiveUnlock = (task) => {
  if (!task) return false;
  const uses = Number(task.unlock_uses_remaining || 0);
  if (uses <= 0) return false;
  if (!task.unlock_expires_at) return false;
  try {
    return new Date(task.unlock_expires_at) > new Date();
  } catch { return false; }
};

// Anyone in this list is allowed to lock the task or issue OTPs:
// admin, the task creator, and (for team view) a manager who can see the
// assignee. Employee assignees are NOT included.
export const canManageLocks = (task, currentUser) => {
  if (!currentUser) return false;
  if (currentUser.role === "admin") return true;
  if (task.created_by && task.created_by === currentUser.id) return true;
  // Managers who can see the assignee — best-effort UI hint; backend enforces.
  if (currentUser.role === "manager") return true;
  return false;
};

// Returns true if the user is BLOCKED from doing `actionKey` right now.
export const isActionLocked = (task, actionKey, currentUser) => {
  const lockKey = ACTION_LOCK_MAP[actionKey];
  if (!lockKey) return false;
  const flags = task.lock_flags || {};
  if (!flags[lockKey]) return false;
  if (currentUser?.role === "admin") return false;
  if (task.created_by && task.created_by === currentUser?.id) return false;
  if (hasActiveUnlock(task)) return false;
  return true;
};

export const isOverdue = (task) => {
  if (task.status === "done" || task.status === "paused") return false;
  if (task.status === "overdue") return true;
  if (!task.due_date) return false;
  return new Date(task.due_date) < new Date();
};

// Faz 8 CP5 — resolve the effective threshold for a task via priority chain.
// Returns { disabled: true } | { days: n } | { days: null } (no threshold).
export const resolveThreshold = (task, cfg) => {
  if (task.reminder_disabled) return { disabled: true };
  if (typeof task.reminder_days === "number" && REMINDER_DAY_CHOICES.includes(task.reminder_days)) {
    return { days: task.reminder_days };
  }
  if (cfg && typeof cfg.effective === "number") return { days: cfg.effective };
  return { days: 3 };
};

// Faz 8 CP5 — compute due-soon layer for visual color.
// Returns "overdue" | "urgent" (koyu turuncu, ≤ threshold) |
// "soon" (açık turuncu, ≤ threshold × 2) | null (out of window / disabled).
export const dueSoonLayer = (task, cfg) => {
  if (isOverdue(task)) return null; // rose already handles overdue
  if (!task.due_date || task.status === "done" || task.status === "paused") return null;
  const t = resolveThreshold(task, cfg);
  if (t.disabled) return null;
  const days = t.days;
  const dueMs = new Date(task.due_date).getTime();
  const nowMs = Date.now();
  const daysUntil = Math.floor((dueMs - nowMs) / (24 * 3600 * 1000));
  if (daysUntil < 0) return null;
  if (daysUntil <= days) return "urgent";
  if (daysUntil <= days * 2) return "soon";
  return null;
};

export const statusStyle = (task, layer = null) => {
  if (task.status === "done") {
    return { border: "border-emerald-400/60", bg: "bg-emerald-500/15", accent: "text-emerald-300" };
  }
  if (task.status === "paused") {
    return { border: "border-yellow-400/60", bg: "bg-yellow-500/15", accent: "text-yellow-300" };
  }
  if (isOverdue(task)) {
    return { border: "border-rose-500/60", bg: "bg-rose-500/15", accent: "text-rose-300" };
  }
  // Faz 8 CP5 — due-soon layered orange coloring.
  if (layer === "urgent") {
    return { border: "border-orange-500/70", bg: "bg-orange-500/15", accent: "text-orange-300" };
  }
  if (layer === "soon") {
    return { border: "border-amber-400/50", bg: "bg-amber-500/8", accent: "text-amber-300" };
  }
  return {
    border: "border-sertex-cyan/25 hover:border-sertex-cyan/50",
    bg: "hover:bg-sertex-cyan/5",
    accent: "text-sertex-cyan",
  };
};

// Play a simple beep tone for reminder using Web Audio API.
// Faz 9 CP4.35 — returns a `{ cancel }` handle so callers can clear the
// queued 2nd-beep timeout + release the AudioContext early if they unmount
// before the natural ~1.2s lifecycle completes.
// Hatırlatma sesi — artık kalıcı (shared) AudioContext üzerinden JARVIS-vari
// bir chime çalar. Arka plan sekmede de güvenilir çalması için `reminderChime`
// modülüne delege edilir. `{ cancel }` dönüş şekli korunur (TasksPanel uyumu).
export const playReminderBeep = () => playReminderChime(0.3);
