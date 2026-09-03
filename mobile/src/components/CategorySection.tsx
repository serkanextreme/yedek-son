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
  // Görev Kopyalama — pano dolu iken başlıkta "Yapıştır" düğmesi göster.
  pasteVisible?: boolean;
  onPaste?: (categoryId: string | null, categoryName: string) => void;
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
  pasteVisible,
  onPaste,
}: Props) => {
  const isOpen = expanded[node.category.id] !== false; // default open
  const { rollup, category } = node;
  const color = category.color || colors.primary;
  const pasteCatId = category.id === "__uncat__" ? null : category.id;

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
        {pasteVisible && onPaste && (
          <Pressable
            testID={`${TASKS.categoryPaste}-${category.id}`}
            onPress={() => onPaste(pasteCatId, category.name)}
            hitSlop={8}
            style={({ pressed }) => [styles.pasteBtn, pressed && styles.pressed]}
          >
            <Ionicons name="clipboard-outline" size={13} color={colors.primary} />
            <Text style={styles.pasteText}>Yapıştır</Text>
          </Pressable>
        )}
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
              pasteVisible={pasteVisible}
              onPaste={onPaste}
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
  pasteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.primary + "22",
  },
  pasteText: { color: colors.primary, fontSize: 11, fontFamily: monoFont, fontWeight: "700" },
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
