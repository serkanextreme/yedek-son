import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
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
import { AppNotification } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { HudHeader } from "@/src/components/HudHeader";
import { notificationMeta, relativeTime } from "@/src/lib/notify";
import { useNotifications } from "@/src/notifications/NotificationsContext";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { NOTIF } from "@/constants/testIds";

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const { refresh: refreshBadge } = useNotifications();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  const unreadCount = items.filter((n) => !n.read_at).length;

  const load = useCallback(
    async (mode: "initial" | "refresh" | "silent") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      if (mode !== "silent") setError(null);
      try {
        const data = await api.notifications(50);
        setItems(data);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await logout();
          router.replace("/login");
          return;
        }
        if (mode !== "silent") {
          setError(e instanceof ApiError ? e.message : "Bildirimler yüklenemedi");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [logout],
  );

  useFocusEffect(
    useCallback(() => {
      load(mounted.current ? "silent" : "initial");
      mounted.current = true;
      refreshBadge();
    }, [load, refreshBadge]),
  );

  const markRead = useCallback(
    async (n: AppNotification) => {
      if (n.read_at) return;
      const now = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)));
      try {
        await api.markNotificationRead(n.id);
      } catch {
        /* keep optimistic */
      }
      refreshBadge();
    },
    [refreshBadge],
  );

  const markAll = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? now })));
    try {
      await api.markAllNotificationsRead();
    } catch {
      /* keep optimistic */
    }
    refreshBadge();
  }, [refreshBadge]);

  const remove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((x) => x.id !== id));
      try {
        await api.deleteNotification(id);
      } catch {
        /* keep optimistic */
      }
      refreshBadge();
    },
    [refreshBadge],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={NOTIF.screen}>
      <HudHeader
        subtitle={`BİLDİRİMLER · ${unreadCount} okunmamış`}
        right={
          unreadCount > 0 ? (
            <Pressable
              testID={NOTIF.markAll}
              onPress={markAll}
              style={({ pressed }) => [styles.markAllBtn, pressed && styles.pressed]}
            >
              <Ionicons name="checkmark-done" size={14} color={colors.primary} />
              <Text style={styles.markAllText}>Tümü</Text>
            </Pressable>
          ) : null
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            testID={NOTIF.errorRetry}
            onPress={() => load("initial")}
            style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
          >
            <Ionicons name="refresh" size={16} color={colors.bgBase} />
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center} testID={NOTIF.emptyState}>
          <Ionicons name="notifications-off-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Bildirim yok</Text>
          <Text style={styles.emptySub}>Yeni bildirimler burada görünecek</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load("refresh")}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {items.map((n) => {
            const meta = notificationMeta(n.type, n.days_until_due);
            const unread = !n.read_at;
            return (
              <Pressable
                key={n.id}
                testID={`${NOTIF.item}-${n.id}`}
                onPress={() => markRead(n)}
                style={({ pressed }) => [
                  styles.item,
                  unread && styles.itemUnread,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.iconWrap, { borderColor: meta.color }]}>
                  <Ionicons name={meta.icon as never} size={18} color={meta.color} />
                </View>
                <View style={styles.itemBody}>
                  <Text style={[styles.itemLabel, { color: meta.color }]}>{meta.label}</Text>
                  {!!n.task_title && (
                    <Text style={styles.itemTitle} numberOfLines={2}>
                      {n.task_title}
                    </Text>
                  )}
                  {(n.type === "super_admin_expiring" || n.type === "super_admin_expired") && (
                    <Text style={styles.itemTitle} numberOfLines={2}>
                      {n.type === "super_admin_expiring"
                        ? (n.is_for_manager
                            ? `${(n.payload?.username as string) ?? n.owner_username ?? ""} · ${(n.payload?.minutes_left as number) ?? "az"} dk kaldı`
                            : `${(n.payload?.minutes_left as number) ?? "az"} dk içinde sona eriyor`)
                        : (n.is_for_manager
                            ? `${(n.payload?.username as string) ?? n.owner_username ?? ""} → ${(n.payload?.reverted_role as string) ?? "eski rol"}`
                            : `Eski rolüne döndün (${(n.payload?.reverted_role as string) ?? ""})`)}
                    </Text>
                  )}
                  <View style={styles.itemMeta}>
                    <Text style={styles.itemTime}>{relativeTime(n.created_at)}</Text>
                    {n.is_for_manager && !!n.owner_username && (
                      <Text style={styles.itemOwner}>· {n.owner_username}</Text>
                    )}
                  </View>
                </View>
                {unread && <View style={styles.unreadDot} />}
                <Pressable
                  testID={`${NOTIF.delete}-${n.id}`}
                  onPress={() => remove(n.id)}
                  hitSlop={10}
                  style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </Pressable>
              </Pressable>
            );
          })}
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  markAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  markAllText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  itemUnread: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  itemBody: { flex: 1, gap: 2 },
  itemLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  itemTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  itemMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  itemTime: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  itemOwner: { color: colors.textMuted, fontSize: 11 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  deleteBtn: { padding: 6 },
  pressed: { opacity: 0.7 },
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
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  emptySub: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
});
