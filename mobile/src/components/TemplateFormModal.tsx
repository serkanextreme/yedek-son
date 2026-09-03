import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api, ApiError } from "@/src/api/client";
import { Category, TaskTemplate } from "@/src/api/types";
import { AttachmentsSection } from "@/src/components/AttachmentsSection";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TEMPLATES } from "@/constants/testIds";

const REMINDER_CHOICES = [1, 2, 3, 5, 7, 14, 30];

type Props = {
  template: TaskTemplate | null; // null → yeni
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  onAuthError: () => void;
};

export const TemplateFormModal = ({ template, categories, onClose, onSaved, onAuthError }: Props) => {
  const [tplId, setTplId] = useState<string | null>(template?.id || null);
  const [name, setName] = useState(template?.name || "");
  const [title, setTitle] = useState(template?.title || "");
  const [description, setDescription] = useState(template?.description || "");
  const [categoryId, setCategoryId] = useState<string | null>(template?.category_id || null);
  const [reminderDays, setReminderDays] = useState<number | null | "off">(
    template?.reminder_disabled ? "off" : (template?.reminder_days ?? null),
  );
  const [scope, setScope] = useState<"personal" | "shared">(template?.scope === "shared" ? "shared" : "personal");
  const [subtasks, setSubtasks] = useState<{ id?: string; text: string }[]>(template?.subtasks || []);
  const [newSub, setNewSub] = useState("");
  const [saving, setSaving] = useState(false);

  const addSub = () => {
    const t = newSub.trim();
    if (!t) return;
    setSubtasks((p) => [...p, { text: t }]);
    setNewSub("");
  };

  const save = async () => {
    if (name.trim().length < 2) {
      Alert.alert("Eksik", "Şablon adı en az 2 karakter olmalı");
      return;
    }
    const body: Partial<TaskTemplate> & { reminder_disabled?: boolean } = {
      name: name.trim(),
      title: title.trim(),
      description: description.trim(),
      category_id: categoryId,
      scope,
      subtasks: subtasks.map((s) => ({ text: s.text })),
    };
    if (reminderDays === "off") {
      body.reminder_disabled = true;
      body.reminder_days = 0;
    } else {
      body.reminder_disabled = false;
      body.reminder_days = reminderDays;
    }
    setSaving(true);
    try {
      if (tplId) {
        await api.updateTemplate(tplId, body);
        onSaved();
        onClose();
      } else {
        const created = await api.createTemplate(body);
        setTplId(created.id);
        onSaved();
        Alert.alert("Kaydedildi", "Şablon kaydedildi — artık dosya ekleyebilirsiniz.");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      Alert.alert("Hata", e instanceof ApiError ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID={TEMPLATES.formModal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{tplId ? "ŞABLONU DÜZENLE" : "YENİ ŞABLON"}</Text>
            <Pressable testID={TEMPLATES.close} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.lg }}>
            <Text style={styles.label}>ŞABLON ADI *</Text>
            <TextInput testID={TEMPLATES.name} value={name} onChangeText={setName} placeholder="Örn: Haftalık Rapor"
              placeholderTextColor={colors.textMuted} style={styles.input} />

            <Text style={styles.label}>KAPSAM</Text>
            <View style={styles.row}>
              <Pressable testID={TEMPLATES.scopePersonal} onPress={() => setScope("personal")}
                style={[styles.toggle, scope === "personal" && styles.toggleOn]}>
                <Ionicons name="person-outline" size={14} color={scope === "personal" ? colors.primary : colors.textMuted} />
                <Text style={[styles.toggleText, scope === "personal" && styles.toggleTextOn]}>Kişisel</Text>
              </Pressable>
              <Pressable testID={TEMPLATES.scopeShared} onPress={() => setScope("shared")}
                style={[styles.toggle, scope === "shared" && styles.toggleOn]}>
                <Ionicons name="people-outline" size={14} color={scope === "shared" ? colors.primary : colors.textMuted} />
                <Text style={[styles.toggleText, scope === "shared" && styles.toggleTextOn]}>Ekip</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>GÖREV BAŞLIĞI</Text>
            <TextInput testID={TEMPLATES.title} value={title} onChangeText={setTitle} placeholder="Görevin başlığı"
              placeholderTextColor={colors.textMuted} style={styles.input} />

            <Text style={styles.label}>AÇIKLAMA</Text>
            <TextInput testID={TEMPLATES.description} value={description} onChangeText={setDescription} multiline
              placeholder="Açıklama" placeholderTextColor={colors.textMuted} style={[styles.input, styles.textarea]} />

            {categories.length > 0 && (
              <>
                <Text style={styles.label}>İŞ KOLU</Text>
                <View style={styles.chipsWrap}>
                  <Pressable onPress={() => setCategoryId(null)} style={[styles.chip, !categoryId && styles.chipOn]}>
                    <Text style={[styles.chipText, !categoryId && styles.chipTextOn]}>Yok</Text>
                  </Pressable>
                  {categories.map((c) => (
                    <Pressable key={c.id} onPress={() => setCategoryId(c.id)} style={[styles.chip, categoryId === c.id && styles.chipOn]}>
                      <Text style={[styles.chipText, categoryId === c.id && styles.chipTextOn]} numberOfLines={1}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.label}>YAKLAŞAN UYARISI</Text>
            <View style={styles.chipsWrap}>
              <Pressable onPress={() => setReminderDays(null)} style={[styles.chip, reminderDays === null && styles.chipOn]}>
                <Text style={[styles.chipText, reminderDays === null && styles.chipTextOn]}>Varsayılan</Text>
              </Pressable>
              {REMINDER_CHOICES.map((d) => (
                <Pressable key={d} onPress={() => setReminderDays(d)} style={[styles.chip, reminderDays === d && styles.chipOn]}>
                  <Text style={[styles.chipText, reminderDays === d && styles.chipTextOn]}>{d}g</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setReminderDays("off")} style={[styles.chip, reminderDays === "off" && styles.chipOn]}>
                <Text style={[styles.chipText, reminderDays === "off" && styles.chipTextOn]}>Kapalı</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>ALT GÖREVLER</Text>
            {subtasks.map((s, i) => (
              <View key={s.id || i} style={styles.subRow}>
                <Text style={styles.subText} numberOfLines={1}>{s.text}</Text>
                <Pressable onPress={() => setSubtasks((p) => p.filter((_, idx) => idx !== i))} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </Pressable>
              </View>
            ))}
            <View style={styles.row}>
              <TextInput testID={TEMPLATES.subtaskInput} value={newSub} onChangeText={setNewSub} placeholder="Alt görev ekle…"
                placeholderTextColor={colors.textMuted} style={[styles.input, { flex: 1, marginTop: 0 }]} onSubmitEditing={addSub} />
              <Pressable testID={TEMPLATES.subtaskAdd} onPress={addSub} style={styles.addSub}>
                <Ionicons name="add" size={20} color={colors.primary} />
              </Pressable>
            </View>

            {tplId ? (
              <AttachmentsSection taskId={tplId} kind="template" onAuthError={onAuthError} />
            ) : (
              <Text style={styles.note}>📎 Dosya eklemek için önce şablonu kaydedin.</Text>
            )}
          </ScrollView>

          <Pressable testID={TEMPLATES.save} onPress={save} disabled={saving}
            style={({ pressed }) => [styles.saveBtn, (pressed || saving) && styles.pressed]}>
            {saving ? <ActivityIndicator color={colors.bgBase} /> : (
              <Text style={styles.saveText}>{tplId ? "GÜNCELLE" : "KAYDET"}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    maxHeight: "92%",
    padding: spacing.lg,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  headerTitle: { color: colors.primary, fontSize: 15, fontWeight: "800", fontFamily: monoFont, letterSpacing: 1 },
  label: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont, letterSpacing: 1, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  textarea: { minHeight: 60, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  toggle: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10,
  },
  toggleOn: { borderColor: colors.primary, backgroundColor: colors.primary + "22" },
  toggleText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  toggleTextOn: { color: colors.primary },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 6, maxWidth: 160,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary + "22" },
  chipText: { color: colors.textMuted, fontSize: 12, fontFamily: monoFont },
  chipTextOn: { color: colors.primary },
  subRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: 6,
  },
  subText: { flex: 1, color: colors.textPrimary, fontSize: 13, marginRight: spacing.sm },
  addSub: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, padding: 9 },
  note: { color: colors.textMuted, fontStyle: "italic", fontSize: 12, marginTop: spacing.md },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14,
    alignItems: "center", marginTop: spacing.md,
  },
  saveText: { color: colors.bgBase, fontSize: 15, fontWeight: "800", fontFamily: monoFont, letterSpacing: 1 },
  pressed: { opacity: 0.7 },
});

export default TemplateFormModal;
