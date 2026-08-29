import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, monoFont, radius, spacing } from "@/src/theme/colors";

export type Option = { label: string; value: string };

// Basit seçim alanı — değeri gösterir, dokununca modal liste açar (RN'de yerleşik
// picker olmadığı için). Rol / şirket / önem / lisans türü / kişi seçiminde.
export function SelectField({
  label,
  value,
  options,
  placeholder = "Seçin",
  onChange,
  testID,
}: {
  label?: string;
  value: string | null;
  options: Option[];
  placeholder?: string;
  onChange: (v: string) => void;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable testID={testID} onPress={() => setOpen(true)} style={styles.field}>
        <Text style={[styles.value, !current && styles.placeholder]} numberOfLines={1}>
          {current ? current.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label || placeholder}</Text>
            <ScrollView style={styles.list}>
              {options.length === 0 ? (
                <Text style={styles.empty}>Seçenek yok</Text>
              ) : (
                options.map((o) => {
                  const active = o.value === value;
                  return (
                    <Pressable
                      key={o.value}
                      testID={testID ? `${testID}-opt-${o.value}` : undefined}
                      onPress={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}
                    >
                      <Text style={[styles.optionText, active && styles.optionTextActive]}>{o.label}</Text>
                      {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { color: colors.textMuted, fontSize: 11, letterSpacing: 1, fontFamily: monoFont },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  value: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  placeholder: { color: colors.textMuted },
  backdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.8)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.md, maxHeight: "70%" },
  sheetTitle: { color: colors.primary, fontSize: 12, letterSpacing: 1, fontFamily: monoFont, marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  empty: { color: colors.textMuted, fontStyle: "italic", textAlign: "center", padding: spacing.md },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  optionActive: { backgroundColor: "rgba(0,240,255,0.08)" },
  optionText: { color: colors.textPrimary, fontSize: 15 },
  optionTextActive: { color: colors.primary, fontWeight: "700" },
  pressed: { opacity: 0.6 },
});
