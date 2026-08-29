// Wave 3 — Görev Bağlama (grup) bölümü. Görev detay ekranında gösterilir.
// Görev bir gruba bağlıysa: grup adı + ilerleme + üye listesi (dokunulabilir) +
// gruptan çıkar / düzenle / dağıt. Bağlı değilse: "Görevleri Bağla" düğmesi.

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { api, ApiError } from "@/src/api/client";
import { Task, TaskGroup } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { DETAIL } from "@/constants/testIds";
import { LinkTasksModal } from "./LinkTasksModal";

type Props = {
  task: Task;
  onChanged: () => void;
  onAuthError: () => void;
};

export const GroupSection = ({ task, onChanged, onAuthError }: Props) => {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkVisible, setLinkVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const [gs, ts] = await Promise.all([api.taskGroups(), api.tasks()]);
      setGroups(gs);
      setAllTasks(ts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  const group = groups.find((g) => g.id === task.group_id) || null;
  const members = task.group_id
    ? allTasks
        .filter((t) => t.group_id === task.group_id)
        .sort((a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0))
    : [];
  const doneCount = members.filter((m) => m.status === "done").length;

  const refresh = async () => {
    await load();
    onChanged();
  };

  const removeFromGroup = async () => {
    if (!task.group_id) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeGroupMember(task.group_id, task.id);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Çıkarılamadı");
    } finally {
      setBusy(false);
    }
  };

  const dissolveGroup = async () => {
    if (!task.group_id) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteGroup(task.group_id);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Dağıtılamadı");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BAĞLI GÖREVLER</Text>
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.sm }} />
      </View>
    );
  }

  // Görev bir gruba bağlı değil → bağlama seçeneği sun.
  if (!task.group_id || !group) {
    const candidates = allTasks.filter((t) => t.id !== task.id);
    return (
      <View style={styles.section} testID={DETAIL.groupSection}>
        <Text style={styles.sectionTitle}>BAĞLI GÖREVLER</Text>
        <Text style={styles.empty}>Bu görev bir gruba bağlı değil.</Text>
        <Pressable
          testID={DETAIL.groupLinkOpen}
          onPress={() => setLinkVisible(true)}
          style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
        >
          <Ionicons name="git-network-outline" size={16} color={colors.primary} />
          <Text style={styles.linkText}>Görevleri Bağla</Text>
        </Pressable>
        <LinkTasksModal
          visible={linkVisible}
          candidateTasks={allTasks}
          preselectedIds={[task.id]}
          group={null}
          onClose={() => setLinkVisible(false)}
          onSaved={refresh}
          onAuthError={onAuthError}
        />
      </View>
    );
  }

  return (
    <View style={styles.section} testID={DETAIL.groupSection}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>{group.name ? group.name.toUpperCase() : "BAĞLI GÖREVLER"}</Text>
        {group.show_progress && (
          <View style={styles.progressBadge}>
            <Text style={styles.progressText}>{doneCount}/{members.length} tamamlandı</Text>
          </View>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {members.map((m, idx) => {
        const isCurrent = m.id === task.id;
        const done = m.status === "done";
        return (
          <View
            key={m.id}
            style={[styles.memberRow, isCurrent && styles.memberCurrent]}
            testID={`${DETAIL.groupMember}-${m.id}`}
          >
            <Text style={styles.memberNo}>{idx + 1}.</Text>
            <Ionicons
              name={done ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={done ? colors.success : colors.textMuted}
            />
            <Pressable
              style={styles.memberBody}
              disabled={isCurrent}
              onPress={() => router.push(`/task/${m.id}`)}
            >
              <Text
                style={[styles.memberTitle, done && styles.memberDone, isCurrent && styles.memberCurrentText]}
                numberOfLines={1}
              >
                {m.title}
              </Text>
            </Pressable>
            {isCurrent ? (
              <Pressable
                testID={`${DETAIL.groupRemoveMember}-${m.id}`}
                onPress={removeFromGroup}
                disabled={busy}
                hitSlop={8}
              >
                <Ionicons name="unlink-outline" size={18} color={colors.danger} />
              </Pressable>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            )}
          </View>
        );
      })}

      <View style={styles.actions}>
        <Pressable
          testID={DETAIL.groupEdit}
          onPress={() => setLinkVisible(true)}
          disabled={busy}
          style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]}
        >
          <Ionicons name="create-outline" size={15} color={colors.primary} />
          <Text style={styles.smallBtnText}>Düzenle</Text>
        </Pressable>
        <Pressable
          testID={DETAIL.groupDissolve}
          onPress={dissolveGroup}
          disabled={busy}
          style={({ pressed }) => [styles.smallBtn, styles.dangerBtn, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={15} color={colors.danger} />
          <Text style={[styles.smallBtnText, { color: colors.danger }]}>Dağıt</Text>
        </Pressable>
      </View>

      <LinkTasksModal
        visible={linkVisible}
        candidateTasks={allTasks}
        preselectedIds={members.map((m) => m.id)}
        group={group}
        onClose={() => setLinkVisible(false)}
        onSaved={refresh}
        onAuthError={onAuthError}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, fontFamily: monoFont, flex: 1 },
  progressBadge: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  progressText: { color: colors.primary, fontSize: 11, fontFamily: monoFont, fontWeight: "700" },
  empty: { color: colors.textMuted, fontStyle: "italic", fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  memberCurrent: { borderColor: colors.primary, backgroundColor: "rgba(0,240,255,0.06)" },
  memberNo: { color: colors.textMuted, fontSize: 12, fontFamily: monoFont, width: 18, textAlign: "center" },
  memberBody: { flex: 1 },
  memberTitle: { color: colors.textPrimary, fontSize: 14 },
  memberDone: { color: colors.textMuted, textDecorationLine: "line-through" },
  memberCurrentText: { fontWeight: "800", color: colors.primary },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  smallBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 9,
  },
  dangerBtn: { borderColor: "rgba(255,0,60,0.4)" },
  smallBtnText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.65 },
});
