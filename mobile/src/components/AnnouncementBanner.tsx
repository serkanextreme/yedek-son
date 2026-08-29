import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import { ActiveAnnouncement } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { ANNOUNCE } from "@/constants/testIds";

const POLL_MS = 60_000;

type Sev = { color: string; icon: keyof typeof Ionicons.glyphMap; label: string };
const SEV: Record<string, Sev> = {
  info: { color: colors.primary, icon: "information-circle", label: "BİLGİ" },
  warning: { color: colors.warning, icon: "warning", label: "UYARI" },
  critical: { color: colors.danger, icon: "alert-circle", label: "KRİTİK" },
};

// Aktif + bana yönelik duyuruları üstte küçük bir şerit olarak gösterir. Tüm
// sekmelerin üzerinde overlay olarak (tabs layout'unda) mount edilir.
export function AnnouncementBanner() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ActiveAnnouncement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [acking, setAcking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await api.activeAnnouncements();
      setItems(rows.filter((a) => !a.acked));
    } catch {
      // Sessizce yut — banner ağ hatasında uygulamayı bozmamalı.
    }
  }, []);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  const visible = items.filter((a) => !dismissed.has(a.id));
  const current = visible[0];
  if (!current) return null;

  const sev = SEV[current.severity] || SEV.info;
  const extra = visible.length - 1;

  const onAck = async () => {
    setAcking(true);
    try {
      await api.ackAnnouncement(current.id);
      setItems((prev) => prev.filter((a) => a.id !== current.id));
    } catch {
      // yok say
    } finally {
      setAcking(false);
    }
  };

  const onDismiss = () => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(current.id);
      return next;
    });
  };

  return (
    <View
      testID={ANNOUNCE.banner}
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + spacing.xs,
          borderBottomColor: sev.color,
          borderLeftColor: sev.color,
          backgroundColor: tintBg(sev.color, 0.16),
        },
      ]}
    >
      <View style={styles.row}>
        <Ionicons name={sev.icon} size={20} color={sev.color} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[styles.sevTag, { color: sev.color }]}>{sev.label}</Text>
            {extra > 0 ? <Text style={styles.count}>+{extra} duyuru</Text> : null}
          </View>
          <Text testID={ANNOUNCE.title} style={styles.title} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={styles.msg} numberOfLines={2}>
            {current.message}
          </Text>
        </View>
        {!current.require_ack ? (
          <Pressable testID={ANNOUNCE.dismiss} onPress={onDismiss} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        testID={ANNOUNCE.ack}
        onPress={onAck}
        disabled={acking}
        style={({ pressed }) => [styles.ackBtn, { borderColor: sev.color }, pressed && styles.pressed, acking && styles.pressed]}
      >
        <Ionicons name="checkmark" size={15} color={sev.color} />
        <Text style={[styles.ackText, { color: sev.color }]}>ANLADIM</Text>
      </Pressable>
    </View>
  );
}

// Severity rengini opak koyu zemin (#070D1C) üzerine karıştırıp OPAK bir renk
// döndürür — banner overlay olduğu için arkadaki başlık sızmasın diye şeffaf değil.
function tintBg(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return colors.surfaceAlt;
  const base = { r: 7, g: 13, b: 28 }; // #070D1C = colors.surfaceAlt
  const r = Math.round(base.r * (1 - alpha) + parseInt(h.slice(0, 2), 16) * alpha);
  const g = Math.round(base.g * (1 - alpha) + parseInt(h.slice(2, 4), 16) * alpha);
  const b = Math.round(base.b * (1 - alpha) + parseInt(h.slice(4, 6), 16) * alpha);
  return `rgb(${r}, ${g}, ${b})`;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 2,
    borderLeftWidth: 3,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  body: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sevTag: { fontSize: 10, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  count: { fontSize: 10, color: colors.textMuted, fontFamily: monoFont },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: "700", marginTop: 1 },
  msg: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  iconBtn: { padding: 4 },
  ackBtn: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  ackText: { fontSize: 11, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  pressed: { opacity: 0.6 },
});
