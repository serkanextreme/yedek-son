import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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
import { AdminUser, Company } from "@/src/api/types";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { UserFormModal, roleLabel } from "@/src/components/admin/UserFormModal";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { ADMIN } from "@/constants/testIds";

export default function UsersScreen() {
  const insets = useSafeAreaInsets();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const onAuthError = useCallback(() => router.replace("/login"), []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [us, cs] = await Promise.all([api.adminUsers(), api.listCompanies()]);
        setUsers(us);
        setCompanies(cs);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Kullanıcılar yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthError],
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDelBusy(true);
    try {
      await api.deleteUser(deleting.id);
      setDeleting(null);
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setBanner(e instanceof ApiError ? e.message : "Silinemedi");
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="KULLANICILAR" />
      {banner ? (
        <Pressable onPress={() => setBanner(null)} style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </Pressable>
      ) : null}
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => load("initial")} style={styles.retryBtn}><Text style={styles.retryText}>Tekrar Dene</Text></Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
        >
          {users.map((u) => (
            <Pressable
              key={u.id}
              testID={`${ADMIN.userItem}-${u.id}`}
              onPress={() => router.push(`/settings/user/${u.id}` as never)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <View style={styles.avatar}><Text style={styles.avatarText}>{u.username.slice(0, 2).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{u.username}</Text>
                <Text style={styles.sub}>{roleLabel(u.role)}{u.company_name ? ` · ${u.company_name}` : " · Şirketsiz"}</Text>
                {u.quota_label ? <Text style={styles.quota}>{u.quota_label} · {u.usage_mb ?? 0} MB</Text> : null}
              </View>
              <Pressable testID={`${ADMIN.userDelete}-${u.id}`} onPress={() => setDeleting(u)} hitSlop={10} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Pressable testID={ADMIN.userAdd} onPress={() => { setEditing(null); setFormVisible(true); }} style={[styles.fab, { bottom: insets.bottom + 20 }]}>
        <Ionicons name="add" size={26} color={colors.bgBase} />
      </Pressable>

      <UserFormModal
        visible={formVisible}
        editing={editing}
        companies={companies}
        onClose={() => setFormVisible(false)}
        onSaved={(temp) => { if (temp) setBanner(`Geçici şifre: ${temp}`); load("refresh"); }}
        onAuthError={onAuthError}
      />
      <ConfirmModal
        visible={!!deleting}
        title="Kullanıcıyı sil?"
        message={deleting ? `${deleting.username} ve tüm görevleri kalıcı olarak silinecek.` : ""}
        busy={delBusy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  avatarText: { color: colors.primary, fontWeight: "800", fontFamily: monoFont, fontSize: 13 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  quota: { color: colors.textSecondary, fontSize: 11, fontFamily: monoFont, marginTop: 2 },
  iconBtn: { padding: 6 },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  banner: { backgroundColor: "rgba(74,222,128,0.12)", borderBottomWidth: 1, borderBottomColor: "rgba(74,222,128,0.4)", padding: spacing.sm },
  bannerText: { color: colors.success, fontSize: 13, fontWeight: "700", textAlign: "center", fontFamily: monoFont },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  retryText: { color: colors.bgBase, fontWeight: "800", fontFamily: monoFont },
  pressed: { opacity: 0.65 },
});
