import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { api, ApiError } from "@/src/api/client";
import { AdminUser, Company } from "@/src/api/types";
import { Option, SelectField } from "@/src/components/SelectField";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { ADMIN } from "@/constants/testIds";

export const ROLE_OPTS: Option[] = [
  { label: "Yönetici", value: "admin" },
  { label: "Müdür", value: "manager" },
  { label: "Personel", value: "employee" },
];
export const roleLabel = (r: string) => ROLE_OPTS.find((o) => o.value === r)?.label || r;
const NO_COMPANY = "__none__";

// Kullanıcı oluştur/düzenle modalı — Kullanıcılar listesi + Kullanıcı Detay ekranı ortak kullanır.
export function UserFormModal({
  visible,
  editing,
  companies,
  onClose,
  onSaved,
  onAuthError,
}: {
  visible: boolean;
  editing: AdminUser | null;
  companies: Company[];
  onClose: () => void;
  onSaved: (tempPassword?: string) => void;
  onAuthError: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("employee");
  const [companyId, setCompanyId] = useState<string>(NO_COMPANY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setUsername(editing?.username || "");
    setPassword("");
    setRole(editing?.role || "employee");
    setCompanyId(editing?.company_id || NO_COMPANY);
    setError(null);
  }, [visible, editing]);

  const companyOpts: Option[] = [{ label: "Şirketsiz", value: NO_COMPANY }, ...companies.map((c) => ({ label: c.name, value: c.id }))];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        // Boş = şirketi kaldır ("" backend'de unset yapar). Aksi halde company_id gönder.
        const body: { role?: string; company_id?: string | null; new_password?: string } = {
          role,
          company_id: companyId === NO_COMPANY ? "" : companyId,
        };
        if (password.trim()) body.new_password = password.trim();
        await api.updateUser(editing.id, body);
        onSaved();
      } else {
        const cid = companyId === NO_COMPANY ? undefined : companyId;
        const res = await api.createUser({ username: username.trim(), password: password.trim() || undefined, role, company_id: cid });
        onSaved(res.temp_password);
      }
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{editing ? "KULLANICIYI DÜZENLE" : "YENİ KULLANICI"}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!editing && (
            <>
              <Text style={styles.label}>KULLANICI ADI</Text>
              <TextInput testID={ADMIN.fUsername} value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="kullanici" placeholderTextColor={colors.textMuted} style={styles.input} />
            </>
          )}
          <Text style={styles.label}>{editing ? "YENİ ŞİFRE (opsiyonel)" : "ŞİFRE (boşsa otomatik üretilir)"}</Text>
          <TextInput testID={ADMIN.fPassword} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••" placeholderTextColor={colors.textMuted} style={styles.input} />
          <SelectField label="ROL" value={role} options={ROLE_OPTS} onChange={setRole} testID={ADMIN.fRole} />
          <SelectField label="ŞİRKET" value={companyId} options={companyOpts} onChange={setCompanyId} testID={ADMIN.fCompany} />
          <View style={styles.modalRow}>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>İPTAL</Text>
            </Pressable>
            <Pressable testID={ADMIN.userSave} onPress={save} disabled={busy || (!editing && !username.trim())} style={({ pressed }) => [styles.saveBtn, (busy || (!editing && !username.trim())) && styles.disabled, pressed && styles.pressed]}>
              {busy ? <ActivityIndicator size="small" color={colors.bgBase} /> : <Text style={styles.saveText}>KAYDET</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.82)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { color: colors.primary, fontSize: 14, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  label: { color: colors.textMuted, fontSize: 11, letterSpacing: 1, fontFamily: monoFont, marginTop: spacing.xs },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, color: colors.textPrimary, fontSize: 15 },
  modalRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: monoFont },
  saveBtn: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12 },
  saveText: { color: colors.bgBase, fontSize: 13, fontWeight: "800", fontFamily: monoFont },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
