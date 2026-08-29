import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { AdminUser, Company, TeamSummaryRow } from "@/src/api/types";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { UserFormModal, roleLabel } from "@/src/components/admin/UserFormModal";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { USER_DETAIL } from "@/constants/testIds";

type Stat = { key: string; label: string; value: number; color: string };

function quotaBarColor(pct: number): string {
  if (pct >= 90) return colors.danger;
  if (pct >= 70) return colors.warning;
  return colors.success;
}

export default function UserDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [user, setUser] = useState<AdminUser | null>(null);
  const [summary, setSummary] = useState<TeamSummaryRow | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  const onAuthError = useCallback(() => router.replace("/login"), []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [us, sum, cs] = await Promise.all([api.adminUsers(), api.teamSummary(), api.listCompanies()]);
        const u = us.find((x) => x.id === id) || null;
        setUser(u);
        setSummary(sum.find((s) => s.user_id === id) || null);
        setCompanies(cs);
        if (!u) setError("Kullanıcı bulunamadı");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Kullanıcı yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, onAuthError],
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  const confirmDelete = async () => {
    if (!user) return;
    setDelBusy(true);
    try {
      await api.deleteUser(user.id);
      setDeleting(false);
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Silinemedi");
    } finally {
      setDelBusy(false);
    }
  };

  const stats: Stat[] = summary
    ? [
        { key: "total", label: "Toplam", value: summary.total, color: colors.primary },
        { key: "done", label: "Tamamlanan", value: summary.done, color: colors.success },
        { key: "pending", label: "Bekleyen", value: summary.pending, color: colors.warning },
        { key: "paused", label: "Duraklatılan", value: summary.paused, color: colors.textMuted },
        { key: "overdue", label: "Geciken", value: summary.overdue, color: colors.danger },
      ]
    : [];

  const pct = typeof user?.quota_percent === "number" ? user.quota_percent : null;

  return (
    <View style={styles.container} testID={USER_DETAIL.screen}>
      <ScreenHeader title="KULLANICI DETAYI" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error && !user ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => load("initial")} style={styles.retryBtn}><Text style={styles.retryText}>Tekrar Dene</Text></Pressable>
        </View>
      ) : user ? (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
        >
          {/* Profil */}
          <View style={styles.profileCard}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{user.username.slice(0, 2).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user.username}</Text>
              <Text style={styles.sub}>{roleLabel(user.role)}{user.company_name ? ` · ${user.company_name}` : " · Şirketsiz"}</Text>
            </View>
          </View>

          {/* Kota / Kullanım */}
          <Text style={styles.section}>DEPOLAMA KOTASI</Text>
          <View style={styles.card} testID={USER_DETAIL.quota}>
            <View style={styles.quotaHead}>
              <Text style={styles.quotaLabel}>{user.quota_label || "—"}</Text>
              <Text style={styles.quotaVal}>
                {(user.usage_mb ?? 0).toLocaleString("tr-TR")} MB
                {user.quota_mb ? ` / ${user.quota_mb.toLocaleString("tr-TR")} MB` : ""}
              </Text>
            </View>
            {pct !== null && user.quota_mb ? (
              <>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: quotaBarColor(pct) }]} />
                </View>
                <Text style={[styles.pctText, { color: quotaBarColor(pct) }]}>%{pct} kullanıldı</Text>
              </>
            ) : (
              <Text style={styles.muted}>Sistem kotası (sınırsız / varsayılan)</Text>
            )}
          </View>

          {/* Görev Özeti */}
          <Text style={styles.section}>GÖREV ÖZETİ</Text>
          <View style={styles.card} testID={USER_DETAIL.summary}>
            {summary ? (
              <View style={styles.statGrid}>
                {stats.map((s) => (
                  <View key={s.key} style={styles.statCell}>
                    <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.muted}>Bu kullanıcı için görev özeti görünmüyor.</Text>
            )}
          </View>

          {/* Aksiyonlar */}
          <View style={styles.actions}>
            <Pressable testID={USER_DETAIL.edit} onPress={() => setEditVisible(true)} style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}>
              <Ionicons name="create-outline" size={18} color={colors.bgBase} />
              <Text style={styles.editText}>DÜZENLE</Text>
            </Pressable>
            <Pressable testID={USER_DETAIL.delete} onPress={() => setDeleting(true)} style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.deleteText}>SİL</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      ) : null}

      <UserFormModal
        visible={editVisible}
        editing={user}
        companies={companies}
        onClose={() => setEditVisible(false)}
        onSaved={() => load("refresh")}
        onAuthError={onAuthError}
      />
      <ConfirmModal
        visible={deleting}
        title="Kullanıcıyı sil?"
        message={user ? `${user.username} ve tüm görevleri kalıcı olarak silinecek.` : ""}
        busy={delBusy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  body: { padding: spacing.md, gap: spacing.sm },
  profileCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  avatarText: { color: colors.primary, fontWeight: "800", fontFamily: monoFont, fontSize: 17 },
  name: { color: colors.textPrimary, fontSize: 18, fontWeight: "800" },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  section: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, fontFamily: monoFont, marginTop: spacing.md, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  quotaHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  quotaLabel: { color: colors.primary, fontSize: 13, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  quotaVal: { color: colors.textSecondary, fontSize: 13, fontFamily: monoFont },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  barFill: { height: "100%", borderRadius: 4 },
  pctText: { fontSize: 12, fontFamily: monoFont, fontWeight: "700" },
  muted: { color: colors.textMuted, fontSize: 13 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCell: { minWidth: 88, flexGrow: 1, alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md },
  statValue: { fontSize: 24, fontWeight: "800", fontFamily: monoFont },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  editBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 13 },
  editText: { color: colors.bgBase, fontSize: 13, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: spacing.lg },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  error: { color: colors.danger, fontSize: 14, textAlign: "center", marginTop: spacing.sm },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  retryText: { color: colors.bgBase, fontWeight: "800", fontFamily: monoFont },
  pressed: { opacity: 0.65 },
});
