import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { Category, TaskTemplate } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { TemplateFormModal } from "@/src/components/TemplateFormModal";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TEMPLATES } from "@/constants/testIds";

export default function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();

  const [items, setItems] = useState<TaskTemplate[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ template: TaskTemplate | null } | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);

  const onAuthError = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [logout]);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [tpls, cats] = await Promise.all([
          api.listTemplates(),
          api.categories("my_tasks").catch(() => [] as Category[]),
        ]);
        setItems(tpls);
        setCategories(cats);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Şablonlar yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthError],
  );

  useEffect(() => { load("initial"); }, [load]);

  const handleUse = async (t: TaskTemplate) => {
    setUsingId(t.id);
    try {
      const task = await api.instantiateTemplate(t.id);
      router.push(`/task/${task.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Oluşturulamadı");
    } finally {
      setUsingId(null);
    }
  };

  const confirmDelete = (t: TaskTemplate) => {
    Alert.alert("Şablonu sil?", `"${t.name}" silinecek.`, [
      { text: "İptal", style: "cancel" },
      {
        text: "Sil",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteTemplate(t.id);
            setItems((p) => p.filter((x) => x.id !== t.id));
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) return onAuthError();
            Alert.alert("Hata", "Silinemedi");
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={TEMPLATES.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/tasks"))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>ŞABLONLAR</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => load("initial")} style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}>
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          <Pressable testID={TEMPLATES.newBtn} onPress={() => setForm({ template: null })}
            style={({ pressed }) => [styles.newBtn, pressed && styles.pressed]}>
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={styles.newBtnText}>YENİ ŞABLON</Text>
          </Pressable>

          {items.length === 0 ? (
            <View style={styles.empty} testID={TEMPLATES.empty}>
              <Ionicons name="albums-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Henüz şablon yok</Text>
              <Text style={styles.emptySub}>Sık kullandığın görevleri şablon olarak kaydet.</Text>
            </View>
          ) : (
            items.map((t) => (
              <View key={t.id} testID={`${TEMPLATES.row}-${t.id}`} style={styles.row}>
                <View style={styles.rowInfo}>
                  <View style={styles.rowTitleLine}>
                    <Ionicons name={t.scope === "shared" ? "people-outline" : "person-outline"} size={13} color={t.scope === "shared" ? colors.primary : colors.textMuted} />
                    <Text style={styles.rowName} numberOfLines={1}>{t.name}</Text>
                  </View>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {t.title || "(başlık yok)"}{(t.subtasks?.length || 0) > 0 ? ` · ${t.subtasks.length} alt görev` : ""}
                  </Text>
                </View>
                <Pressable testID={`${TEMPLATES.use}-${t.id}`} disabled={usingId === t.id} onPress={() => handleUse(t)}
                  style={({ pressed }) => [styles.useBtn, pressed && styles.pressed]}>
                  {usingId === t.id ? <ActivityIndicator size="small" color={colors.primary} /> : (
                    <><Ionicons name="play" size={12} color={colors.primary} /><Text style={styles.useText}>Kullan</Text></>
                  )}
                </Pressable>
                <Pressable testID={`${TEMPLATES.edit}-${t.id}`} onPress={() => setForm({ template: t })} hitSlop={6} style={styles.iconBtn}>
                  <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
                </Pressable>
                <Pressable testID={`${TEMPLATES.delete}-${t.id}`} onPress={() => confirmDelete(t)} hitSlop={6} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {form && (
        <TemplateFormModal
          template={form.template}
          categories={categories}
          onClose={() => setForm(null)}
          onSaved={() => load("refresh")}
          onAuthError={onAuthError}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.primary, fontSize: 15, fontWeight: "800", fontFamily: monoFont, letterSpacing: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  errorText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  retryBtn: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  retryText: { color: colors.primary, fontWeight: "700" },
  list: { padding: spacing.md, gap: spacing.sm },
  newBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, marginBottom: spacing.sm,
  },
  newBtnText: { color: colors.primary, fontWeight: "800", fontFamily: monoFont, letterSpacing: 1, fontSize: 13 },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  emptySub: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowName: { color: colors.textPrimary, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  rowSub: { color: colors.textMuted, fontSize: 12, fontFamily: monoFont, marginTop: 2 },
  useBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6,
  },
  useText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  iconBtn: { padding: 4 },
  pressed: { opacity: 0.6 },
});
