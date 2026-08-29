// Wave 4 — Görev Kilidi + tek kullanımlık OTP. Görev detay ekranında gösterilir.
// - Yönetici/oluşturan: kısıtlamaları ayarlar (Kilit Ayarla) ve atanana tek
//   kullanımlık şifre üretir (Şifre Üret).
// - Atanan (görev sahibi): kilitliyse şifreyle (katı) veya OTP'siz (yumuşak)
//   10 dakikalık tek kullanımlık pencere açar.
// Backend: PATCH /tasks/{id}/locks · POST unlock-otp · unlock-verify ·
// unlock-simple · GET lock-audit.

import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
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
import { LockAuditRow, OtpIssueResponse, Task } from "@/src/api/types";
import {
  activeLockLabels,
  hasActiveUnlockWindow,
  LOCK_AUDIT_LABELS,
  LOCK_KEY_LABELS,
  LOCK_KEY_ORDER,
} from "@/src/lib/taskLocks";
import { colors, monoFont, radius, spacing } from "@/src/theme/colors";
import { DETAIL } from "@/constants/testIds";

type Props = {
  task: Task;
  currentUserId?: string;
  onUpdated: (t: Task) => void;
  onAuthError: () => void;
};

// ---------------------------------------------------------------------------
// Lock configuration modal (managed locks) — checklist + OTP toggle + history.
// ---------------------------------------------------------------------------
const LockConfigModal = ({
  task,
  onClose,
  onSaved,
  onAuthError,
}: {
  task: Task;
  onClose: () => void;
  onSaved: (t: Task) => void;
  onAuthError: () => void;
}) => {
  const [flags, setFlags] = useState<Record<string, boolean>>(() => ({ ...(task.lock_flags || {}) }));
  const [requiresOtp, setRequiresOtp] = useState<boolean>(task.lock_requires_otp !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"config" | "history">("config");
  const [auditRows, setAuditRows] = useState<LockAuditRow[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const activeCount = Object.values(flags).filter(Boolean).length;
  const toggle = (k: string) => setFlags((f) => ({ ...f, [k]: !f[k] }));
  const setAll = (val: boolean) => {
    const next: Record<string, boolean> = {};
    LOCK_KEY_ORDER.forEach((k) => {
      next[k] = val;
    });
    setFlags(next);
  };

  useEffect(() => {
    if (tab !== "history" || auditRows !== null) return;
    setAuditLoading(true);
    api
      .lockAudit(task.id)
      .then((r) => setAuditRows(r.rows || []))
      .catch(() => setAuditRows([]))
      .finally(() => setAuditLoading(false));
  }, [tab, auditRows, task.id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setLocks(task.id, flags, requiresOtp);
      onSaved(updated);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.warning} />
              <Text style={[styles.headerTitle, { color: colors.warning }]}>GÖREV KİLİDİ</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable testID={DETAIL.lockTabConfig} onPress={() => setTab("config")}>
              <Text style={[styles.tabText, tab === "config" && styles.tabActive]}>KISITLAMALAR</Text>
            </Pressable>
            <Pressable testID={DETAIL.lockTabHistory} onPress={() => setTab("history")}>
              <Text style={[styles.tabText, tab === "history" && styles.tabActiveGreen]}>TARİHÇE</Text>
            </Pressable>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          {tab === "config" ? (
            <>
              <Text style={styles.hint} numberOfLines={3}>
                {task.title} için atanan kişinin izinsiz yapamayacağı işlemleri seç. Gerekince tek
                kullanımlık şifre ile açılır.
              </Text>
              <View style={styles.setAllRow}>
                <Pressable
                  testID={DETAIL.lockSetAll}
                  onPress={() => setAll(true)}
                  style={({ pressed }) => [styles.setAllBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.setAllText}>TÜMÜNÜ KİLİTLE</Text>
                </Pressable>
                <Pressable
                  testID={DETAIL.lockClearAll}
                  onPress={() => setAll(false)}
                  style={({ pressed }) => [styles.clearAllBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.clearAllText}>SERBEST BIRAK</Text>
                </Pressable>
                <Text style={styles.countText}>{activeCount}/{LOCK_KEY_ORDER.length}</Text>
              </View>

              <Pressable
                testID={DETAIL.lockRequiresOtp}
                onPress={() => setRequiresOtp((v) => !v)}
                style={[styles.otpToggle, requiresOtp ? styles.otpStrict : styles.otpSoft]}
              >
                <Switch
                  value={requiresOtp}
                  onValueChange={setRequiresOtp}
                  trackColor={{ false: colors.border, true: colors.warning }}
                  thumbColor={colors.bgBase}
                />
                <Text style={styles.otpToggleText}>
                  {requiresOtp ? "Bypass için OTP gerekli (katı)" : "OTP'siz açılabilir (yumuşak)"}
                </Text>
              </Pressable>

              <ScrollView style={styles.checklist} keyboardShouldPersistTaps="handled">
                {LOCK_KEY_ORDER.map((k) => {
                  const checked = !!flags[k];
                  return (
                    <Pressable
                      key={k}
                      testID={`${DETAIL.lockFlag}-${k}`}
                      onPress={() => toggle(k)}
                      style={[styles.checkRow, checked && styles.checkRowOn]}
                    >
                      <Ionicons
                        name={checked ? "checkbox" : "square-outline"}
                        size={20}
                        color={checked ? colors.warning : colors.textMuted}
                      />
                      <Text style={[styles.checkLabel, checked && styles.checkLabelOn]}>
                        {LOCK_KEY_LABELS[k]}
                      </Text>
                      {checked && <Ionicons name="lock-closed" size={13} color={colors.warning} />}
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.footer}>
                <Pressable
                  testID={DETAIL.lockConfigCancel}
                  onPress={onClose}
                  style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.cancelText}>İPTAL</Text>
                </Pressable>
                <Pressable
                  testID={DETAIL.lockConfigSave}
                  onPress={save}
                  disabled={saving}
                  style={({ pressed }) => [styles.saveBtn, saving && styles.disabled, pressed && styles.pressed]}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={colors.bgBase} />
                  ) : (
                    <Text style={styles.saveText}>KAYDET</Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.historyWrap}>
              <Pressable
                testID={DETAIL.lockHistoryRefresh}
                onPress={() => setAuditRows(null)}
                style={({ pressed }) => [styles.refreshBtn, pressed && styles.pressed]}
              >
                <Ionicons name="refresh" size={14} color={colors.success} />
                <Text style={styles.refreshText}>YENİLE</Text>
              </Pressable>
              {auditLoading ? (
                <ActivityIndicator color={colors.success} style={{ marginVertical: spacing.md }} />
              ) : auditRows && auditRows.length === 0 ? (
                <Text style={styles.empty}>Bu görev için henüz kilit hareketi yok.</Text>
              ) : (
                <ScrollView style={styles.historyList}>
                  {(auditRows || []).map((row) => (
                    <View key={row.id} style={styles.historyRow} testID={`lock-history-${row.event_type}`}>
                      <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyLabel}>
                          {LOCK_AUDIT_LABELS[row.event_type] || row.event_type}
                        </Text>
                        <Text style={styles.historyMeta}>
                          {(row.actor_username || "?") + (row.actor_role ? ` (${row.actor_role})` : "")}
                          {row.created_at ? " · " + fmt(row.created_at) : ""}
                        </Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
              <Pressable onPress={onClose} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
                <Text style={styles.cancelText}>KAPAT</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// OTP display modal — issuer sees the plaintext code once with a countdown.
// ---------------------------------------------------------------------------
const OtpDisplayModal = ({ data, onClose }: { data: OtpIssueResponse; onClose: () => void }) => {
  const [remaining, setRemaining] = useState(() => {
    const s = Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000);
    return isNaN(s) ? data.ttl_minutes * 60 : Math.max(0, s);
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  const mins = String(Math.floor(remaining / 60)).padStart(2, "0");
  const secs = String(remaining % 60).padStart(2, "0");

  const copy = async () => {
    await Clipboard.setStringAsync(data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { maxWidth: 340 }]}>
          <View style={styles.headerTitleWrap}>
            <Ionicons name="key-outline" size={16} color={colors.success} />
            <Text style={[styles.headerTitle, { color: colors.success }]}>TEK KULLANIMLIK ŞİFRE</Text>
          </View>
          <Text style={styles.hint}>Atanan kişiye ilet (mesaj / sözlü). Sistem bildirimi de gönderildi.</Text>
          <Text style={styles.otpCode} testID={DETAIL.otpCode} selectable>
            {data.code}
          </Text>
          <Text style={styles.otpCountdown}>
            Kalan süre: <Text style={{ color: colors.success }}>{mins}:{secs}</Text> · tek kullanımlık
          </Text>
          <View style={styles.footer}>
            <Pressable
              testID={DETAIL.otpCopy}
              onPress={copy}
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
            >
              <Text style={[styles.cancelText, { color: colors.success }]}>
                {copied ? "KOPYALANDI" : "KOPYALA"}
              </Text>
            </Pressable>
            <Pressable
              testID={DETAIL.otpClose}
              onPress={onClose}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, pressed && styles.pressed]}
            >
              <Text style={[styles.saveText, { color: colors.textSecondary }]}>KAPAT</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Unlock (assignee enters the 6-digit code).
// ---------------------------------------------------------------------------
const UnlockOtpModal = ({
  task,
  onClose,
  onVerified,
  onAuthError,
}: {
  task: Task;
  onClose: () => void;
  onVerified: (t: Task) => void;
  onAuthError: () => void;
}) => {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError("6 haneli kod girin");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.verifyUnlockOtp(task.id, code);
      onVerified(updated);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Doğrulanamadı");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { maxWidth: 340 }]}>
          <View style={styles.headerTitleWrap}>
            <Ionicons name="lock-open-outline" size={16} color={colors.success} />
            <Text style={[styles.headerTitle, { color: colors.success }]}>KİLİDİ AÇ</Text>
          </View>
          <Text style={styles.hint}>
            Müdürün verdiği 6 haneli şifreyi gir. Doğru şifreyle 10 dk boyunca tek bir kısıtlı işlem
            yapabilirsin.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <TextInput
            testID={DETAIL.unlockInput}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="______"
            placeholderTextColor={colors.textMuted}
            style={styles.otpInput}
            autoFocus
          />
          <View style={styles.footer}>
            <Pressable
              testID={DETAIL.unlockCancel}
              onPress={onClose}
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>İPTAL</Text>
            </Pressable>
            <Pressable
              testID={DETAIL.unlockSubmit}
              onPress={submit}
              disabled={busy || code.length !== 6}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: colors.success },
                (busy || code.length !== 6) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.bgBase} />
              ) : (
                <Text style={styles.saveText}>AÇ</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Main section.
// ---------------------------------------------------------------------------
export const LockSection = ({ task, currentUserId, onUpdated, onAuthError }: Props) => {
  const [configVisible, setConfigVisible] = useState(false);
  const [otpData, setOtpData] = useState<OtpIssueResponse | null>(null);
  const [unlockVisible, setUnlockVisible] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = activeLockLabels(task);
  const locked = active.length > 0;
  const requiresOtp = task.lock_requires_otp !== false;
  const isOwner = !!currentUserId && task.user_id === currentUserId;
  const windowOpen = hasActiveUnlockWindow(task);

  const issueOtp = async () => {
    setIssuing(true);
    setError(null);
    try {
      const res = await api.issueUnlockOtp(task.id);
      setOtpData(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Şifre üretilemedi");
    } finally {
      setIssuing(false);
    }
  };

  const unlockSoft = async () => {
    setError(null);
    try {
      const updated = await api.unlockSimple(task.id);
      onUpdated(updated);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      setError(e instanceof ApiError ? e.message : "Açılamadı");
    }
  };

  return (
    <View style={styles.section} testID={DETAIL.lockSection}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>GÜVENLİK KİLİDİ</Text>
        <View
          style={[
            styles.statusChip,
            windowOpen ? styles.statusOpen : locked ? styles.statusLocked : styles.statusFree,
          ]}
        >
          <Ionicons
            name={windowOpen ? "lock-open" : locked ? "lock-closed" : "shield-checkmark-outline"}
            size={12}
            color={windowOpen ? colors.success : locked ? colors.warning : colors.textMuted}
          />
          <Text
            style={[
              styles.statusText,
              { color: windowOpen ? colors.success : locked ? colors.warning : colors.textMuted },
            ]}
          >
            {windowOpen ? "Kilit açık" : locked ? "Kilitli" : "Serbest"}
          </Text>
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {locked ? (
        <>
          <View style={styles.lockList}>
            {active.map((a) => (
              <View key={a.key} style={styles.lockChip}>
                <Ionicons name="lock-closed" size={11} color={colors.warning} />
                <Text style={styles.lockChipText}>{a.label}{a.self ? " (kişisel)" : ""}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.otpNote}>
            {windowOpen
              ? "Tek kullanımlık pencere aktif — bir kısıtlı işlem yapabilirsiniz."
              : requiresOtp
                ? "Bypass için müdürden tek kullanımlık şifre gerekir."
                : "OTP'siz — görev sahibi kilidi kendisi kaldırabilir."}
          </Text>
        </>
      ) : (
        <Text style={styles.empty}>Bu görevde kısıtlama yok.</Text>
      )}

      <View style={styles.actions}>
        <Pressable
          testID={DETAIL.lockConfigOpen}
          onPress={() => setConfigVisible(true)}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
        >
          <Ionicons name="options-outline" size={15} color={colors.warning} />
          <Text style={[styles.actionText, { color: colors.warning }]}>Kilit Ayarla</Text>
        </Pressable>

        {!isOwner && (
          <Pressable
            testID={DETAIL.lockIssueOtp}
            onPress={issueOtp}
            disabled={issuing}
            style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
          >
            {issuing ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <>
                <Ionicons name="key-outline" size={15} color={colors.success} />
                <Text style={[styles.actionText, { color: colors.success }]}>Şifre Üret</Text>
              </>
            )}
          </Pressable>
        )}
      </View>

      {isOwner && locked && !windowOpen && (
        requiresOtp ? (
          <Pressable
            testID={DETAIL.lockUnlockOpen}
            onPress={() => setUnlockVisible(true)}
            style={({ pressed }) => [styles.unlockBtn, pressed && styles.pressed]}
          >
            <Ionicons name="lock-open-outline" size={16} color={colors.bgBase} />
            <Text style={styles.unlockText}>Kilidi Aç (Şifre Gir)</Text>
          </Pressable>
        ) : (
          <Pressable
            testID={DETAIL.lockUnlockSimple}
            onPress={unlockSoft}
            style={({ pressed }) => [styles.unlockBtn, pressed && styles.pressed]}
          >
            <Ionicons name="lock-open-outline" size={16} color={colors.bgBase} />
            <Text style={styles.unlockText}>Kilidi Aç</Text>
          </Pressable>
        )
      )}

      {configVisible && (
        <LockConfigModal
          task={task}
          onClose={() => setConfigVisible(false)}
          onSaved={onUpdated}
          onAuthError={onAuthError}
        />
      )}
      {otpData && <OtpDisplayModal data={otpData} onClose={() => setOtpData(null)} />}
      {unlockVisible && (
        <UnlockOtpModal
          task={task}
          onClose={() => setUnlockVisible(false)}
          onVerified={onUpdated}
          onAuthError={onAuthError}
        />
      )}
    </View>
  );
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, fontFamily: monoFont },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  statusLocked: { borderColor: colors.warning },
  statusFree: { borderColor: colors.border },
  statusOpen: { borderColor: colors.success },
  statusText: { fontSize: 11, fontWeight: "700", fontFamily: monoFont },
  error: { color: colors.danger, fontSize: 13 },
  empty: { color: colors.textMuted, fontStyle: "italic", fontSize: 13 },
  lockList: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  lockChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,184,0,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,184,0,0.35)",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lockChipText: { color: colors.warning, fontSize: 11, fontWeight: "600" },
  otpNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 9,
  },
  actionText: { fontSize: 13, fontWeight: "700" },
  unlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.success,
    borderRadius: radius.md,
    paddingVertical: 11,
    marginTop: spacing.xs,
  },
  unlockText: { color: colors.bgBase, fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
  // shared modal styles
  backdrop: { flex: 1, backgroundColor: "rgba(2,4,10,0.82)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "85%",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitleWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerTitle: { fontSize: 14, fontWeight: "800", letterSpacing: 1.5, fontFamily: monoFont },
  tabs: { flexDirection: "row", gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.xs },
  tabText: { color: colors.textMuted, fontSize: 12, fontWeight: "700", fontFamily: monoFont, letterSpacing: 1 },
  tabActive: { color: colors.warning, borderBottomWidth: 2, borderBottomColor: colors.warning, paddingBottom: 4 },
  tabActiveGreen: { color: colors.success, borderBottomWidth: 2, borderBottomColor: colors.success, paddingBottom: 4 },
  hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  setAllRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  setAllBtn: { borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  setAllText: { color: colors.warning, fontSize: 10, fontWeight: "700", fontFamily: monoFont },
  clearAllBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  clearAllText: { color: colors.textMuted, fontSize: 10, fontWeight: "700", fontFamily: monoFont },
  countText: { marginLeft: "auto", color: colors.textMuted, fontSize: 11, fontFamily: monoFont },
  otpToggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8 },
  otpStrict: { borderColor: "rgba(255,184,0,0.4)", backgroundColor: "rgba(255,184,0,0.05)" },
  otpSoft: { borderColor: "rgba(74,222,128,0.4)", backgroundColor: "rgba(74,222,128,0.05)" },
  otpToggleText: { flex: 1, color: colors.textSecondary, fontSize: 12 },
  checklist: { maxHeight: 260 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  checkRowOn: { backgroundColor: "rgba(255,184,0,0.08)" },
  checkLabel: { flex: 1, color: colors.textPrimary, fontSize: 13 },
  checkLabelOn: { color: colors.warning, fontWeight: "600" },
  footer: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12 },
  cancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", letterSpacing: 1, fontFamily: monoFont },
  saveBtn: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.warning, borderRadius: radius.md, paddingVertical: 12 },
  saveText: { color: colors.bgBase, fontSize: 13, fontWeight: "800", letterSpacing: 1, fontFamily: monoFont },
  historyWrap: { gap: spacing.sm },
  refreshBtn: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: "rgba(74,222,128,0.4)", borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 5 },
  refreshText: { color: colors.success, fontSize: 10, fontWeight: "700", fontFamily: monoFont },
  historyList: { maxHeight: 320 },
  historyRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  historyMeta: { color: colors.textMuted, fontSize: 11, fontFamily: monoFont, marginTop: 2 },
  otpCode: { color: colors.success, fontSize: 40, fontWeight: "800", letterSpacing: 8, textAlign: "center", fontFamily: monoFont, paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(74,222,128,0.3)" },
  otpCountdown: { color: colors.textMuted, fontSize: 11, textAlign: "center", fontFamily: monoFont },
  otpInput: { textAlign: "center", fontSize: 30, letterSpacing: 10, fontFamily: monoFont, color: colors.success, backgroundColor: colors.surface, borderWidth: 1, borderColor: "rgba(74,222,128,0.4)", borderRadius: radius.md, paddingVertical: 12 },
});
