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
import { LicenseDoc } from "@/src/api/types";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { Option, SelectField } from "@/src/components/SelectField";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { ADMIN } from "@/constants/testIds";

const TYPE_LABEL: Record<string, string> = { trial: "Deneme (30 gün)", monthly: "Aylık", yearly: "Yıllık", lifetime: "Ömür Boyu" };
const statusColor = (s: string) => (s === "active" ? colors.success : s === "revoked" ? colors.danger : s === "expired" ? colors.warning : colors.textMuted);
const statusLabel = (s: string) => ({ active: "Aktif", available: "Boşta", revoked: "İptal", expired: "Süresi Doldu" }[s] || s);

export default function LicensesScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<LicenseDoc[]>([]);
  const [types, setTypes] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [genType, setGenType] = useState("monthly");
  const [count, setCount] = useState("1");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LicenseDoc | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const onAuthError = useCallback(() => router.replace("/login"), []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [lic, ty] = await Promise.all([api.licenses(), api.licenseTypes().catch(() => ({ types: ["trial", "monthly", "yearly", "lifetime"] }))]);
        setRows(lic.licenses || []);
        setTypes((ty.types || []).map((t) => ({ label: TYPE_LABEL[t] || t, value: t })));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Lisanslar yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthError],
  );

  useEffect(() => { load("initial"); }, [load]);

  const generate = async () => {
    const n = parseInt(count, 10);
    if (!n || n < 1 || n > 100) { setFormError("Adet 1-100 arası olmalı"); return; }
    setSaving(true); setFormError(null);
    try {
      const res = await api.generateLicenses(genType, n);
      setFormVisible(false);
      setBanner(`${res.created} lisans üretildi`);
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setFormError(e instanceof ApiError ? e.message : "Üretilemedi");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDelBusy(true);
    try {
      await api.deleteLicense(deleting.id);
      setDeleting(null);
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="LİSANSLAR" />
      {banner ? <Pressable onPress={() => setBanner(null)} style={styles.banner}><Text style={styles.bannerText}>{banner}</Text></Pressable> : null}
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => load("initial")} style={styles.retryBtn}><Text style={styles.retryText}>Tekrar Dene</Text></Pressable>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="key-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Henüz lisans yok</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
        >
          {rows.map((l) => (
            <View key={l.id} testID={`${ADMIN.licItem}-${l.id}`} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.key} selectable>{l.key}</Text>
                <Text style={styles.sub}>{TYPE_LABEL[l.type] || l.type}{l.assigned_to_username ? ` · ${l.assigned_to_username}` : ""}{l.expires_at ? ` · bitiş ${String(l.expires_at).slice(0, 10)}` : ""}</Text>
              </View>
              <View style={[styles.statusChip, { borderColor: statusColor(l.status) }]}>
                <Text style={[styles.statusText, { color: statusColor(l.status) }]}>{statusLabel(l.status)}</Text>
              </View>
              <Pressable testID={`${ADMIN.licDelete}-${l.id}`} onPress={() => setDeleting(l)} hitSlop={10} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <Pressable testID={ADMIN.licGenerate} onPress={() => { setCount("1"); setFormError(null); setFormVisible(true); }} style={[styles.fab, { bottom: insets.bottom + 20 }]}>
        <Ionicons name="add" size={26} color={colors.bgBase} />
      </Pressable>

      <Modal visible={formVisible} transparent animationType="fade" onRequestClose={() => setFormVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>LİSANS ÜRET</Text>
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <SelectField label="LİSANS TÜRÜ" value={genType} options={types} onChange={setGenType} testID={ADMIN.fLicType} />
            <Text style={styles.label}>ADET</Text>
            <TextInput testID={ADMIN.fLicCount} value={count} onChangeText={(t) => setCount(t.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.textMuted} style={styles.input} />
            <View style={styles.modalRow}>
              <Pressable onPress={() => setFormVisible(false)} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
                <Text style={styles.cancelText}>İPTAL</Text>
              </Pressable>
              <Pressable onPress={generate} disabled={saving} testID="admin-license-generate-save" style={({ pressed }) => [styles.saveBtn, saving && styles.disabled, pressed && styles.pressed]}>
                {saving ? <ActivityIndicator size="small" color={colors.bgBase} /> : <Text style={styles.saveText}>ÜRET</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={!!deleting}
        title="Lisansı sil?"
        message={deleting ? `${deleting.key} kalıcı olarak silinecek.` : ""}
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
  key: { color: colors.textPrimary, fontSize: 14, fontWeight: "700", fontFamily: monoFont },
  sub: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  statusChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: "800", fontFamily: monoFont },
  iconBtn: { padding: 4 },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  retryText: { color: colors.bgBase, fontWeight: "800", fontFamily: monoFont },
  banner: { backgroundColor: "rgba(74,222,128,0.12)", borderBottomWidth: 1, borderBottomColor: "rgba(74,222,128,0.4)", padding: spacing.sm },
  bannerText: { color: colors.success, fontSize: 13, fontWeight: "700", textAlign: "center", fontFamily: monoFont },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.82)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 400, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { color: colors.primary, fontSize: 14, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  label: { color: colors.textMuted, fontSize: 11, letterSpacing: 1, fontFamily: monoFont, marginTop: spacing.xs },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, color: colors.textPrimary, fontSize: 15 },
  modalRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: monoFont },
  saveBtn: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12 },
  saveText: { color: colors.bgBase, fontSize: 13, fontWeight: "800", fontFamily: monoFont },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
