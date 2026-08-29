// A single task CARD: checkbox toggle, title (with optional search
// highlight), a colored urgency accent bar, and a rich meta row — status,
// start/due dates (overdue/soon coloured), subtask progress bar, reminder
// indicator and assignee avatars. Mirrors the web task card.

import { Ionicons } from "@expo/vector-icons";
import { memo, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Task } from "@/src/api/types";
import {
  dueUrgency,
  formatDateTime,
  initials,
  statusMeta,
  subtaskCounts,
  taskDurationLabel,
} from "@/src/lib/format";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TASKS } from "@/constants/testIds";

type Props = {
  task: Task;
  busy?: boolean;
  highlight?: string;
  onToggle: (task: Task) => void;
  onPress?: (task: Task) => void;
  groupBadge?: GroupBadge;
};

export type GroupBadge = {
  name?: string | null;
  done: number;
  total: number;
  showProgress: boolean;
};

// Split the title around the (case-insensitive) search query and wrap
// matches in a highlighted <Text>.
function renderTitle(title: string, q?: string): ReactNode {
  const query = (q || "").trim();
  if (!query) return title;
  const lower = title.toLowerCase();
  const ql = query.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < title.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      out.push(title.slice(i));
      break;
    }
    if (idx > i) out.push(title.slice(i, idx));
    out.push(
      <Text key={key++} style={styles.hl}>
        {title.slice(idx, idx + query.length)}
      </Text>,
    );
    i = idx + query.length;
  }
  return out;
}

const TaskRowBase = ({ task, busy, highlight, onToggle, onPress, groupBadge }: Props) => {
  const done = task.status === "done";
  const meta = statusMeta(task.status);
  const start = formatDateTime(task.start_date);
  const due = formatDateTime(task.due_date);
  const completedAt = done ? formatDateTime(task.completed_at) : null;
  const durationLabel = done ? taskDurationLabel(task.created_at, task.completed_at) : null;
  const urgency = dueUrgency(task.due_date, task.status);
  const counts = subtaskCounts(task.subtasks);

  const assignees =
    task.assignees && task.assignees.length > 0
      ? task.assignees.map((a) => a.name || "?")
      : task.assignee_name
        ? [task.assignee_name]
        : [];

  const hasReminder =
    !task.reminder_disabled &&
    (!!task.reminder_at || task.reminder_days != null);
  const recurring = (task.reminder_repeat_total ?? 0) > 0;

  const dueColor = urgency.overdue
    ? colors.danger
    : urgency.soon
      ? colors.warning
      : colors.textMuted;

  const accent = done
    ? colors.success
    : urgency.overdue
      ? colors.danger
      : urgency.soon
        ? colors.warning
        : meta.color;

  return (
    <View style={styles.card} testID={`${TASKS.taskRow}-${task.id}`}>
      <View style={[styles.accent, { backgroundColor: accent }]} />

      <Pressable
        testID={`${TASKS.taskToggle}-${task.id}`}
        onPress={() => !busy && onToggle(task)}
        hitSlop={10}
        style={({ pressed }) => [styles.check, pressed && styles.pressed]}
      >
        <Ionicons
          name={done ? "checkmark-circle" : "ellipse-outline"}
          size={26}
          color={done ? colors.success : colors.textMuted}
        />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        onPress={() => onPress?.(task)}
      >
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
          {renderTitle(task.title, highlight)}
        </Text>

        <View style={styles.metaRow}>
          <View style={[styles.pill, { borderColor: meta.color }]}>
            <View style={[styles.dot, { backgroundColor: meta.color }]} />
            <Text style={[styles.pillText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>

          {!!start && (
            <View style={styles.metaItem} testID={`${TASKS.taskStart}-${task.id}`}>
              <Ionicons name="play-outline" size={12} color={colors.textMuted} />
              <Text style={styles.metaText}>{start}</Text>
            </View>
          )}

          {!!due && (
            <View style={styles.metaItem} testID={`${TASKS.taskDue}-${task.id}`}>
              <Ionicons
                name={urgency.overdue ? "alert-circle" : "calendar-outline"}
                size={12}
                color={dueColor}
              />
              <Text style={[styles.metaText, { color: dueColor }]}>{due}</Text>
            </View>
          )}

          {hasReminder && (
            <View style={styles.metaItem} testID={`${TASKS.taskReminder}-${task.id}`}>
              <Ionicons
                name={recurring ? "repeat" : "notifications-outline"}
                size={12}
                color={colors.secondary}
              />
            </View>
          )}

          {!!completedAt && (
            <View style={styles.metaItem} testID={`${TASKS.taskCompleted}-${task.id}`}>
              <Ionicons name="checkmark-done-circle-outline" size={12} color={colors.success} />
              <Text style={[styles.metaText, { color: colors.success }]}>{completedAt}</Text>
            </View>
          )}

          {!!durationLabel && (
            <View style={styles.durationPill} testID={`${TASKS.taskDuration}-${task.id}`}>
              <Ionicons name="time-outline" size={11} color={colors.success} />
              <Text style={styles.durationText}>{durationLabel}</Text>
            </View>
          )}

          {groupBadge && (
            <View style={styles.groupBadge} testID={`${TASKS.taskGroupBadge}-${task.id}`}>
              <Ionicons name="git-network-outline" size={11} color={colors.primary} />
              <Text style={styles.groupBadgeText} numberOfLines={1}>
                {groupBadge.name || "Bağlı"}
                {groupBadge.showProgress ? ` ${groupBadge.done}/${groupBadge.total}` : ""}
              </Text>
            </View>
          )}
        </View>

        {(counts || assignees.length > 0) && (
          <View style={styles.metaRow}>
            {counts && (
              <View style={styles.progressWrap}>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${(counts.done / counts.total) * 100}%` },
                    ]}
                  />
                </View>
                <Text style={styles.metaText}>
                  {counts.done}/{counts.total}
                </Text>
              </View>
            )}

            {assignees.length > 0 && (
              <View style={styles.avatars} testID={`${TASKS.taskAssignees}-${task.id}`}>
                {assignees.slice(0, 3).map((name, i) => (
                  <View key={i} style={[styles.avatar, i > 0 && styles.avatarStack]}>
                    <Text style={styles.avatarText}>{initials(name)}</Text>
                  </View>
                ))}
                {assignees.length > 3 && (
                  <Text style={styles.moreText}>+{assignees.length - 3}</Text>
                )}
              </View>
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
};

export const TaskRow = memo(TaskRowBase);

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingRight: spacing.sm,
    paddingLeft: spacing.sm + 4,
    marginTop: spacing.xs,
    overflow: "hidden",
  },
  accent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  check: { paddingTop: 1 },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: 6 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  titleDone: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  hl: {
    color: colors.primary,
    backgroundColor: "rgba(0, 240, 255, 0.18)",
    fontWeight: "800",
  },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, fontFamily: monoFont },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  durationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.35)",
    backgroundColor: "rgba(74,222,128,0.10)",
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  durationText: { color: colors.success, fontSize: 10, fontWeight: "700", fontFamily: monoFont },
  groupBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    maxWidth: 130,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: "rgba(0,240,255,0.06)",
  },
  groupBadgeText: { color: colors.primary, fontSize: 10, fontWeight: "700", fontFamily: monoFont },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  progressTrack: {
    width: 56,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  avatars: { flexDirection: "row", alignItems: "center", gap: 2 },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarStack: { marginLeft: -6 },
  avatarText: { color: colors.textSecondary, fontSize: 9, fontWeight: "800", fontFamily: monoFont },
  moreText: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont, marginLeft: 2 },
});
