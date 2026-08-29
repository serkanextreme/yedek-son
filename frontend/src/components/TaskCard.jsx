import React, { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { createPortal } from "react-dom";
import {
  Check, Pause, Plus, MoreVertical, BellRing, RotateCcw, Clock, AlertTriangle,
  Bell, GripVertical, User, Building2, Tag, Lock, Unlock, Eye, Users, BellOff,
  ChevronsDownUp, ChevronsUpDown, Maximize2, Minimize2, CircleCheckBig, RefreshCw, CornerLeftUp, CornerDownRight, Undo2, Anchor, ChevronRight, ChevronDown,
} from "lucide-react";
import { tasksApi, taskLockApi } from "../lib/api";
import { toast } from "sonner";
import { confirmDialog } from "../lib/confirm";
import { hasActiveUnlock, isOverdue, dueSoonLayer, statusStyle } from "../lib/taskHelpers";
import { LockConfigModal } from "./tasks/LockConfigModal";
import { OtpDisplayModal } from "./tasks/OtpDisplayModal";
import { UnlockOtpModal } from "./tasks/UnlockOtpModal";
import { ReassignModal } from "./tasks/ReassignModal";
import { ShareTaskModal } from "./tasks/ShareTaskModal";
import { printTasks, exportTasksExcel, exportTasksWord } from "../lib/taskExport";
import { ContextMenu } from "./TaskContextMenu";
import { SubtaskMenu } from "./SubtaskMenu";
import { SubtaskRow, SUBTASK_SIZE_KEY_PREFIX } from "./SubtaskRow";
import { Highlight } from "./tasks/Highlight";
import { TaskAttachments } from "./tasks/TaskAttachments";
import { formatIntervalShort } from "../lib/reminderUtils";
import { getCategoryPath } from "../lib/categoryTree";
import { isCatTreeExpanded, setCatTreeExpanded } from "../lib/catTreePrefs";
import { QuickReminderEditModal } from "./tasks/QuickReminderEditModal";

const TASK_SIZE_KEY_PREFIX = "sertex_task_size_";
const TASK_DSIZE_KEY_PREFIX = "sertex_task_dsize_"; // detached (büyük pencere) kart boyutu — sidebar boyutundan bağımsız

// Subtask helpers (mirror the parent task color logic)
const taskDurationLabel = (start, end) => {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "anında";
  if (mins < 60) return `${mins} dakikada`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saatte`;
  const days = Math.floor(hours / 24);
  return `${days} günde`;
};


export const TaskCard = ({ task, displayNumber, onStatusChange, onDelete, onEdit, onSetReminder, onClearReminder, onSetSubtasks, onSetArchived, onReassign, onTransferCompany, onPromoteSubtask, onDemoteToSubtask, onDemoteChild, onPinNumber, onUnpinNumber, promotedChildren = [], dragControls, isTeamView, isHighlighted, categoryName, categories, onSetCategory, reminderConfig, onSetReminderDays, onSetReminderDisabled, currentUser, onLockChanged, collapsed = false, onToggleCollapse, detached = false, onToggleDetach, onNudge, nudgeCount = 0, onLinkTasks, onEditGroup, onRemoveFromGroup, onToggleDigestMute, highlight = "", archiveGroup = null, canPermanentDelete = false, onCancel, onUncancel, onRestore, onPermanentDelete, archiveSettings = null }) => {
  const layer = dueSoonLayer(task, reminderConfig);
  const style = statusStyle(task, layer);
  const overdue = isOverdue(task);
  // Faz 9 CP5 (P2) — memoize lock badge inputs so re-renders during typing /
  // filter changes don't re-walk the flags object every frame. TaskCard is
  // rendered per row so this used to allocate two arrays per card per render.
  const lockBadge = useMemo(() => {
    const flagsObj = task.lock_flags || {};
    const flagCount = Object.values(flagsObj).filter(Boolean).length;
    if (flagCount === 0) return null;
    return { flagCount, unlockActive: hasActiveUnlock(task) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.lock_flags, task.unlock_uses_remaining, task.unlock_expires_at]);
  const [ctx, setCtx] = useState(null);
  const [showReassign, setShowReassign] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // Faz 9 CP4.27 — lock modals local state.
  const [showLockConfig, setShowLockConfig] = useState(false);
  const [showUnlockOtp, setShowUnlockOtp] = useState(false);
  const [showReminderEdit, setShowReminderEdit] = useState(false);
  const [otpDisplay, setOtpDisplay] = useState(null); // { code, expires_at, ttl_minutes }
  // İş kolu ağacı (ana kol → alt kol) kart içi görünümü — KİŞİYE ÖZEL kalıcı,
  // varsayılan kapalı (kompakt). Hiyerarşi yoksa hiç gösterilmez.
  const catPath = useMemo(
    () => (categories && task.category_id ? getCategoryPath(task.category_id, categories) : []),
    [categories, task.category_id]
  );
  const catHasHierarchy = catPath.length > 1;
  const [catTreeOpen, setCatTreeOpen] = useState(() => isCatTreeExpanded(currentUser?.id, task.id));
  const toggleCatTree = (e) => {
    if (e) e.stopPropagation();
    const nv = !catTreeOpen;
    setCatTreeOpen(nv);
    setCatTreeExpanded(currentUser?.id, task.id, nv);
    // Panel'deki "tümünü aç/kapat" etiketi güncel kalsın (render dışında yayılır).
    window.dispatchEvent(new CustomEvent("sertex:cattree-changed"));
  };
  // Toplu "tümünü aç/kapat" olayını dinle — hiyerarşisi olan kartlar durumunu
  // günceller + kişiye özel kalıcı yazar.
  useEffect(() => {
    const handler = (e) => {
      if (!catHasHierarchy) return;
      const expanded = !!(e.detail && e.detail.expanded);
      setCatTreeOpen(expanded);
      setCatTreeExpanded(currentUser?.id, task.id, expanded);
    };
    window.addEventListener("sertex:cattree-set-all", handler);
    return () => window.removeEventListener("sertex:cattree-set-all", handler);
  }, [catHasHierarchy, currentUser?.id, task.id]);
  const longPressTimer = useRef();
  const cardRef = useRef(null);
  const persistTimer = useRef(null);
  const [newSub, setNewSub] = useState("");
  const [showSubInput, setShowSubInput] = useState(false);
  const [subCtx, setSubCtx] = useState(null); // { idx, x, y }
  const [childCtx, setChildCtx] = useState(null); // "BU GÖREVDEN ÇIKANLAR" satırına sağ-tık menüsü: { childId, title, x, y }
  const subLongPressTimer = useRef();
  const subtasks = useMemo(() => (Array.isArray(task.subtasks) ? task.subtasks : []), [task.subtasks]);
  // Alt görev numaraları — sabitlenenler atlanır (görev listesiyle aynı mantık).
  const subNumbers = useMemo(() => {
    const m = {};
    const reserved = new Set();
    for (const s of subtasks) {
      const done = s.done || s.status === "done";
      if (!done && s.number_pinned && s.pinned_number != null) reserved.add(s.pinned_number);
    }
    let c = 0;
    for (const s of subtasks) {
      const done = s.done || s.status === "done";
      if (done) { m[s.id] = null; continue; }
      if (s.number_pinned && s.pinned_number != null) { m[s.id] = s.pinned_number; continue; }
      c += 1;
      while (reserved.has(c)) c += 1;
      m[s.id] = c;
    }
    return m;
  }, [subtasks]);

  const openLockConfig = () => setShowLockConfig(true);
  const openUnlockOtp = () => setShowUnlockOtp(true);
  const issueOtp = async () => {
    try {
      const res = await taskLockApi.issueOtp(task.id);
      setOtpDisplay(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "OTP üretilemedi");
    }
  };

  const updateSubtaskAt = (idx, patch) => {
    onSetSubtasks(
      subtasks.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
  };

  const handleSubAction = (idx, action, extra) => {
    if (action === "delete") {
      onSetSubtasks(subtasks.filter((_, i) => i !== idx));
      return;
    }
    if (action === "reset-size") {
      const sub = subtasks[idx];
      if (sub) {
        try {
          localStorage.removeItem(SUBTASK_SIZE_KEY_PREFIX + sub.id);
        } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
        // Force re-render: also strip inline size from DOM if present
        const el = document.querySelector(`[data-testid="subtask-row-${task.id}-${idx}"]`);
        if (el) { el.style.width = ""; el.style.height = ""; }
        toast.success("Boyut sıfırlandı");
      }
      return;
    }
    if (action === "date-clear") {
      updateSubtaskAt(idx, { due_date: null, reminder_fired: false });
      return;
    }
    if (action === "date-set") {
      updateSubtaskAt(idx, { due_date: extra.iso, reminder_fired: false });
      return;
    }
    if (action === "edit-set") {
      updateSubtaskAt(idx, { text: extra.text });
      return;
    }
    if (action === "promote") {
      const sub = subtasks[idx];
      if (sub?.id && onPromoteSubtask) onPromoteSubtask(sub.id);
      return;
    }
    if (action === "pin-number") {
      const num = extra?.number;
      if (num != null) {
        const dup = subtasks.some(
          (s, i) => i !== idx && !(s.done || s.status === "done") && s.number_pinned && s.pinned_number === num,
        );
        if (dup) { toast.error(`${num} numarası zaten başka bir alt göreve sabit`); return; }
      }
      updateSubtaskAt(idx, { number_pinned: true, pinned_number: num });
      return;
    }
    if (action === "unpin-number") {
      updateSubtaskAt(idx, { number_pinned: false, pinned_number: null });
      return;
    }
    // status changes: pending / done / paused / overdue
    if (action === "done") {
      updateSubtaskAt(idx, { status: "done", done: true });
      return;
    }
    if (action === "pending") {
      updateSubtaskAt(idx, { status: "pending", done: false });
      return;
    }
    updateSubtaskAt(idx, { status: action });
  };

  // Load persisted size for this task
  // Kart boyutu — detached (büyük pencere) ile sidebar için AYRI kayıt tut.
  const sizeKey = (detached ? TASK_DSIZE_KEY_PREFIX : TASK_SIZE_KEY_PREFIX) + task.id;
  const [savedSize, setSavedSize] = useState(() => {
    try {
      const raw = localStorage.getItem(sizeKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.width || parsed.height)) return parsed;
      }
    } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
    return null;
  });
  const savedSizeRef = useRef(savedSize);
  useEffect(() => { savedSizeRef.current = savedSize; }, [savedSize]);

  // Elle yeniden boyutlandırmayı izle → hem localStorage'a yaz hem React state'ini
  // güncelle (böylece küçült/büyüt yeniden-çiziminde genişlik/yükseklik korunur).
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (collapsed) return; // küçükken boyut yakalama (kısa yüksekliği kaydetme)
      // Yalnızca kullanıcı elle boyutlandırınca (inline stil var) devam et
      const inlineW = el.style.width;
      const inlineH = el.style.height;
      if (!inlineW && !inlineH) return;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        const prev = savedSizeRef.current;
        if (prev && Math.abs((prev.width || 0) - size.width) < 2 && Math.abs((prev.height || 0) - size.height) < 2) return;
        savedSizeRef.current = size;
        try { localStorage.setItem(sizeKey, JSON.stringify(size)); } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
        setSavedSize(size);
      }, 250);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [task.id, collapsed, sizeKey]);

  const resetSize = () => {
    if (cardRef.current) {
      cardRef.current.style.width = "";
      cardRef.current.style.height = "";
    }
    try {
      localStorage.removeItem(sizeKey);
    } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
    savedSizeRef.current = null;
    setSavedSize(null);
    toast.success("Boyut sıfırlandı");
  };

  const handleRightClick = (e) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY });
  };

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      setCtx({ x: touch.clientX, y: touch.clientY });
      if (navigator.vibrate) navigator.vibrate(30);
    }, 500);
  };

  const handleTouchEnd = () => clearTimeout(longPressTimer.current);

  const toggleDone = () => {
    onStatusChange(task.status === "done" ? "pending" : "done");
  };

  // Görev Paylaşımı — an assignee toggles their OWN completion (ÖZELLİK A).
  const myComplete = async (completed) => {
    try {
      await tasksApi.myCompletion(task.id, completed);
      onLockChanged?.();
    } catch (e) {
      if (e?.response?.status === 423) {
        toast.error(e.response.data?.detail || "Görev kilitli — müdürünüzden şifre isteyin");
      } else {
        toast.error(e?.response?.data?.detail || "Güncellenemedi");
      }
    }
  };

  const handleAction = (action, extra) => {
    if (action === "delete") onDelete();
    else if (action === "edit") onEdit();
    else if (action === "share") setShowShare(true);
    else if (action === "archive") onSetArchived(true);
    else if (action === "unarchive") onSetArchived(false);
    else if (action === "cancel-task") onCancel?.();
    else if (action === "uncancel") onUncancel?.();
    else if (action === "restore") onRestore?.();
    else if (action === "permanent-delete") onPermanentDelete?.();
    else if (action === "reset-size") resetSize();
    else if (action === "reminder-cancel") onClearReminder();
    else if (action === "link-tasks") onLinkTasks?.();
    else if (action === "group-edit") onEditGroup?.();
    else if (action === "group-remove") onRemoveFromGroup?.();
    else if (action === "demote-to-subtask") onDemoteToSubtask?.();
    else if (action === "digest-mute-toggle") onToggleDigestMute?.(!task.digest_muted);
    else if (action.startsWith("export-")) {
      const catMap = Object.fromEntries((categories || []).map((c) => [c.id, c.name]));
      (async () => {
        try {
          if (action === "export-print") printTasks(task, catMap);
          else if (action === "export-excel") exportTasksExcel(task, catMap);
          else if (action === "export-word") await exportTasksWord(task, catMap);
        } catch (e) {
          console.error("[TasksPanel] tek görev dışa aktarma hatası:", e);
          toast.error(
            e?.message === "popup-blocked"
              ? "Yazdırma penceresi engellendi — tarayıcıda açılır pencerelere izin verin"
              : "Dışa aktarılamadı"
          );
        }
      })();
    } else if (action.startsWith("reminder-")) {
      const repeat = Math.max(1, extra?.repeat || 1);
      const opts = repeat > 1
        ? { intervalMin: extra.intervalMin, repeatLeft: repeat, repeatTotal: repeat }
        : {};
      if (action === "reminder-custom") onSetReminder(extra.iso, opts);
      else onSetReminder(new Date(Date.now() + extra.offset).toISOString(), opts);
    } else {
      onStatusChange(action);
    }
  };

  const formatReminder = () => {
    if (!task.reminder_at) return null;
    const d = new Date(task.reminder_at);
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <motion.div
        ref={cardRef}
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -20 }}
        onContextMenu={handleRightClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        style={{
          resize: collapsed ? "none" : "both",
          overflow: "auto",
          minHeight: collapsed ? undefined : 72,
          minWidth: detached ? 240 : 200,
          maxWidth: "100%",
          ...(savedSize?.width ? { width: savedSize.width } : (detached ? { width: "100%" } : {})),
          ...(!collapsed && savedSize?.height ? { height: savedSize.height } : {}),
        }}
        className={`task-resizable relative rounded-lg border ${style.border} ${style.bg} p-2.5 transition-colors group ${isHighlighted ? "ring-2 ring-sertex-cyan animate-pulse shadow-[0_0_20px_rgba(0,229,255,0.5)]" : ""}`}
        data-testid={`task-item-${task.id}`}
      >
        {dragControls && (
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              dragControls.start(e);
            }}
            data-testid={`task-drag-${task.id}`}
            title="Görevi sürükle sırala"
            aria-label="Görevi sürükle sırala"
            className="absolute top-1 left-1 z-10 opacity-30 hover:opacity-100 focus:opacity-100 text-sertex-cyan/70 hover:text-sertex-cyan cursor-grab active:cursor-grabbing transition-opacity"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <div className={`flex items-start gap-2 ${dragControls ? "pl-3" : ""}`}>
          <button
            onClick={toggleDone}
            data-testid={`task-check-${task.id}`}
            className={`mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
              task.status === "done"
                ? "border-emerald-400 bg-emerald-500/40"
                : "border-sertex-cyan/40 hover:border-sertex-cyan bg-transparent"
            }`}
          >
            {task.status === "done" && <Check className="h-3.5 w-3.5 text-white" />}
          </button>

          <div className="flex-1 min-w-0">
            {(task.status === "paused" || overdue) && (
              <div className={`hud-text mb-1 flex items-center gap-1 ${style.accent}`}>
                {task.status === "paused" ? (
                  <>
                    <Pause className="h-3 w-3" /> BEKLEMEDE
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3" /> SÜRESİ GEÇTİ
                  </>
                )}
              </div>
            )}
            <div
              className={`text-sm font-mono font-medium ${
                task.status === "done"
                  ? "text-sertex-textMuted line-through"
                  : "text-sertex-text"
              }`}
            >
              {displayNumber != null && (
                <span
                  className={`inline-flex items-center mr-1.5 tabular-nums font-semibold ${
                    task.status === "done"
                      ? "text-sertex-textMuted"
                      : overdue
                      ? "text-rose-300"
                      : task.status === "paused"
                      ? "text-yellow-300"
                      : task.number_pinned
                      ? "text-amber-300"
                      : "text-sertex-cyan"
                  }`}
                  data-testid={`task-number-${task.id}`}
                  title={task.number_pinned ? "Sıra numarası sabit" : undefined}
                >
                  {task.status === "done" ? "✓" : `${displayNumber}.`}
                  {task.number_pinned && task.status !== "done" && (
                    <Anchor className="h-2.5 w-2.5 ml-0.5 text-amber-300" data-testid={`task-number-pinned-${task.id}`} />
                  )}
                </span>
              )}
              <Highlight text={task.title} query={highlight} />
              {/* Faz 9 CP4.27 — kilit rozeti (Faz 9 CP5 P2 — memoized) */}
              {lockBadge && (
                <span
                  data-testid={`task-lock-badge-${task.id}`}
                  title={lockBadge.unlockActive
                    ? `Kilit geçici olarak açık (1 kullanım kaldı) — ${lockBadge.flagCount} kısıtlama`
                    : `Kilitli — ${lockBadge.flagCount} kısıtlama · müdüre başvur`}
                  className={`inline-flex items-center gap-0.5 ml-1.5 px-1 py-0.5 rounded-full border align-middle text-[9px] font-mono uppercase leading-none ${
                    lockBadge.unlockActive
                      ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-400/50 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  {lockBadge.unlockActive ? <Unlock className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                  {lockBadge.flagCount}
                </span>
              )}
              {/* Görev Paylaşımı — göz rozeti: paylaşıldıysa kimler görüyor */}
              {(task.shared_with?.length > 0) && (
                <span
                  data-testid={`task-shared-badge-${task.id}`}
                  title={`Bu görevi görenler: ${Array.from(new Set([
                    ...(task.assignees || []).map((a) => a.name).filter(Boolean),
                    ...(task.shared_with || []).map((s) => s.name).filter(Boolean),
                  ])).join(", ")}`}
                  className="inline-flex items-center gap-0.5 ml-1.5 px-1 py-0.5 rounded-full border border-sertex-cyan/50 bg-sertex-cyan/10 text-sertex-cyan align-middle text-[9px] font-mono uppercase leading-none"
                >
                  <Eye className="h-2.5 w-2.5" />
                  {task.shared_with.length}
                </span>
              )}
              {/* Görev Bazlı Sessiz — sabah özetinden çıkarılan görev rozeti */}
              {task.digest_muted && (
                <span
                  data-testid={`task-digest-muted-badge-${task.id}`}
                  title="Bu görev sabah özetinden çıkarıldı (sessiz)"
                  className="inline-flex items-center gap-0.5 ml-1.5 px-1 py-0.5 rounded-full border border-amber-400/50 bg-amber-500/10 text-amber-300 align-middle text-[9px] font-mono uppercase leading-none"
                >
                  <BellOff className="h-2.5 w-2.5" />
                </span>
              )}
            </div>
            {task.description && (
              <div
                className={`text-xs font-mono mt-1 ${
                  task.status === "done"
                    ? "text-sertex-textMuted/60 line-through"
                    : "text-sertex-textMuted"
                }`}
              >
                <Highlight text={task.description} query={highlight} />
              </div>
            )}
            {/* Arşiv — İptal/Silme neden notu + otomatik temizlik geri sayımı */}
            {archiveGroup === "cancelled" && task.cancel_reason && (
              <div className="text-[11px] font-mono mt-1 text-amber-300/90 normal-case flex items-start gap-1" data-testid={`task-cancel-reason-${task.id}`}>
                <span className="opacity-70">İptal nedeni:</span>
                <span className="text-amber-200"><Highlight text={task.cancel_reason} query={highlight} /></span>
              </div>
            )}
            {archiveGroup === "deleted" && (task.delete_reason || archiveSettings?.trash_autoclean_enabled) && (
              <div className="mt-1 space-y-0.5">
                {task.delete_reason && (
                  <div className="text-[11px] font-mono text-rose-300/90 normal-case flex items-start gap-1" data-testid={`task-delete-reason-${task.id}`}>
                    <span className="opacity-70">Silme nedeni:</span>
                    <span className="text-rose-200"><Highlight text={task.delete_reason} query={highlight} /></span>
                  </div>
                )}
                {archiveSettings?.trash_autoclean_enabled && task.deleted_at && (() => {
                  const days = archiveSettings.trash_autoclean_days || 30;
                  const elapsed = Math.floor((Date.now() - new Date(task.deleted_at).getTime()) / 86400000);
                  const left = Math.max(0, days - elapsed);
                  return (
                    <div className="text-[10px] font-mono text-rose-400/80 normal-case flex items-center gap-1" data-testid={`task-autoclean-${task.id}`}>
                      <Clock className="h-3 w-3" />
                      {left <= 0 ? "Yakında kalıcı silinecek" : `${left} gün sonra kalıcı silinecek`}
                    </div>
                  );
                })()}
              </div>
            )}
            {task.start_date && (
              <div
                className="hud-text mt-1.5 flex items-center gap-1 text-sertex-textMuted"
                data-testid={`task-start-${task.id}`}
              >
                <Clock className="h-3 w-3" />
                Başlangıç: {new Date(task.start_date).toLocaleString("tr-TR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}
            {task.due_date && (
              <div
                className={`hud-text mt-1.5 flex items-center gap-1 ${
                  overdue ? "text-rose-300" : layer === "urgent" ? "text-orange-300" : layer === "soon" ? "text-amber-300" : "text-sertex-textMuted"
                }`}
              >
                <Clock className="h-3 w-3" />
                Bitiş: {new Date(task.due_date).toLocaleString("tr-TR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {/* Faz 8 CP5 — countdown pill for approaching tasks (not overdue). */}
                {!overdue && layer && (() => {
                  const daysUntil = Math.max(0, Math.floor(
                    (new Date(task.due_date).getTime() - Date.now()) / (24 * 3600 * 1000),
                  ));
                  const label = daysUntil === 0 ? "BUGÜN SON" : `${daysUntil} GÜN KALDI`;
                  const pillCls = layer === "urgent"
                    ? "border-orange-500/60 text-orange-300 bg-orange-500/15"
                    : "border-amber-400/50 text-amber-300 bg-amber-500/10";
                  return (
                    <span
                      className={`ml-1 px-1.5 py-0.5 rounded border hud-text ${pillCls}`}
                      data-testid={`task-duesoon-${task.id}`}
                    >
                      ⏱ {label}
                    </span>
                  );
                })()}
                {task.reminder_disabled && (
                  <span
                    className="ml-1 px-1.5 py-0.5 rounded border border-sertex-textMuted/40 text-sertex-textMuted/70 hud-text"
                    data-testid={`task-reminder-off-${task.id}`}
                    title="Bu görev için hatırlatıcı kapalı"
                  >
                    🚫 HATIRLATICI KAPALI
                  </span>
                )}
              </div>
            )}
            {task.status === "done" && task.completed_at && (
              <div
                className="hud-text mt-1.5 flex items-center gap-1 text-emerald-300"
                data-testid={`task-completed-at-${task.id}`}
                title="Tamamlanma tarihi"
              >
                <CircleCheckBig className="h-3 w-3" />
                Tamamlandı: {new Date(task.completed_at).toLocaleString("tr-TR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {taskDurationLabel(task.created_at, task.completed_at) && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-emerald-400/30 bg-emerald-500/10 text-emerald-200/90 text-[10px] ml-1"
                    title="Tamamlanma süresi (oluşturmadan bitişe)"
                    data-testid={`task-duration-${task.id}`}
                  >
                    <Clock className="h-2.5 w-2.5" />
                    {taskDurationLabel(task.created_at, task.completed_at)}
                  </span>
                )}
              </div>
            )}
            {isTeamView && (task.assignee_name || task.company_name) && (
              <div
                className="hud-text mt-1 flex items-center gap-1.5 text-sertex-textMuted/90"
                data-testid={`task-owner-${task.id}`}
                title={
                  [task.assignee_name && `Görev sahibi: ${task.assignee_name}`,
                   task.company_name && `Şirket: ${task.company_name}`]
                    .filter(Boolean)
                    .join(" · ")
                }
              >
                {task.assignee_name && (
                  <span className="inline-flex items-center gap-1 text-sertex-textSecondary">
                    <User className="h-3 w-3" />
                    <Highlight text={task.assignee_name} query={highlight} />
                  </span>
                )}
                {task.assignee_name && task.company_name && (
                  <span className="text-sertex-textMuted/60">·</span>
                )}
                {task.company_name && (
                  <span className="inline-flex items-center gap-1 italic text-sertex-cyan/80">
                    <Building2 className="h-3 w-3" />
                    <Highlight text={task.company_name} query={highlight} />
                  </span>
                )}
              </div>
            )}
            {categoryName && (
              catHasHierarchy ? (
                <div className="hud-text mt-1" data-testid={`task-category-${task.id}`}>
                  {!catTreeOpen ? (
                    <button
                      type="button"
                      onClick={toggleCatTree}
                      data-testid={`task-category-expand-${task.id}`}
                      title="İş kolu ağacını göster (ana kol → alt kol)"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sertex-cyan/40 text-sertex-cyan bg-sertex-cyan/10 hover:bg-sertex-cyan/20 transition-colors"
                    >
                      <Tag className="h-2.5 w-2.5" />
                      <Highlight text={catPath[catPath.length - 1].name} query={highlight} />
                      <ChevronRight className="h-2.5 w-2.5 opacity-60" />
                    </button>
                  ) : (
                    <div
                      className="inline-block border border-sertex-cyan/30 rounded bg-sertex-cyan/[0.04] px-1.5 py-1 space-y-0.5"
                      data-testid={`task-category-tree-${task.id}`}
                    >
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={toggleCatTree}
                          data-testid={`task-category-collapse-${task.id}`}
                          title="Küçült"
                          className="text-sertex-cyan/80 hover:text-sertex-cyan shrink-0"
                        >
                          <ChevronDown className="h-2.5 w-2.5" />
                        </button>
                        <Tag className="h-2.5 w-2.5 text-sertex-cyan shrink-0" />
                        {catPath[0].color && (
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: catPath[0].color }} />
                        )}
                        <span className="text-sertex-cyan">
                          <Highlight text={catPath[0].name} query={highlight} />
                        </span>
                      </div>
                      {catPath.slice(1).map((node, i) => (
                        <div
                          key={node.id}
                          className="flex items-center gap-1"
                          style={{ marginLeft: (i + 1) * 12 }}
                        >
                          <CornerDownRight className="h-2.5 w-2.5 text-sertex-cyan/50 shrink-0" />
                          {node.color && (
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: node.color }} />
                          )}
                          <span className={i === catPath.length - 2 ? "text-sertex-cyan" : "text-sertex-cyan/70"}>
                            <Highlight text={node.name} query={highlight} />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="hud-text mt-1"
                  data-testid={`task-category-${task.id}`}
                >
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sertex-cyan/40 text-sertex-cyan bg-sertex-cyan/10">
                    <Tag className="h-2.5 w-2.5" />
                    <Highlight text={categoryName} query={highlight} />
                  </span>
                </div>
              )
            )}
            {task.promoted_from_task_title && (
              <div
                className="hud-text mt-1"
                data-testid={`task-promoted-from-${task.id}`}
              >
                {task.promoted_from_task_id ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent("sertex:task-jump", {
                          detail: { task_id: task.promoted_from_task_id },
                        }),
                      );
                    }}
                    data-testid={`task-promoted-jump-${task.id}`}
                    title="Ana göreve git"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-400/40 text-violet-300 bg-violet-500/10 hover:bg-violet-500/25 hover:border-violet-300 transition-colors cursor-pointer"
                  >
                    <CornerLeftUp className="h-2.5 w-2.5 shrink-0" />
                    <span className="normal-case">
                      <Highlight text={task.promoted_from_task_title} query={highlight} /> görevinin alt unsuru
                    </span>
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-400/40 text-violet-300 bg-violet-500/10"
                    title="Bu görev bir alt görevden dönüştürüldü"
                  >
                    <CornerLeftUp className="h-2.5 w-2.5 shrink-0" />
                    <span className="normal-case">
                      <Highlight text={task.promoted_from_task_title} query={highlight} /> görevinin alt unsuru
                    </span>
                  </span>
                )}
              </div>
            )}
            {/* Görev Paylaşımı — çok kişili atama ilerleme + kişi-kişi tamamlama */}
            {task.assignees?.length > 0 && (
              <div
                className="mt-2 border-t border-sertex-cyan/15 pt-1.5"
                data-testid={`task-assignees-${task.id}`}
              >
                <div className="hud-text text-sertex-textMuted flex items-center gap-1.5 mb-1">
                  <Users className="h-3 w-3 text-sertex-cyan" />
                  <span
                    className="text-sertex-cyan"
                    data-testid={`task-assignee-progress-${task.id}`}
                  >
                    {task.assignees.filter((a) => a.completed).length}/{task.assignees.length} tamamlandı
                  </span>
                </div>
                <div className="space-y-1">
                  {task.assignees.map((a) => {
                    const isMe = a.user_id === currentUser?.id;
                    return (
                      <div
                        key={a.user_id}
                        className="flex items-center gap-2"
                        data-testid={`task-assignee-row-${task.id}-${a.user_id}`}
                      >
                        <button
                          onClick={() => isMe && myComplete(!a.completed)}
                          disabled={!isMe}
                          data-testid={`assignee-check-${task.id}-${a.user_id}`}
                          title={isMe ? "Kendi tamamlama durumun" : `${a.name} · ${a.completed ? "tamamladı" : "bekliyor"}`}
                          className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            a.completed
                              ? "border-emerald-400 bg-emerald-500/40"
                              : "border-sertex-cyan/40 bg-transparent"
                          } ${isMe ? "hover:border-sertex-cyan cursor-pointer" : "cursor-default opacity-80"}`}
                        >
                          {a.completed && <Check className="h-2.5 w-2.5 text-white" />}
                        </button>
                        <span
                          className={`text-xs font-mono truncate ${
                            a.completed ? "text-sertex-textMuted line-through" : "text-sertex-text"
                          }`}
                        >
                          {a.name || a.user_id}
                          {isMe && <span className="hud-text text-sertex-cyan/70 ml-1.5">(sen)</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {task.reminder_at && (
              <div
                className={`hud-text mt-1 flex items-center gap-1 ${
                  task.reminder_fired ? "text-sertex-textMuted" : "text-sertex-cyan neon-glow"
                }`}
                data-testid={`task-reminder-${task.id}`}
              >
                <Bell className="h-3 w-3" />
                HATIRLATMA: {formatReminder()}
                {task.reminder_fired && " ✓"}
              </div>
            )}

            {/* Tekrarlı hatırlatma rozeti — tıklayınca hızlı düzenleme modalı. */}
            {task.reminder_interval_min && task.reminder_repeat_total > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReminderEdit(true);
                }}
                className="hud-text mt-1 flex items-center gap-1 text-sertex-cyan/80 hover:text-sertex-cyan hover:bg-sertex-cyan/5 rounded px-1 -mx-1 transition-colors"
                data-testid={`task-reminder-repeat-${task.id}`}
                title="Tekrarlı hatırlatmayı düzenle"
              >
                <RefreshCw className="h-3 w-3 shrink-0" />
                {task.reminder_repeat_total} defa · {formatIntervalShort(task.reminder_interval_min)} arayla
                {task.reminder_repeat_left != null && (
                  <span className="text-sertex-textMuted">· {task.reminder_repeat_left} kaldı</span>
                )}
              </button>
            )}

            {/* Subtasks list — collapsed olunca alt görevler + "alt görev ekle" gizlenir */}
            {!collapsed && (
            <>
            {(subtasks.length > 0 || showSubInput) && (
              <div className="mt-2 border-t border-sertex-cyan/15 pt-1.5" data-testid={`subtasks-${task.id}`}>
                <Reorder.Group
                  axis="y"
                  values={subtasks}
                  onReorder={(next) => onSetSubtasks(next)}
                  className="space-y-1"
                >
                  {(() => {
                    return subtasks.map((s, idx) => {
                      const isSubDone = s.done || s.status === "done";
                      const num = subNumbers[s.id];
                      return (
                        <SubtaskRow
                          key={s.id}
                          sub={s}
                          idx={idx}
                          taskId={task.id}
                          displayNumber={isSubDone ? null : num}
                          onToggle={(i, next) => updateSubtaskAt(i, { done: next, status: next ? "done" : "pending" })}
                          onOpenMenu={(i, x, y) => setSubCtx({ idx: i, x, y })}
                          onLongPressStart={(i, e) => {
                            const touch = e.touches[0];
                            subLongPressTimer.current = setTimeout(() => {
                              setSubCtx({ idx: i, x: touch.clientX, y: touch.clientY });
                              if (navigator.vibrate) navigator.vibrate(30);
                            }, 500);
                          }}
                          onLongPressEnd={() => clearTimeout(subLongPressTimer.current)}
                          highlight={highlight}
                        />
                      );
                    });
                  })()}
                </Reorder.Group>
                {showSubInput && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <div className={`h-4 w-4 rounded-sm border ${style.border.split(" ")[0]} shrink-0`} />
                    <input
                      value={newSub}
                      onChange={(e) => setNewSub(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newSub.trim()) {
                          onSetSubtasks([
                            ...subtasks,
                            { id: crypto.randomUUID(), text: newSub.trim(), done: false },
                          ]);
                          setNewSub("");
                        } else if (e.key === "Escape") {
                          setShowSubInput(false);
                          setNewSub("");
                        }
                      }}
                      onBlur={() => {
                        if (newSub.trim()) {
                          onSetSubtasks([
                            ...subtasks,
                            { id: crypto.randomUUID(), text: newSub.trim(), done: false },
                          ]);
                        }
                        setNewSub("");
                        setShowSubInput(false);
                      }}
                      autoFocus
                      placeholder="Alt görev... (Enter: ekle · Esc: iptal)"
                      data-testid={`subtask-input-${task.id}`}
                      className="flex-1 bg-transparent border-b border-sertex-cyan/25 focus:border-sertex-cyan outline-none text-xs font-mono text-sertex-text placeholder:text-sertex-textMuted/60 pb-0.5"
                    />
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setShowSubInput(true)}
              data-testid={`subtask-add-${task.id}`}
              className={`mt-1.5 hud-text ${style.accent} opacity-60 hover:opacity-100 flex items-center gap-1 transition-opacity`}
            >
              <Plus className="h-3 w-3" /> ALT GÖREV EKLE
              {subtasks.length > 0 && (
                <span className="text-sertex-textMuted ml-1">
                  · {subtasks.filter((s) => s.done || s.status === "done").length}/{subtasks.length}
                </span>
              )}
            </button>
            {/* ⤵ Bu görevden çıkan (promote edilen) alt unsur görevleri */}
            {promotedChildren.length > 0 && (() => {
              const doneChildCount = promotedChildren.filter((c) =>
                c.__bucket ? c.__bucket === "bitti" : (c.done || c.status === "done"),
              ).length;
              const allDone = doneChildCount === promotedChildren.length;
              return (
              <div
                className="mt-2 border-t border-violet-400/15 pt-1.5"
                data-testid={`task-children-${task.id}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="hud-text text-violet-300/80 flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="flex items-center gap-1">
                    <CornerDownRight className="h-3 w-3" /> BU GÖREVDEN ÇIKANLAR ({promotedChildren.length})
                  </span>
                  <span
                    data-testid={`task-children-progress-${task.id}`}
                    title={`${doneChildCount}/${promotedChildren.length} alt unsur tamamlandı`}
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[9px] font-mono uppercase leading-none ${
                      allDone
                        ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
                        : "border-violet-400/40 bg-violet-500/10 text-violet-200"
                    }`}
                  >
                    {allDone && <Check className="h-2.5 w-2.5" />}
                    {doneChildCount}/{promotedChildren.length} bitti
                  </span>
                </div>
                <div className="space-y-1">
                  {promotedChildren.map((c) => {
                    // Gerçek durum kovası (overdue hesaplı): TasksPanel `__bucket`
                    // sağlar; yoksa alan bazlı güvenli fallback.
                    const bucket = c.__bucket
                      || ((c.done || c.status === "done") ? "bitti"
                        : c.status === "paused" ? "bekliyor"
                        : "aktif");
                    const dot =
                      bucket === "bitti" ? "bg-emerald-400"
                      : bucket === "gecti" ? "bg-rose-400"
                      : bucket === "bekliyor" ? "bg-amber-400"
                      : "bg-sertex-cyan";
                    const statusLabel =
                      bucket === "bitti" ? "Tamamlandı"
                      : bucket === "gecti" ? "Süresi geçti"
                      : bucket === "bekliyor" ? "Beklemede"
                      : "Aktif";
                    // Satır çerçevesi + hafif arka plan da durum rengine uysun (nokta ile aynı) → göze batar.
                    const rowCls =
                      bucket === "bitti" ? "border-emerald-400/35 bg-emerald-500/5 hover:border-emerald-300/70 hover:bg-emerald-500/15"
                      : bucket === "gecti" ? "border-rose-400/35 bg-rose-500/5 hover:border-rose-300/70 hover:bg-rose-500/15"
                      : bucket === "bekliyor" ? "border-amber-400/35 bg-amber-500/5 hover:border-amber-300/70 hover:bg-amber-500/15"
                      : "border-sertex-cyan/35 bg-sertex-cyan/5 hover:border-sertex-cyan/70 hover:bg-sertex-cyan/15";
                    const titleHoverCls =
                      bucket === "bitti" ? "group-hover:text-emerald-200"
                      : bucket === "gecti" ? "group-hover:text-rose-200"
                      : bucket === "bekliyor" ? "group-hover:text-amber-200"
                      : "group-hover:text-sertex-cyan";
                    const arrowCls =
                      bucket === "bitti" ? "text-emerald-300/50"
                      : bucket === "gecti" ? "text-rose-300/50"
                      : bucket === "bekliyor" ? "text-amber-300/50"
                      : "text-sertex-cyan/50";
                    return (
                      <div
                        key={c.id}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setChildCtx({ childId: c.id, title: c.title, x: e.clientX, y: e.clientY });
                        }}
                        className={`w-full flex items-center rounded border transition-colors group ${rowCls}`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.dispatchEvent(
                              new CustomEvent("sertex:task-jump", {
                                detail: { task_id: c.id },
                              }),
                            );
                          }}
                          data-testid={`task-child-${c.id}`}
                          title={`Bu göreve git · ${statusLabel}`}
                          className="flex-1 min-w-0 text-left flex items-center gap-2 px-2 py-1"
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`}
                            data-testid={`task-child-dot-${c.id}`}
                            title={statusLabel}
                          />
                          <span className={`text-[12px] font-mono text-sertex-text truncate flex-1 transition-colors ${titleHoverCls}`}>
                            <Highlight text={c.title} query={highlight} />
                          </span>
                          <CornerLeftUp className={`h-3 w-3 rotate-90 shrink-0 ${arrowCls}`} />
                        </button>
                        {onDemoteChild && (
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const ok = await confirmDialog({
                                title: "GERİ ALT GÖREVE DÖNÜŞTÜR",
                                message: `"${c.title}" görevi bu görevin alt görevine geri çevrilsin mi?\nGörev silinir, içeriği alt görev olarak eklenir.`,
                                confirmText: "DÖNÜŞTÜR",
                                cancelText: "VAZGEÇ",
                              });
                              if (!ok) return;
                              onDemoteChild(c.id);
                            }}
                            data-testid={`task-child-demote-${c.id}`}
                            title="Geri alt göreve dönüştür"
                            aria-label="Geri alt göreve dönüştür"
                            className="shrink-0 mr-1 h-6 w-6 flex items-center justify-center rounded text-violet-300/70 hover:text-violet-200 hover:bg-violet-500/20 transition-colors"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}
            {/* 📎 Görev dosyaları — yükle / listele / tıkla-indir / sil */}
            <TaskAttachments
              taskId={task.id}
              currentUserId={currentUser?.id}
              canManage={isTeamView}
            />
            </>
            )}
            {collapsed && subtasks.length > 0 && (
              <div
                className="mt-1.5 hud-text text-sertex-textMuted flex items-center gap-1"
                data-testid={`task-collapsed-hint-${task.id}`}
              >
                <ChevronsUpDown className="h-3 w-3 text-sertex-cyan/70" />
                {subtasks.filter((s) => s.done || s.status === "done").length}/{subtasks.length} alt görev · büyütmek için ▸
              </div>
            )}
          </div>

          {/* Boyutu sıfırla — kart elle boyutlandırıldıysa görünür (tek tık, hover'a bağlı değil) */}
          {savedSize && !collapsed && (
            <button
              onClick={(e) => { e.stopPropagation(); resetSize(); }}
              data-testid={`task-reset-size-${task.id}`}
              title="Boyutu varsayılana sıfırla"
              className="shrink-0 h-8 w-8 flex items-center justify-center border border-sertex-cyan/30 hover:border-sertex-cyan hover:bg-sertex-cyan/15 rounded-md text-sertex-cyan/80 hover:text-sertex-cyan transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {/* Küçült / Büyüt (collapse) */}
          {onToggleCollapse && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
              data-testid={`task-collapse-${task.id}`}
              title={collapsed ? "Büyüt (alt görevleri göster)" : "Küçült (alt görevleri gizle)"}
              className="shrink-0 h-8 w-8 flex items-center justify-center border border-sertex-cyan/30 hover:border-sertex-cyan hover:bg-sertex-cyan/15 rounded-md text-sertex-cyan transition-colors"
            >
              {collapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
            </button>
          )}
          {/* Dışarı al / Sidebar'a geri al (detach) */}
          {onToggleDetach && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleDetach(); }}
              data-testid={`task-detach-${task.id}`}
              title={detached ? "Sidebar'a geri al" : "Dışarı al · büyük pencerede incele"}
              className="shrink-0 h-8 w-8 flex items-center justify-center border border-sertex-cyan/30 hover:border-sertex-cyan hover:bg-sertex-cyan/15 rounded-md text-sertex-cyan transition-colors"
            >
              {detached ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          {/* Dürt / Hatırlat — sadece Personel Görevleri (team) görünümünde */}
          {onNudge && task.status !== "done" && (
            <button
              onClick={(e) => { e.stopPropagation(); onNudge(); }}
              data-testid={`task-nudge-${task.id}`}
              title={nudgeCount > 0 ? `Dürt · bugün ${nudgeCount} kez hatırlatıldı` : "Dürt · personele hatırlatma gönder (çan + push)"}
              className={`relative shrink-0 h-8 w-8 flex items-center justify-center border rounded-md transition-colors ${overdue ? "border-amber-400/50 text-amber-300 hover:bg-amber-400/20 hover:border-amber-300" : "border-sertex-cyan/30 text-sertex-cyan/70 hover:bg-sertex-cyan/15 hover:border-sertex-cyan"}`}
            >
              <BellRing className="h-4 w-4" />
              {nudgeCount > 0 && (
                <span
                  data-testid={`task-nudge-count-${task.id}`}
                  className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-amber-500 text-black text-[9px] font-bold flex items-center justify-center leading-none"
                >
                  {nudgeCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setCtx({ x: rect.left - 200, y: rect.bottom + 4 });
            }}
            data-testid={`task-menu-${task.id}`}
            aria-label="Görev menüsü"
            className="shrink-0 h-8 w-8 flex items-center justify-center border border-sertex-cyan/30 hover:border-sertex-cyan hover:bg-sertex-cyan/15 active:bg-sertex-cyan/25 rounded-md text-sertex-cyan transition-colors"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {ctx && (
          <ContextMenu
            x={ctx.x}
            y={ctx.y}
            task={task}
            onAction={handleAction}
            onClose={() => setCtx(null)}
            isTeamView={isTeamView}
            onReassign={() => setShowReassign(true)}
            categories={categories}
            onSetCategory={onSetCategory}
            onSetReminderDays={onSetReminderDays}
            onSetReminderDisabled={onSetReminderDisabled}
            currentUser={currentUser}
            onOpenLockConfig={openLockConfig}
            onOpenUnlockOtp={openUnlockOtp}
            onIssueOtp={issueOtp}
            displayNumber={displayNumber}
            onPinNumber={onPinNumber}
            onUnpinNumber={onUnpinNumber}
            archiveGroup={archiveGroup}
            isAdmin={canPermanentDelete}
          />
        )}
        {subCtx && subtasks[subCtx.idx] && (
          <SubtaskMenu
            x={subCtx.x}
            y={subCtx.y}
            sub={subtasks[subCtx.idx]}
            displayNumber={subNumbers[subtasks[subCtx.idx].id]}
            onAction={(action, extra) => handleSubAction(subCtx.idx, action, extra)}
            onClose={() => setSubCtx(null)}
          />
        )}
      </AnimatePresence>
      {childCtx && createPortal(
        <div
          className="fixed inset-0 z-[100]"
          onClick={() => setChildCtx(null)}
          onContextMenu={(e) => { e.preventDefault(); setChildCtx(null); }}
          data-testid="task-child-ctx-overlay"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12 }}
            className="fixed glass-panel border border-sertex-cyan/40 rounded-md py-1 shadow-lg min-w-[210px]"
            style={{
              left: Math.min(childCtx.x, window.innerWidth - 224),
              top: Math.min(childCtx.y, window.innerHeight - 104),
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="task-child-context-menu"
          >
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("sertex:task-jump", { detail: { task_id: childCtx.childId } }),
                );
                setChildCtx(null);
              }}
              data-testid="child-ctx-jump"
              className="w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 text-sertex-cyan hover:bg-sertex-cyan/10 transition-colors"
            >
              <CornerLeftUp className="h-3 w-3 shrink-0 rotate-90" />
              <span className="flex-1">Bu göreve git</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const child = childCtx;
                setChildCtx(null);
                const ok = await confirmDialog({
                  title: "GERİ ALT GÖREVE DÖNÜŞTÜR",
                  message: `"${child.title}" görevi bu görevin alt görevine geri çevrilsin mi?\nGörev silinir, içeriği alt görev olarak eklenir.`,
                  confirmText: "DÖNÜŞTÜR",
                  cancelText: "VAZGEÇ",
                });
                if (!ok) return;
                onDemoteChild?.(child.childId);
              }}
              data-testid="child-ctx-demote"
              className="w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 text-violet-300 hover:bg-violet-500/15 transition-colors"
            >
              <Undo2 className="h-3 w-3 shrink-0" />
              <span className="flex-1">Geri alt göreve dönüştür</span>
            </button>
          </motion.div>
        </div>,
        document.body,
      )}
      {showReassign && (
        <ReassignModal
          task={task}
          onClose={() => setShowReassign(false)}
          onSave={(uid) => onReassign(uid)}
          onTransferCompany={(cid) => onTransferCompany && onTransferCompany(cid)}
        />
      )}
      {showShare && (
        <ShareTaskModal
          task={task}
          onClose={() => setShowShare(false)}
          onSaved={() => onLockChanged?.()}
        />
      )}
      {showLockConfig && (
        <LockConfigModal
          task={task}
          onClose={() => setShowLockConfig(false)}
          onSaved={(updated) => onLockChanged?.(updated)}
        />
      )}
      {showUnlockOtp && (
        <UnlockOtpModal
          task={task}
          onClose={() => setShowUnlockOtp(false)}
          onVerified={(updated) => onLockChanged?.(updated)}
        />
      )}
      {showReminderEdit && (
        <QuickReminderEditModal
          task={task}
          onClose={() => setShowReminderEdit(false)}
          onSetReminder={onSetReminder}
          onClearReminder={onClearReminder}
        />
      )}
      {otpDisplay && (
        <OtpDisplayModal
          task={task}
          code={otpDisplay.code}
          expiresAt={otpDisplay.expires_at}
          ttlMinutes={otpDisplay.ttl_minutes}
          onClose={() => setOtpDisplay(null)}
        />
      )}
    </>
  );
};

// ============ REORDERABLE TASK CARD WRAPPER ============
