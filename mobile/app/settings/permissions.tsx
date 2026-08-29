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
import { AdminUser, ManagerVisibility } from "@/src/api/types";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { Option, SelectField } from "@/src/components/SelectField";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { ADMIN } from "@/constants/testIds";

export default function PermissionsScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<ManagerVisibility[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ManagerVisibility | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const onAuthError = useCallback(() => router.replace("/login"), []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [mv, us] = await Promise.all([api.managerVisibility(), api.adminUsers()]);
        setRows(mv);
        setUsers(us);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Yetkiler yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthError],
  );

  useEffect(() => { load("initial"); }, [load]);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users) m[u.id] = u.username;
    return (id: string) => m[id] || "?";
  }, [users]);

  const managerOpts: Option[] = users.filter((u) => u.role === "manager" || u.role === "admin").map((u) => ({ label: `${u.username} (${u.role === "admin" ? "Yönetici" : "Müdür"})`, value: u.id }));
  const employeeOpts: Option[] = users.map((u) => ({ label: u.username, value: u.id }));

  const openForm = () => { setManagerId(null); setEmployeeId(null); setFormError(null); setFormVisible(true); };

  const save = async () => {
    if (!managerId || !employeeId) { setFormError("Müdür ve personel seçin"); return; }
    if (managerId === employeeId) { setFormError("Aynı kişi seçilemez"); return; }
    if (rows.some((r) => r.manager_user_id === managerId && r.employee_user_id === employeeId)) {
      setFormError("Bu eşleşme zaten tanımlı");
      return;
    }
    setSaving(true); setFormError(null);
    try {
      await api.createManagerVisibility(managerId, employeeId);
      setFormVisible(false);
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setFormError(e instanceof ApiError ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDelBusy(true);
    try {
      await api.deleteManagerVisibility(deleting.id);
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
      <ScreenHeader title="YETKİLER" />
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
          <Text style={styles.hint}>Bir müdürün, kendi şirketi dışında hangi personelleri görebileceğini burada tanımlarsınız.</Text>
          {rows.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="eye-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>Henüz özel görünürlük yok</Text>
            </View>
          ) : (
            rows.map((r) => (
              <View key={r.id} testID={`${ADMIN.mvItem}-${r.id}`} style={styles.card}>
                <View style={styles.pair}>
                  <View style={styles.person}><Ionicons name="briefcase-outline" size={14} color={colors.primary} /><Text style={styles.personText}>{nameOf(r.manager_user_id)}</Text></View>
                  <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
                  <View style={styles.person}><Ionicons name="person-outline" size={14} color={colors.secondary} /><Text style={styles.personText}>{nameOf(r.employee_user_id)}</Text></View>
                </View>
                <Pressable testID={`${ADMIN.mvDelete}-${r.id}`} onPress={() => setDeleting(r)} hitSlop={10} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Pressable testID={ADMIN.mvAdd} onPress={openForm} style={[styles.fab, { bottom: insets.bottom + 20 }]}>
        <Ionicons name="add" size={26} color={colors.bgBase} />
      </Pressable>

      <Modal visible={formVisible} transparent animationType="fade" onRequestClose={() => setFormVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>YENİ GÖRÜNÜRLÜK</Text>
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <SelectField label="MÜDÜR" value={managerId} options={managerOpts} onChange={setManagerId} placeholder="Müdür seçin" testID={ADMIN.fMvManager} />
            <SelectField label="GÖRECEĞİ PERSONEL" value={employeeId} options={employeeOpts} onChange={setEmployeeId} placeholder="Personel seçin" testID={ADMIN.fMvEmployee} />
            <View style={styles.modalRow}>
              <Pressable onPress={() => setFormVisible(false)} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
                <Text style={styles.cancelText}>İPTAL</Text>
              </Pressable>
              <Pressable onPress={save} disabled={saving} testID="admin-mv-save" style={({ pressed }) => [styles.saveBtn, saving && styles.disabled, pressed && styles.pressed]}>
                {saving ? <ActivityIndicator size="small" color={colors.bgBase} /> : <Text style={styles.saveText}>EKLE</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={!!deleting}
        title="Görünürlüğü kaldır?"
        message={deleting ? `${nameOf(deleting.manager_user_id)} artık ${nameOf(deleting.employee_user_id)} kişisini görmeyecek.` : ""}
        confirmLabel="Kaldır"
        busy={delBusy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: spacing.xs },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  pair: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  person: { flexDirection: "row", alignItems: "center", gap: 4 },
  personText: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  iconBtn: { padding: 4 },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10, alignSelf: "center" },
  retryText: { color: colors.bgBase, fontWeight: "800", fontFamily: monoFont },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.82)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { color: colors.primary, fontSize: 14, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  modalRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: monoFont },
  saveBtn: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12 },
  saveText: { color: colors.bgBase, fontSize: 13, fontWeight: "800", fontFamily: monoFont },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
