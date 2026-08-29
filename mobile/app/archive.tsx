import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { Task } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { formatDateTime } from "@/src/lib/format";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { ARCHIVE } from "@/constants/testIds";

type Group = "done" | "cancelled" | "deleted";

const GROUP_VIEW: Record<Group, string> = {
  done: "archived",
  cancelled: "cancelled",
  deleted: "trash",
};

const GROUP_META: { key: Group; label: string; color: string; testID: string }[] = [
  { key: "done", label: "BİTMİŞ", color: colors.success, testID: ARCHIVE.groupDone },
  { key: "cancelled", label: "İPTAL", color: colors.warning, testID: ARCHIVE.groupCancelled },
  { key: "deleted", label: "SİLİNMİŞ", color: colors.danger, testID: ARCHIVE.groupDeleted },
];

export default function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();

  const [group, setGroup] = useState<Group>("done");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState({ done: 0, cancelled: 0, deleted: 0 });
  const [caps, setCaps] = useState({ perm_delete: false, empty_trash: false, manage_policy: false });
  const [autoClean, setAutoClean] = useState({ enabled: false, days: 30 });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"new" | "old" | "az">("new");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState<Task | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const handle401 = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [logout]);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [rows, c, s] = await Promise.all([
          api.tasks("mine", GROUP_VIEW[group]),
          api.archiveCounts("mine"),
          api.getTaskSettings(),
        ]);
        setTasks(rows);
        setCounts(c);
        setCaps(s.caps || { perm_delete: false, empty_trash: false, manage_policy: false });
        setAutoClean({ enabled: !!s.trash_autoclean_enabled, days: s.trash_autoclean_days || 30 });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return handle401();
        setError(e instanceof ApiError ? e.message : "Arşiv yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [group, handle401],
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  const dt = (t: Task) => t.deleted_at || t.cancelled_at || t.archived_at || t.due_date || "";
  const visibleTasks = tasks
    .filter((t) => {
      const q = query.trim().toLocaleLowerCase("tr");
      if (!q) return true;
      return `${t.title || ""} ${t.description || ""}`.toLocaleLowerCase("tr").includes(q);
    })
    .sort((a, b) => {
      if (sort === "az") return (a.title || "").localeCompare(b.title || "", "tr");
      const da = dt(a), db = dt(b);
      if (da === db) return 0;
      return sort === "old" ? (da < db ? -1 : 1) : (da > db ? -1 : 1);
    });

  const daysLeft = (t: Task) => {
    if (!autoClean.enabled || !t.deleted_at) return null;
    const elapsed = Math.floor((Date.now() - new Date(t.deleted_at).getTime()) / 86400000);
    return Math.max(0, autoClean.days - elapsed);
  };

  const restore = async (t: Task) => {
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    try {
      if (group === "deleted") await api.restoreTask(t.id);
      else if (group === "cancelled") await api.uncancelTask(t.id);
      else await api.updateTask(t.id, { archived: false });
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return handle401();
      setError(e instanceof ApiError ? e.message : "Geri yüklenemedi");
      load("refresh");
    }
  };

  const doPermanent = async (t: Task) => {
    setConfirmPermanent(null);
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    try {
      await api.permanentDeleteTask(t.id);
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return handle401();
      setError(e instanceof ApiError ? e.message : "Silinemedi");
      load("refresh");
    }
  };

  const doEmpty = async () => {
    setConfirmEmpty(false);
    try {
      await api.emptyTrash("mine");
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return handle401();
      setError(e instanceof ApiError ? e.message : "Boşaltılamadı");
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={ARCHIVE.screen}>
      <View style={styles.header}>
        <Pressable
          testID={ARCHIVE.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/tasks"))}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>ARŞİV</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.chipsRow}>
        {GROUP_META.map((g) => {
          const active = group === g.key;
          return (
            <Pressable
              key={g.key}
              testID={g.testID}
              onPress={() => setGroup(g.key)}
              style={({ pressed }) => [
                styles.chip,
                active && { borderColor: g.color, backgroundColor: "rgba(255,255,255,0.05)" },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipValue, { color: g.color }]}>{counts[g.key]}</Text>
              <Text style={styles.chipLabel}>{g.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {group === "deleted" && caps.empty_trash && counts.deleted > 0 && (
        <Pressable
          testID={ARCHIVE.emptyTrash}
          onPress={() => setConfirmEmpty(true)}
          style={({ pressed }) => [styles.emptyTrashBtn, pressed && styles.pressed]}
        >
          <Ionicons name="trash" size={14} color={colors.danger} />
          <Text style={styles.emptyTrashText}>ÇÖP KUTUSUNU BOŞALT</Text>
        </Pressable>
      )}

      {/* Arama + sıralama */}
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={14} color={colors.textMuted} />
          <TextInput
            testID="archive-search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Ara (başlık, açıklama)"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        <View style={styles.sortRow}>
          {([["new", "Yeni"], ["old", "Eski"], ["az", "A-Z"]] as const).map(([k, label]) => (
            <Pressable
              key={k}
              testID={`archive-sort-${k}`}
              onPress={() => setSort(k)}
              style={({ pressed }) => [styles.sortBtn, sort === k && styles.sortBtnActive, pressed && styles.pressed]}
            >
              <Text style={[styles.sortText, sort === k && styles.sortTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => load("initial")} style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}>
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : visibleTasks.length === 0 ? (
        <View style={styles.center} testID={ARCHIVE.emptyState}>
          <Ionicons name="file-tray-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{query.trim() ? "Eşleşen görev yok" : "Bu grupta görev yok"}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          {visibleTasks.map((t) => {
            const dtLabel = formatDateTime(t.deleted_at || t.cancelled_at || t.archived_at || t.due_date);
            const left = group === "deleted" ? daysLeft(t) : null;
            return (
              <View key={t.id} style={styles.row} testID={`${ARCHIVE.row}-${t.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{t.title}</Text>
                  {dtLabel && <Text style={styles.rowMeta}>{dtLabel}</Text>}
                  {group === "cancelled" && t.cancel_reason ? (
                    <Text style={styles.reasonCancel} numberOfLines={2} testID={`archive-cancel-reason-${t.id}`}>İptal nedeni: {t.cancel_reason}</Text>
                  ) : null}
                  {group === "deleted" && t.delete_reason ? (
                    <Text style={styles.reasonDelete} numberOfLines={2} testID={`archive-delete-reason-${t.id}`}>Silme nedeni: {t.delete_reason}</Text>
                  ) : null}
                  {left != null ? (
                    <Text style={styles.countdown} testID={`archive-autoclean-${t.id}`}>
                      {left <= 0 ? "Yakında kalıcı silinecek" : `${left} gün sonra kalıcı silinecek`}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  testID={`${ARCHIVE.restore}-${t.id}`}
                  onPress={() => restore(t)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
                >
                  <Ionicons name="arrow-undo-outline" size={16} color={colors.success} />
                  <Text style={[styles.rowActionText, { color: colors.success }]}>Geri Yükle</Text>
                </Pressable>
                {group === "deleted" && caps.perm_delete && (
                  <Pressable
                    testID={`${ARCHIVE.permanentDelete}-${t.id}`}
                    onPress={() => setConfirmPermanent(t)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    <Text style={[styles.rowActionText, { color: colors.danger }]}>Kalıcı Sil</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      )}

      {/* Kalıcı Sil onayı */}
      <Modal visible={!!confirmPermanent} transparent animationType="fade" onRequestClose={() => setConfirmPermanent(null)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Kalıcı Sil</Text>
            <Text style={styles.confirmBody}>Bu görev geri dönüşü olmayacak şekilde kalıcı silinecek. Emin misiniz?</Text>
            <View style={styles.confirmRow}>
              <Pressable testID={ARCHIVE.confirmCancel} onPress={() => setConfirmPermanent(null)} style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed]}>
                <Text style={styles.confirmCancelText}>Vazgeç</Text>
              </Pressable>
              <Pressable testID={ARCHIVE.confirmPermanent} onPress={() => confirmPermanent && doPermanent(confirmPermanent)} style={({ pressed }) => [styles.confirmDelete, pressed && styles.pressed]}>
                <Text style={styles.confirmDeleteText}>Kalıcı Sil</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Çöp Kutusunu Boşalt onayı */}
      <Modal visible={confirmEmpty} transparent animationType="fade" onRequestClose={() => setConfirmEmpty(false)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Çöp Kutusunu Boşalt</Text>
            <Text style={styles.confirmBody}>Çöp kutusundaki TÜM görevler kalıcı olarak silinecek. Bu işlem geri alınamaz.</Text>
            <View style={styles.confirmRow}>
              <Pressable onPress={() => setConfirmEmpty(false)} style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed]}>
                <Text style={styles.confirmCancelText}>Vazgeç</Text>
              </Pressable>
              <Pressable testID={ARCHIVE.confirmEmpty} onPress={doEmpty} style={({ pressed }) => [styles.confirmDelete, pressed && styles.pressed]}>
                <Text style={styles.confirmDeleteText}>Kalıcı Sil</Text>
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
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.primary, fontSize: 16, fontWeight: "800", fontFamily: monoFont, letterSpacing: 2 },
  chipsRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  chip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipValue: { fontSize: 20, fontWeight: "800", fontFamily: monoFont },
  chipLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2, fontFamily: monoFont, letterSpacing: 1 },
  toolbar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.xs },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 13, fontFamily: monoFont, padding: 0 },
  sortRow: { flexDirection: "row", gap: spacing.xs },
  sortBtn: { paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  sortBtnActive: { borderColor: colors.primary, backgroundColor: "rgba(0,240,255,0.1)" },
  sortText: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  sortTextActive: { color: colors.primary },
  reasonCancel: { color: colors.warning, fontSize: 11, marginTop: 3, fontFamily: monoFont },
  reasonDelete: { color: colors.danger, fontSize: 11, marginTop: 3, fontFamily: monoFont },
  countdown: { color: colors.danger, fontSize: 10, marginTop: 3, fontFamily: monoFont, opacity: 0.85 },
  emptyTrashBtn: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(255,0,60,0.4)",
  },
  emptyTrashText: { color: colors.danger, fontSize: 11, fontFamily: monoFont, letterSpacing: 1 },
  list: { padding: spacing.md, gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  rowMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2, fontFamily: monoFont },
  rowAction: { alignItems: "center", gap: 2, paddingHorizontal: spacing.xs },
  rowActionText: { fontSize: 10, fontFamily: monoFont },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  errorText: { color: colors.danger, fontSize: 13, textAlign: "center" },
  retryBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong },
  retryText: { color: colors.primary, fontFamily: monoFont },
  emptyTitle: { color: colors.textSecondary, fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.6 },
  confirmBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  confirmCard: { width: "100%", maxWidth: 360, backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, padding: spacing.lg, gap: spacing.md },
  confirmTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "800", fontFamily: monoFont },
  confirmBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  confirmRow: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  confirmCancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  confirmCancelText: { color: colors.textSecondary, fontFamily: monoFont },
  confirmDelete: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.danger },
  confirmDeleteText: { color: "#fff", fontWeight: "800", fontFamily: monoFont },
});
