import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { roleLabel as roleLabelFn } from "@/src/auth/roles";
import { HudHeader } from "@/src/components/HudHeader";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { LOGOUT, PROFILE, SETTINGS } from "@/constants/testIds";

const roleLabel = (role: string, isOwner?: boolean) => roleLabelFn(role, isOwner);

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={PROFILE.screen}>
      <HudHeader subtitle="Hesap" />

      <View style={styles.body}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatarGlow} />
          <Ionicons name="person" size={44} color={colors.primary} />
        </View>

        <Text style={styles.username} testID={PROFILE.username}>
          {user?.username ?? "—"}
        </Text>
        <Text style={styles.role} testID={PROFILE.role}>
          {user ? roleLabel(user.role, user.is_owner) : ""}
        </Text>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>ÇALIŞMA MODU</Text>
            <Text style={styles.infoValue}>
              {user?.workspace_mode === "team" ? "Takım" : "Kişisel"}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>ROL</Text>
            <Text style={styles.infoValue}>{user ? roleLabel(user.role, user.is_owner) : "—"}</Text>
          </View>
        </View>

        <Pressable
          testID={SETTINGS.open}
          onPress={() => router.push("/settings")}
          style={({ pressed }) => [styles.settingsBtn, pressed && styles.pressed]}
        >
          <Ionicons name="settings-outline" size={18} color={colors.primary} />
          <Text style={styles.settingsText}>Ayarlar</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ marginLeft: "auto" }} />
        </Pressable>

        <Pressable
          testID={LOGOUT.button}
          onPress={onLogout}
          style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>Çıkış Yap</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  body: { flex: 1, alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  avatarGlow: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.glow,
    opacity: 0.15,
  },
  username: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: spacing.md,
    fontFamily: monoFont,
  },
  role: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  card: {
    width: "100%",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.xl,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  infoLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 1, fontFamily: monoFont },
  infoValue: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  divider: { height: 1, backgroundColor: colors.border },
  settingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: "100%",
    marginTop: spacing.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  settingsText: { color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    width: "100%",
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255, 0, 60, 0.4)",
    backgroundColor: "rgba(255, 0, 60, 0.08)",
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  pressed: { opacity: 0.7 },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: "700" },
});
