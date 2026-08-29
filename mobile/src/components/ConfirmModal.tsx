import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, monoFont, radius, spacing } from "@/src/theme/colors";

// Basit onay penceresi (Alert yerine — mobil kuralı). Sil/tehlikeli işlemler için.
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = "Sil",
  danger = true,
  busy = false,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.row}>
            <Pressable testID="confirm-cancel" onPress={onClose} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Vazgeç</Text>
            </Pressable>
            <Pressable
              testID="confirm-ok"
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [styles.confirm, danger && styles.danger, busy && styles.disabled, pressed && styles.pressed]}
            >
              {busy ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.8)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 360, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: "800" },
  message: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancel: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: monoFont },
  confirm: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12 },
  danger: { backgroundColor: colors.danger },
  confirmText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", fontFamily: monoFont },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
