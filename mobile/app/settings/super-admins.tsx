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
import { AdminUser, Company, SuperAdmin } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { isOwner, roleLabel } from "@/src/auth/roles";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { SUPERADMIN } from "@/constants/testIds";

const HOUR_OPTIONS = [
  { label: "2s", value: 2 },
  { label: "8s", value: 8 },
  { label: "1g", value: 24 },
  { label: "3g", value: 72 },
  { label: "1h", value: 168 },
];

const fmtUntil = (iso?: string | null) => {
  if (!iso) return null;
  try {
    const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (mins <= 0) return "süresi doldu";
    if (mins < 60) return `${mins} dk kaldı`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs} saat kaldı`;
    return `${Math.round(hrs / 24)} gün kaldı`;
  } catch {
    return null;
  }
};

export default function SuperAdminsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const owner = isOwner(user);

  const [supers, setSupers] = useState<SuperAdmin[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [grantHours, setGrantHours] = useState<Record<string, number>>({});
  const [revoking, setRevoking] = useState<SuperAdmin | null>(null);
  const [revBusy, setRevBusy] = useState(false);

  const onAuthError = useCallback(() => router.replace("/login"), []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [sa, users, comps] = await Promise.all([
          api.superAdmins(),
          api.adminUsers(),
          api.listCompanies().catch(() => [] as Company[]),
        ]);
        setSupers(sa.super_admins || []);
        setAdmins((users || []).filter((u) => u.role === "admin"));
        setCompanies(comps || []);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthError],
  );

  useEffect(() => { load("initial"); }, [load]);

  const patchCaps = async (uid: string, patch: Record<string, unknown>) => {
    setBusy(uid);
    try {
      await api.setAdminCaps(uid, patch);
      await load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Güncellenemedi");
    } finally {
      setBusy(null);
    }
  };

  const toggleExtra = (a: AdminUser, cid: string) => {
    if (cid === a.company_id) return;
    const cur = a.admin_caps?.extra_company_ids || [];
    const next = cur.includes(cid) ? cur.filter((c) => c !== cid) : [...cur, cid];
    patchCaps(a.id, { extra_company_ids: next });
  };

  const promote = async (uid: string) => {
    setBusy(uid);
    try {
      await api.grantSuperAdmin(uid, grantHours[uid] || 24);
      await load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Atanamadı");
    } finally {
      setBusy(null);
    }
  };

  const confirmRevoke = async () => {
    if (!revoking) return;
    setRevBusy(true);
    try {
      await api.revokeSuperAdmin(revoking.id);
      setRevoking(null);
      await load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Geri alınamadı");
    } finally {
      setRevBusy(false);
    }
  };

  return (
    <View style={styles.container} testID={SUPERADMIN.screen}>
      <ScreenHeader title="SÜPER YÖNETİCİ" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.section}>AKTİF SÜPER YÖNETİCİLER</Text>
          <View style={styles.card} testID={SUPERADMIN.list}>
            {supers.map((s, i) => (
              <View key={s.id}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.rowBetween}>
                  <View style={styles.rowLeft}>
                    <Ionicons name={s.is_owner ? "star" : "time-outline"} size={16} color={s.is_owner ? colors.warning : colors.primary} />
                    <Text style={styles.username}>{s.username}</Text>
                    <Text style={styles.tag}>{s.is_owner ? "KURUCU" : "SÜRELİ"}</Text>
                    {!s.is_owner && s.super_admin_until ? (
                      <Text style={styles.until}>{fmtUntil(s.super_admin_until)}</Text>
                    ) : null}
                  </View>
                  {!s.is_owner && owner ? (
                    <Pressable testID={SUPERADMIN.revoke(s.id)} onPress={() => setRevoking(s)} disabled={busy === s.id} style={({ pressed }) => [styles.revokeBtn, pressed && styles.pressed]}>
                      <Text style={styles.revokeText}>Geri Al</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.section}>YÖNETİCİLER — ÖZEL FONKSİYONLAR</Text>
          <Text style={styles.hint}>
            Her yönetici yalnızca kendi şirketini görür. Aşağıdan ek şirket görme,
            yeni şirket açma ve şirket görevlerini görme yetkisi tanıyabilirsin.
            {!owner ? " (Süreli süper yönetici atama yalnızca Kurucu'ya aittir.)" : ""}
          </Text>

          {admins.length === 0 ? (
            <Text style={styles.empty}>Henüz yönetici yok.</Text>
          ) : (
            admins.map((a) => {
              const caps = a.admin_caps || {};
              const extra = caps.extra_company_ids || [];
              return (
                <View key={a.id} style={styles.adminCard} testID={SUPERADMIN.adminRow(a.id)}>
                  <View style={styles.rowLeft}>
                    <Text style={styles.username}>{a.username}</Text>
                    <Text style={styles.tag}>{roleLabel(a.role)}</Text>
                    {a.company_name ? <Text style={styles.until}>· {a.company_name}</Text> : null}
                  </View>

                  <View style={styles.chipRow}>
                    <Pressable
                      testID={SUPERADMIN.capViewTasks(a.id)}
                      onPress={() => patchCaps(a.id, { can_view_company_tasks: !caps.can_view_company_tasks })}
                      disabled={busy === a.id}
                      style={[styles.chip, caps.can_view_company_tasks && styles.chipOn]}
                    >
                      <Ionicons name="eye-outline" size={13} color={caps.can_view_company_tasks ? colors.success : colors.textMuted} />
                      <Text style={[styles.chipText, caps.can_view_company_tasks && styles.chipTextOn]}>Şirket görevleri</Text>
                    </Pressable>
                    <Pressable
                      testID={SUPERADMIN.capCreateCompany(a.id)}
                      onPress={() => patchCaps(a.id, { can_create_company: !caps.can_create_company })}
                      disabled={busy === a.id}
                      style={[styles.chip, caps.can_create_company && styles.chipOn]}
                    >
                      <Ionicons name="add-circle-outline" size={13} color={caps.can_create_company ? colors.success : colors.textMuted} />
                      <Text style={[styles.chipText, caps.can_create_company && styles.chipTextOn]}>Şirket açabilsin</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.miniLabel}>EK ŞİRKET GÖRME</Text>
                  <View style={styles.chipRow}>
                    {companies.map((c) => {
                      const own = c.id === a.company_id;
                      const active = own || extra.includes(c.id);
                      return (
                        <Pressable
                          key={c.id}
                          testID={SUPERADMIN.extraCompany(a.id, c.id)}
                          onPress={() => toggleExtra(a, c.id)}
                          disabled={busy === a.id || own}
                          style={[styles.chip, active && styles.chipCyan, own && styles.chipDisabled]}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextCyan]}>{c.name}{own ? " ★" : ""}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {owner ? (
                    <View style={styles.grantRow}>
                      <Text style={styles.miniLabel}>SÜRELİ SÜPER YÖNETİCİ:</Text>
                      <View style={styles.chipRow}>
                        {HOUR_OPTIONS.map((o) => (
                          <Pressable
                            key={o.value}
                            testID={`${SUPERADMIN.grantHours(a.id)}-${o.value}`}
                            onPress={() => setGrantHours((p) => ({ ...p, [a.id]: o.value }))}
                            style={[styles.hourChip, (grantHours[a.id] || 24) === o.value && styles.hourChipOn]}
                          >
                            <Text style={[styles.hourText, (grantHours[a.id] || 24) === o.value && styles.hourTextOn]}>{o.label}</Text>
                          </Pressable>
                        ))}
                        <Pressable testID={SUPERADMIN.promote(a.id)} onPress={() => promote(a.id)} disabled={busy === a.id} style={({ pressed }) => [styles.ataBtn, pressed && styles.pressed]}>
                          {busy === a.id ? <ActivityIndicator size="small" color={colors.bgBase} /> : <Text style={styles.ataText}>ATA</Text>}
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <ConfirmModal
        visible={!!revoking}
        title="Süper yönetici geri alınsın mı?"
        message={revoking ? `${revoking.username} eski rolüne dönecek.` : ""}
        busy={revBusy}
        onConfirm={confirmRevoke}
        onClose={() => setRevoking(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  body: { padding: spacing.md, gap: spacing.sm },
  section: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, fontFamily: monoFont, marginTop: spacing.md, marginBottom: spacing.xs },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  adminCard: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap", flex: 1 },
  username: { color: colors.primary, fontSize: 14, fontWeight: "700", fontFamily: monoFont },
  tag: { color: colors.warning, fontSize: 10, fontFamily: monoFont, letterSpacing: 1 },
  until: { color: colors.textMuted, fontSize: 11 },
  revokeBtn: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  revokeText: { color: colors.danger, fontSize: 11, fontWeight: "700", fontFamily: monoFont },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6 },
  chipOn: { borderColor: colors.success, backgroundColor: "rgba(74,222,128,0.10)" },
  chipCyan: { borderColor: colors.borderStrong, backgroundColor: "rgba(0,240,255,0.10)" },
  chipDisabled: { opacity: 0.75 },
  chipText: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  chipTextOn: { color: colors.success },
  chipTextCyan: { color: colors.primary },
  miniLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1, fontFamily: monoFont, marginTop: spacing.xs },
  grantRow: { marginTop: spacing.xs, gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  hourChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6 },
  hourChipOn: { borderColor: colors.warning, backgroundColor: "rgba(255,184,0,0.12)" },
  hourText: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  hourTextOn: { color: colors.warning },
  ataBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 7, alignItems: "center", justifyContent: "center" },
  ataText: { color: colors.bgBase, fontSize: 12, fontWeight: "800", fontFamily: monoFont },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  empty: { color: colors.textMuted, fontSize: 14 },
  pressed: { opacity: 0.65 },
});
