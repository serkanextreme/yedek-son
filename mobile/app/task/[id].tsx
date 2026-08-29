import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { Category, SearchUser, Task } from "@/src/api/types";
import { AttachmentsSection } from "@/src/components/AttachmentsSection";
import { SharesSection } from "@/src/components/SharesSection";
import { GroupSection } from "@/src/components/GroupSection";
import { LockSection } from "@/src/components/LockSection";
import { useAuth } from "@/src/auth/AuthContext";
import { TaskFormModal } from "@/src/components/TaskFormModal";
import { formatDateTime, genId, statusMeta } from "@/src/lib/format";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { DETAIL } from "@/constants/testIds";

const reminderOptions = [
  { key: "off", label: "Kapalı", days: null as number | null },
  { key: "1", label: "1 gün", days: 1 },
  { key: "3", label: "3 gün", days: 3 },
  { key: "7", label: "7 gün", days: 7 },
  { key: "14", label: "14 gün", days: 14 },
];

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const [task, setTask] = useState<Task | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSub, setNewSub] = useState("");
  const [editVisible, setEditVisible] = useState(false);
  const [policy, setPolicy] = useState<string>("optional");
  const [reasonMode, setReasonMode] = useState<null | "cancel" | "delete">(null);
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reassignVisible, setReassignVisible] = useState(false);
  const [rQuery, setRQuery] = useState("");
  const [rResults, setRResults] = useState<SearchUser[]>([]);
  const [rSearching, setRSearching] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const handle401 = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [logout]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/tasks");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, cats] = await Promise.all([api.getTask(id), api.categories("my_tasks")]);
      setTask(t);
      setCategories(cats);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return handle401();
      setError(e instanceof ApiError ? e.message : "Görev yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [id, handle401]);

  useEffect(() => {
    load();
  }, [load]);

  // Arşiv v2 — neden politikasını yükle (iptal/silme modalı için).
  useEffect(() => {
    api.getTaskSettings().then((s) => setPolicy(s.delete_reason_policy)).catch(() => {});
  }, []);

  const patchTask = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!task) return;
      setBusy(true);
      try {
        const updated = await api.updateTask(task.id, patch);
        setTask(updated);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return handle401();
        setError(e instanceof ApiError ? e.message : "İşlem başarısız");
        load();
      } finally {
        setBusy(false);
      }
    },
    [task, handle401, load],
  );

  const toggleStatus = () => {
    if (!task) return;
    patchTask({ status: task.status === "done" ? "pending" : "done" });
  };

  const subtasks = (task?.subtasks ?? []) as Task["subtasks"];

  const toggleSub = (subId: string) => {
    const next = subtasks.map((s) =>
      s.id === subId ? { ...s, done: !s.done, status: !s.done ? "done" : "pending" } : s,
    );
    patchTask({ subtasks: next });
  };
  const deleteSub = (subId: string) => {
    patchTask({ subtasks: subtasks.filter((s) => s.id !== subId) });
  };
  const addSub = () => {
    const text = newSub.trim();
    if (!text) return;
    setNewSub("");
    patchTask({ subtasks: [...subtasks, { id: genId(), text, done: false, status: "pending" }] });
  };

  const setReminder = (days: number | null) => {
    if (days == null) patchTask({ reminder_disabled: true });
    else patchTask({ reminder_disabled: false, reminder_days: days });
  };

  const doDelete = async (reason: string) => {
    if (!task) return;
    setReasonMode(null);
    try {
      await api.deleteTask(task.id, reason || undefined);
      goBack();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return handle401();
      setError(e instanceof ApiError ? e.message : "Silinemedi");
    }
  };

  const doCancel = async (reason: string) => {
    if (!task) return;
    setReasonMode(null);
    try {
      await api.cancelTask(task.id, reason || undefined);
      goBack();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return handle401();
      setError(e instanceof ApiError ? e.message : "İptal edilemedi");
    }
  };

  // Neden politikasına göre: 'off' → direkt işlem; aksi halde neden modalını aç.
  const openReason = (mode: "cancel" | "delete") => {
    setReasonText("");
    if (policy === "off") {
      if (mode === "cancel") doCancel(""); else doDelete("");
      return;
    }
    setReasonMode(mode);
  };

  const submitReason = () => {
    const r = reasonText.trim();
    if (policy === "required" && !r) return; // buton zaten disabled
    if (reasonMode === "cancel") doCancel(r); else if (reasonMode === "delete") doDelete(r);
  };

  const myAssignee = task?.assignees?.find((a) => a.user_id === user?.id);

  // Debounced user search for reassignment (owner transfer).
  useEffect(() => {
    if (!reassignVisible) return;
    const q = rQuery.trim();
    if (q.length < 1) {
      setRResults([]);
      return;
    }
    let active = true;
    setRSearching(true);
    const t = setTimeout(async () => {
      try {
        const users = await api.searchUsers(q);
        if (active) setRResults(users.filter((u) => u.id !== task?.user_id));
      } catch {
        if (active) setRResults([]);
      } finally {
        if (active) setRSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [rQuery, reassignVisible, task?.user_id]);

  const openReassign = () => {
    setReassignError(null);
    setRQuery("");
    setRResults([]);
    setReassignVisible(true);
  };

  const doReassign = async (u: SearchUser) => {
    if (!task || reassigning) return;
    setReassigning(true);
    setReassignError(null);
    try {
      const updated = await api.reassignTask(task.id, u.id);
      setTask(updated);
      setReassignVisible(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return handle401();
      setReassignError(e instanceof ApiError ? e.message : "Devredilemedi");
    } finally {
      setReassigning(false);
    }
  };

  const toggleMyCompletion = async () => {
    if (!task || !myAssignee) return;
    setBusy(true);
    try {
      const updated = await api.myCompletion(task.id, !myAssignee.completed);
      setTask(updated);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return handle401();
      setError(e instanceof ApiError ? e.message : "İşlem başarısız");
    } finally {
      setBusy(false);
    }
  };

  const meta = task ? statusMeta(task.status) : null;
  const category = categories.find((c) => c.id === task?.category_id);
  const reminderKey = task?.reminder_disabled
    ? "off"
    : task?.reminder_days != null
      ? String(task.reminder_days)
      : "off";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={DETAIL.screen}>
      <View style={styles.header}>
        <Pressable testID={DETAIL.back} onPress={goBack} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>GÖREV</Text>
        {task ? (
          <Pressable testID={DETAIL.edit} onPress={() => setEditVisible(true)} hitSlop={10}>
            <Ionicons name="create-outline" size={22} color={colors.primary} />
          </Pressable>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !task ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}>
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : task ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{task.title}</Text>
          <View style={styles.badgeRow}>
            {meta && (
              <View style={[styles.pill, { borderColor: meta.color }]}>
                <View style={[styles.dot, { backgroundColor: meta.color }]} />
                <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            )}
            {!!task.start_date && (
              <View style={styles.metaItem}>
                <Ionicons name="play-outline" size={13} color={colors.textMuted} />
                <Text style={styles.metaText} testID={DETAIL.startDate}>
                  Başlangıç: {formatDateTime(task.start_date)}
                </Text>
              </View>
            )}
            {!!task.due_date && (
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                <Text style={styles.metaText}>Bitiş: {formatDateTime(task.due_date)}</Text>
              </View>
            )}
            {!!category && (
              <View style={styles.metaItem}>
                <View style={[styles.dot, { backgroundColor: category.color || colors.primary }]} />
                <Text style={styles.metaText}>{category.name}</Text>
              </View>
            )}
          </View>

          <View style={styles.actionRow}>
            <Pressable
              testID={DETAIL.toggleStatus}
              onPress={toggleStatus}
              disabled={busy}
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
            >
              <Ionicons
                name={task.status === "done" ? "arrow-undo-outline" : "checkmark-circle-outline"}
                size={18}
                color={task.status === "done" ? colors.warning : colors.success}
              />
              <Text style={styles.actionText}>
                {task.status === "done" ? "Geri Al" : "Tamamla"}
              </Text>
            </Pressable>
            <Pressable
              testID={DETAIL.cancelTask}
              onPress={() => openReason("cancel")}
              disabled={busy}
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
            >
              <Ionicons name="ban-outline" size={18} color={colors.warning} />
              <Text style={[styles.actionText, { color: colors.warning }]}>İptal Et</Text>
            </Pressable>
            <Pressable
              testID={DETAIL.delete}
              onPress={() => openReason("delete")}
              style={({ pressed }) => [styles.actionBtn, styles.actionDanger, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.actionText, { color: colors.danger }]}>Sil</Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SAHİP</Text>
            <View style={styles.ownerRow}>
              <View style={styles.ownerInfo}>
                <Ionicons name="person-circle-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.assigneeName} numberOfLines={1}>
                  {task.owner_username || task.assignee_name || "—"}
                </Text>
              </View>
              <Pressable
                testID={DETAIL.reassign}
                onPress={openReassign}
                style={({ pressed }) => [styles.reassignBtn, pressed && styles.pressed]}
              >
                <Ionicons name="swap-horizontal" size={16} color={colors.primary} />
                <Text style={styles.reassignText}>Devret</Text>
              </Pressable>
            </View>
          </View>

          <AttachmentsSection taskId={task.id} onAuthError={handle401} />

          <SharesSection task={task} onUpdated={setTask} onAuthError={handle401} />

          <LockSection
            task={task}
            currentUserId={user?.id}
            onUpdated={setTask}
            onAuthError={handle401}
          />

          <GroupSection task={task} onChanged={load} onAuthError={handle401} />

          {!!task.description && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>AÇIKLAMA</Text>
              <Text style={styles.description}>{task.description}</Text>
            </View>
          )}

          {task.assignees && task.assignees.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ATANANLAR</Text>
              {task.assignees.map((a) => (
                <View key={a.user_id} style={styles.assigneeRow}>
                  <Ionicons
                    name={a.completed ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={a.completed ? colors.success : colors.textMuted}
                  />
                  <Text style={styles.assigneeName}>{a.name || a.user_id}</Text>
                </View>
              ))}
              {myAssignee && (
                <Pressable
                  testID={DETAIL.myCompletion}
                  onPress={toggleMyCompletion}
                  disabled={busy}
                  style={({ pressed }) => [styles.myCompletionBtn, pressed && styles.pressed]}
                >
                  <Ionicons
                    name={myAssignee.completed ? "checkmark-done" : "checkmark"}
                    size={16}
                    color={colors.bgBase}
                  />
                  <Text style={styles.myCompletionText}>
                    {myAssignee.completed ? "Tamamlamamı geri al" : "Benim payımı tamamla"}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ALT GÖREVLER</Text>
            {subtasks.length === 0 && <Text style={styles.emptyMini}>Alt görev yok</Text>}
            {subtasks.map((s) => (
              <View key={s.id} style={styles.subRow}>
                <Pressable
                  testID={`${DETAIL.subtaskToggle}-${s.id}`}
                  onPress={() => toggleSub(s.id)}
                  hitSlop={8}
                >
                  <Ionicons
                    name={s.done ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={s.done ? colors.success : colors.textMuted}
                  />
                </Pressable>
                <Text style={[styles.subText, s.done && styles.subDone]}>{s.text}</Text>
                <Pressable
                  testID={`${DETAIL.subtaskDelete}-${s.id}`}
                  onPress={() => deleteSub(s.id)}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
            <View style={styles.addSubRow}>
              <TextInput
                testID={DETAIL.subtaskInput}
                value={newSub}
                onChangeText={setNewSub}
                placeholder="Yeni alt görev"
                placeholderTextColor={colors.textMuted}
                style={styles.subInput}
                onSubmitEditing={addSub}
                returnKeyType="done"
              />
              <Pressable
                testID={DETAIL.subtaskAdd}
                onPress={addSub}
                style={({ pressed }) => [styles.subAddBtn, pressed && styles.pressed]}
              >
                <Ionicons name="add" size={22} color={colors.bgBase} />
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>HATIRLATMA (SON TARİHTEN ÖNCE)</Text>
            <View style={styles.chipRow}>
              {reminderOptions.map((o) => (
                <Pressable
                  key={o.key}
                  testID={`${DETAIL.reminderChip}-${o.key}`}
                  onPress={() => setReminder(o.days)}
                  style={[styles.chip, reminderKey === o.key && styles.chipActive]}
                >
                  <Text style={[styles.chipText, reminderKey === o.key && styles.chipTextActive]}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ height: spacing.xl }} />
        </ScrollView>
      ) : null}

      {task && (
        <TaskFormModal
          visible={editVisible}
          mode="edit"
          task={task}
          categories={categories}
          onClose={() => setEditVisible(false)}
          onSaved={load}
        />
      )}

      <Modal
        visible={reassignVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReassignVisible(false)}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.reassignCard}>
            <View style={styles.reassignHeader}>
              <Text style={styles.confirmTitle}>Görevi Devret</Text>
              <Pressable
                testID={DETAIL.reassignClose}
                onPress={() => setReassignVisible(false)}
                hitSlop={10}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.confirmBody}>Görevin yeni sahibini seçin.</Text>
            <TextInput
              testID={DETAIL.reassignSearch}
              value={rQuery}
              onChangeText={setRQuery}
              placeholder="Kullanıcı ara…"
              placeholderTextColor={colors.textMuted}
              style={styles.subInput}
              autoCapitalize="none"
            />
            {reassignError && <Text style={styles.reassignErr}>{reassignError}</Text>}
            {rSearching ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : (
              <ScrollView style={styles.reassignResults} keyboardShouldPersistTaps="handled">
                {rResults.length === 0 && rQuery.trim().length > 0 && (
                  <Text style={styles.emptyMini}>Kullanıcı bulunamadı</Text>
                )}
                {rResults.map((u) => (
                  <Pressable
                    key={u.id}
                    testID={`${DETAIL.reassignUser}-${u.id}`}
                    onPress={() => doReassign(u)}
                    disabled={reassigning}
                    style={({ pressed }) => [styles.reassignUserRow, pressed && styles.pressed]}
                  >
                    <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.assigneeName}>{u.username}</Text>
                      {!!u.company_name && <Text style={styles.metaText}>{u.company_name}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={reasonMode !== null} transparent animationType="fade" onRequestClose={() => setReasonMode(null)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{reasonMode === "cancel" ? "Görevi iptal et" : "Görevi sil"}</Text>
            <Text style={styles.confirmBody}>
              {reasonMode === "delete"
                ? "Görev çöp kutusuna (Arşiv › Silinmiş) taşınacak. Oradan geri yükleyebilirsiniz."
                : "Görev iptal edilip arşivin İPTAL grubuna taşınacak."}
              {policy === "required" ? " Bu işlem için neden girmeniz zorunlu." : policy === "optional" ? " İsterseniz kısa bir neden ekleyin." : ""}
            </Text>
            {policy !== "off" && (
              <TextInput
                testID="detail-reason-input"
                value={reasonText}
                onChangeText={setReasonText}
                placeholder="Neden (kısa not)..."
                placeholderTextColor={colors.textMuted}
                multiline
                style={styles.reasonInput}
              />
            )}
            <View style={styles.confirmRow}>
              <Pressable
                testID={DETAIL.deleteCancel}
                onPress={() => setReasonMode(null)}
                style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed]}
              >
                <Text style={styles.confirmCancelText}>Vazgeç</Text>
              </Pressable>
              <Pressable
                testID={DETAIL.deleteConfirm}
                onPress={submitReason}
                disabled={policy === "required" && !reasonText.trim()}
                style={({ pressed }) => [styles.confirmDelete, (policy === "required" && !reasonText.trim()) && { opacity: 0.4 }, pressed && styles.pressed]}
              >
                <Text style={styles.confirmDeleteText}>{reasonMode === "cancel" ? "İptal Et" : "Sil"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "800", letterSpacing: 2, fontFamily: monoFont },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: "800" },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 11, fontWeight: "700", fontFamily: monoFont },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: colors.textMuted, fontSize: 12, fontFamily: monoFont },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  actionDanger: { borderColor: "rgba(255,0,60,0.4)", backgroundColor: "rgba(255,0,60,0.08)" },
  actionText: { color: colors.textPrimary, fontSize: 14, fontWeight: "700" },
  section: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, fontFamily: monoFont },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  assigneeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  assigneeName: { color: colors.textPrimary, fontSize: 14 },
  ownerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  ownerInfo: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  reassignBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  reassignText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  reassignCard: {
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  reassignHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reassignErr: { color: colors.danger, fontSize: 13, marginTop: 4 },
  reassignResults: { marginTop: spacing.sm },
  reassignUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  myCompletionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    marginTop: spacing.xs,
  },
  myCompletionText: { color: colors.bgBase, fontSize: 13, fontWeight: "700" },
  emptyMini: { color: colors.textMuted, fontSize: 13, fontStyle: "italic" },
  subRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  subText: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  subDone: { color: colors.textMuted, textDecorationLine: "line-through" },
  addSubRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  subInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  subAddBtn: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.bgBase, fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.7 },
  errorText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  retryText: { color: colors.bgBase, fontWeight: "800", fontFamily: monoFont },
  confirmBackdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.8)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  confirmCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  confirmTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "800", fontFamily: monoFont },
  confirmBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  reasonInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 14,
    fontFamily: monoFont,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 60,
    textAlignVertical: "top",
  },
  confirmRow: { flexDirection: "row", gap: spacing.sm },
  confirmCancel: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  confirmCancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: "700" },
  confirmDelete: { flex: 1, alignItems: "center", backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 12 },
  confirmDeleteText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
});
