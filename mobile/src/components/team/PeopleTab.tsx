// TAKIM → Kişiler alt sekmesi — üye bazlı görev özeti kartları.
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api, ApiError } from "@/src/api/client";
import { TeamSummaryRow } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TEAM } from "@/constants/testIds";
import { TabShell } from "./TabShell";

const roleLabel = (r: string) => (r === "admin" ? "Yönetici" : r === "manager" ? "Müdür" : "Personel");

const Stat = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

export function PeopleTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<TeamSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        setRows(await api.teamSummary());
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Ekip verisi yüklenemedi");
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
      emptyIcon="people-outline"
      emptyTitle="Görüntülenecek ekip üyesi yok"
      emptySub="Yetkiniz dahilinde görüntüleyebileceğiniz kullanıcı bulunmuyor"
      onRetry={() => load("initial")}
      refreshing={refreshing}
      onRefresh={() => load("refresh")}
      testID={TEAM.emptyState}
    >
      {rows.map((r) => {
        const progress = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
        return (
          <View key={r.user_id} style={styles.card} testID={`${TEAM.memberCard}-${r.user_id}`}>
            <View style={styles.cardHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{r.username.slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={styles.cardHeaderText}>
                <Text style={styles.name}>{r.username}</Text>
                <Text style={styles.sub}>
                  {roleLabel(r.role)}
                  {r.company_name ? ` · ${r.company_name}` : ""}
                </Text>
              </View>
              {r.overdue > 0 && (
                <View style={styles.overdueBadge}>
                  <Ionicons name="alert-circle" size={12} color={colors.danger} />
                  <Text style={styles.overdueBadgeText}>{r.overdue}</Text>
                </View>
              )}
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>{progress}% tamamlandı</Text>
            <View style={styles.statsRow}>
              <Stat label="Toplam" value={r.total} color={colors.textPrimary} />
              <Stat label="Tamam" value={r.done} color={colors.success} />
              <Stat label="Bekleyen" value={r.pending} color={colors.secondary} />
              <Stat label="Gecikmiş" value={r.overdue} color={colors.danger} />
            </View>
          </View>
        );
      })}
    </TabShell>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  avatarText: { color: colors.primary, fontWeight: "800", fontFamily: monoFont, fontSize: 14 },
  cardHeaderText: { flex: 1 },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  overdueBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderColor: "rgba(255, 0, 60, 0.5)", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  overdueBadgeText: { color: colors.danger, fontSize: 12, fontWeight: "800", fontFamily: monoFont },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: "hidden", marginTop: spacing.xs },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressText: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  stat: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 18, fontWeight: "800", fontFamily: monoFont },
  statLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 0.5, marginTop: 2 },
});
