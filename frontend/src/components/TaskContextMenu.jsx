import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  Check, Pause, Play, Trash2, Clock, AlertTriangle, Edit3, Bell,
  ChevronRight, BellOff, GripVertical, Archive, ArchiveRestore, UserPlus,
  Tag, Lock, Unlock, KeyRound, Share2, RefreshCw, Printer, FileSpreadsheet,
  FileText, FileDown, Link2, Unlink, RotateCcw, CornerLeftUp, Anchor, Ban, Copy,
} from "lucide-react";
import { LOCK_KEY_LABELS } from "../lib/taskLocks";
import { toast } from "sonner";
import { confirmDialog } from "../lib/confirm";
import {
  REMINDER_DAY_CHOICES, ACTION_LOCK_MAP, hasActiveUnlock, canManageLocks,
  isActionLocked,
} from "../lib/taskHelpers";
import { REMINDER_UNITS, unitToMinutes } from "../lib/reminderUtils";
import { CustomSnoozeInput } from "./tasks/CustomSnoozeInput";
import { flattenTree } from "../lib/categoryTree";

export const ContextMenu = ({ x, y, task, onAction, onClose, isTeamView, onReassign, categories, onSetCategory, onSetReminderDays, onSetReminderDisabled, currentUser, onOpenLockConfig, onOpenUnlockOtp, onIssueOtp, displayNumber, onPinNumber, onUnpinNumber, archiveGroup = null, isAdmin = false }) => {
  const menuRef = useRef();
  const [reminderSub, setReminderSub] = useState(false);
  const [categorySub, setCategorySub] = useState(false);
  const [dueSoonSub, setDueSoonSub] = useState(false);
  const [exportSub, setExportSub] = useState(false);
  const [numberSub, setNumberSub] = useState(false);
  const [pinInput, setPinInput] = useState(
    task?.number_pinned && task?.pinned_number != null ? String(task.pinned_number) : "",
  );
  const [customTime, setCustomTime] = useState("");
  // Tekrarlı hatırlatma — kaç defa (1 = tekrarsız).
  const [repeatCount, setRepeatCount] = useState(1);
  // Serbest aralık — "kaç dakika/saat/gün arayla" (tekrar > 1 iken).
  const [intervalAmount, setIntervalAmount] = useState(30);
  const [intervalUnit, setIntervalUnit] = useState("min");
  // Faz 9 CP4.29 — menü runtime'da ölçülür ve viewport'a sığdırılır. Önce
  // görünmez render edilir (ready=false), gerçek yükseklik ölçülünce doğru
  // konuma taşınıp görünür yapılır. Böylece uzun menü (kilit vb.) ekranın
  // altına asla taşmaz; sığmıyorsa maxHeight + scroll devreye girer.
  const [pos, setPos] = useState({ left: x, top: y, ready: false });

  useEffect(() => {
    const onMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Menü'nün gerçek boyutunu ölç → viewport içine kaydır. Alt-menü açılıp
  // kapandıkça (ve item sayısı değiştikçe) yükseklik değişir → yeniden hesapla.
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const availH = vh - 2 * pad;
    const effH = Math.min(rect.height, availH);
    let left = x;
    let top = y;
    if (left + rect.width > vw - pad) left = vw - rect.width - pad;
    if (left < pad) left = pad;
    if (top + effH > vh - pad) top = vh - effH - pad;
    if (top < pad) top = pad;
    if (left !== pos.left || top !== pos.top || !pos.ready) {
      setPos({ left, top, ready: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, reminderSub, categorySub, dueSoonSub, exportSub, numberSub, task?.id]);

  const items = (archiveGroup === "cancelled" || archiveGroup === "deleted") ? [
    // Çöp kutusu / iptal grubu — sade menü: Geri Yükle (+ admin Kalıcı Sil).
    {
      icon: ArchiveRestore,
      label: "Geri Yükle",
      color: "text-emerald-300 hover:bg-emerald-500/15",
      action: archiveGroup === "deleted" ? "restore" : "uncancel",
    },
    archiveGroup === "deleted" && isAdmin && {
      icon: Trash2,
      label: "Kalıcı Sil",
      color: "text-rose-300 hover:bg-rose-500/15",
      action: "permanent-delete",
    },
  ] : [
    task.status !== "done" && {
      icon: Check,
      label: "Tamamlandı",
      color: "text-emerald-300 hover:bg-emerald-500/15",
      action: "done",
    },
    task.status !== "paused" && {
      icon: Pause,
      label: "Beklemeye al",
      color: "text-yellow-300 hover:bg-yellow-500/15",
      action: "paused",
    },
    task.status !== "pending" && {
      icon: Play,
      label: "Aktif yap",
      color: "text-sertex-cyan hover:bg-sertex-cyan/10",
      action: "pending",
    },
    task.status !== "overdue" && {
      icon: AlertTriangle,
      label: "Tarihi geçmiş işaretle",
      color: "text-rose-300 hover:bg-rose-500/15",
      action: "overdue",
    },
    {
      icon: Edit3,
      label: "Düzenle",
      color: "text-sertex-cyan hover:bg-sertex-cyan/10",
      action: "edit",
    },
    // Görev Kopyalama — görevi panoya al; bir iş koluna sağ tıklayıp "Yapıştır"
    // ile o iş kolunda yeni (bana atanan) kopya oluştur. Hazır şablon mantığı.
    {
      icon: Copy,
      label: "Kopyala",
      color: "text-sertex-cyan hover:bg-sertex-cyan/10",
      action: "copy",
    },
    // Sıra numarasını sabitle — sürüklense de numara değişmez (⚓).
    {
      icon: Anchor,
      label: task?.number_pinned && task?.pinned_number != null
        ? `Sıra numarası sabit: ${task.pinned_number}`
        : "Sıra numarasını sabitle",
      color: "text-amber-300 hover:bg-amber-500/15",
      action: "pin-number",
      hasSubmenu: true,
    },
    // Promote'u geri al — yalnızca bir alt görevden dönüştürülmüş görevlerde.
    task?.promoted_from_task_id && {
      icon: CornerLeftUp,
      label: "Geri alt göreve dönüştür",
      color: "text-violet-300 hover:bg-violet-500/15",
      action: "demote-to-subtask",
    },
    // Faz 8 CP3 — team view only: transfer this task to another visible user.
    isTeamView && {
      icon: UserPlus,
      label: "Devret",
      color: "text-purple-300 hover:bg-purple-500/15",
      action: "reassign",
    },
    // Görev Paylaşımı — herkese açık: kişisel kullanıcı da bir görevi
    // arkadaşına/eşine paylaşabilir. Backend yalnızca oluşturan/admin/müdüre
    // izin verir; yetkisizde 403 döner.
    {
      icon: Share2,
      label: "Özellik Tanımla (Paylaş)",
      color: "text-sertex-cyan hover:bg-sertex-cyan/10",
      action: "share",
    },
    // Faz 8 CP4 — assign / change the "iş kolu" (task category). Only shown
    // when the caller can see any category at all (employees with no company
    // won't have any, so the submenu stays hidden for them).
    (categories && categories.length > 0) && {
      icon: Tag,
      label: "İş Koluna Taşı",
      color: "text-sertex-cyan hover:bg-sertex-cyan/10",
      action: "category",
      hasSubmenu: true,
    },
    {
      icon: GripVertical,
      label: "Boyutu sıfırla",
      color: "text-sertex-cyan hover:bg-sertex-cyan/10",
      action: "reset-size",
    },
    {
      icon: FileDown,
      label: "Dışa Aktar",
      color: "text-sertex-cyan hover:bg-sertex-cyan/10",
      action: "export",
      hasSubmenu: true,
    },
    {
      icon: Bell,
      label: "Hatırlat",
      color: "text-sertex-cyan hover:bg-sertex-cyan/10",
      action: "reminder",
      hasSubmenu: true,
    },
    task.reminder_at && {
      icon: BellOff,
      label: "Hatırlatmayı iptal et",
      color: "text-sertex-textMuted hover:bg-sertex-cyan/10",
      action: "reminder-cancel",
    },
    // Faz 8 CP5 — Task-level due-soon override (turuncu uyarı) submenu.
    {
      icon: Clock,
      label: "Yaklaşan Uyarısı",
      color: "text-orange-300 hover:bg-orange-500/15",
      action: "due-soon",
      hasSubmenu: true,
    },
    // Görev Bazlı Sessiz — bu görevi sabah "geciken görev" özetinden çıkar/ekle.
    {
      icon: task?.digest_muted ? Bell : BellOff,
      label: task?.digest_muted ? "Sabah özetine ekle" : "Sabah özetinden çıkar",
      color: "text-amber-300 hover:bg-amber-500/15",
      action: "digest-mute-toggle",
    },
    task.archived
      ? {
          icon: ArchiveRestore,
          label: "Arşivden çıkar",
          color: "text-sertex-cyan hover:bg-sertex-cyan/10",
          action: "unarchive",
        }
      : {
          icon: Archive,
          label: "Arşivle",
          color: "text-sertex-cyan hover:bg-sertex-cyan/10",
          action: "archive",
        },
    // GÖREV BAĞLAMA — bağlıysa düzenle/çıkar, değilse bağla.
    task?.group_id
      ? {
          icon: Edit3,
          label: "Grubu Düzenle",
          color: "text-sertex-cyan hover:bg-sertex-cyan/10",
          action: "group-edit",
        }
      : {
          icon: Link2,
          label: "Görevleri Bağla",
          color: "text-sertex-cyan hover:bg-sertex-cyan/10",
          action: "link-tasks",
        },
    task?.group_id && {
      icon: Unlink,
      label: "Gruptan Çıkar",
      color: "text-amber-300 hover:bg-amber-500/15",
      action: "group-remove",
    },
    // İptal Et — yalnızca aktif (arşiv dışı) görevlerde. Görevi "iptal
    // edilmiş" işaretler + arşivin İPTAL grubuna taşır.
    archiveGroup === null && !task.archived && {
      icon: Ban,
      label: "İptal Et",
      color: "text-amber-300 hover:bg-amber-500/15",
      action: "cancel-task",
    },
    {
      icon: Trash2,
      label: "Sil",
      color: "text-rose-300 hover:bg-rose-500/15",
      action: "delete",
    },
    // Faz 9 CP4.27 — Lock system. Two items appended at the bottom:
    //  * "Kilit Ayarları" — only for creator / admin / manager (opens config modal).
    //  * "Kilidi Aç (OTP)" — only for the ASSIGNEE when the task is locked
    //     and there's no active unlock window (opens code-entry modal).
    canManageLocks(task, currentUser) && {
      icon: Lock,
      label: (() => {
        const flagCount = Object.values(task.lock_flags || {}).filter(Boolean).length;
        return flagCount > 0 ? `Kilit Ayarları (${flagCount})` : "Kilit Ayarları";
      })(),
      color: "text-amber-300 hover:bg-amber-500/15",
      action: "lock-config",
    },
    // OTP issue — only if the current user CAN lock, task is locked, AND
    // they're not the assignee themselves (assignee gets the unlock modal
    // instead — see below).
    canManageLocks(task, currentUser) &&
      Object.values(task.lock_flags || {}).some(Boolean) &&
      task.user_id !== currentUser?.id && {
        icon: KeyRound,
        label: "OTP Üret (kilidi aç)",
        color: "text-emerald-300 hover:bg-emerald-500/15",
        action: "lock-issue-otp",
      },
    // Assignee unlock entry — shows only when the task is locked for THIS
    // user and they're not the creator/admin.
    !canManageLocks(task, currentUser) &&
      Object.values(task.lock_flags || {}).some(Boolean) &&
      !hasActiveUnlock(task) && {
        icon: Unlock,
        label: "Kilidi Aç (OTP gir)",
        color: "text-emerald-300 hover:bg-emerald-500/15",
        action: "lock-enter-otp",
      },
    // Active-unlock hint for the assignee — a passive status row.
    !canManageLocks(task, currentUser) && hasActiveUnlock(task) && {
      icon: Unlock,
      label: "Kilit açık (1 kullanım kaldı)",
      color: "text-emerald-300",
      action: "lock-noop",
      disabled: true,
    },
  ].filter(Boolean);

  const reminderChoices = [
    { label: "30 dakika sonra", offset: 30 * 60 * 1000, intervalMin: 30, action: "reminder-30m" },
    { label: "1 saat sonra", offset: 60 * 60 * 1000, intervalMin: 60, action: "reminder-1h" },
    { label: "3 saat sonra", offset: 3 * 60 * 60 * 1000, intervalMin: 180, action: "reminder-3h" },
    { label: "1 gün sonra", offset: 24 * 60 * 60 * 1000, intervalMin: 1440, action: "reminder-1d" },
    { label: "1 hafta sonra", offset: 7 * 24 * 60 * 60 * 1000, intervalMin: 10080, action: "reminder-1w" },
  ];

  return createPortal(
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed z-[100] glass-panel border border-sertex-cyan/40 rounded-md py-1 shadow-lg min-w-[220px]"
      style={{
        left: pos.left,
        top: pos.top,
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        visibility: pos.ready ? "visible" : "hidden",
      }}
      data-testid="task-context-menu"
    >
      {!reminderSub && !categorySub && !dueSoonSub && !exportSub && !numberSub && (
        <>
          {items.map((it, i) => {
            const locked = isActionLocked(task, it.action, currentUser);
            const disabled = it.disabled || locked;
            const lockKey = ACTION_LOCK_MAP[it.action];
            const title = locked
              ? `Kilitli — ${LOCK_KEY_LABELS[lockKey] || it.label} yapılamaz. Müdürünüzden şifre isteyin.`
              : undefined;
            return (
            <button
              key={i}
              disabled={disabled}
              title={title}
              onClick={() => {
                if (disabled) return;
                if (it.action === "reminder") {
                  setReminderSub(true);
                  return;
                }
                if (it.action === "category") {
                  setCategorySub(true);
                  return;
                }
                if (it.action === "due-soon") {
                  setDueSoonSub(true);
                  return;
                }
                if (it.action === "export") {
                  setExportSub(true);
                  return;
                }
                if (it.action === "pin-number") {
                  setNumberSub(true);
                  return;
                }
                if (it.action === "reassign") {
                  onReassign?.();
                  onClose();
                  return;
                }
                if (it.action === "lock-config") {
                  onOpenLockConfig?.();
                  onClose();
                  return;
                }
                if (it.action === "lock-issue-otp") {
                  onIssueOtp?.();
                  onClose();
                  return;
                }
                if (it.action === "lock-enter-otp") {
                  onOpenUnlockOtp?.();
                  onClose();
                  return;
                }
                if (it.action === "lock-noop") {
                  onClose();
                  return;
                }
                onAction(it.action);
                onClose();
              }}
              data-testid={`ctx-${it.action}`}
              className={`w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 transition-colors ${it.color} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <it.icon className="h-3 w-3 shrink-0" />
              <span className="flex-1">{it.label}</span>
              {locked && <Lock className="h-3 w-3 text-amber-300/70" />}
              {it.hasSubmenu && <ChevronRight className="h-3 w-3 opacity-60" />}
            </button>
            );
          })}
        </>
      )}
      {numberSub && (
        <div>
          <div className="hud-text text-amber-300 px-3 py-1.5 border-b border-amber-400/20 flex items-center gap-1">
            <Anchor className="h-3 w-3" /> SIRA NUMARASI
          </div>
          {task?.number_pinned && task?.pinned_number != null ? (
            <div className="px-3 py-2 space-y-2">
              <div className="hud-text text-sertex-textMuted">
                Şu an sabit: <span className="text-amber-300 font-semibold">{task.pinned_number}</span>
              </div>
              <button
                onClick={() => { onUnpinNumber?.(); onClose(); }}
                data-testid="ctx-unpin-number"
                className="w-full py-1.5 border border-rose-400/40 text-rose-300 hover:bg-rose-500/15 rounded hud-text"
              >
                SABİTLEMEYİ KALDIR
              </button>
            </div>
          ) : (
            <div className="px-3 py-2 space-y-2">
              {displayNumber != null && (
                <button
                  onClick={() => { onPinNumber?.(displayNumber); onClose(); }}
                  data-testid="ctx-pin-number-auto"
                  className="w-full py-1.5 bg-amber-500/15 border border-amber-400 text-amber-300 hover:bg-amber-500/25 rounded hud-text"
                >
                  OTOMATİK (MEVCUT: {displayNumber})
                </button>
              )}
              <div className="hud-text text-sertex-textMuted pt-1">VEYA ELLE GİR</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="No"
                  data-testid="ctx-pin-number-input"
                  className="w-20 bg-sertex-surface/60 border border-amber-400/30 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-amber-400 outline-none"
                />
                <button
                  onClick={() => {
                    const n = parseInt(pinInput, 10);
                    if (!n || n < 1) { toast.error("Geçerli bir numara girin"); return; }
                    onPinNumber?.(n);
                    onClose();
                  }}
                  data-testid="ctx-pin-number-set"
                  className="flex-1 py-1 bg-amber-500/15 border border-amber-400 text-amber-300 hover:bg-amber-500/25 rounded hud-text"
                >
                  SABİTLE
                </button>
              </div>
            </div>
          )}
          <button
            onClick={() => setNumberSub(false)}
            className="w-full text-left px-3 py-1.5 hud-text text-sertex-textMuted hover:text-sertex-cyan border-t border-sertex-cyan/15"
          >
            ← Geri
          </button>
        </div>
      )}
      {reminderSub && (
        <div>
          <div className="hud-text text-sertex-cyan px-3 py-1.5 border-b border-sertex-cyan/20 flex items-center gap-1">
            <Bell className="h-3 w-3" /> HATIRLATMA ZAMANI
          </div>
          {/* Tekrarlı hatırlatma — kaç defa tekrarlansın (görev bitince durur). */}
          <div className="px-3 py-2 border-b border-sertex-cyan/15 space-y-1">
            <div className="hud-text text-sertex-textMuted flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> TEKRAR SAYISI
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={999}
                value={repeatCount}
                onChange={(e) => setRepeatCount(Math.max(1, Math.min(999, parseInt(e.target.value || "1", 10))))}
                onClick={(e) => e.stopPropagation()}
                data-testid="ctx-reminder-repeat"
                className="w-16 bg-sertex-surface/60 border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
              />
              <span className="hud-text text-sertex-textMuted/80">
                {repeatCount > 1 ? `defa · her aralıkta tekrar` : "defa (tekrarsız)"}
              </span>
            </div>
            {/* Serbest aralık — kaç dakika/saat/gün arayla (tekrar > 1 iken). */}
            {repeatCount > 1 && (
              <div className="pt-1 space-y-1">
                <div className="hud-text text-sertex-textMuted">ARALIK</div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={intervalAmount}
                    onChange={(e) => setIntervalAmount(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    data-testid="ctx-reminder-interval-amount"
                    className="w-16 bg-sertex-surface/60 border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                  />
                  <select
                    value={intervalUnit}
                    onChange={(e) => setIntervalUnit(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    data-testid="ctx-reminder-interval-unit"
                    className="bg-sertex-surface/60 border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                  >
                    {REMINDER_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                  <span className="hud-text text-sertex-textMuted/80">arayla</span>
                </div>
              </div>
            )}
          </div>
          {reminderChoices.map((c) => (
            <button
              key={c.action}
              onClick={() => {
                onAction(c.action, {
                  offset: c.offset,
                  intervalMin: repeatCount > 1 ? unitToMinutes(intervalAmount, intervalUnit) : c.intervalMin,
                  repeat: repeatCount,
                });
                onClose();
              }}
              data-testid={`ctx-${c.action}`}
              className="w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 text-sertex-cyan hover:bg-sertex-cyan/10 transition-colors"
            >
              <Clock className="h-3 w-3 shrink-0" />
              {c.label}
              {repeatCount > 1 && <span className="ml-auto opacity-60">×{repeatCount}</span>}
            </button>
          ))}
          <div className="border-t border-sertex-cyan/20 px-3 py-2 space-y-1">
            <div className="hud-text text-sertex-textMuted">ÖZEL SÜRE (SONRA)</div>
            <CustomSnoozeInput
              label="Kur"
              testPrefix="ctx-reminder-custom-dur"
              onApply={(min) => {
                onAction("reminder-custom-duration", {
                  offset: min * 60 * 1000,
                  intervalMin: repeatCount > 1 ? unitToMinutes(intervalAmount, intervalUnit) : undefined,
                  repeat: repeatCount,
                });
                onClose();
              }}
            />
          </div>
          <div className="border-t border-sertex-cyan/20 px-3 py-2 space-y-1">
            <div className="hud-text text-sertex-textMuted">ÖZEL ZAMAN</div>
            <input
              type="datetime-local"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              data-testid="ctx-reminder-custom-input"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            />
            <button
              onClick={() => {
                if (!customTime) {
                  toast.error("Bir zaman seçin");
                  return;
                }
                onAction("reminder-custom", {
                  iso: new Date(customTime).toISOString(),
                  intervalMin: repeatCount > 1 ? unitToMinutes(intervalAmount, intervalUnit) : undefined,
                  repeat: repeatCount,
                });
                onClose();
              }}
              data-testid="ctx-reminder-custom-set"
              className="w-full py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded hud-text"
            >
              KAYDET
            </button>
          </div>
          <button
            onClick={async () => {
              const ok = await confirmDialog({
                title: "SIFIRLA",
                message: "Bu görevin hatırlatması kaldırılsın mı?\nBu işlem geri alınamaz.",
                confirmText: "SIFIRLA",
                cancelText: "VAZGEÇ",
                danger: true,
              });
              if (!ok) return;
              setRepeatCount(1);
              setIntervalAmount(30);
              setIntervalUnit("min");
              setCustomTime("");
              onAction("reminder-cancel");
              onClose();
            }}
            data-testid="ctx-reminder-reset"
            className="w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 text-amber-300 hover:bg-amber-500/10 transition-colors border-t border-sertex-cyan/15"
          >
            <RotateCcw className="h-3 w-3 shrink-0" /> Sıfırla (hatırlatmayı kaldır)
          </button>
          <button
            onClick={() => setReminderSub(false)}
            className="w-full text-left px-3 py-1.5 hud-text text-sertex-textMuted hover:bg-sertex-cyan/5 border-t border-sertex-cyan/15"
          >
            ← Geri
          </button>
        </div>
      )}
      {categorySub && (
        <div data-testid="ctx-category-submenu">
          <div className="hud-text text-sertex-cyan px-3 py-1.5 border-b border-sertex-cyan/20 flex items-center gap-1">
            <Tag className="h-3 w-3" /> İŞ KOLU SEÇ
          </div>
          {/* Clear-category option — always first. */}
          <button
            onClick={() => {
              onSetCategory?.(null);
              onClose();
            }}
            data-testid="ctx-category-none"
            className={`w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 transition-colors ${
              !task.category_id ? "text-sertex-cyan bg-sertex-cyan/10" : "text-sertex-textMuted hover:bg-sertex-cyan/5"
            }`}
          >
            <span className="flex-1">Kolsuz</span>
            {!task.category_id && <Check className="h-3 w-3" />}
          </button>
          {flattenTree(categories).map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSetCategory?.(c.id);
                onClose();
              }}
              data-testid={`ctx-category-pick-${c.name}`}
              className={`w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 transition-colors ${
                task.category_id === c.id
                  ? "text-sertex-cyan bg-sertex-cyan/10"
                  : "text-sertex-text hover:bg-sertex-cyan/10"
              }`}
            >
              {c.color ? (
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
              ) : (
                <Tag className="h-3 w-3 shrink-0" />
              )}
              <span className="flex-1 truncate" style={{ paddingLeft: (c.__depth || 0) * 12 }}>
                {c.name}
              </span>
              {task.category_id === c.id && <Check className="h-3 w-3 shrink-0" />}
            </button>
          ))}
          <button
            onClick={() => setCategorySub(false)}
            className="w-full text-left px-3 py-1.5 hud-text text-sertex-textMuted hover:bg-sertex-cyan/5 border-t border-sertex-cyan/15"
          >
            ← Geri
          </button>
        </div>
      )}
      {dueSoonSub && (
        <div data-testid="ctx-duesoon-submenu">
          <div className="hud-text text-orange-300 px-3 py-1.5 border-b border-orange-500/20 flex items-center gap-1">
            <Clock className="h-3 w-3" /> YAKLAŞAN UYARISI
          </div>
          {/* Varsayılan (hiyerarşiye bırak) */}
          <button
            onClick={() => {
              onSetReminderDays?.(null);
              onSetReminderDisabled?.(false);
              onClose();
            }}
            data-testid="ctx-duesoon-default"
            className={`w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 transition-colors ${
              !task.reminder_disabled && task.reminder_days == null
                ? "text-sertex-cyan bg-sertex-cyan/10"
                : "text-sertex-textMuted hover:bg-sertex-cyan/5"
            }`}
          >
            <span className="flex-1">Varsayılan (hiyerarşi)</span>
            {!task.reminder_disabled && task.reminder_days == null && <Check className="h-3 w-3" />}
          </button>
          {REMINDER_DAY_CHOICES.map((d) => (
            <button
              key={d}
              onClick={() => {
                onSetReminderDays?.(d);
                onSetReminderDisabled?.(false);
                onClose();
              }}
              data-testid={`ctx-duesoon-${d}d`}
              className={`w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 transition-colors ${
                task.reminder_days === d && !task.reminder_disabled
                  ? "text-orange-300 bg-orange-500/15"
                  : "text-sertex-text hover:bg-orange-500/10"
              }`}
            >
              <Clock className="h-3 w-3 shrink-0" />
              <span className="flex-1">{d} gün önce</span>
              {task.reminder_days === d && !task.reminder_disabled && <Check className="h-3 w-3" />}
            </button>
          ))}
          <div className="border-t border-orange-500/15" />
          <button
            onClick={() => {
              onSetReminderDisabled?.(true);
              onClose();
            }}
            data-testid="ctx-duesoon-disabled"
            className={`w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 transition-colors ${
              task.reminder_disabled
                ? "text-rose-300 bg-rose-500/15"
                : "text-sertex-textMuted hover:bg-rose-500/10"
            }`}
          >
            <BellOff className="h-3 w-3 shrink-0" />
            <span className="flex-1">🚫 Hatırlatıcıyı kapat</span>
            {task.reminder_disabled && <Check className="h-3 w-3" />}
          </button>
          <button
            onClick={async () => {
              const ok = await confirmDialog({
                title: "SIFIRLA",
                message: "Yaklaşan uyarısı varsayılana (hiyerarşi) döndürülsün mü?",
                confirmText: "SIFIRLA",
                cancelText: "VAZGEÇ",
                danger: true,
              });
              if (!ok) return;
              onSetReminderDays?.(null);
              onSetReminderDisabled?.(false);
              onClose();
            }}
            data-testid="ctx-duesoon-reset"
            className="w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 text-amber-300 hover:bg-amber-500/10 transition-colors border-t border-orange-500/15"
          >
            <RotateCcw className="h-3 w-3 shrink-0" /> Sıfırla (varsayılana dön)
          </button>
          <button
            onClick={() => setDueSoonSub(false)}
            className="w-full text-left px-3 py-1.5 hud-text text-sertex-textMuted hover:bg-sertex-cyan/5 border-t border-sertex-cyan/15"
          >
            ← Geri
          </button>
        </div>
      )}
      {exportSub && (
        <div data-testid="ctx-export-submenu">
          <div className="hud-text text-sertex-cyan px-3 py-1.5 border-b border-sertex-cyan/20 flex items-center gap-1">
            <FileDown className="h-3 w-3" /> DIŞA AKTAR
          </div>
          <button
            onClick={() => { onAction("export-print"); onClose(); }}
            data-testid="ctx-export-print"
            className="w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 text-sertex-cyan hover:bg-sertex-cyan/10 transition-colors"
          >
            <Printer className="h-3 w-3 shrink-0" />
            <span className="flex-1">Yazdır / PDF</span>
          </button>
          <button
            onClick={() => { onAction("export-excel"); onClose(); }}
            data-testid="ctx-export-excel"
            className="w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 text-emerald-300 hover:bg-emerald-500/15 transition-colors"
          >
            <FileSpreadsheet className="h-3 w-3 shrink-0" />
            <span className="flex-1">Excel (.xlsx)</span>
          </button>
          <button
            onClick={() => { onAction("export-word"); onClose(); }}
            data-testid="ctx-export-word"
            className="w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 text-blue-300 hover:bg-blue-500/15 transition-colors"
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="flex-1">Word (.docx)</span>
          </button>
          <button
            onClick={() => setExportSub(false)}
            className="w-full text-left px-3 py-1.5 hud-text text-sertex-textMuted hover:bg-sertex-cyan/5 border-t border-sertex-cyan/15"
          >
            ← Geri
          </button>
        </div>
      )}
    </motion.div>,
    document.body
  );
};


// Faz 9 CP5 — Modals extracted to /components/tasks/*:
//   LockConfigModal, OtpDisplayModal, UnlockOtpModal,
//   ReassignModal, EditTaskModal (imported at the top of this file).


// ============ TASK CARD ============
