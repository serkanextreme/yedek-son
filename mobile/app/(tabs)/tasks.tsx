import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { Category, CompanyLite, Task, TaskGroup } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { isAdminLike } from "@/src/auth/roles";
import { CategorySection } from "@/src/components/CategorySection";
import { TemplateBar } from "@/src/components/TemplateBar";
import { HudHeader } from "@/src/components/HudHeader";
import { LinkTasksModal } from "@/src/components/LinkTasksModal";
import { GroupBadge } from "@/src/components/TaskRow";
import { TaskFormModal } from "@/src/components/TaskFormModal";
import { allCategoryIds, buildTaskTree, CatNode, pruneEmpty } from "@/src/lib/taskTree";
import { useTaskClipboard, clearTaskClipboard } from "@/src/lib/taskClipboard";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { storage } from "@/src/utils/storage";
import { ARCHIVE, CATMGR, TASK_FORM, TASKS } from "@/constants/testIds";

const PREF_COMPANY = "tasks.filter.company";
const PREF_SEARCH = "tasks.filter.companySearch";
const PREF_HIDE_EMPTY = "tasks.filter.hideEmpty";

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const { logout, user } = useAuth();
  const isAdmin = isAdminLike(user);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [manageCategories, setManageCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [companies, setCompanies] = useState<CompanyLite[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const [formVisible, setFormVisible] = useState(false);
  const [linkVisible, setLinkVisible] = useState(false);
  // Görev Kopyalama (Kopyala → Yapıştır) panosu.
  const clipboard = useTaskClipboard();

  const openCreate = useCallback(() => setFormVisible(true), []);
  const openDetail = useCallback((task: Task) => router.push(`/task/${task.id}`), []);

  const handlePaste = useCallback(
    async (categoryId: string | null, categoryName: string) => {
      if (!clipboard?.sourceId) return;
      try {
        await api.duplicateTask(clipboard.sourceId, {
          include_subtasks: clipboard.includeSubtasks,
          include_attachments: clipboard.includeAttachments,
          category_id: categoryId,
        });
        Alert.alert("Yapıştırıldı", `Görev → ${categoryName || "Kolsuz"}`);
        load("silent");
      } catch (e) {
        Alert.alert("Hata", e instanceof ApiError ? e.message : "Yapıştırılamadı");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipboard],
  );

  const handleUnauthorized = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [logout]);

  const load = useCallback(
    async (mode: "initial" | "refresh" | "silent") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      if (mode !== "silent") setError(null);
      try {
        const [ts, cats, gs, comps, mcats] = await Promise.all([
          api.tasks(),
          api.categories("my_tasks"),
          api.taskGroups(),
          api.companies().catch(() => [] as CompanyLite[]),
          isAdmin
            ? api.categories("manage").catch(() => [] as Category[])
            : Promise.resolve([] as Category[]),
        ]);
        setTasks(ts);
        setCategories(cats);
        setGroups(gs);
        setCompanies(comps);
        setManageCategories(mcats);
        setError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await handleUnauthorized();
          return;
        }
        if (mode !== "silent") {
          setError(e instanceof ApiError ? e.message : "Veriler yüklenemedi");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
        loadedOnce.current = true;
      }
    },
    [handleUnauthorized, isAdmin],
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  // --- Filtre tercihlerini hatırla (yerel depolama) ---
  const prefsLoaded = useRef(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [cf, cs, he] = await Promise.all([
        storage.getItem<string | null>(PREF_COMPANY, null),
        storage.getItem<string>(PREF_SEARCH, ""),
        storage.getItem<boolean>(PREF_HIDE_EMPTY, false),
      ]);
      if (!alive) return;
      if (cf) setCompanyFilter(cf);
      if (cs) setCompanySearch(cs);
      if (he) setHideEmpty(true);
      prefsLoaded.current = true;
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!prefsLoaded.current) return;
    storage.setItem(PREF_COMPANY, companyFilter);
    storage.setItem(PREF_SEARCH, companySearch);
    storage.setItem(PREF_HIDE_EMPTY, hideEmpty);
  }, [companyFilter, companySearch, hideEmpty]);

  // Kayıtlı şirket artık mevcut değilse filtreyi sıfırla.
  useEffect(() => {
    if (companyFilter && companies.length > 0 && !companies.some((c) => c.id === companyFilter)) {
      setCompanyFilter(null);
    }
  }, [companies, companyFilter]);

  useFocusEffect(
    useCallback(() => {
      if (loadedOnce.current) load("silent");
    }, [load]),
  );

  const onToggleTask = useCallback(
    async (task: Task) => {
      const newStatus = task.status === "done" ? "pending" : "done";
      setBusyId(task.id);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t)),
      );
      try {
        await api.updateTask(task.id, { status: newStatus });
      } catch (e) {
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)),
        );
        if (e instanceof ApiError && e.status === 401) {
          await handleUnauthorized();
          return;
        }
        Alert.alert(
          "İşlem başarısız",
          e instanceof ApiError ? e.message : "Görev güncellenemedi",
        );
      } finally {
        setBusyId(null);
      }
    },
    [handleUnauthorized],
  );

  const onToggleExpand = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: prev[id] === false }));
  }, []);

  const tree = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? tasks.filter((t) => (t.title || "").toLowerCase().includes(q))
      : tasks;
    // Admin bir şirket seçtiğinde o şirketin TÜM kolları (manage) gösterilir;
    // aksi halde (ve müdürlerde) yalnızca görünür kollar (my_tasks).
    const catSet = isAdmin && companyFilter ? manageCategories : categories;
    return buildTaskTree(catSet, filtered);
  }, [tasks, categories, manageCategories, isAdmin, companyFilter, search]);

  // Grup rozetleri — her görev için bağlı olduğu grubun adı + ilerlemesi.
  const groupBadges = useMemo(() => {
    const byId: Record<string, TaskGroup> = {};
    for (const g of groups) byId[g.id] = g;
    const counts: Record<string, { done: number; total: number }> = {};
    for (const t of tasks) {
      if (!t.group_id) continue;
      const c = counts[t.group_id] || { done: 0, total: 0 };
      c.total += 1;
      if (t.status === "done") c.done += 1;
      counts[t.group_id] = c;
    }
    const map: Record<string, GroupBadge> = {};
    for (const t of tasks) {
      const g = t.group_id ? byId[t.group_id] : null;
      if (!g) continue;
      const c = counts[t.group_id!] || { done: 0, total: 0 };
      map[t.id] = { name: g.name, done: c.done, total: c.total, showProgress: !!g.show_progress };
    }
    return map;
  }, [tasks, groups]);

  const nodes = useMemo<CatNode[]>(() => {
    let roots = companyFilter
      ? tree.roots.filter((r) => (r.category.company_id || "") === companyFilter)
      : tree.roots;
    if (hideEmpty) roots = pruneEmpty(roots);
    const list = [...roots];
    // "Kategorisiz" yalnızca şirket filtresi yokken gösterilir (sahipsiz görevler).
    if (!companyFilter && tree.uncategorized.length) {
      const done = tree.uncategorized.filter((t) => t.status === "done").length;
      list.push({
        category: { id: "__uncat__", name: "Kategorisiz", color: colors.textMuted, company_id: "" },
        tasks: tree.uncategorized,
        children: [],
        rollup: { total: tree.uncategorized.length, done },
      });
    }
    return list;
  }, [tree, companyFilter, hideEmpty]);

  // Şirket filtresi çipleri — admin: TÜM şirketler (arama kutusuyla süzülür);
  // müdür/diğer: yalnızca görünür (my_tasks) kollarında geçen şirketler.
  const companyChips = useMemo(() => {
    let list: CompanyLite[];
    if (isAdmin) {
      list = companies;
    } else {
      const present = new Set<string>();
      categories.forEach((c) => {
        if (c.company_id) present.add(c.company_id);
      });
      list = companies.filter((c) => present.has(c.id));
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [isAdmin, companies, categories]);

  // Arama kutusu yalnızca admin + çok şirket olduğunda görünür.
  const showCompanySearch = isAdmin && companyChips.length >= 6;
  const visibleChips = useMemo(() => {
    const q = companySearch.trim().toLocaleLowerCase("tr");
    if (!q) return companyChips;
    return companyChips.filter((c) => c.name.toLocaleLowerCase("tr").includes(q));
  }, [companyChips, companySearch]);

  const setAll = useCallback(
    (open: boolean) => {
      const map: Record<string, boolean> = {};
      allCategoryIds(nodes).forEach((id) => {
        map[id] = open;
      });
      setExpanded(map);
    },
    [nodes],
  );

  const totalCount = tasks.length;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const showEmpty = nodes.length === 0;
  const filtersActive = !!companyFilter || hideEmpty;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={TASKS.screen}>
      <HudHeader
        subtitle={`GÖREVLER · ${doneCount}/${totalCount} tamamlandı`}
        right={
          <View style={{ flexDirection: "row", gap: spacing.xs }}>
            <Pressable
              testID={ARCHIVE.open}
              onPress={() => router.push("/archive")}
              hitSlop={10}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
            >
              <Ionicons name="archive-outline" size={20} color={colors.primary} />
            </Pressable>
            <Pressable
              testID={CATMGR.open}
              onPress={() => router.push("/categories")}
              hitSlop={10}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
            >
              <Ionicons name="folder-outline" size={20} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => router.push("/templates")}
              hitSlop={10}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
            >
              <Ionicons name="albums-outline" size={20} color={colors.primary} />
            </Pressable>
          </View>
        }
      />

      <TemplateBar onAuthError={() => { logout(); router.replace("/login"); }} />

      {clipboard?.sourceId && (
        <View style={styles.clipboardBar} testID={TASKS.clipboardBar}>
          <Ionicons name="clipboard-outline" size={15} color={colors.primary} />
          <Text style={styles.clipboardText} numberOfLines={1}>
            Kopyalandı: {clipboard.title}
          </Text>
          <Pressable
            testID={TASKS.clipboardClear}
            onPress={() => clearTaskClipboard()}
            hitSlop={8}
            style={({ pressed }) => [styles.clipboardClear, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={13} color={colors.danger} />
            <Text style={styles.clipboardClearText}>Temizle</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            testID={TASKS.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Görev ara..."
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable
          testID={TASKS.linkOpen}
          onPress={() => setLinkVisible(true)}
          style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
        >
          <Ionicons name="git-network-outline" size={16} color={colors.primary} />
        </Pressable>
        <Pressable
          testID={TASKS.expandAll}
          onPress={() => setAll(true)}
          style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-down" size={16} color={colors.primary} />
        </Pressable>
        <Pressable
          testID={TASKS.collapseAll}
          onPress={() => setAll(false)}
          style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-up" size={16} color={colors.primary} />
        </Pressable>
        <Pressable
          testID={TASKS.hideEmpty}
          onPress={() => setHideEmpty((v) => !v)}
          style={({ pressed }) => [styles.toolBtn, hideEmpty && styles.toolBtnActive, pressed && styles.pressed]}
        >
          <Ionicons
            name={hideEmpty ? "eye-off-outline" : "eye-outline"}
            size={16}
            color={hideEmpty ? colors.bgBase : colors.primary}
          />
        </Pressable>
      </View>

      {companyChips.length >= 2 && (
        <View style={styles.filterWrap}>
          {showCompanySearch && (
            <View style={styles.companySearchWrap}>
              <Ionicons name="search" size={14} color={colors.textMuted} />
              <TextInput
                testID={TASKS.companySearch}
                value={companySearch}
                onChangeText={setCompanySearch}
                placeholder="Şirket ara..."
                placeholderTextColor={colors.textMuted}
                style={styles.companySearchInput}
                autoCapitalize="none"
              />
              {companySearch.length > 0 && (
                <Pressable onPress={() => setCompanySearch("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              )}
            </View>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Pressable
              testID={`${TASKS.companyFilter}-all`}
              onPress={() => setCompanyFilter(null)}
              style={[styles.fchip, companyFilter === null && styles.fchipActive]}
            >
              <Text style={[styles.fchipText, companyFilter === null && styles.fchipTextActive]}>Tümü</Text>
            </Pressable>
            {visibleChips.map((co) => (
              <Pressable
                key={co.id}
                testID={`${TASKS.companyFilter}-${co.id}`}
                onPress={() => setCompanyFilter(co.id)}
                style={[styles.fchip, companyFilter === co.id && styles.fchipActive]}
              >
                <Ionicons
                  name="business-outline"
                  size={12}
                  color={companyFilter === co.id ? colors.bgBase : colors.textSecondary}
                />
                <Text style={[styles.fchipText, companyFilter === co.id && styles.fchipTextActive]}>
                  {co.name}
                </Text>
              </Pressable>
            ))}
            {showCompanySearch && companySearch.length > 0 && visibleChips.length === 0 && (
              <Text style={styles.noCompany}>Şirket bulunamadı</Text>
            )}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            testID={TASKS.errorRetry}
            onPress={() => load("initial")}
            style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
          >
            <Ionicons name="refresh" size={16} color={colors.bgBase} />
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : showEmpty ? (
        <View style={styles.center} testID={TASKS.emptyState}>
          <Ionicons name="file-tray-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>
            {search ? "Sonuç bulunamadı" : filtersActive ? "Filtreye uygun iş kolu yok" : "Henüz görev yok"}
          </Text>
          <Text style={styles.emptySub}>
            {search
              ? "Farklı bir arama terimi deneyin"
              : filtersActive
                ? "Filtreyi değiştirmeyi deneyin"
                : "Görevleriniz burada listelenecek"}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load("refresh")}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {nodes.map((node) => (
            <CategorySection
              key={node.category.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onToggleTask={onToggleTask}
              onPressTask={openDetail}
              busyId={busyId}
              highlight={search}
              groupBadges={groupBadges}
              pasteVisible={!!clipboard?.sourceId}
              onPaste={handlePaste}
            />
          ))}
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      )}

      <Pressable
        testID={TASK_FORM.fab}
        onPress={openCreate}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons name="add" size={30} color={colors.bgBase} />
      </Pressable>

      <TaskFormModal
        visible={formVisible}
        mode="create"
        task={null}
        categories={categories}
        onClose={() => setFormVisible(false)}
        onSaved={() => load("silent")}
      />

      <LinkTasksModal
        visible={linkVisible}
        candidateTasks={tasks}
        preselectedIds={[]}
        group={null}
        onClose={() => setLinkVisible(false)}
        onSaved={() => load("silent")}
        onAuthError={handleUnauthorized}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  clipboardBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.primary + "18",
  },
  clipboardText: { flex: 1, color: colors.primary, fontSize: 12, fontFamily: monoFont },
  clipboardClear: { flexDirection: "row", alignItems: "center", gap: 3 },
  clipboardClearText: { color: colors.danger, fontSize: 12, fontFamily: monoFont },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14, paddingVertical: 10 },
  toolBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  pressed: { opacity: 0.65 },
  toolBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterWrap: { paddingBottom: spacing.sm },
  companySearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 38,
  },
  companySearchInput: { flex: 1, color: colors.textPrimary, fontSize: 14, paddingVertical: 0 },
  noCompany: { color: colors.textMuted, fontSize: 13, alignSelf: "center", paddingHorizontal: spacing.sm },
  filterRow: { paddingHorizontal: spacing.md, gap: spacing.sm, alignItems: "center" },
  fchip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fchipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  fchipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  fchipTextActive: { color: colors.bgBase },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  errorText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  retryText: { color: colors.bgBase, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  emptySub: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
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
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
});
