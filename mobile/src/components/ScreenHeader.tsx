import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, monoFont, spacing } from "@/src/theme/colors";
import { SETTINGS } from "@/constants/testIds";

// Ortak ekran başlığı — geri düğmesi + başlık. Admin/Ayarlar ekranlarında.
export function ScreenHeader({ title, testID }: { title: string; testID?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID={SETTINGS.back} onPress={() => router.back()} hitSlop={12} style={styles.back}>
        <Ionicons name="chevron-back" size={26} color={colors.primary} />
      </Pressable>
      <Text style={styles.title} testID={testID} numberOfLines={1}>{title}</Text>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgBase,
  },
  back: { padding: 4 },
  title: { flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont, textAlign: "center" },
  spacer: { width: 34 },
});
