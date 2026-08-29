import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { DigestSettings } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { isAdminLike, isSuperAdmin } from "@/src/auth/roles";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { SETTINGS } from "@/constants/testIds";

const ADMIN_LINKS: { key: string; label: string; icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap; route: string; testID: string; superOnly?: boolean }[] = [
  { key: "users", label: "Kullanıcılar", icon: "people-outline", route: "/settings/users", testID: SETTINGS.navUsers },
  { key: "announcements", label: "Duyurular", icon: "megaphone-outline", route: "/settings/announcements", testID: SETTINGS.navAnnouncements },
  { key: "companies", label: "Şirketler", icon: "business-outline", route: "/settings/companies", testID: SETTINGS.navCompanies },
  { key: "permissions", label: "Yetkiler (Müdür Görünürlüğü)", icon: "eye-outline", route: "/settings/permissions", testID: SETTINGS.navPermissions },
  { key: "licenses", label: "Lisanslar", icon: "key-outline", route: "/settings/licenses", testID: SETTINGS.navLicenses, superOnly: true },
  { key: "super", label: "Süper Yönetici", icon: "shield-checkmark-outline", route: "/settings/super-admins", testID: SETTINGS.navSuperAdmins, superOnly: true },
  { key: "clientlogs", label: "Hata Radarı", icon: "pulse-outline", route: "/settings/client-logs", testID: SETTINGS.navClientLogs, superOnly: true },
];

const SettingRow = ({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID: string }) => (
  <View style={styles.switchRow}>
    <Text style={styles.switchLabel}>{label}</Text>
    <Switch
      testID={testID}
      value={value}
      onValueChange={onChange}
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={colors.bgBase}
    />
  </View>
);

export default function SettingsHome() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [digest, setDigest] = useState<DigestSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .digestSettings()
      .then(setDigest)
      .catch(() => setDigest({ digest_hour: 8, digest_enabled: true, digest_detailed: false, digest_skip_weekend: false }))
      .finally(() => setLoading(false));
  }, []);

  const patch = (p: Partial<DigestSettings>) => {
    setDigest((d) => (d ? { ...d, ...p } : d));
    setSaved(false);
  };

  const save = async () => {
    if (!digest) return;
    setSaving(true);
    try {
      await api.saveDigestSettings(digest);
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/login");
    } finally {
      setSaving(false);
    }
  };

  const links = ADMIN_LINKS.filter((l) => (l.superOnly ? isSuperAdmin(user) : isAdminLike(user)));

  return (
    <View style={[styles.container]} testID={SETTINGS.screen}>
      <ScreenHeader title="AYARLAR" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.section}>GÜNLÜK ÖZET BİLDİRİMİ</Text>
        <View style={styles.card}>
          {loading || !digest ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
          ) : (
            <>
              <SettingRow label="Günlük özet bildirimi açık" value={digest.digest_enabled} onChange={(v) => patch({ digest_enabled: v })} testID={SETTINGS.digestEnabled} />
              <View style={styles.divider} />
              <View style={styles.hourRow}>
                <Text style={styles.switchLabel}>Gönderim saati</Text>
                <View style={styles.stepper}>
                  <Pressable testID={SETTINGS.digestHourDec} onPress={() => patch({ digest_hour: (digest.digest_hour + 23) % 24 })} style={styles.stepBtn}>
                    <Ionicons name="remove" size={18} color={colors.primary} />
                  </Pressable>
                  <Text style={styles.hourText}>{String(digest.digest_hour).padStart(2, "0")}:00</Text>
                  <Pressable testID={SETTINGS.digestHourInc} onPress={() => patch({ digest_hour: (digest.digest_hour + 1) % 24 })} style={styles.stepBtn}>
                    <Ionicons name="add" size={18} color={colors.primary} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.divider} />
              <SettingRow label="Detaylı özet (görev başlıkları)" value={digest.digest_detailed} onChange={(v) => patch({ digest_detailed: v })} testID={SETTINGS.digestDetailed} />
              <View style={styles.divider} />
              <SettingRow label="Hafta sonu gönderme" value={digest.digest_skip_weekend} onChange={(v) => patch({ digest_skip_weekend: v })} testID={SETTINGS.digestSkipWeekend} />
              <Pressable testID={SETTINGS.digestSave} onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtn, saving && styles.disabled, pressed && styles.pressed]}>
                {saving ? <ActivityIndicator size="small" color={colors.bgBase} /> : <Text style={styles.saveText}>{saved ? "✓ KAYDEDİLDİ" : "KAYDET"}</Text>}
              </Pressable>
            </>
          )}
        </View>

        {links.length > 0 && (
          <>
            <Text style={styles.section}>YÖNETİM PANELLERİ</Text>
            <View style={styles.card}>
              {links.map((l, i) => (
                <View key={l.key}>
                  {i > 0 && <View style={styles.divider} />}
                  <Pressable testID={l.testID} onPress={() => router.push(l.route as never)} style={({ pressed }) => [styles.navRow, pressed && styles.pressed]}>
                    <Ionicons name={l.icon} size={20} color={colors.primary} />
                    <Text style={styles.navLabel}>{l.label}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  body: { padding: spacing.md, gap: spacing.sm },
  section: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, fontFamily: monoFont, marginTop: spacing.md, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md },
  switchLabel: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  hourRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepBtn: { width: 34, height: 34, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  hourText: { color: colors.primary, fontSize: 16, fontWeight: "800", fontFamily: monoFont, minWidth: 56, textAlign: "center" },
  divider: { height: 1, backgroundColor: colors.border },
  saveBtn: { alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, marginVertical: spacing.md },
  saveText: { color: colors.bgBase, fontSize: 13, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  navRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  navLabel: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
