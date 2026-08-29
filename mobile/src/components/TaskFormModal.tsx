// Create / edit a task. Multi-assignee is supported ONLY on create (backend
// sets `assignees` from `assignee_user_ids` at creation; PATCH cannot mutate
// them). On edit we manage title / description / due date / category, and
// allow delete.

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";

import { api, ApiError } from "@/src/api/client";
import { Category, SearchUser, Task } from "@/src/api/types";
import { flattenCategories } from "@/src/lib/taskTree";
import { formatDate } from "@/src/lib/format";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TASK_FORM } from "@/constants/testIds";

type Props = {
  visible: boolean;
  mode: "create" | "edit";
  task: Task | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
};

const endOfDayISO = (daysAhead: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
};

const startOfDayISO = (daysAhead: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const formatDateTimeTr = (d: Date) =>
  `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`;

// Web önizleme fallback'i: "GG.AA.YYYY SS:DD" metnini Date'e çevirir.
const parseTrDateTime = (s: string): Date | null => {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], 0, 0);
  return isNaN(d.getTime()) ? null : d;
};

const dueOptions = [
  { key: "none", label: "Yok", value: null as string | null },
  { key: "today", label: "Bugün", value: endOfDayISO(0) },
  { key: "tomorrow", label: "Yarın", value: endOfDayISO(1) },
  { key: "3d", label: "3 gün", value: endOfDayISO(3) },
  { key: "1w", label: "1 hafta", value: endOfDayISO(7) },
];

const startOptions = [
  { key: "none", label: "Yok", value: null as string | null },
  { key: "today", label: "Bugün", value: startOfDayISO(0) },
  { key: "tomorrow", label: "Yarın", value: startOfDayISO(1) },
  { key: "3d", label: "3 gün", value: startOfDayISO(3) },
  { key: "1w", label: "1 hafta", value: startOfDayISO(7) },
];

