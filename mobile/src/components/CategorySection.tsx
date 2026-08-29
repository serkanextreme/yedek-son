// Collapsible category section rendering its own tasks then nested
// sub-categories (recursive). Roll-up done/total badge shown in the header.

import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Task } from "@/src/api/types";
import { CatNode } from "@/src/lib/taskTree";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TASKS } from "@/constants/testIds";
import { GroupBadge, TaskRow } from "./TaskRow";

type Props = {
  node: CatNode;
  depth: number;
  expanded: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  onToggleTask: (task: Task) => void;
  onPressTask: (task: Task) => void;
  busyId: string | null;
  highlight?: string;
  groupBadges?: Record<string, GroupBadge>;
};

export const CategorySection = ({
  node,
  depth,
  expanded,
  onToggleExpand,
  onToggleTask,
  onPressTask,
  busyId,
  highlight,
  groupBadges,
}: Props) => {
  const isOpen = expanded[node.category.id] !== false; // default open
  const { rollup, category } = node;
  const color = category.color || colors.primary;

  return (
    <View style={[styles.wrap, depth > 0 && { marginLeft: spacing.md }]}>
      <Pressable
        testID={`${TASKS.categoryHeader}-${category.id}`}
        onPress={() => onToggleExpand(category.id)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Ionicons
          name={isOpen ? "chevron-down" : "chevron-forward"}
          size={16}
          color={colors.primary}
        />
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <Text style={styles.name} numberOfLines={1}>
          {category.name}
        </Text>
        <View style={styles.count}>
          <Text style={styles.countText}>
            {rollup.done}/{rollup.total}
          </Text>
        </View>
      </Pressable>

      {isOpen && (
        <View style={styles.content}>
          {node.tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              busy={busyId === t.id}
              highlight={highlight}
              onToggle={onToggleTask}
              onPress={onPressTask}
              groupBadge={groupBadges?.[t.id]}
            />
          ))}
          {node.children.map((child) => (
            <CategorySection
              key={child.category.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onToggleTask={onToggleTask}
              onPressTask={onPressTask}
              busyId={busyId}
              highlight={highlight}
              groupBadges={groupBadges}
            />
          ))}
          {node.tasks.length === 0 && node.children.length === 0 && (
            <Text style={styles.empty}>Bu kategoride görev yok</Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xs },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  pressed: { opacity: 0.7 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  count: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: { color: colors.primary, fontSize: 11, fontFamily: monoFont, fontWeight: "700" },
  content: {
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    marginLeft: spacing.sm,
    marginTop: spacing.xs,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: "italic",
    paddingVertical: spacing.sm,
  },
});
