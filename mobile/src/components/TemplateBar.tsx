import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, ApiError } from "@/src/api/client";
import { TaskTemplate } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { TEMPLATES } from "@/constants/testIds";

// "Şablondan başla" çubuğu — görevler ekranında. Çipe dokun → o şablondan
// görev oluştur (instantiate) → görev detayına (düzenlemeye) git. "Şablonlar"
// düğmesi kütüphaneyi açar.
export const TemplateBar = ({ onAuthError }: { onAuthError: () => void }) => {
  const router = useRouter();
  const [items, setItems] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingId, setUsingId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api.listTemplates()
        .then((r) => alive && setItems(Array.isArray(r) ? r : []))
        .catch(() => alive && setItems([]))
        .finally(() => alive && setLoading(false));
      return () => { alive = false; };
    }, []),
  );

  const use = async (t: TaskTemplate) => {
    setUsingId(t.id);
    try {
      const task = await api.instantiateTemplate(t.id);
      router.push(`/task/${task.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
    } finally {
      setUsingId(null);
    }
  };

  return (
    <View style={styles.wrap} testID={TEMPLATES.bar}>
      <Ionicons name="albums-outline" size={14} color={colors.textMuted} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          items.slice(0, 12).map((t) => (
            <Pressable key={t.id} testID={`${TEMPLATES.chip}-${t.id}`} disabled={usingId === t.id}
              onPress={() => use(t)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
              {usingId === t.id && <ActivityIndicator size="small" color={colors.primary} />}
              <Text style={styles.chipText} numberOfLines={1}>{t.name}</Text>
            </Pressable>
          ))
        )}
        <Pressable testID={TEMPLATES.manage} onPress={() => router.push("/templates")}
          style={({ pressed }) => [styles.manage, pressed && styles.pressed]}>
          <Ionicons name="add" size={14} color={colors.textMuted} />
          <Text style={styles.manageText}>Şablonlar</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  chips: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingRight: spacing.md },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderColor: colors.primary + "66", borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.primary + "12", maxWidth: 160,
  },
  chipText: { color: colors.primary, fontSize: 12, fontFamily: monoFont },
  manage: {
    flexDirection: "row", alignItems: "center", gap: 3,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  manageText: { color: colors.textMuted, fontSize: 12, fontFamily: monoFont },
  pressed: { opacity: 0.6 },
});

export default TemplateBar;
