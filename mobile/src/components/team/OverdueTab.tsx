// TAKIM → Gecikenler alt sekmesi — kişi bazlı geciken görevler + toplu "Dürt".
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { api, ApiError } from "@/src/api/client";
import { OverdueSummary } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TEAM } from "@/constants/testIds";
import { TabShell } from "./TabShell";

const roleLabel = (r: string) => (r === "admin" ? "Yönetici" : r === "manager" ? "Müdür" : "Personel");

const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function OverdueTab({ onAuthError }: { onAuthError: () => void }) {
  const [data, setData] = useState<OverdueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nudging, setNudging] = useState<string | null>(null);
  const [nudged, setNudged] = useState<Record<string, string>>({});

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        setData(await api.teamOverdueSummary());
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Geciken görev verisi yüklenemedi");
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

  const nudge = async (uid: string, taskIds: string[]) => {
    setNudging(uid);
    try {
      const res = await api.teamBulkNudge(taskIds);
      setNudged((m) => ({ ...m, [uid]: `${res.sent} hatırlatma gönderildi` }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setNudged((m) => ({ ...m, [uid]: "Gönderilemedi" }));
    } finally {
      setNudging(null);
    }
  };

  const people = data?.people || [];

  return (
    <TabShell
      loading={loading}
      error={error}
      empty={people.length === 0}
      emptyIcon="checkmark-done-circle-outline"
      emptyTitle="Geciken görev yok"
      emptySub="Ekibinizde şu an gecikmiş görev bulunmuyor 🎉"
      onRetry={() => load("initial")}
      refreshing={refreshing}
      onRefresh={() => load("refresh")}
    >
      <View style={styles.summaryBar}>
        <Ionicons name="alert-circle" size={16} color={colors.danger} />
        <Text style={styles.summaryText}>
          {data?.total_people} kişide {data?.total_overdue} geciken görev
        </Text>
      </View>

      {people.map((p) => (
        <View key={p.user_id} style={styles.card} testID={`${TEAM.overduePerson}-${p.user_id}`}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderText}>
              <Text style={styles.name}>{p.username}</Text>
              <Text style={styles.sub}>
                {roleLabel(p.role)}
                {p.company_name ? ` · ${p.company_name}` : ""}
              </Text>
            </View>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{p.overdue_count}</Text>
            </View>
          </View>

          {p.tasks.slice(0, 5).map((t) => (
            <Pressable key={t.id} style={styles.taskRow} onPress={() => router.push(`/task/${t.id}`)}>
              <Ionicons name="time-outline" size={13} color={colors.danger} />
              <Text style={styles.taskTitle} numberOfLines={1}>{t.title}</Text>
              <Text style={styles.taskDue}>{fmtDate(t.due_date)}</Text>
            </Pressable>
          ))}
          {p.tasks.length > 5 && <Text style={styles.more}>+{p.tasks.length - 5} görev daha</Text>}

          {nudged[p.user_id] ? (
            <Text style={styles.nudgedText}>✓ {nudged[p.user_id]}</Text>
          ) : (
            <Pressable
              testID={`${TEAM.nudgePerson}-${p.user_id}`}
              onPress={() => nudge(p.user_id, p.tasks.map((t) => t.id))}
              disabled={nudging !== null}
              style={({ pressed }) => [styles.nudgeBtn, pressed && styles.pressed, nudging !== null && styles.disabled]}
            >
              {nudging === p.user_id ? (
                <ActivityIndicator size="small" color={colors.bgBase} />
              ) : (
                <>
                  <Ionicons name="notifications" size={15} color={colors.bgBase} />
                  <Text style={styles.nudgeText}>Hepsini Dürt</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      ))}
    </TabShell>
  );
}

const styles = StyleSheet.create({
  summaryBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(255,0,60,0.08)", borderWidth: 1, borderColor: "rgba(255,0,60,0.3)", borderRadius: radius.md, padding: spacing.sm },
  summaryText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardHeaderText: { flex: 1 },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  countBadge: { minWidth: 30, alignItems: "center", backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  countBadgeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", fontFamily: monoFont },
  taskRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  taskTitle: { flex: 1, color: colors.textSecondary, fontSize: 13 },
  taskDue: { color: colors.danger, fontSize: 11, fontFamily: monoFont },
  more: { color: colors.textMuted, fontSize: 11, fontStyle: "italic" },
  nudgeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.warning, borderRadius: radius.md, paddingVertical: 10, marginTop: spacing.xs },
  nudgeText: { color: colors.bgBase, fontSize: 14, fontWeight: "800" },
  nudgedText: { color: colors.success, fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: spacing.xs },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
