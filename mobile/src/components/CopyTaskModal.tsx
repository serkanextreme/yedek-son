// Görev Kopyalama penceresi (mobil) — task detay ekranından "Kopyala" ile
// açılır. Alt görev ve dosya eklerinin de kopyalanıp kopyalanmayacağı seçilir
// (görevde yoksa o seçenek gizli). Onayla → görev panoya alınır; kullanıcı bir
// iş kolu başlığındaki "Yapıştır" düğmesine dokunur.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "@/src/api/client";
import { Task } from "@/src/api/types";
import { setTaskClipboard } from "@/src/lib/taskClipboard";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { DETAIL } from "@/constants/testIds";

type Props = {
  visible: boolean;
  task: Task | null;
  onClose: () => void;
  onCopied?: () => void;
};

export const CopyTaskModal = ({ visible, task, onClose, onCopied }: Props) => {
  const subtaskCount = (task?.subtasks || []).length;
  const [attCount, setAttCount] = useState<number | null>(null);
  const [includeSubtasks, setIncludeSubtasks] = useState(true);
  const [includeAttachments, setIncludeAttachments] = useState(true);

  useEffect(() => {
    if (!visible || !task) return;
    setAttCount(null);
    setIncludeSubtasks(true);
    setIncludeAttachments(true);
    let alive = true;
    (async () => {
      try {
        const rows = await api.listAttachments(task.id);
        if (alive) setAttCount(Array.isArray(rows) ? rows.length : 0);
      } catch {
        if (alive) setAttCount(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, task]);

  if (!task) return null;

  const confirm = () => {
    setTaskClipboard({
      sourceId: task.id,
      title: task.title,
      includeSubtasks: subtaskCount > 0 ? includeSubtasks : false,
      includeAttachments: (attCount || 0) > 0 ? includeAttachments : false,
    });
    onClose();
    onCopied?.();
  };

  const Row = ({
    checked,
    onToggle,
    label,
    testID,
  }: {
    checked: boolean;
    onToggle: () => void;
    label: string;
    testID: string;
  }) => (
    <Pressable
      testID={testID}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked && <Ionicons name="checkmark" size={15} color={colors.primary} />}
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} testID={DETAIL.copyModal} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="copy-outline" size={18} color={colors.primary} />
              <Text style={styles.title}>GÖREVİ KOPYALA</Text>
            </View>
            <Pressable testID={DETAIL.copyCancel} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <Text style={styles.sub} numberOfLines={2}>
            &quot;{task.title}&quot;
          </Text>

          {attCount === null ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.rows}>
              {subtaskCount > 0 && (
                <Row
                  checked={includeSubtasks}
                  onToggle={() => setIncludeSubtasks((v) => !v)}
                  label={`Alt görevleri dahil et (${subtaskCount})`}
                  testID={DETAIL.copyIncludeSubtasks}
                />
              )}
              {(attCount || 0) > 0 && (
                <Row
                  checked={includeAttachments}
                  onToggle={() => setIncludeAttachments((v) => !v)}
                  label={`Dosya eklerini dahil et (${attCount})`}
                  testID={DETAIL.copyIncludeAttachments}
                />
              )}
              {subtaskCount === 0 && (attCount || 0) === 0 && (
                <Text style={styles.note}>
                  Görevin kendisi kopyalanacak (alt görev / dosya eki yok).
                </Text>
              )}
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              testID={DETAIL.copyCancel}
              onPress={onClose}
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
            >
              <Text style={styles.btnGhostText}>VAZGEÇ</Text>
            </Pressable>
            <Pressable
              testID={DETAIL.copyConfirm}
              onPress={confirm}
              disabled={attCount === null}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                (pressed || attCount === null) && styles.pressed,
              ]}
            >
              <Text style={styles.btnPrimaryText}>KOPYALA</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: colors.primary, fontSize: 14, fontWeight: "700", fontFamily: monoFont, letterSpacing: 0.5 },
  sub: { color: colors.textSecondary, fontSize: 13, marginTop: 6, marginBottom: spacing.md },
  loading: { paddingVertical: spacing.lg, alignItems: "center" },
  rows: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { borderColor: colors.primary, backgroundColor: colors.primary + "22" },
  rowLabel: { flex: 1, color: colors.textPrimary, fontSize: 13 },
  note: { color: colors.textMuted, fontSize: 12, fontStyle: "italic", paddingVertical: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: "center", borderWidth: 1 },
  btnGhost: { borderColor: colors.border },
  btnGhostText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: monoFont },
  btnPrimary: { borderColor: colors.primary, backgroundColor: colors.primary + "22" },
  btnPrimaryText: { color: colors.primary, fontSize: 13, fontWeight: "700", fontFamily: monoFont },
  pressed: { opacity: 0.6 },
});
