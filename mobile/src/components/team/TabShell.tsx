// Ortak durum kabuğu — Takım alt sekmeleri için yükleniyor / hata / boş +
// aşağı çekerek yenileme davranışını tek yerde toplar.
import { Ionicons } from "@expo/vector-icons";
import { ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, monoFont, radius, spacing } from "@/src/theme/colors";

type Props = {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitle?: string;
  emptySub?: string;
  onRetry: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
  testID?: string;
};

export function TabShell({
  loading,
  error,
  empty,
  emptyIcon = "cube-outline",
  emptyTitle = "Kayıt yok",
  emptySub,
  onRetry,
  refreshing,
  onRefresh,
  children,
  testID,
}: Props) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.danger} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={onRetry} style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}>
          <Ionicons name="refresh" size={16} color={colors.bgBase} />
          <Text style={styles.retryText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  }
  if (empty) {
    return (
      <View style={styles.center} testID={testID}>
        <Ionicons name={emptyIcon} size={40} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
        {emptySub ? <Text style={styles.emptySub}>{emptySub}</Text> : null}
      </View>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={styles.list}
      testID={testID}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      {children}
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
  errorText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  retryText: { color: colors.bgBase, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptySub: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  pressed: { opacity: 0.7 },
});
