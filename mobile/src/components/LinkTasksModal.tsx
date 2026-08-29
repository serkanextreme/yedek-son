// Görev Bağlama modalı — 2+ görevi seçip sıraya dizerek gruplar. Hem yeni grup
// oluşturma hem mevcut grubu düzenleme için kullanılır. Web LinkTasksModal ile
// birebir aynı akış (ad + ilerleme + sıralı üye listesi).

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { api, ApiError } from "@/src/api/client";
import { Task, TaskGroup } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { LINK } from "@/constants/testIds";

type Props = {
  visible: boolean;
  candidateTasks: Task[];
  preselectedIds?: string[];
  group?: TaskGroup | null;
  onClose: () => void;
  onSaved: () => void;
  onAuthError?: () => void;
};

export const LinkTasksModal = ({
  visible,
  candidateTasks,
  preselectedIds = [],
  group = null,
  onClose,
  onSaved,
  onAuthError,
}: Props) => {
  const isEdit = !!group;
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [showProgress, setShowProgress] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local state each time the modal opens.
  useEffect(() => {
    if (!visible) return;
    setSelected((preselectedIds || []).filter((id) => candidateTasks.some((t) => t.id === id)));
    setName(group?.name || "");
    setShowProgress(group ? !!group.show_progress : true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const taskById = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of candidateTasks) m[t.id] = t;
    return m;
  }, [candidateTasks]);

  const available = candidateTasks.filter((t) => !selected.includes(t.id));

  const addTask = (id: string) => setSelected((s) => [...s, id]);
  const removeTask = (id: string) => setSelected((s) => s.filter((x) => x !== id));
  const move = (idx: number, dir: number) => {
    setSelected((s) => {
      const next = [...s];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return s;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    if (selected.length < 2) {
      setError("Bağlamak için en az 2 görev seçin");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim() || null, show_progress: showProgress, task_ids: selected };
      if (isEdit && group) await api.updateGroup(group.id, payload);
      else await api.createGroup(payload);
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError?.();
      setError(e instanceof ApiError ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID={LINK.modal}>
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Ionicons name="git-network-outline" size={16} color={colors.primary} />
              <Text style={styles.headerTitle}>{isEdit ? "GRUBU DÜZENLE" : "GÖREVLERİ BAĞLA"}</Text>
            </View>
            <Pressable testID={LINK.close} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>GRUP ADI (opsiyonel)</Text>
            <TextInput
              testID={LINK.name}
              value={name}
              onChangeText={setName}
              placeholder="Örn: Cuma İşleri"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Pressable
              testID={LINK.showProgress}
              onPress={() => setShowProgress((v) => !v)}
              style={styles.switchRow}
            >
              <Switch
                value={showProgress}
                onValueChange={setShowProgress}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.bgBase}
              />
              <Text style={styles.switchLabel}>İlerleme göster (ör. &quot;2/4 tamamlandı&quot;)</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>SEÇİLİ GÖREVLER · SIRA ({selected.length})</Text>
            {selected.length === 0 ? (
              <Text style={styles.hint}>Aşağıdan görev ekleyin</Text>
            ) : (
              selected.map((id, idx) => {
                const t = taskById[id];
                if (!t) return null;
                return (
                  <View key={id} style={styles.selectedRow} testID={`${LINK.selected}-${id}`}>
                    <Text style={styles.orderNo}>{idx + 1}.</Text>
                    <Text style={styles.selectedTitle} numberOfLines={1}>{t.title}</Text>
                    <Pressable
                      testID={`${LINK.moveUp}-${id}`}
                      onPress={() => move(idx, -1)}
                      disabled={idx === 0}
                      hitSlop={6}
                      style={idx === 0 && styles.disabled}
                    >
                      <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      testID={`${LINK.moveDown}-${id}`}
                      onPress={() => move(idx, 1)}
                      disabled={idx === selected.length - 1}
                      hitSlop={6}
                      style={idx === selected.length - 1 && styles.disabled}
                    >
                      <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable testID={`${LINK.remove}-${id}`} onPress={() => removeTask(id)} hitSlop={6}>
                      <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
                    </Pressable>
                  </View>
                );
              })
            )}

            {available.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>EKLENEBİLİR GÖREVLER</Text>
                {available.map((t) => (
                  <Pressable
                    key={t.id}
                    testID={`${LINK.add}-${t.id}`}
                    onPress={() => addTask(t.id)}
                    style={({ pressed }) => [styles.availableRow, pressed && styles.pressed]}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                    <Text style={styles.availableTitle} numberOfLines={1}>{t.title}</Text>
                  </Pressable>
                ))}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              testID={LINK.cancel}
              onPress={onClose}
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>İPTAL</Text>
            </Pressable>
            <Pressable
              testID={LINK.save}
              onPress={handleSave}
              disabled={saving || selected.length < 2}
              style={({ pressed }) => [
                styles.saveBtn,
                (saving || selected.length < 2) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.bgBase} />
              ) : (
                <Text style={styles.saveText}>{isEdit ? "GÜNCELLE" : "BAĞLA"}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.8)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "85%",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  headerTitleWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerTitle: { color: colors.primary, fontSize: 14, fontWeight: "800", letterSpacing: 1.5, fontFamily: monoFont },
  error: { color: colors.danger, fontSize: 13 },
  scroll: { flexGrow: 0 },
  label: { color: colors.textMuted, fontSize: 11, letterSpacing: 1, fontFamily: monoFont, marginTop: spacing.xs },
  sectionLabel: { color: colors.primary, fontSize: 11, letterSpacing: 1, fontFamily: monoFont, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  switchLabel: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  hint: {
    color: colors.textMuted,
    fontStyle: "italic",
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: radius.md,
    padding: spacing.md,
    textAlign: "center",
  },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    marginBottom: spacing.xs,
  },
  orderNo: { color: colors.primary, fontSize: 12, fontFamily: monoFont, width: 22, textAlign: "center" },
  selectedTitle: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  availableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    marginBottom: spacing.xs,
  },
  availableTitle: { flex: 1, color: colors.textSecondary, fontSize: 14 },
  footer: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", letterSpacing: 1, fontFamily: monoFont },
  saveBtn: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12 },
  saveText: { color: colors.bgBase, fontSize: 13, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.65 },
});
