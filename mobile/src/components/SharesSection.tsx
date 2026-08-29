// Task sharing: view who a task is shared with (and their permissions),
// share it with more users via a search + permission picker, edit an
// existing recipient's permissions, and remove a recipient. Uses the shared
// backend PUT /tasks/{id}/shares (full-list replace).

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
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

import { api, ApiError } from "@/src/api/client";
import { SearchUser, Task } from "@/src/api/types";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { DETAIL } from "@/constants/testIds";

type PermSet = {
  view?: boolean;
  edit?: boolean;
  complete?: boolean;
  delete?: boolean;
  assign?: boolean;
};

type ShareRow = { user_id: string; name: string; perms: PermSet };

type Props = {
  task: Task;
  onUpdated: (t: Task) => void;
  onAuthError: () => void;
};

// Toggleable permissions (view is always implicitly on for a shared user).
const PERM_OPTIONS: { key: keyof PermSet; label: string }[] = [
  { key: "edit", label: "Düzenle" },
  { key: "complete", label: "Tamamla" },
  { key: "assign", label: "Ata" },
  { key: "delete", label: "Sil" },
];

function fromTask(task: Task): ShareRow[] {
  return (task.shared_with || []).map((s) => ({
    user_id: s.user_id,
    name: s.name || "?",
    perms: { view: true, ...(s.perms || {}) },
  }));
}

function permSummary(perms: PermSet): string {
  const on = PERM_OPTIONS.filter((p) => perms[p.key]).map((p) => p.label);
  return on.length ? `Görüntüle · ${on.join(" · ")}` : "Yalnızca görüntüleme";
}

export const SharesSection = ({ task, onUpdated, onAuthError }: Props) => {
  const [rows, setRows] = useState<ShareRow[]>(() => fromTask(task));
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [perms, setPerms] = useState<PermSet>({ view: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(fromTask(task));
  }, [task]);

  // Debounced user search (add step only).
  useEffect(() => {
    if (!modal || picked) return;
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const users = await api.searchUsers(q);
        const existing = new Set(rows.map((r) => r.user_id));
        if (active) setResults(users.filter((u) => !existing.has(u.id) && u.id !== task.user_id));
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, modal, picked, rows, task.user_id]);

  const openAdd = () => {
    setError(null);
    setPicked(null);
    setQuery("");
    setResults([]);
    setPerms({ view: true });
    setModal(true);
  };

  const openEdit = (row: ShareRow) => {
    setError(null);
    setPicked({ id: row.user_id, name: row.name });
    setPerms({ view: true, ...row.perms });
    setModal(true);
  };

  const persist = async (list: ShareRow[]) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setShares(
        task.id,
        list.map((r) => ({ user_id: r.user_id, perms: r.perms })),
        true,
      );
      onUpdated(updated);
      setRows(fromTask(updated));
      setModal(false);
      setPicked(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Paylaşım güncellenemedi");
    } finally {
      setSaving(false);
    }
  };

  const savePicked = () => {
    if (!picked) return;
    const next = [
      ...rows.filter((r) => r.user_id !== picked.id),
      { user_id: picked.id, name: picked.name, perms: { ...perms, view: true } },
    ];
    persist(next);
  };

  const removeRow = (uid: string) => persist(rows.filter((r) => r.user_id !== uid));

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>
          PAYLAŞIM {rows.length > 0 ? `(${rows.length})` : ""}
        </Text>
        <Pressable
          testID={DETAIL.shareAdd}
          onPress={openAdd}
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
        >
          <Ionicons name="person-add-outline" size={15} color={colors.primary} />
          <Text style={styles.addText}>Paylaş</Text>
        </Pressable>
      </View>

      {rows.length === 0 ? (
        <Text style={styles.empty}>Bu görev kimseyle paylaşılmadı.</Text>
      ) : (
        rows.map((r) => (
          <View key={r.user_id} style={styles.item} testID={`${DETAIL.shareItem}-${r.user_id}`}>
            <Pressable style={styles.itemBody} onPress={() => openEdit(r)}>
              <Ionicons name="person-circle-outline" size={22} color={colors.textSecondary} />
              <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.itemMeta} numberOfLines={1}>{permSummary(r.perms)}</Text>
              </View>
            </Pressable>
            <Pressable
              testID={`${DETAIL.shareRemove}-${r.user_id}`}
              onPress={() => removeRow(r.user_id)}
              disabled={saving}
              hitSlop={8}
              style={({ pressed }) => [styles.trash, pressed && styles.pressed]}
            >
              <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
            </Pressable>
          </View>
        ))
      )}

      <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{picked ? picked.name : "Kullanıcıyla Paylaş"}</Text>
              <Pressable testID={DETAIL.shareClose} onPress={() => setModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            {!picked ? (
              <>
                <TextInput
                  testID={DETAIL.shareSearch}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Kullanıcı ara…"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  style={styles.input}
                />
                {searching ? (
                  <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
                ) : (
                  <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
                    {results.length === 0 && query.trim().length > 0 && (
                      <Text style={styles.empty}>Kullanıcı bulunamadı</Text>
                    )}
                    {results.map((u) => (
                      <Pressable
                        key={u.id}
                        testID={`${DETAIL.shareUser}-${u.id}`}
                        onPress={() => {
                          setPicked({ id: u.id, name: u.username });
                          setPerms({ view: true });
                        }}
                        style={({ pressed }) => [styles.userRow, pressed && styles.pressed]}
                      >
                        <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemName}>{u.username}</Text>
                          {!!u.company_name && <Text style={styles.itemMeta}>{u.company_name}</Text>}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </>
            ) : (
              <>
                <Text style={styles.permHint}>İzinler (görüntüleme her zaman açık)</Text>
                <View style={styles.permWrap}>
                  {PERM_OPTIONS.map((p) => {
                    const on = !!perms[p.key];
                    return (
                      <Pressable
                        key={p.key}
                        testID={`${DETAIL.sharePerm}-${p.key}`}
                        onPress={() => setPerms((prev) => ({ ...prev, [p.key]: !prev[p.key] }))}
                        style={[styles.permChip, on && styles.permChipOn]}
                      >
                        {on && <Ionicons name="checkmark" size={13} color={colors.bgBase} />}
                        <Text style={[styles.permText, on && styles.permTextOn]}>{p.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  testID={DETAIL.shareSave}
                  onPress={savePicked}
                  disabled={saving}
                  style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={colors.bgBase} />
                  ) : (
                    <Text style={styles.saveText}>Paylaş</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.textMuted, fontSize: 12, letterSpacing: 1, fontFamily: monoFont },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  addText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.6 },
  empty: { color: colors.textMuted, fontStyle: "italic", fontSize: 13, paddingVertical: spacing.sm },
  error: { color: colors.danger, fontSize: 13 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  itemBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemInfo: { flex: 1 },
  itemName: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  itemMeta: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont, marginTop: 2 },
  trash: { padding: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "800", flex: 1 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
  },
  results: { marginTop: spacing.xs },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  permHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  permWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: spacing.sm },
  permChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  permChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  permText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  permTextOn: { color: colors.bgBase, fontWeight: "800" },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  saveText: { color: colors.bgBase, fontSize: 15, fontWeight: "800" },
});
