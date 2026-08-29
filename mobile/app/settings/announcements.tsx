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
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { Announcement } from "@/src/api/types";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { Option, SelectField } from "@/src/components/SelectField";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { ADMIN } from "@/constants/testIds";

const SEVERITY: Option[] = [
  { label: "Bilgi", value: "info" },
  { label: "Uyarı", value: "warning" },
  { label: "Kritik", value: "critical" },
];
const sevColor = (s: string) => (s === "critical" ? colors.danger : s === "warning" ? colors.warning : colors.primary);
const sevLabel = (s: string) => SEVERITY.find((o) => o.value === s)?.label || s;

export default function AnnouncementsScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState("info");
  const [requireAck, setRequireAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onAuthError = useCallback(() => router.replace("/login"), []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const all = await api.announcements();
        // Soft-delete backend: sadece aktif duyuruları göster (silinen kaybolur).
        setRows(all.filter((a) => a.is_active !== false));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Duyurular yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthError],
  );

  useEffect(() => { load("initial"); }, [load]);

  const openCreate = () => {
    setTitle(""); setMessage(""); setSeverity("info"); setRequireAck(false); setFormError(null);
    setFormVisible(true);
  };

  const save = async () => {
    if (!title.trim() || !message.trim()) { setFormError("Başlık ve mesaj zorunlu"); return; }
    setSaving(true); setFormError(null);
    try {
      await api.createAnnouncement({ title: title.trim(), message: message.trim(), severity, target_type: "all", require_ack: requireAck });
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
      await api.deleteAnnouncement(deleting.id);
      setDeleting(null);
      load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setBanner(e instanceof ApiError ? e.message : "Silinemedi");
      setDeleting(null);
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="DUYURULAR" />
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
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="megaphone-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Henüz duyuru yok</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
        >
          {rows.map((a) => (
            <View key={a.id} testID={`${ADMIN.annItem}-${a.id}`} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={[styles.sevDot, { backgroundColor: sevColor(a.severity) }]} />
                <Text style={styles.cardTitle} numberOfLines={1}>{a.title}</Text>
                <View style={[styles.sevChip, { borderColor: sevColor(a.severity) }]}>
                  <Text style={[styles.sevChipText, { color: sevColor(a.severity) }]}>{sevLabel(a.severity)}</Text>
                </View>
                <Pressable testID={`${ADMIN.annDelete}-${a.id}`} onPress={() => setDeleting(a)} hitSlop={10} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
              <Text style={styles.cardMsg}>{a.message}</Text>
              <Text style={styles.cardMeta}>
                {a.created_by_username ? `${a.created_by_username} · ` : ""}{a.require_ack ? "Onay gerekli" : "Bilgilendirme"}{a.is_active === false ? " · Pasif" : ""}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      <Pressable testID={ADMIN.annAdd} onPress={openCreate} style={[styles.fab, { bottom: insets.bottom + 20 }]}>
        <Ionicons name="add" size={26} color={colors.bgBase} />
      </Pressable>

      <Modal visible={formVisible} transparent animationType="fade" onRequestClose={() => setFormVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>YENİ DUYURU</Text>
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <Text style={styles.label}>BAŞLIK</Text>
            <TextInput testID={ADMIN.fAnnTitle} value={title} onChangeText={setTitle} placeholder="Duyuru başlığı" placeholderTextColor={colors.textMuted} style={styles.input} />
            <Text style={styles.label}>MESAJ</Text>
            <TextInput testID={ADMIN.fAnnMessage} value={message} onChangeText={setMessage} placeholder="Mesaj metni" placeholderTextColor={colors.textMuted} style={[styles.input, styles.textarea]} multiline />
            <SelectField label="ÖNEM" value={severity} options={SEVERITY} onChange={setSeverity} testID={ADMIN.fAnnSeverity} />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Okundu onayı iste</Text>
              <Switch value={requireAck} onValueChange={setRequireAck} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.bgBase} />
            </View>
            <View style={styles.modalRow}>
              <Pressable onPress={() => setFormVisible(false)} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
                <Text style={styles.cancelText}>İPTAL</Text>
              </Pressable>
              <Pressable testID={ADMIN.annSave} onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, saving && styles.disabled, pressed && styles.pressed]}>
                {saving ? <ActivityIndicator size="small" color={colors.bgBase} /> : <Text style={styles.saveText}>YAYINLA</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={!!deleting}
        title="Duyuruyu sil?"
        message={deleting ? `"${deleting.title}" kalıcı olarak silinecek.` : ""}
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
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sevDot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  sevChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  sevChipText: { fontSize: 10, fontWeight: "800", fontFamily: monoFont },
  iconBtn: { padding: 4 },
  cardMsg: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  cardMeta: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  retryText: { color: colors.bgBase, fontWeight: "800", fontFamily: monoFont },
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", elevation: 6 },
  banner: { backgroundColor: "rgba(255,0,60,0.12)", borderBottomWidth: 1, borderBottomColor: "rgba(255,0,60,0.4)", padding: spacing.sm },
  bannerText: { color: colors.danger, fontSize: 13, fontWeight: "700", textAlign: "center", fontFamily: monoFont },
  backdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.82)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 440, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { color: colors.primary, fontSize: 14, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  label: { color: colors.textMuted, fontSize: 11, letterSpacing: 1, fontFamily: monoFont, marginTop: spacing.xs },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, color: colors.textPrimary, fontSize: 15 },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  switchLabel: { color: colors.textPrimary, fontSize: 14 },
  modalRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: monoFont },
  saveBtn: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12 },
  saveText: { color: colors.bgBase, fontSize: 13, fontWeight: "800", fontFamily: monoFont },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
