// TAKIM → İş Kolları alt sekmesi — kategori (iş kolu) performans kartları +
// PDF/Excel rapor paylaşma düğmeleri.
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { api, ApiError } from "@/src/api/client";
import { TeamCategoryRow } from "@/src/api/types";
import { shareCategoryReportExcel, shareCategoryReportPdf } from "@/src/lib/categoryReportMobile";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TEAM } from "@/constants/testIds";
import { TabShell } from "./TabShell";

const Chip = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <View style={styles.chip}>
    <Text style={[styles.chipValue, { color }]}>{value}</Text>
    <Text style={styles.chipLabel}>{label}</Text>
  </View>
);

export function CategoryTab({ onAuthError }: { onAuthError: () => void }) {
  const [rows, setRows] = useState<TeamCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<"pdf" | "excel" | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        setRows(await api.teamCategorySummary());
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "İş kolu verisi yüklenemedi");
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

  const doShare = async (kind: "pdf" | "excel") => {
    if (!rows.length) return;
    setSharing(kind);
    setShareError(null);
    try {
      if (kind === "pdf") await shareCategoryReportPdf(rows);
      else await shareCategoryReportExcel(rows);
    } catch {
      setShareError("Rapor paylaşılamadı");
    } finally {
      setSharing(null);
    }
  };

  return (
    <TabShell
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyIcon="pricetags-outline"
      emptyTitle="İş kolu verisi yok"
      emptySub="Görüntüleyebileceğiniz iş kolu görevleri bulunmuyor"
      onRetry={() => load("initial")}
      refreshing={refreshing}
      onRefresh={() => load("refresh")}
    >
      <View style={styles.reportRow}>
        <Pressable
          testID={TEAM.reportPdf}
          onPress={() => doShare("pdf")}
          disabled={sharing !== null}
          style={({ pressed }) => [styles.reportBtn, styles.pdfBtn, pressed && styles.pressed, sharing !== null && styles.disabled]}
        >
          {sharing === "pdf" ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={15} color={colors.primary} />
              <Text style={[styles.reportText, { color: colors.primary }]}>PDF Paylaş</Text>
            </>
          )}
        </Pressable>
        <Pressable
          testID={TEAM.reportExcel}
          onPress={() => doShare("excel")}
          disabled={sharing !== null}
          style={({ pressed }) => [styles.reportBtn, styles.excelBtn, pressed && styles.pressed, sharing !== null && styles.disabled]}
        >
          {sharing === "excel" ? (
            <ActivityIndicator size="small" color={colors.success} />
          ) : (
            <>
              <Ionicons name="grid-outline" size={15} color={colors.success} />
              <Text style={[styles.reportText, { color: colors.success }]}>Excel Paylaş</Text>
            </>
          )}
        </Pressable>
      </View>
      {shareError ? <Text style={styles.shareError}>{shareError}</Text> : null}

      {rows.map((r) => {
        const progress = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
        return (
          <View key={r.category_id || "__uncat__"} style={styles.card} testID={`${TEAM.categoryCard}-${r.category_id || "uncat"}`}>
            <View style={styles.cardHeader}>
              <View style={[styles.dot, { backgroundColor: r.color || colors.textMuted }]} />
              <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
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
            <Text style={styles.progressText}>{r.done}/{r.total} tamamlandı · %{progress}</Text>
            <View style={styles.chipRow}>
              <Chip label="Açık" value={r.pending} color={colors.secondary} />
              <Chip label="Beklet." value={r.paused} color={colors.warning} />
              <Chip label="Geciken" value={r.overdue} color={colors.danger} />
              <Chip label="Yaklaşan" value={r.due_soon} color={colors.primary} />
            </View>
          </View>
        );
      })}
    </TabShell>
  );
}

const styles = StyleSheet.create({
  reportRow: { flexDirection: "row", gap: spacing.sm },
  reportBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: radius.md, paddingVertical: 11 },
  pdfBtn: { borderColor: colors.primary },
  excelBtn: { borderColor: colors.success },
  reportText: { fontSize: 13, fontWeight: "700" },
  shareError: { color: colors.danger, fontSize: 12, textAlign: "center" },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  overdueBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderColor: "rgba(255, 0, 60, 0.5)", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  overdueBadgeText: { color: colors.danger, fontSize: 12, fontWeight: "800", fontFamily: monoFont },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressText: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  chipRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  chip: { alignItems: "center", flex: 1 },
  chipValue: { fontSize: 16, fontWeight: "800", fontFamily: monoFont },
  chipLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
