import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { HudHeader } from "@/src/components/HudHeader";
import { CategoryTab } from "@/src/components/team/CategoryTab";
import { HeatmapTab } from "@/src/components/team/HeatmapTab";
import { OverdueTab } from "@/src/components/team/OverdueTab";
import { PeopleTab } from "@/src/components/team/PeopleTab";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TEAM } from "@/constants/testIds";

type SubTab = "people" | "categories" | "overdue" | "heatmap";

const TABS: { key: SubTab; label: string; testID: string }[] = [
  { key: "people", label: "KİŞİLER", testID: TEAM.subPeople },
  { key: "categories", label: "İŞ KOLLARI", testID: TEAM.subCategories },
  { key: "overdue", label: "GECİKENLER", testID: TEAM.subOverdue },
  { key: "heatmap", label: "ISI HARİTASI", testID: TEAM.subHeatmap },
];

export default function TeamScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const [tab, setTab] = useState<SubTab>("people");

  const onAuthError = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [logout]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={TEAM.screen}>
      <HudHeader subtitle="TAKIM & RAPORLAR" />

      <View style={styles.tabBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                testID={t.testID}
                onPress={() => setTab(t.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.body}>
        {tab === "people" && <PeopleTab onAuthError={onAuthError} />}
        {tab === "categories" && <CategoryTab onAuthError={onAuthError} />}
        {tab === "overdue" && <OverdueTab onAuthError={onAuthError} />}
        {tab === "heatmap" && <HeatmapTab onAuthError={onAuthError} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  tabBarWrap: { borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBar: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: {
    height: 36,
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: "rgba(0,240,255,0.08)" },
  chipText: { color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1, fontFamily: monoFont },
  chipTextActive: { color: colors.primary },
  body: { flex: 1 },
});
