// Create / edit a task category (iş kolu). Admins pick a company for a new
// root category; sub-categories inherit the parent's company. Edit supports
// rename, recolor and move (re-parent) within the same company.

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api/client";
import { Category, CompanyLite } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { CATMGR } from "@/constants/testIds";

export const CATEGORY_COLORS = [
  "#00F0FF", "#0066FF", "#4ADE80", "#FFB800", "#FF003C",
  "#A855F7", "#EC4899", "#14B8A6", "#F97316", "#94A3B8",
];

type Mode = "create-root" | "create-sub" | "edit";

type Props = {
  visible: boolean;
  mode: Mode;
  category: Category | null;
  parent: Category | null;
  companies: CompanyLite[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
};

// ids of a category + all its descendants (to exclude from move targets)
const descendantIds = (cats: Category[], rootId: string): Set<string> => {
  const childrenBy = new Map<string | null | undefined, Category[]>();
  cats.forEach((c) => {
    const list = childrenBy.get(c.parent_id ?? null) ?? [];
    list.push(c);
    childrenBy.set(c.parent_id ?? null, list);
  });
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const ch of childrenBy.get(cur) ?? []) {
      if (!out.has(ch.id)) {
        out.add(ch.id);
        stack.push(ch.id);
      }
    }
  }
  return out;
};

export const CategoryEditorModal = ({
  visible,
  mode,
  category,
  parent,
  companies,
  categories,
  onClose,
  onSaved,
}: Props) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [companyQuery, setCompanyQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(category?.name ?? "");
    setColor(category?.color || CATEGORY_COLORS[0]);
    setCompanyId(mode === "edit" ? category?.company_id ?? null : mode === "create-sub" ? parent?.company_id ?? null : null);
    setParentId(mode === "edit" ? category?.parent_id ?? null : mode === "create-sub" ? parent?.id ?? null : null);
    setCompanyQuery("");
    setError(null);
    setSaving(false);
  }, [visible, mode, category, parent]);

  const filteredCompanies = useMemo(() => {
    const q = companyQuery.trim().toLowerCase();
    const list = q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies;
    return list.slice(0, 40);
  }, [companies, companyQuery]);

  // Move targets for edit: same-company categories excluding self + descendants
  const moveTargets = useMemo(() => {
    if (mode !== "edit" || !category) return [];
    const excluded = descendantIds(categories, category.id);
    return categories.filter(
      (c) => c.company_id === category.company_id && !excluded.has(c.id),
    );
  }, [mode, category, categories]);

  const title =
    mode === "edit" ? "İŞ KOLUNU DÜZENLE" : mode === "create-sub" ? "YENİ ALT KOL" : "YENİ İŞ KOLU";

  const onSave = async () => {
    if (saving) return;
    if (name.trim().length < 2) {
      setError("İş kolu adı en az 2 karakter olmalı");
      return;
    }
    if (mode === "create-root" && !companyId) {
      setError("Lütfen bir şirket seçin");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (mode === "edit" && category) {
        const patch: Record<string, unknown> = { name: name.trim(), color };
        if ((category.parent_id ?? null) !== (parentId ?? null)) patch.parent_id = parentId;
        await api.updateCategory(category.id, patch);
      } else if (mode === "create-sub" && parent) {
        await api.createCategory({
          name: name.trim(),
          color,
          company_id: parent.company_id,
          parent_id: parent.id,
        });
      } else {
        await api.createCategory({ name: name.trim(), color, company_id: companyId });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]} testID={CATMGR.editorModal}>
        <View style={styles.header}>
          <Pressable testID={CATMGR.cancel} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {mode === "create-sub" && parent && (
            <Text style={styles.hint}>Üst kol: {parent.name}</Text>
          )}

          <Text style={styles.label}>AD</Text>
          <TextInput
            testID={CATMGR.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="İş kolu adı"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.label}>RENK</Text>
          <View style={styles.swatchRow}>
            {CATEGORY_COLORS.map((c) => (
              <Pressable
                key={c}
                testID={`${CATMGR.colorSwatch}-${c}`}
                onPress={() => setColor(c)}
                style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
              >
                {color === c && <Ionicons name="checkmark" size={16} color={colors.bgBase} />}
              </Pressable>
            ))}
          </View>

          {mode === "create-root" && (
            <>
              <Text style={styles.label}>ŞİRKET</Text>
              <TextInput
                testID={CATMGR.companySearch}
                value={companyQuery}
                onChangeText={setCompanyQuery}
                placeholder="Şirket ara..."
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
              <View style={styles.pickerBox}>
                {filteredCompanies.map((c) => (
                  <Pressable
                    key={c.id}
                    testID={`${CATMGR.companyChip}-${c.id}`}
                    onPress={() => setCompanyId(c.id)}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      companyId === c.id && styles.pickerRowActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={companyId === c.id ? "radio-button-on" : "radio-button-off"}
                      size={16}
                      color={companyId === c.id ? colors.primary : colors.textMuted}
                    />
                    <Text style={styles.pickerText}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {mode === "edit" && (
            <>
              <Text style={styles.label}>ÜST KOL (TAŞI)</Text>
              <View style={styles.chipRow}>
                <Pressable
                  testID={`${CATMGR.parentChip}-root`}
                  onPress={() => setParentId(null)}
                  style={[styles.chip, parentId === null && styles.chipActive]}
                >
                  <Text style={[styles.chipText, parentId === null && styles.chipTextActive]}>Kök</Text>
                </Pressable>
                {moveTargets.map((c) => (
                  <Pressable
                    key={c.id}
                    testID={`${CATMGR.parentChip}-${c.id}`}
                    onPress={() => setParentId(c.id)}
                    style={[styles.chip, parentId === c.id && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, parentId === c.id && styles.chipTextActive]}>
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="warning-outline" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          <View style={{ height: 90 }} />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable
            testID={CATMGR.save}
            onPress={onSave}
            disabled={saving}
            style={({ pressed }) => [styles.saveBtn, (pressed || saving) && styles.pressed]}
          >
            {saving ? (
              <ActivityIndicator color={colors.bgBase} />
            ) : (
              <Text style={styles.saveText}>KAYDET</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "800", letterSpacing: 2, fontFamily: monoFont },
  form: { padding: spacing.md, gap: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 12 },
  label: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, fontFamily: monoFont, marginTop: spacing.sm },
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
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchActive: { borderColor: colors.textPrimary },
  pickerBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    maxHeight: 260,
    overflow: "hidden",
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerRowActive: { backgroundColor: colors.surface },
  pickerText: { color: colors.textPrimary, fontSize: 14 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.bgBase, fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.7 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,0,60,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,0,60,0.4)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  saveBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 15,
  },
  saveText: { color: colors.bgBase, fontSize: 15, fontWeight: "800", letterSpacing: 2, fontFamily: monoFont },
});
