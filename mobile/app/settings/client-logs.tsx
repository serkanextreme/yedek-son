import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { ClientLog } from "@/src/api/types";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { CLIENTLOGS } from "@/constants/testIds";

const levelColor = (lvl?: string) => {
  const l = (lvl || "").toLowerCase();
  if (l === "error" || l === "critical" || l === "fatal") return colors.danger;
  if (l === "warning" || l === "warn") return colors.warning;
  return colors.textMuted;
};

const fmtTime = (iso?: string | null) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
};

export default function ClientLogsScreen() {
  const insets = useSafeAreaInsets();

  const [logs, setLogs] = useState<ClientLog[]>([]);
  const [total, setTotal] = useState(0);
  const [last24h, setLast24h] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const onAuthError = useCallback(() => router.replace("/login"), []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await api.clientLogs(200);
        setLogs(res.logs || []);
        setTotal(res.total || 0);
        setLast24h(res.last_24h || 0);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return onAuthError();
        setError(e instanceof ApiError ? e.message : "Yüklenemedi");
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

  const clearAll = async () => {
    setClearing(true);
    try {
      await api.clearClientLogs();
      setConfirmClear(false);
      await load("refresh");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Temizlenemedi");
    } finally {
      setClearing(false);
    }
  };

  return (
    <View style={styles.container} testID={CLIENTLOGS.screen}>
      <ScreenHeader title="HATA RADARI" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={
            <RefreshControl
              testID={CLIENTLOGS.refresh}
              refreshing={refreshing}
              onRefresh={() => load("refresh")}
              tintColor={colors.primary}
            />
          }
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.statRow}>
            <View style={[styles.statCard, last24h > 0 && styles.statCardAlert]}>
              <Text style={[styles.statValue, { color: last24h > 0 ? colors.danger : colors.success }]}>
                {last24h}
              </Text>
              <Text style={styles.statLabel}>SON 24 SAAT</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: colors.warning }]}>{total}</Text>
              <Text style={styles.statLabel}>TOPLAM KAYIT</Text>
            </View>
          </View>

          <Text style={styles.hint}>
            Web ve mobil istemcilerde oluşan yakalanmamış hatalar burada toplanır.
            Kayıtlar 30 gün sonra otomatik silinir. Bu ekran kullanıcı deneyimini
            etkilemez; yalnızca sizin görebilmeniz içindir.
          </Text>

          {logs.length > 0 ? (
            <Pressable
              testID={CLIENTLOGS.clear}
              onPress={() => setConfirmClear(true)}
              style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={15} color={colors.danger} />
              <Text style={styles.clearText}>TÜM KAYITLARI TEMİZLE</Text>
            </Pressable>
          ) : null}

          {logs.length === 0 ? (
            <View style={styles.emptyBox} testID={CLIENTLOGS.empty}>
              <Ionicons name="shield-checkmark-outline" size={28} color={colors.success} />
              <Text style={styles.emptyText}>Kayıtlı hata yok. Sistem temiz. ✓</Text>
            </View>
          ) : (
            <View testID={CLIENTLOGS.list} style={{ gap: spacing.sm }}>
              {logs.map((l) => {
                const open = !!expanded[l.id];
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => setExpanded((p) => ({ ...p, [l.id]: !p[l.id] }))}
                    style={styles.logCard}
                  >
                    <View style={styles.logHead}>
                      <View style={[styles.levelDot, { backgroundColor: levelColor(l.level) }]} />
                      <Text style={[styles.level, { color: levelColor(l.level) }]}>
                        {(l.level || "error").toUpperCase()}
                      </Text>
                      <Text style={styles.time}>{fmtTime(l.created_at)}</Text>
                    </View>
                    <Text style={styles.message} numberOfLines={open ? undefined : 3}>
                      {l.message}
                    </Text>
                    <View style={styles.metaRow}>
                      {l.username ? <Text style={styles.meta}>👤 {l.username}</Text> : null}
                      {l.source ? <Text style={styles.meta}>◈ {l.source}</Text> : null}
                      {l.user_agent ? <Text style={styles.meta}>{l.user_agent}</Text> : null}
                    </View>
                    {open && l.stack ? <Text style={styles.stack}>{l.stack}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      <ConfirmModal
        visible={confirmClear}
        title="Tüm hata kayıtları silinsin mi?"
        message="Bu işlem geri alınamaz. Tüm istemci hata kayıtları kalıcı olarak silinecek."
        busy={clearing}
        onConfirm={clearAll}
        onClose={() => setConfirmClear(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  body: { padding: spacing.md, gap: spacing.sm },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  statRow: { flexDirection: "row", gap: spacing.sm },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: "center",
    gap: spacing.xs,
  },
  statCardAlert: { borderColor: "rgba(255,0,60,0.4)" },
  statValue: { fontSize: 28, fontWeight: "800", fontFamily: monoFont },
  statLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1, fontFamily: monoFont },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 10,
    marginTop: spacing.xs,
  },
  clearText: { color: colors.danger, fontSize: 12, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  emptyBox: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { color: colors.textSecondary, fontSize: 14 },
  logCard: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  logHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  levelDot: { width: 8, height: 8, borderRadius: 4 },
  level: { fontSize: 11, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  time: { marginLeft: "auto", color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  message: { color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  meta: { color: colors.textMuted, fontSize: 10, fontFamily: monoFont },
  stack: {
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: monoFont,
    marginTop: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.bgBase,
    borderRadius: radius.sm,
  },
  pressed: { opacity: 0.65 },
});
