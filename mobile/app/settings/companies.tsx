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
import { Company } from "@/src/api/types";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { ADMIN } from "@/constants/testIds";

export default function CompaniesScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  const onAuthError = useCallback(() => router.replace("/login"), []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        setRows(await api.listCompanies());
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Şirketler yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthError],
  );

  useEffect(() => { load("initial"); }, [load]);

  const openForm = (c: Company | null) => {
    setEditing(c); setName(c?.name || ""); setFormError(null); setFormVisible(true);
  };

  const save = async () => {
    if (name.trim().length < 2) { setFormError("En az 2 karakter"); return; }
    setSaving(true); setFormError(null);
    try {
      if (editing) await api.updateCompany(editing.id, name.trim());
      else await api.createCompany(name.trim());
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
    setDelBusy(true); setDelError(null);
    try {
      await api.deleteCompany(deleting.id);
      setDeleting(null);
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setDelError(e instanceof ApiError ? e.message : "Silinemedi");
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="ŞİRKETLER" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => load("initial")} style={styles.retryBtn}><Text style={styles.retryText}>Tekrar Dene</Text></Pressable>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="business-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Henüz şirket yok</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
        >
          {rows.map((c) => (
            <Pressable key={c.id} testID={`${ADMIN.compItem}-${c.id}`} onPress={() => openForm(c)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
              <View style={styles.icon}><Ionicons name="business" size={18} color={colors.primary} /></View>
              <Text style={styles.name}>{c.name}</Text>
              <Pressable testID={`${ADMIN.compDelete}-${c.id}`} onPress={() => { setDelError(null); setDeleting(c); }} hitSlop={10} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Pressable testID={ADMIN.compAdd} onPress={() => openForm(null)} style={[styles.fab, { bottom: insets.bottom + 20 }]}>
        <Ionicons name="add" size={26} color={colors.bgBase} />
      </Pressable>

      <Modal visible={formVisible} transparent animationType="fade" onRequestClose={() => setFormVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? "ŞİRKETİ DÜZENLE" : "YENİ ŞİRKET"}</Text>
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <Text style={styles.label}>ŞİRKET ADI</Text>
            <TextInput testID={ADMIN.fCompName} value={name} onChangeText={setName} placeholder="Şirket adı" placeholderTextColor={colors.textMuted} style={styles.input} autoFocus />
            <View style={styles.modalRow}>
              <Pressable onPress={() => setFormVisible(false)} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
                <Text style={styles.cancelText}>İPTAL</Text>
              </Pressable>
              <Pressable testID={ADMIN.compSave} onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, saving && styles.disabled, pressed && styles.pressed]}>
                {saving ? <ActivityIndicator size="small" color={colors.bgBase} /> : <Text style={styles.saveText}>KAYDET</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={!!deleting}
        title="Şirketi sil?"
        message={(deleting ? `"${deleting.name}" silinecek. ` : "") + (delError || "Şirkete bağlı kullanıcılar varsa işlem reddedilebilir.")}
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
  icon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  name: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  iconBtn: { padding: 4 },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  retryText: { color: colors.bgBase, fontWeight: "800", fontFamily: monoFont },
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
