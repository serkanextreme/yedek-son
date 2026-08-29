// Small formatting + status helpers for the tasks UI.

import { colors } from "@/src/theme/colors";

export function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}.${mm}.${yy}`;
}

// Full date + time — mirrors the web card format "08.11.2026 15:00".
export function formatDateTime(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
}

// Tamamlanma süresi (oluşturmadan bitişe) — web TaskCard ile birebir sözlük.
export function taskDurationLabel(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "anında";
  if (mins < 60) return `${mins} dakikada`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saatte`;
  const days = Math.floor(hours / 24);
  return `${days} günde`;
}

type StatusMeta = { label: string; color: string };

export function statusMeta(status: string): StatusMeta {
  switch (status) {
    case "done":
      return { label: "Tamamlandı", color: colors.success };
    case "overdue":
      return { label: "Gecikmiş", color: colors.danger };
    case "paused":
      return { label: "Duraklatıldı", color: colors.warning };
    case "in_progress":
      return { label: "Devam ediyor", color: colors.primary };
    case "pending":
    default:
      return { label: "Bekliyor", color: colors.secondary };
  }
}

export function subtaskProgress(
  subtasks: { done: boolean }[] | undefined,
): string | null {
  if (!subtasks || subtasks.length === 0) return null;
  const done = subtasks.filter((s) => s.done).length;
  return `${done}/${subtasks.length}`;
}

export function subtaskCounts(
  subtasks: { done: boolean }[] | undefined,
): { done: number; total: number } | null {
  if (!subtasks || subtasks.length === 0) return null;
  return { done: subtasks.filter((s) => s.done).length, total: subtasks.length };
}

export type DueUrgency = { overdue: boolean; soon: boolean };

// Mirrors the web card's urgency "layer": overdue (past due) or soon (<=2 days).
// Done tasks are never urgent.
export function dueUrgency(dueISO?: string | null, status?: string): DueUrgency {
  if (!dueISO || status === "done") return { overdue: false, soon: false };
  const due = new Date(dueISO).getTime();
  if (isNaN(due)) return { overdue: false, soon: false };
  const now = Date.now();
  if (due < now) return { overdue: true, soon: false };
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  return { overdue: false, soon: due - now <= twoDays };
}

// Two-letter initials from a display name / username, for assignee avatars.
export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Client-side id for newly-created subtasks (backend accepts any string id).
export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
