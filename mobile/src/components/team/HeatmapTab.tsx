// TAKIM → Isı Haritası alt sekmesi — son 60 günde kişi bazlı tamamlanan görev
// yoğunluğu (GitHub tarzı ızgara).
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api, ApiError } from "@/src/api/client";
import { HeatmapRow } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TEAM } from "@/constants/testIds";
import { TabShell } from "./TabShell";

const CELL = 11;
const GAP = 3;

const cellColor = (done: number) => {
  if (done <= 0) return colors.surface;
  if (done <= 2) return "rgba(0,240,255,0.28)";
  if (done <= 5) return "rgba(0,240,255,0.55)";
  return "rgba(0,240,255,0.9)";
};

const Legend = () => (
  <View style={styles.legend}>
    <Text style={styles.legendText}>Az</Text>
    {[0, 1, 3, 6].map((d) => (
      <View key={d} style={[styles.legendCell, { backgroundColor: cellColor(d) }]} />
    ))}
    <Text style={styles.legendText}>Çok</Text>
  </View>
);

export function HeatmapTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        setRows(await api.teamHeatmap(60));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Isı haritası yüklenemedi");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthError],
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  return (
    <TabShell
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyIcon="grid-outline"
      emptyTitle="Isı haritası verisi yok"
      emptySub="Son 60 günde tamamlanmış görev bulunmuyor"
      onRetry={() => load("initial")}
      refreshing={refreshing}
      onRefresh={() => load("refresh")}
    >
      <Legend />
      {rows.map((r) => {
        const total = r.days.reduce((a, d) => a + d.done, 0);
        return (
          <View key={r.user_id} style={styles.card} testID={`${TEAM.heatmapRow}-${r.user_id}`}>
            <View style={styles.header}>
              <Text style={styles.name} numberOfLines={1}>{r.username}</Text>
              <Text style={styles.total}>{total} tamam</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {r.days.map((d) => (
                <View key={d.date} style={[styles.cell, { backgroundColor: cellColor(d.done) }]} />
              ))}
            </ScrollView>
          </View>
        );
      })}
    </TabShell>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", alignItems: "center", gap: GAP, alignSelf: "flex-end" },
  legendText: { color: colors.textMuted, fontSize: 10, fontFamily: monoFont, marginHorizontal: 4 },
  legendCell: { width: CELL, height: CELL, borderRadius: 2 },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: "700" },
  total: { color: colors.primary, fontSize: 11, fontFamily: monoFont },
  strip: { flexDirection: "row", gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 2 },
});
