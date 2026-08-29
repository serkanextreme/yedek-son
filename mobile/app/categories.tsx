import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { Category, CompanyLite } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { CategoryEditorModal } from "@/src/components/CategoryEditorModal";
import { flattenCategories } from "@/src/lib/taskTree";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { CATMGR } from "@/constants/testIds";

type EditorState =
  | { mode: "create-root"; category: null; parent: null }
  | { mode: "create-sub"; category: null; parent: Category }
  | { mode: "edit"; category: Category; parent: null };

export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();

  const [categories, setCategories] = useState<Category[]>([]);
  const [companies, setCompanies] = useState<CompanyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [cats, comps] = await Promise.all([api.categories(), api.companies()]);
        setCategories(cats);
        setCompanies(comps);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await logout();
          router.replace("/login");
          return;
        }
        setError(e instanceof ApiError ? e.message : "Kategoriler yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [logout],
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  const companyName = useMemo(() => {
    const m = new Map(companies.map((c) => [c.id, c.name]));
    return (id?: string) => (id ? m.get(id) ?? "Şirket" : "Şirket");
  }, [companies]);

  // group categories by company, then flatten each group's tree
  const groups = useMemo(() => {
    const byCompany = new Map<string, Category[]>();
    for (const c of categories) {
      const key = c.company_id ?? "?";
      const list = byCompany.get(key) ?? [];
      list.push(c);
      byCompany.set(key, list);
    }
    return Array.from(byCompany.entries()).map(([cid, cats]) => ({
      companyId: cid,
      name: companyName(cid),
      flat: flattenCategories(cats),
    }));
  }, [categories, companyName]);

  const doDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await api.deleteCategory(target.id);
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await logout();
        router.replace("/login");
        return;
      }
      setError(e instanceof ApiError ? e.message : "Silinemedi");
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={CATMGR.screen}>
      <View style={styles.header}>
        <Pressable
          testID={CATMGR.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/tasks"))}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>İŞ KOLLARI</Text>
        <View style={{ width: 26 }} />
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
      ) : categories.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="folder-open-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Henüz iş kolu yok</Text>
          <Text style={styles.emptySub}>Aşağıdaki + ile ilk iş kolunu oluşturun</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          {groups.map((g) => (
            <View key={g.companyId} style={styles.group}>
              <Text style={styles.groupHeader}>{g.name}</Text>
              {g.flat.map((fc) => {
                const cat = categories.find((c) => c.id === fc.id)!;
                return (
                  <View
                    key={fc.id}
                    testID={`${CATMGR.node}-${fc.id}`}
                    style={[styles.node, { marginLeft: fc.depth * spacing.md }]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: cat.color || colors.primary }]} />
                    <Text style={styles.nodeName} numberOfLines={1}>{fc.label}</Text>
                    <Pressable
                      testID={`${CATMGR.addSub}-${fc.id}`}
                      onPress={() => setEditor({ mode: "create-sub", category: null, parent: cat })}
                      hitSlop={8}
                      style={styles.nodeAction}
                    >
                      <Ionicons name="add" size={18} color={colors.primary} />
                    </Pressable>
                    <Pressable
                      testID={`${CATMGR.edit}-${fc.id}`}
                      onPress={() => setEditor({ mode: "edit", category: cat, parent: null })}
                      hitSlop={8}
                      style={styles.nodeAction}
                    >
                      <Ionicons name="create-outline" size={17} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      testID={`${CATMGR.delete}-${fc.id}`}
                      onPress={() => setDeleting(cat)}
                      hitSlop={8}
                      style={styles.nodeAction}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
          <View style={{ height: 90 }} />
        </ScrollView>
      )}

      <Pressable
        testID={CATMGR.addRoot}
        onPress={() => setEditor({ mode: "create-root", category: null, parent: null })}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons name="add" size={30} color={colors.bgBase} />
      </Pressable>

      {editor && (
        <CategoryEditorModal
          visible={!!editor}
          mode={editor.mode}
          category={editor.category}
          parent={editor.parent}
          companies={companies}
          categories={categories}
          onClose={() => setEditor(null)}
          onSaved={() => load("refresh")}
        />
      )}

      <Modal visible={!!deleting} transparent animationType="fade" onRequestClose={() => setDeleting(null)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>İş kolunu sil</Text>
            <Text style={styles.confirmBody}>
              {`"${deleting?.name ?? ""}" ve tüm alt kolları silinecek. Görevler silinmez, sadece kategorileri kaldırılır.`}
            </Text>
            <View style={styles.confirmRow}>
              <Pressable
                testID={CATMGR.deleteCancel}
                onPress={() => setDeleting(null)}
                style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed]}
              >
                <Text style={styles.confirmCancelText}>Vazgeç</Text>
              </Pressable>
              <Pressable
                testID={CATMGR.deleteConfirm}
                onPress={doDelete}
                style={({ pressed }) => [styles.confirmDelete, pressed && styles.pressed]}
              >
                <Text style={styles.confirmDeleteText}>Sil</Text>
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
  list: { padding: spacing.md, gap: spacing.md },
  group: { gap: spacing.xs },
  groupHeader: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, fontFamily: monoFont, marginBottom: 4 },
  node: {
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
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  nodeName: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  nodeAction: { padding: 4 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: "rgba(226, 241, 255, 0.5)",
  },
  pressed: { opacity: 0.7 },
  errorText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  retryText: { color: colors.bgBase, fontWeight: "800", fontFamily: monoFont },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  emptySub: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
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
  confirmRow: { flexDirection: "row", gap: spacing.sm },
  confirmCancel: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  confirmCancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: "700" },
  confirmDelete: { flex: 1, alignItems: "center", backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 12 },
  confirmDeleteText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
});