export const TaskFormModal = ({ visible, mode, task, categories, onClose, onSaved }: Props) => {
  const insets = useSafeAreaInsets();
  const isEdit = mode === "edit";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueKey, setDueKey] = useState<string>(isEdit ? "keep" : "none");
  const [startKey, setStartKey] = useState<string>(isEdit ? "keep" : "none");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchUser[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customDue, setCustomDue] = useState<Date | null>(null);
  const [picker, setPicker] = useState<{
    target: "start" | "due";
    stage: "date" | "time";
    temp: Date;
  } | null>(null);
  const [webText, setWebText] = useState("");
  const [pickerErr, setPickerErr] = useState<string | null>(null);

  const flatCats = useMemo(() => flattenCategories(categories), [categories]);

  // Reset form each time it opens.
  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setCategoryId(task?.category_id ?? null);
    setDueKey(isEdit ? "keep" : "none");
    setStartKey(isEdit ? "keep" : "none");
    setSelected([]);
    setQuery("");
    setResults([]);
    setError(null);
    setSaving(false);
    setConfirmingDelete(false);
    setCustomStart(null);
    setCustomDue(null);
    setPicker(null);
    setWebText("");
    setPickerErr(null);
  }, [visible, task, isEdit]);

  // Debounced assignee search (create mode only).
  useEffect(() => {
    if (isEdit) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const users = await api.searchUsers(q);
        const pickedIds = new Set(selected.map((s) => s.id));
        setResults(users.filter((u) => !pickedIds.has(u.id)));
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, isEdit, selected]);

  const addAssignee = (u: SearchUser) => {
    setSelected((prev) => [...prev, u]);
    setQuery("");
    setResults([]);
  };
  const removeAssignee = (id: string) => {
    setSelected((prev) => prev.filter((s) => s.id !== id));
  };

  const resolveStart = (): string | null => {
    if (startKey === "keep") return task?.start_date ?? null;
    if (startKey === "custom") return customStart ? customStart.toISOString() : null;
    return startOptions.find((o) => o.key === startKey)?.value ?? null;
  };
  const resolveDue = (): string | null => {
    if (dueKey === "keep") return task?.due_date ?? null;
    if (dueKey === "custom") return customDue ? customDue.toISOString() : null;
    return dueOptions.find((o) => o.key === dueKey)?.value ?? null;
  };

  // ---- Manuel tarih/saat seçici ----
  const defaultFor = (target: "start" | "due"): Date => {
    const iso =
      target === "start"
        ? customStart?.toISOString() ?? (isEdit ? task?.start_date : null)
        : customDue?.toISOString() ?? (isEdit ? task?.due_date : null);
    return iso ? new Date(iso) : new Date();
  };
  const openCustom = (target: "start" | "due") => {
    const base = defaultFor(target);
    setPickerErr(null);
    setWebText(formatDateTimeTr(base));
    setPicker({ target, stage: "date", temp: base });
  };
  const commitCustom = (d: Date) => {
    if (!picker) return;
    if (picker.target === "start") {
      setCustomStart(d);
      setStartKey("custom");
    } else {
      setCustomDue(d);
      setDueKey("custom");
    }
    setPicker(null);
  };
  const mergeDatePart = (base: Date, picked: Date): Date => {
    const d = new Date(base);
    d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    return d;
  };
  const mergeTimePart = (base: Date, picked: Date): Date => {
    const d = new Date(base);
    d.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    return d;
  };
  // Android: her aşama ayrı dialog.
  const onAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (!picker) return;
    if (event.type === "dismissed" || !selected) {
      setPicker(null);
      return;
    }
    if (picker.stage === "date") {
      setPicker({ ...picker, stage: "time", temp: mergeDatePart(picker.temp, selected) });
    } else {
      commitCustom(mergeTimePart(picker.temp, selected));
    }
  };
  // iOS: çark sürekli günceller, "İleri/Tamam" ile ilerler.
  const onSpinnerChange = (_e: DateTimePickerEvent, selected?: Date) => {
    if (!picker || !selected) return;
    const merged =
      picker.stage === "date"
        ? mergeDatePart(picker.temp, selected)
        : mergeTimePart(picker.temp, selected);
    setPicker({ ...picker, temp: merged });
  };
  const onSheetConfirm = () => {
    if (!picker) return;
    if (Platform.OS === "web") {
      const parsed = parseTrDateTime(webText);
      if (!parsed) {
        setPickerErr("Biçim: GG.AA.YYYY SS:DD (örn. 10.08.2026 16:43)");
        return;
      }
      commitCustom(parsed);
      return;
    }
    // iOS
    if (picker.stage === "date") setPicker({ ...picker, stage: "time" });
    else commitCustom(picker.temp);
  };

  const onSave = async () => {
    if (saving) return;
    if (!title.trim()) {
      setError("Görev başlığı gerekli");
      return;
    }
    // Yumuşak doğrulama — başlangıç, bitişten sonra olamaz (ikisi de opsiyonel).
    const resolvedStart = resolveStart();
    const resolvedDue = resolveDue();
    if (resolvedStart && resolvedDue && new Date(resolvedStart) > new Date(resolvedDue)) {
      setError("Başlangıç tarihi bitiş tarihinden sonra olamaz");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (isEdit && task) {
        const patch: Record<string, unknown> = {
          title: title.trim(),
          description: description.trim(),
          category_id: categoryId ?? "",
        };
        if (startKey !== "keep") patch.start_date = resolvedStart;
        if (dueKey !== "keep") patch.due_date = resolvedDue;
        await api.updateTask(task.id, patch);
      } else {
        await api.createTask({
          title: title.trim(),
          description: description.trim(),
          start_date: resolvedStart,
          due_date: resolvedDue,
          category_id: categoryId,
          assignee_user_ids: selected.map((s) => s.id),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    if (!task) return;
    setConfirmingDelete(true);
  };

  const doDelete = async () => {
    if (!task) return;
    setConfirmingDelete(false);
    try {
      await api.deleteTask(task.id);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Silinemedi");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]} testID={TASK_FORM.modal}>
        <View style={styles.header}>
          <Pressable testID={TASK_FORM.cancelButton} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
          <Text style={styles.headerTitle}>{isEdit ? "GÖREVİ DÜZENLE" : "YENİ GÖREV"}</Text>
          <View style={{ width: 26 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>BAŞLIK</Text>
            <TextInput
              testID={TASK_FORM.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Görev başlığı"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.label}>AÇIKLAMA</Text>
            <TextInput
              testID={TASK_FORM.descInput}
              value={description}
              onChangeText={setDescription}
              placeholder="İsteğe bağlı açıklama"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.textarea]}
              multiline
            />

            <Text style={styles.label}>BAŞLANGIÇ</Text>
            <View style={styles.chipRow}>
              {isEdit && (
                <Pressable
                  onPress={() => setStartKey("keep")}
                  style={[styles.chip, startKey === "keep" && styles.chipActive]}
                >
                  <Text style={[styles.chipText, startKey === "keep" && styles.chipTextActive]}>
                    {task?.start_date ? formatDate(task.start_date) : "Mevcut"}
                  </Text>
                </Pressable>
              )}
              {startOptions.map((o) => (
                <Pressable
                  key={o.key}
                  testID={`${TASK_FORM.startChip}-${o.key}`}
                  onPress={() => setStartKey(o.key)}
                  style={[styles.chip, startKey === o.key && styles.chipActive]}
                >
                  <Text style={[styles.chipText, startKey === o.key && styles.chipTextActive]}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                testID={TASK_FORM.startCustom}
                onPress={() => openCustom("start")}
                style={[styles.chip, startKey === "custom" && styles.chipActive]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={startKey === "custom" ? colors.bgBase : colors.textSecondary}
                />
                <Text style={[styles.chipText, startKey === "custom" && styles.chipTextActive]}>
                  {startKey === "custom" && customStart
                    ? formatDateTimeTr(customStart)
                    : "Tarih/Saat seç"}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.label}>SON TARİH</Text>
            <View style={styles.chipRow}>
              {isEdit && (
                <Pressable
                  onPress={() => setDueKey("keep")}
                  style={[styles.chip, dueKey === "keep" && styles.chipActive]}
                >
                  <Text style={[styles.chipText, dueKey === "keep" && styles.chipTextActive]}>
                    {task?.due_date ? formatDate(task.due_date) : "Mevcut"}
                  </Text>
                </Pressable>
              )}
              {dueOptions.map((o) => (
                <Pressable
                  key={o.key}
                  testID={`${TASK_FORM.dueChip}-${o.key}`}
                  onPress={() => setDueKey(o.key)}
                  style={[styles.chip, dueKey === o.key && styles.chipActive]}
                >
                  <Text style={[styles.chipText, dueKey === o.key && styles.chipTextActive]}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                testID={TASK_FORM.dueCustom}
                onPress={() => openCustom("due")}
                style={[styles.chip, dueKey === "custom" && styles.chipActive]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={dueKey === "custom" ? colors.bgBase : colors.textSecondary}
                />
                <Text style={[styles.chipText, dueKey === "custom" && styles.chipTextActive]}>
                  {dueKey === "custom" && customDue ? formatDateTimeTr(customDue) : "Tarih/Saat seç"}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.label}>KATEGORİ</Text>
            <View style={styles.chipRow}>
              <Pressable
                testID={`${TASK_FORM.categoryChip}-none`}
                onPress={() => setCategoryId(null)}
                style={[styles.chip, categoryId === null && styles.chipActive]}
              >
                <Text style={[styles.chipText, categoryId === null && styles.chipTextActive]}>
                  Yok
                </Text>
              </Pressable>
              {flatCats.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`${TASK_FORM.categoryChip}-${c.id}`}
                  onPress={() => setCategoryId(c.id)}
                  style={[styles.chip, categoryId === c.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>
                    {"— ".repeat(c.depth)}
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {!isEdit && (
              <>
                <Text style={styles.label}>KİŞİYE ATA (İSTEĞE BAĞLI)</Text>
                {selected.length > 0 && (
                  <View style={styles.chipRow}>
                    {selected.map((s) => (
                      <Pressable
                        key={s.id}
                        testID={`${TASK_FORM.assigneeChip}-${s.id}`}
                        onPress={() => removeAssignee(s.id)}
                        style={[styles.chip, styles.chipActive, styles.assigneeChip]}
                      >
                        <Text style={styles.chipTextActive}>{s.username}</Text>
                        <Ionicons name="close-circle" size={14} color={colors.bgBase} />
                      </Pressable>
                    ))}
                  </View>
                )}
                <TextInput
                  testID={TASK_FORM.assigneeSearch}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Kullanıcı ara (en az 2 harf)"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  style={styles.input}
                />
                {results.map((u) => (
                  <Pressable
                    key={u.id}
                    testID={`${TASK_FORM.assigneeResult}-${u.id}`}
                    onPress={() => addAssignee(u)}
                    style={({ pressed }) => [styles.result, pressed && styles.pressed]}
                  >
                    <Ionicons name="person-add-outline" size={16} color={colors.primary} />
                    <Text style={styles.resultText}>{u.username}</Text>
                    {!!u.company_name && <Text style={styles.resultSub}>{u.company_name}</Text>}
                  </Pressable>
                ))}
              </>
            )}

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="warning-outline" size={14} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {isEdit && (
              <Pressable
                testID={TASK_FORM.deleteButton}
                onPress={onDelete}
                style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={styles.deleteText}>Görevi Sil</Text>
              </Pressable>
            )}
            <View style={{ height: 100 }} />
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
            <Pressable
              testID={TASK_FORM.saveButton}
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed, saving && styles.pressed]}
            >
              {saving ? (
                <ActivityIndicator color={colors.bgBase} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={18} color={colors.bgBase} />
                  <Text style={styles.saveText}>{isEdit ? "KAYDET" : "OLUŞTUR"}</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>

        <Modal
          visible={confirmingDelete}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirmingDelete(false)}
        >
          <View style={styles.confirmBackdrop}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>Görevi sil</Text>
              <Text style={styles.confirmBody}>
                {`"${task?.title ?? ""}" silinsin mi? Bu işlem geri alınamaz.`}
              </Text>
              <View style={styles.confirmRow}>
                <Pressable
                  testID={TASK_FORM.deleteCancel}
                  onPress={() => setConfirmingDelete(false)}
                  style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed]}
                >
                  <Text style={styles.confirmCancelText}>Vazgeç</Text>
                </Pressable>
                <Pressable
                  testID={TASK_FORM.deleteConfirm}
                  onPress={doDelete}
                  style={({ pressed }) => [styles.confirmDelete, pressed && styles.pressed]}
                >
                  <Text style={styles.confirmDeleteText}>Sil</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {picker && Platform.OS === "android" && (
          <DateTimePicker value={picker.temp} mode={picker.stage} is24Hour onChange={onAndroidChange} />
        )}

        <Modal
          visible={!!picker && Platform.OS !== "android"}
          transparent
          animationType="fade"
          onRequestClose={() => setPicker(null)}
        >
          <View style={styles.confirmBackdrop}>
            <View style={styles.pickerCard} testID={TASK_FORM.pickerSheet}>
              <Text style={styles.confirmTitle}>
                {picker?.target === "start" ? "BAŞLANGIÇ" : "SON TARİH"}
              </Text>
              {Platform.OS === "web" ? (
                <>
                  <Text style={styles.pickerHint}>Tarih ve saati gir (GG.AA.YYYY SS:DD)</Text>
                  <TextInput
                    testID="task-form-picker-web-input"
                    value={webText}
                    onChangeText={setWebText}
                    placeholder="10.08.2026 16:43"
                    placeholderTextColor={colors.textMuted}
                    style={styles.pickerInput}
                    autoCapitalize="none"
                  />
                </>
              ) : (
                <>
                  <Text style={styles.pickerPreview}>{picker ? formatDateTimeTr(picker.temp) : ""}</Text>
                  <Text style={styles.pickerHint}>
                    {picker?.stage === "date" ? "1) Tarihi seç" : "2) Saati seç"}
                  </Text>
                  {picker && (
                    <DateTimePicker
                      value={picker.temp}
                      mode={picker.stage}
                      is24Hour
                      display="spinner"
                      themeVariant="dark"
                      textColor={colors.textPrimary}
                      onChange={onSpinnerChange}
                      style={styles.spinner}
                    />
                  )}
                </>
              )}
              {!!pickerErr && <Text style={styles.pickerErr}>{pickerErr}</Text>}
              <View style={styles.confirmRow}>
                <Pressable
                  testID={TASK_FORM.pickerCancel}
                  onPress={() => setPicker(null)}
                  style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed]}
                >
                  <Text style={styles.confirmCancelText}>Vazgeç</Text>
                </Pressable>
                <Pressable
                  testID={TASK_FORM.pickerConfirm}
                  onPress={onSheetConfirm}
                  style={({ pressed }) => [styles.pickerConfirmBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.pickerConfirmText}>
                    {Platform.OS !== "web" && picker?.stage === "date" ? "İleri →" : "Tamam"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 2,
    fontFamily: monoFont,
  },
  form: { padding: spacing.md, gap: spacing.sm },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1.5,
    fontFamily: monoFont,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  assigneeChip: { paddingRight: 8 },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.bgBase, fontSize: 12, fontWeight: "700" },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  resultText: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  resultSub: { color: colors.textMuted, fontSize: 11, marginLeft: "auto" },
  pressed: { opacity: 0.7 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 0, 60, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 0, 60, 0.4)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255, 0, 60, 0.4)",
    backgroundColor: "rgba(255, 0, 60, 0.08)",
    borderRadius: radius.md,
    paddingVertical: 13,
  },
  deleteText: { color: colors.danger, fontSize: 14, fontWeight: "700" },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 15,
  },
  saveText: { color: colors.bgBase, fontSize: 15, fontWeight: "800", letterSpacing: 2, fontFamily: monoFont },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 4, 10, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  confirmTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: monoFont,
  },
  confirmBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  confirmRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  confirmCancel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  confirmCancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: "700" },
  confirmDelete: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  confirmDeleteText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  pickerCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  pickerPreview: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: "800",
    fontFamily: monoFont,
    letterSpacing: 1,
    alignSelf: "center",
  },
  pickerHint: { color: colors.textMuted, fontSize: 12, alignSelf: "center" },
  pickerErr: { color: colors.danger, fontSize: 13, alignSelf: "center", textAlign: "center" },
  spinner: { alignSelf: "stretch" },
  pickerInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: monoFont,
    textAlign: "center",
  },
  pickerConfirmBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  pickerConfirmText: { color: colors.bgBase, fontSize: 14, fontWeight: "800" },
});
