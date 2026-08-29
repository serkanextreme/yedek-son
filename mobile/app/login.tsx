import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { HudHeader } from "@/src/components/HudHeader";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { LOGIN } from "@/constants/testIds";

export default function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (loading) return;
    setError(null);
    if (!username.trim() || !password) {
      setError("Kullanıcı adı ve şifre gerekli");
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      router.replace("/tasks");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Giriş başarısız. Tekrar deneyin.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.gradient}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
          <HudHeader subtitle="Enterprise Assistant" />

          <View style={styles.hero}>
            <Text style={styles.heroTitle}>SİSTEME GİRİŞ</Text>
            <Text style={styles.heroSub}>
              Devam etmek için kimlik bilgilerinizi girin
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.field}>
              <Ionicons name="person-outline" size={18} color={colors.textMuted} />
              <TextInput
                testID={LOGIN.emailInput}
                value={username}
                onChangeText={setUsername}
                placeholder="Kullanıcı adı"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
              <TextInput
                testID={LOGIN.passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Şifre"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                style={styles.input}
                returnKeyType="go"
                onSubmitEditing={onSubmit}
              />
            </View>

            {!!error && (
              <View testID="login-error" style={styles.errorBox}>
                <Ionicons name="warning-outline" size={14} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              testID={LOGIN.submitButton}
              onPress={onSubmit}
              disabled={loading}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                loading && styles.buttonDisabled,
              ]}
            >
              {loading ? (
                <ActivityIndicator color={colors.bgBase} />
              ) : (
                <>
                  <Text style={styles.buttonText}>GİRİŞ YAP</Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.bgBase} />
                </>
              )}
            </Pressable>
          </View>

          <Text style={styles.footer}>SYS.ONLINE · SECURE CHANNEL</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1, backgroundColor: colors.bgBase },
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: spacing.lg },
  hero: { marginTop: spacing.xl, marginBottom: spacing.lg },
  heroTitle: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 2,
    fontFamily: monoFont,
  },
  heroSub: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: 14,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 0, 60, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 0, 60, 0.4)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 15,
    marginTop: spacing.xs,
  },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: colors.bgBase,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 2,
    fontFamily: monoFont,
  },
  footer: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    textAlign: "center",
    marginTop: "auto",
    marginBottom: spacing.lg,
    fontFamily: monoFont,
  },
});
