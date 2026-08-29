import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Home,
  ListTodo,
  StickyNote,
  FolderOpen,
  Settings as SettingsIcon,
  Users,
  Plus,
  Search,
  Check,
  MoreVertical,
  GripVertical,
  X,
  AlertTriangle,
  Clock,
  FileText,
  Anchor,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Trash2,
  Archive,
  Tag,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { tasksApi, taskCategoriesApi, taskLockApi, notesApi, teamApi, reminderConfigApi, taskAttachmentsApi } from "../lib/api";
import FilePanel from "./FilePanel";
import TeamPanel from "./TeamPanel";
import { useAuth } from "../lib/auth";
import { confirmDialog } from "../lib/confirm";
import { flattenTree } from "../lib/categoryTree";
import { REMINDER_DAY_CHOICES } from "../lib/taskHelpers";
import { defaultRecurringValue, resolveRecurringReminder } from "../lib/reminderUtils";
import { MultiAssigneeSelect } from "./tasks/MultiAssigneeSelect";
import { CompanyCombobox } from "./tasks/CompanyCombobox";
import { RecurringReminderFields } from "./tasks/RecurringReminderFields";
import { PendingAttachments } from "./tasks/PendingAttachments";
import CategorySelect from "./tasks/CategorySelect";
import { ContextMenu } from "./TaskContextMenu";
import { EditTaskModal } from "./tasks/EditTaskModal";
import { ShareTaskModal } from "./tasks/ShareTaskModal";
import { ReassignModal } from "./tasks/ReassignModal";
import { LockConfigModal } from "./tasks/LockConfigModal";
import { UnlockOtpModal } from "./tasks/UnlockOtpModal";
import { OtpDisplayModal } from "./tasks/OtpDisplayModal";
import { LinkTasksModal } from "./tasks/LinkTasksModal";
import { printTasks, exportTasksExcel, exportTasksWord } from "../lib/taskExport";

// Son tarih + duruma göre basit durum rozeti (Sertex'te ayrı "öncelik" alanı yok).
const bucketOf = (t) => {
  if (t.status === "done") return { label: "Tamamlandı", color: "#10b981" };
  if (t.status === "paused") return { label: "Beklemede", color: "#f59e0b" };
  const due = t.due_date ? new Date(t.due_date) : null;
  const now = new Date();
  if (due && due.getTime() < now.getTime()) return { label: "Süresi Geçti", color: "#f43f5e" };
  if (due && due.getTime() - now.getTime() < 2 * 86400000) return { label: "Yaklaşıyor", color: "#f59e0b" };
  return { label: "Aktif", color: "accent" };
};

const fmtDateTime = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return null;
  }
};

// Zengin kart gövdesi — referans görsele göre (kutucuk + uyarı ikonu + ⚓ + 🕐 + 📄 etiket + küçült/menü).
const KolayCardBody = ({ task, number, catName, onComplete, onMenu, collapsed, onToggleCollapse, dragHandleProps }) => {
  const b = bucketOf(task);
  const badgeColor = b.color === "accent" ? "rgb(var(--sx-accent-rgb))" : b.color;
  const overdue = b.label === "Süresi Geçti";
  const dt = fmtDateTime(task.due_date);
  const cat = catName(task.category_id);
  const tag = task.company_name || task.assignee_name || null;
  const pinnedNum = task.number_pinned && task.pinned_number != null ? task.pinned_number : number;

  return (
    <div
      className="glass-panel rounded-xl p-3.5 border border-sertex-cyan/25 flex flex-col h-full relative group"
      data-testid={`kolay-card-${task.id}`}
      style={overdue ? { borderColor: "rgba(244,63,94,0.45)" } : undefined}
    >
      {/* Üst şerit: sol = sürükle + tamamla kutucuğu · sağ = küçült/büyüt + ⋮ */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {dragHandleProps && (
            <button
              type="button"
              {...dragHandleProps}
              data-testid={`kolay-drag-${task.id}`}
              title="Sürükleyip sırala"
              aria-label="Sürükleyip sırala"
              className="opacity-30 hover:opacity-100 text-sertex-cyan/70 hover:text-sertex-cyan cursor-grab active:cursor-grabbing transition-opacity touch-none"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onComplete(task); }}
            data-testid={`kolay-check-${task.id}`}
            title="Tamamla"
            aria-label="Görevi tamamla"
            className="h-5 w-5 flex items-center justify-center rounded-md border-2 border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/20 hover:border-emerald-400 transition-colors group/chk"
          >
            <Check className="h-3.5 w-3.5 opacity-0 group-hover/chk:opacity-100 transition-opacity" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(task.id); }}
            data-testid={`kolay-collapse-${task.id}`}
            title={collapsed ? "Büyüt" : "Küçült"}
            aria-label={collapsed ? "Büyüt" : "Küçült"}
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/15 hover:border-sertex-cyan transition-colors"
          >
            {collapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              onMenu(task, r);
            }}
            data-testid={`kolay-menu-btn-${task.id}`}
            aria-label="Görev menüsü"
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/15 hover:border-sertex-cyan transition-colors"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Durum etiketi (süresi geçtiyse uyarı ikonu) */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {overdue ? (
          <AlertTriangle className="h-3.5 w-3.5" style={{ color: badgeColor }} />
        ) : (
          <span className="h-2 w-2 rounded-full" style={{ background: badgeColor, boxShadow: `0 0 6px ${badgeColor}` }} />
        )}
        <span className="text-[11px] font-mono font-semibold tracking-wide" style={{ color: badgeColor }}>{b.label}</span>
      </div>

      {/* Başlık: sıra no + ⚓ (sabitse) + başlık */}
      <div className={`text-sertex-text font-semibold leading-snug ${collapsed ? "line-clamp-1" : "line-clamp-2"}`}>
        <span className="text-sertex-cyan tabular-nums font-mono mr-1 inline-flex items-center" data-testid={`kolay-num-${task.id}`}>
          {pinnedNum}.
          {task.number_pinned && <Anchor className="h-3 w-3 ml-0.5 text-amber-300" data-testid={`kolay-pin-${task.id}`} />}
        </span>
        {task.title}
      </div>

      {!collapsed && (
        <>
          {task.description && (
            <div className="hud-text text-sertex-textMuted normal-case mt-1 line-clamp-2">{task.description}</div>
          )}

          <div className="mt-2.5 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-mono">
              <Clock className="h-3.5 w-3.5 text-sertex-cyan/70 shrink-0" />
              <span className={dt ? "text-sertex-textMuted" : "text-sertex-textMuted/60"}>
                {dt ? `BİTİŞ: ${dt}` : "Tarih yok"}
              </span>
            </div>
            {(tag || cat) && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                <FileText className="h-3.5 w-3.5 text-sertex-cyan/70 shrink-0" />
                <span className="text-sertex-textMuted truncate">{tag || cat}</span>
                {tag && cat && <span className="text-sertex-textMuted/50 truncate">· {cat}</span>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// dnd-kit sürüklenebilir sarmalayıcı (2 yönlü ızgara sıralaması).
const KolaySortableCard = ({ task, number, catName, onComplete, onMenu, collapsed, onToggleCollapse }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <KolayCardBody
        task={task}
        number={number}
        catName={catName}
        onComplete={onComplete}
        onMenu={onMenu}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        dragHandleProps={listeners}
      />
    </div>
  );
};

// Kolay içi görev ekleme formu (Neural Link'e ATMADAN).
const KolayAddModal = ({ cats, onClose, onCreated }) => {
  const { isTeamView, user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyAutoFilled, setCompanyAutoFilled] = useState(false);
  const [assigneeUserIds, setAssigneeUserIds] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newReminderDays, setNewReminderDays] = useState(null);
  const [newReminderDisabled, setNewReminderDisabled] = useState(false);
  const [newReminder, setNewReminder] = useState(defaultRecurringValue());
  const [reminderConfig, setReminderConfig] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isTeamView) teamApi.members().then(setTeamMembers).catch(() => setTeamMembers([]));
    reminderConfigApi.get().then(setReminderConfig).catch(() => setReminderConfig(null));
  }, [isTeamView]);

  const submit = async () => {
    if (!title.trim()) { toast.error("Başlık gerekli"); return; }
    if (startDate && dueDate && new Date(startDate) > new Date(dueDate)) {
      toast.error("Başlangıç tarihi bitiş tarihinden sonra olamaz");
      return;
    }
    setSaving(true);
    try {
      // Görev Paylaşımı — Detaylı ile aynı yönlendirme (kendim / tekil devir / çok kişili).
      const ids = assigneeUserIds;
      const others = ids.filter((x) => x !== user?.id);
      const includesSelf = user?.id ? ids.includes(user.id) : false;
      const extras = {
        assignee_name: assigneeName.trim() || null,
        company_name: companyName.trim() || null,
      };
      if (ids.length === 0 || (ids.length === 1 && includesSelf)) {
        // kişisel görev
      } else if (others.length === 1 && !includesSelf) {
        extras.assignee_user_id = others[0];
      } else {
        extras.assignee_user_ids = ids;
      }
      if (newCategoryId) extras.category_id = newCategoryId;
      if (startDate) extras.start_date = new Date(startDate).toISOString();
      if (newReminderDisabled) extras.reminder_disabled = true;
      else if (newReminderDays != null) extras.reminder_days = newReminderDays;
      const rr = resolveRecurringReminder(newReminder);
      if (rr.error) { toast.error(rr.error); setSaving(false); return; }
      if (rr.reminder_at) {
        extras.reminder_interval_min = rr.reminder_interval_min;
        extras.reminder_repeat_total = rr.reminder_repeat_total;
        extras.reminder_repeat_left = rr.reminder_repeat_left;
      }
      const created = await tasksApi.create(
        title.trim(),
        description.trim(),
        dueDate ? new Date(dueDate).toISOString() : null,
        rr.reminder_at || null,
        extras,
      );
      // Bekleyen dosyaları yeni göreve yükle (görev zaten oluştu).
      if (created?.id && pendingFiles.length) {
        let okCount = 0;
        for (const f of pendingFiles) {
          try { await taskAttachmentsApi.upload(created.id, f); okCount += 1; }
          catch { toast.error(`Dosya yüklenemedi: ${f.name}`); }
        }
        if (okCount) toast.success(`${okCount} dosya göreve eklendi`);
      }
      toast.success("Görev eklendi");
      onCreated();
      onClose();
    } catch {
      toast.error("Görev eklenemedi");
    } finally {
      setSaving(false);
    }
  };

  const defaultReminderLabel = reminderConfig?.effective
    ? `⏱ Uyarı: Varsayılan (${reminderConfig.effective} gün)`
    : "⏱ Uyarı: Varsayılan";

  const inputCls = "w-full px-3 py-2.5 rounded-lg bg-sertex-surface/60 border border-sertex-cyan/25 text-sertex-text font-mono text-sm placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none";

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose} data-testid="kolay-add-overlay">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-panel border border-sertex-cyan/40 rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-sertex"
        onClick={(e) => e.stopPropagation()}
        data-testid="kolay-add-modal"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="display-text text-sertex-cyan neon-glow flex items-center gap-2"><Plus className="h-4 w-4" /> YENİ GÖREV</div>
          <button onClick={onClose} data-testid="kolay-add-close" className="text-sertex-textMuted hover:text-sertex-cyan"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            data-testid="kolay-add-title"
            placeholder="Görev başlığı"
            className={inputCls}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="kolay-add-desc"
            rows={2}
            placeholder="Açıklama (opsiyonel)"
            className={`${inputCls} resize-none`}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">BAŞLANGIÇ</div>
              <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="kolay-add-start" className={inputCls} />
            </div>
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">BİTİŞ</div>
              <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="kolay-add-due" className={inputCls} />
            </div>
          </div>
          {isTeamView && (
            <div className="space-y-2">
              {teamMembers.length > 0 ? (
                <MultiAssigneeSelect
                  members={teamMembers}
                  selfUser={user ? { id: user.id, username: user.username } : null}
                  selectedIds={assigneeUserIds}
                  companyFilter={companyName}
                  onChange={(newIds) => {
                    setAssigneeUserIds(newIds);
                    const others = newIds.filter((x) => x !== user?.id);
                    if (companyAutoFilled || !companyName.trim()) {
                      if (others.length === 1) {
                        setCompanyName(teamMembers.find((m) => m.id === others[0])?.company_name || "");
                        setCompanyAutoFilled(true);
                      } else if (newIds.length === 0) {
                        setCompanyName("");
                        setCompanyAutoFilled(true);
                      }
                    }
                  }}
                />
              ) : (
                <input
                  type="text"
                  value={assigneeName}
                  onChange={(e) => setAssigneeName(e.target.value)}
                  placeholder="Görev sahibi (opsiyonel)"
                  data-testid="kolay-add-assignee"
                  className={inputCls}
                />
              )}
              <CompanyCombobox
                value={companyName}
                onChange={setCompanyName}
                onManualEdit={(isManual) => setCompanyAutoFilled(!isManual)}
                options={teamMembers.map((m) => m.company_name).filter(Boolean)}
                placeholder="Şirket (opsiyonel)"
                testId="kolay-add-company"
              />
            </div>
          )}
          <CategorySelect
            categories={cats}
            value={newCategoryId}
            onChange={setNewCategoryId}
            testId="kolay-add-category"
          />
          <select
            value={newReminderDisabled ? "__off__" : (newReminderDays == null ? "" : String(newReminderDays))}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__off__") { setNewReminderDisabled(true); setNewReminderDays(null); }
              else if (v === "") { setNewReminderDisabled(false); setNewReminderDays(null); }
              else { setNewReminderDisabled(false); setNewReminderDays(parseInt(v, 10)); }
            }}
            data-testid="kolay-add-reminder-days"
            className={inputCls}
          >
            <option value="">{defaultReminderLabel}</option>
            {REMINDER_DAY_CHOICES.map((d) => (
              <option key={d} value={d}>{`⏱ Uyarı: ${d} gün önce`}</option>
            ))}
            <option value="__off__">🚫 Bu görev için hatırlatıcı kapalı</option>
          </select>
          <RecurringReminderFields value={newReminder} onChange={setNewReminder} testPrefix="kolay-add-reminder" />
          <PendingAttachments files={pendingFiles} onChange={setPendingFiles} />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} data-testid="kolay-add-cancel" className="px-4 py-2 rounded-lg border border-sertex-textMuted/30 text-sertex-textMuted hover:text-sertex-text font-mono text-sm">İPTAL</button>
          <button onClick={submit} disabled={saving} data-testid="kolay-add-submit" className="px-4 py-2 rounded-lg bg-sertex-cyan/15 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/25 font-mono text-sm neon-glow disabled:opacity-50">
            {saving ? "EKLENİYOR..." : "EKLE"}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
};

// Kolay içi Notlar paneli — Detaylı'ya ATMADAN (notesApi ile).
const KolayNotes = () => {
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    notesApi.list().then((n) => setNotes(Array.isArray(n) ? n : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  const add = async () => {
    const c = input.trim();
    if (!c) return;
    try { await notesApi.create(c); setInput(""); toast.success("Not eklendi"); load(); }
    catch { toast.error("Not eklenemedi"); }
  };
  const del = async (id) => {
    try { await notesApi.delete(id); load(); toast.success("Not silindi"); }
    catch { toast.error("Silinemedi"); }
  };
  return (
    <div data-testid="kolay-notes">
      <div className="flex gap-2 mb-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Yeni not..."
          data-testid="kolay-note-input"
          className="flex-1 px-3 py-2.5 rounded-lg bg-sertex-surface/60 border border-sertex-cyan/25 text-sertex-text font-mono text-sm placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
        />
        <button type="button" onClick={add} data-testid="kolay-note-add" className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-sertex-cyan/15 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/25 font-mono text-sm neon-glow">
          <Plus className="h-4 w-4" /> Ekle
        </button>
      </div>
      {loading ? (
        <div className="hud-text text-sertex-textMuted py-10 text-center">YÜKLENİYOR...</div>
      ) : notes.length === 0 ? (
        <div className="glass-panel corner-bracket rounded-xl p-8 text-center" data-testid="kolay-notes-empty">
          <div className="text-sertex-text mb-1">Henüz not yok</div>
          <div className="hud-text text-sertex-textMuted normal-case">Yukarıdan ilk notunu ekle.</div>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {notes.map((n) => (
            <div key={n.id} data-testid={`kolay-note-${n.id}`} className="glass-panel rounded-xl p-4 border border-sertex-cyan/20 flex flex-col gap-2">
              <div className="text-sertex-text text-sm whitespace-pre-wrap break-words flex-1">{n.content}</div>
              <div className="flex items-center justify-between">
                <span className="hud-text text-sertex-textMuted normal-case">
                  {n.created_at ? new Date(n.created_at).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : ""}
                </span>
                <button type="button" onClick={() => del(n.id)} data-testid={`kolay-note-del-${n.id}`} aria-label="Notu sil" className="text-sertex-textMuted hover:text-rose-400 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Kolay içi Arşiv — biten görevler + iş koluna göre gruplama toggle'ı.
const KolayArchive = ({ catName }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [byCat, setByCat] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleGroup = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const load = () => {
    setLoading(true);
    tasksApi
      .list(true, "mine", "archived")
      .then((t) => setItems(Array.isArray(t) ? t : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  const restore = async (id) => {
    try { await tasksApi.setArchived(id, false); toast.success("Görev aktife alındı"); load(); }
    catch { toast.error("Geri yüklenemedi"); }
  };
  const card = (t) => (
    <div key={t.id} data-testid={`kolay-arch-card-${t.id}`} className="glass-panel rounded-xl p-3.5 border border-sertex-cyan/15 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="text-sertex-text text-sm font-semibold line-through decoration-sertex-textMuted/50 truncate">{t.title}</span>
        </div>
        <button
          type="button"
          onClick={() => restore(t.id)}
          data-testid={`kolay-arch-restore-${t.id}`}
          title="Aktif görevlere geri al"
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/15 hover:border-sertex-cyan text-[11px] font-mono transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" /> AKTİFE AL
        </button>
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono text-sertex-textMuted flex-wrap">
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDateTime(t.archived_at || t.updated_at) || "—"}</span>
        {catName(t.category_id) && (
          <span className="flex items-center gap-1"><Tag className="h-3 w-3 text-sertex-cyan/70" /> {catName(t.category_id)}</span>
        )}
      </div>
    </div>
  );
  const groups = () => {
    const buckets = new Map();
    for (const t of items) {
      const key = t.category_id || "__none__";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    const entries = [...buckets.entries()].map(([key, tasks]) => ({
      key,
      name: key === "__none__" ? "Kolsuz" : (catName(key) || "Bilinmeyen İş Kolu"),
      tasks,
    }));
    entries.sort((a, b) => (a.key === "__none__" ? 1 : b.key === "__none__" ? -1 : a.name.localeCompare(b.name, "tr")));
    return entries;
  };
  const gridStyle = { gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" };
  return (
    <div data-testid="kolay-archive">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="hud-text text-sertex-textMuted">{items.length} biten görev</div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setByCat((v) => !v)}
            data-testid="kolay-archive-groupby"
            title={byCat ? "İş kolu gruplamayı kaldır (düz liste)" : "Biten görevleri iş koluna göre grupla"}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border font-mono text-xs transition-colors ${
              byCat
                ? "border-sertex-cyan bg-sertex-cyan/15 text-sertex-cyan"
                : "border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60"
            }`}
          >
            <Tag className="h-4 w-4" /> {byCat ? "GRUPLAMAYI KALDIR" : "İŞ KOLUNA GÖRE GRUPLA"}
          </button>
        )}
      </div>
      {loading ? (
        <div className="hud-text text-sertex-textMuted py-10 text-center">YÜKLENİYOR...</div>
      ) : items.length === 0 ? (
        <div className="glass-panel corner-bracket rounded-xl p-8 text-center" data-testid="kolay-archive-empty">
          <div className="text-sertex-text mb-1">Arşiv boş</div>
          <div className="hud-text text-sertex-textMuted normal-case">Tamamladığın görevler burada listelenir.</div>
        </div>
      ) : byCat ? (
        (() => {
          const gl = groups();
          const allCollapsed = gl.length > 0 && gl.every((g) => collapsed.has(g.key));
          return (
            <div className="space-y-4" data-testid="kolay-archive-grouped">
              {gl.length > 1 && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(gl.map((g) => g.key)))}
                    data-testid="kolay-archive-toggle-all"
                    title={allCollapsed ? "Tüm iş kollarını aç" : "Tüm iş kollarını kapat"}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60 font-mono text-xs transition-colors"
                  >
                    {allCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
                    {allCollapsed ? "HEPSİNİ AÇ" : "HEPSİNİ KAPAT"}
                  </button>
                </div>
              )}
              {gl.map((g) => {
                const isCollapsed = collapsed.has(g.key);
                return (
                  <div key={g.key} data-testid={`kolay-arch-group-${g.key}`}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      data-testid={`kolay-arch-group-toggle-${g.key}`}
                      title={isCollapsed ? "Aç" : "Kapat"}
                      className="w-full flex items-center gap-2 mb-2 px-1 group/cat"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-sertex-cyan/70" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-sertex-cyan/70" />
                      )}
                      <Tag className="h-3.5 w-3.5 text-sertex-cyan/70" />
                      <span className="hud-text text-sertex-cyan group-hover/cat:text-sertex-text transition-colors">{g.name}</span>
                      <span className="hud-text text-[10px] text-sertex-textMuted">({g.tasks.length})</span>
                      <div className="flex-1 h-px bg-sertex-cyan/15" />
                    </button>
                    {!isCollapsed && (
                      <div className="grid gap-3" style={gridStyle}>{g.tasks.map(card)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()
      ) : (
        <div className="grid gap-3" style={gridStyle} data-testid="kolay-archive-flat">
          {items.map(card)}
        </div>
      )}
    </div>
  );
};


const KolayInterface = ({ onOpenSettings, sidebarOpen, isMobile }) => {
  const { user, teamFeaturesVisible } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [cats, setCats] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [activeKey, setActiveKey] = useState("home");
  const [showAdd, setShowAdd] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const toggleCollapse = (id) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  // ⋮ menü + modallar
  const [ctxMenu, setCtxMenu] = useState(null); // { task, x, y }
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [reassigning, setReassigning] = useState(null);
  const [lockConfig, setLockConfig] = useState(null);
  const [unlockOtp, setUnlockOtp] = useState(null);
  const [otpDisplay, setOtpDisplay] = useState(null);
  const [linkModal, setLinkModal] = useState(null); // { mode, taskId?, groupId? }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = () => {
    setLoading(true);
    Promise.all([
      tasksApi.list(false, "mine").catch(() => []),
      taskCategoriesApi.list("my_tasks").catch(() => []),
      tasksApi.listGroups().catch(() => []),
    ])
      .then(([ts, cs, gs]) => {
        setTasks(Array.isArray(ts) ? ts : []);
        setCats(Array.isArray(cs) ? cs : []);
        setGroups(Array.isArray(gs) ? gs : []);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const flatCats = useMemo(() => flattenTree(cats), [cats]);
  const catName = (id) => flatCats.find((c) => c.id === id)?.name || null;
  const groupById = useMemo(() => Object.fromEntries((groups || []).map((g) => [g.id, g])), [groups]);

  const activeTasks = useMemo(() => {
    let base = tasks.filter((t) => t.status !== "done" && !t.archived && !t.deleted);
    if (catFilter === "__none__") base = base.filter((t) => !t.category_id);
    else if (catFilter) base = base.filter((t) => t.category_id === catFilter);
    const query = q.trim().toLocaleLowerCase("tr");
    if (!query) return base;
    return base.filter((t) => {
      const hay = [t.title, t.description, t.assignee_name, t.company_name, catName(t.category_id)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return hay.includes(query);
    });
  }, [tasks, flatCats, q, catFilter]);

  const numberOf = useMemo(() => {
    const m = {};
    activeTasks.forEach((t, i) => { m[t.id] = i + 1; });
    return m;
  }, [activeTasks]);

  const canReorder = !q.trim() && !catFilter;
  const closeMenu = () => setCtxMenu(null);

  // Ana Sayfa özet istatistikleri + yaklaşan son tarihler.
  const stats = useMemo(() => {
    const live = tasks.filter((t) => !t.archived && !t.deleted);
    const now = Date.now();
    const open = live.filter((t) => t.status !== "done");
    const overdue = open.filter((t) => t.due_date && new Date(t.due_date).getTime() < now).length;
    const soon = open.filter((t) => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date).getTime();
      return d >= now && d - now < 2 * 86400000;
    }).length;
    return { total: live.length, done: live.length - open.length, active: open.length, overdue, soon };
  }, [tasks]);
  const upcoming = useMemo(
    () =>
      tasks
        .filter((t) => !t.archived && !t.deleted && t.status !== "done" && t.due_date)
        .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
        .slice(0, 6),
    [tasks],
  );

  // ---- Aksiyonlar (tasksApi + reload) — TasksPanel ile aynı davranış ----
  const completeTask = async (t) => {
    try {
      await tasksApi.setStatus(t.id, "done");
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: "done" } : x)));
      toast.success("Görev tamamlandı");
    } catch { toast.error("Tamamlanamadı"); }
  };
  const setStatus = async (id, status) => {
    try { await tasksApi.setStatus(id, status); load(); } catch { toast.error("Güncellenemedi"); }
  };
  const setArchived = async (id, archived) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success(archived ? "Görev arşivlendi" : "Arşivden çıkarıldı");
    try { await tasksApi.setArchived(id, archived); } catch { toast.error("İşlem başarısız — geri alınıyor"); load(); }
  };
  const removeTask = async (id, title) => {
    const ok = await confirmDialog({ title: "GÖREVİ SİL", message: `"${title}" çöp kutusuna taşınsın mı?`, confirmText: "SİL", cancelText: "VAZGEÇ", danger: true });
    if (!ok) return;
    try { await tasksApi.delete(id); load(); toast.success("Çöp kutusuna taşındı"); }
    catch (e) { toast.error(e?.response?.status === 423 ? (e.response.data?.detail || "Görev kilitli") : "Silinemedi"); }
  };
  const cancelTask = async (id, title) => {
    const ok = await confirmDialog({ title: "GÖREVİ İPTAL ET", message: `"${title}" iptal edilsin mi?\nArşivin İPTAL grubuna taşınır.`, confirmText: "İPTAL ET", cancelText: "VAZGEÇ", danger: true });
    if (!ok) return;
    try { await tasksApi.cancel(id); load(); toast.success("Görev iptal edildi"); }
    catch (e) { toast.error(e?.response?.status === 423 ? (e.response.data?.detail || "Görev kilitli") : "İptal başarısız"); }
  };
  const setTaskCategory = async (id, categoryId) => {
    try {
      await tasksApi.update(id, { category_id: categoryId || "" });
      const name = categoryId ? (catName(categoryId) || "İş Kolu") : "Kolsuz";
      toast.success(`Görev → ${name}`); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Değiştirilemedi"); }
  };
  const setTaskReminderDays = async (id, days) => {
    try { await tasksApi.update(id, { reminder_days: days == null ? 0 : days, reminder_disabled: false }); toast.success(days == null ? "Uyarı: varsayılan" : `Uyarı: ${days} gün önce`); load(); }
    catch { toast.error("Değiştirilemedi"); }
  };
  const setTaskReminderDisabled = async (id, disabled) => {
    try { await tasksApi.update(id, { reminder_disabled: !!disabled }); toast.success(disabled ? "Hatırlatıcı kapatıldı" : "Hatırlatıcı aktif"); load(); }
    catch { toast.error("Değiştirilemedi"); }
  };
  const setTaskDigestMuted = async (id, muted) => {
    try { await tasksApi.update(id, { digest_muted: !!muted }); toast.success(muted ? "Sabah özetinden çıkarıldı" : "Sabah özetine eklendi"); load(); }
    catch { toast.error("Değiştirilemedi"); }
  };
  const setTaskPin = async (taskId, pinned, number) => {
    if (pinned && number != null) {
      const dup = tasks.find((t) => t.id !== taskId && t.status !== "done" && t.number_pinned && t.pinned_number === number);
      if (dup) { toast.error(`${number} numarası zaten "${dup.title}" görevine sabit`); return; }
    }
    try { await tasksApi.update(taskId, { number_pinned: pinned, pinned_number: pinned ? number : null }); toast.success(pinned ? `Sıra numarası sabitlendi: ${number}` : "Sabit kaldırıldı"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "İşlem başarısız"); }
  };
  const setReminder = async (id, iso, opts = {}) => {
    try { await tasksApi.setReminder(id, iso, opts); load(); toast.success("Hatırlatma kuruldu"); }
    catch { toast.error("Hatırlatma kurulamadı"); }
  };
  const clearReminder = async (id) => {
    try { await tasksApi.setReminder(id, null); load(); toast.success("Hatırlatma iptal edildi"); }
    catch { toast.error("İptal edilemedi"); }
  };
  const reassignTask = async (id, newOwnerId) => { await tasksApi.reassign(id, newOwnerId); load(); };
  const transferTaskToCompany = async (id, companyId) => { await tasksApi.transferToCompany(id, companyId); load(); };
  const demoteToSubtask = async (id) => {
    try { await tasksApi.demoteToSubtask(id); toast.success("Alt göreve dönüştürüldü"); } catch (e) { toast.error(e?.response?.data?.detail || "Dönüştürülemedi"); }
    load();
  };
  const removeFromGroup = async (gid, tid) => {
    try { await tasksApi.removeGroupMember(gid, tid); toast.success("Görev gruptan çıkarıldı"); load(); } catch { toast.error("Çıkarılamadı"); }
  };
  const saveEdit = async (patch) => {
    try { await tasksApi.update(editing.id, patch); load(); toast.success("Kaydedildi"); } catch { toast.error("Kaydedilemedi"); }
  };
  const issueOtp = async (task) => {
    try { const res = await taskLockApi.issueOtp(task.id); setOtpDisplay({ task, ...res }); }
    catch (e) { toast.error(e?.response?.data?.detail || "OTP üretilemedi"); }
  };

  // ContextMenu onAction — TaskCard.handleAction ile birebir.
  const handleAction = (task, action, extra) => {
    if (action === "delete") removeTask(task.id, task.title);
    else if (action === "edit") setEditing(task);
    else if (action === "share") setSharing(task);
    else if (action === "archive") setArchived(task.id, true);
    else if (action === "unarchive") setArchived(task.id, false);
    else if (action === "cancel-task") cancelTask(task.id, task.title);
    else if (action === "reset-size") { /* Kolay kartları sabit boyut — noop */ }
    else if (action === "reminder-cancel") clearReminder(task.id);
    else if (action === "link-tasks") setLinkModal({ mode: "create", taskId: task.id });
    else if (action === "group-edit") { if (task.group_id) setLinkModal({ mode: "edit", groupId: task.group_id }); }
    else if (action === "group-remove") { if (task.group_id) removeFromGroup(task.group_id, task.id); }
    else if (action === "demote-to-subtask") demoteToSubtask(task.id);
    else if (action === "digest-mute-toggle") setTaskDigestMuted(task.id, !task.digest_muted);
    else if (action.startsWith("export-")) {
      const catMap = Object.fromEntries((cats || []).map((c) => [c.id, c.name]));
      (async () => {
        try {
          if (action === "export-print") printTasks(task, catMap);
          else if (action === "export-excel") exportTasksExcel(task, catMap);
          else if (action === "export-word") await exportTasksWord(task, catMap);
        } catch (e) {
          toast.error(e?.message === "popup-blocked" ? "Açılır pencere engellendi" : "Dışa aktarılamadı");
        }
      })();
    } else if (action.startsWith("reminder-")) {
      const repeat = Math.max(1, extra?.repeat || 1);
      const opts = repeat > 1 ? { intervalMin: extra.intervalMin, repeatLeft: repeat, repeatTotal: repeat } : {};
      if (action === "reminder-custom") setReminder(task.id, extra.iso, opts);
      else setReminder(task.id, new Date(Date.now() + extra.offset).toISOString(), opts);
    } else {
      setStatus(task.id, action); // done / paused / pending / overdue
    }
  };

  const onDragEnd = (e) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = activeTasks.findIndex((t) => t.id === active.id);
    const newIndex = activeTasks.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(activeTasks, oldIndex, newIndex);
    setTasks((prev) => {
      const activeIds = new Set(next.map((t) => t.id));
      const rest = prev.filter((t) => !activeIds.has(t.id));
      return [...next, ...rest];
    });
    tasksApi.reorder(next.map((t) => t.id)).catch(() => {});
  };

  const openMenu = (task, rect) => {
    setCtxMenu({ task, x: rect.left - 200, y: rect.bottom + 4 });
  };

  const linkCandidates = useMemo(() => {
    if (!linkModal) return { candidates: [], preselected: [], group: null };
    const ungrouped = tasks.filter((t) => !t.group_id && !t.archived && !t.deleted);
    if (linkModal.mode === "edit" && linkModal.groupId) {
      const members = tasks.filter((t) => t.group_id === linkModal.groupId);
      return { candidates: [...members, ...ungrouped], preselected: members.map((t) => t.id), group: groupById[linkModal.groupId] || null };
    }
    return { candidates: ungrouped, preselected: linkModal.taskId ? [linkModal.taskId] : [], group: null };
  }, [linkModal, tasks, groupById]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6) return "İyi geceler";
    if (h < 12) return "Günaydın";
    if (h < 18) return "İyi günler";
    return "İyi akşamlar";
  })();
  const today = new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });

  const MENU = [
    { key: "home", label: "Ana Sayfa", icon: Home, onClick: () => setActiveKey("home") },
    { key: "tasks", label: "Görevler", icon: ListTodo, onClick: () => setActiveKey("tasks") },
    { key: "archive", label: "Arşiv", icon: Archive, onClick: () => setActiveKey("archive") },
    ...(teamFeaturesVisible ? [{ key: "team", label: "Ekip", icon: Users, onClick: () => setActiveKey("team") }] : []),
    { key: "notes", label: "Notlar", icon: StickyNote, onClick: () => setActiveKey("notes") },
    { key: "files", label: "Dosyalar", icon: FolderOpen, onClick: () => setActiveKey("files") },
    { key: "settings", label: "Ayarlar", icon: SettingsIcon, onClick: () => onOpenSettings?.() },
  ];

  const ctxTask = ctxMenu?.task;

  return (
    <div
      className="absolute inset-0 z-10 overflow-y-auto scrollbar-sertex"
      data-testid="kolay-interface"
      style={{
        right: !isMobile && sidebarOpen ? 360 : 0,
        bottom: isMobile ? 64 : 0,
        transition: "right 300ms",
      }}
    >
      <div className="flex min-h-full">
        {/* Slim sol menü */}
        <div className="w-[132px] shrink-0 border-r border-sertex-cyan/15 p-3 flex flex-col gap-1.5 sticky top-0 self-start" data-testid="kolay-menu">
          <div className="display-text text-sertex-cyan neon-glow tracking-[0.15em] text-xs mb-2 px-1">
            GÖREV<br />MERKEZİ
          </div>
          {MENU.map((m) => {
            const Icon = m.icon;
            const active = m.key === activeKey;
            return (
              <button
                key={m.key}
                type="button"
                onClick={m.onClick}
                data-testid={`kolay-menu-${m.key}`}
                className={`w-full flex flex-col items-center gap-1 py-3 rounded-lg border transition-colors ${
                  active
                    ? "border-sertex-cyan bg-sertex-cyan/10 text-sertex-cyan"
                    : "border-transparent text-sertex-textMuted hover:text-sertex-cyan hover:bg-sertex-cyan/5"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-mono">{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* İçerik — tam genişlik (max-w yok); sidebar açılınca right:360 ile daralır. */}
        <div className="flex-1 min-w-0 p-5 lg:p-8">
          <div className="mb-5">
            <div className="hud-text text-sertex-textMuted">{today}</div>
            <h1 className="display-text text-2xl lg:text-3xl text-sertex-cyan neon-glow mt-1">
              {activeKey === "home"
                ? `${greeting}, ${user?.username || "Kullanıcı"}!`
                : activeKey === "tasks"
                ? "Görevler"
                : activeKey === "archive"
                ? "Arşiv"
                : activeKey === "notes"
                ? "Notlar"
                : activeKey === "files"
                ? "Dosyalar"
                : activeKey === "team"
                ? "Ekip"
                : ""}
            </h1>
          </div>

          {/* ANA SAYFA — özet gösterge (görev ızgarası GÖREVLER sekmesinde) */}
          {activeKey === "home" && (
            <div data-testid="kolay-home">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6" data-testid="kolay-home-stats">
                {[
                  { key: "active", label: "Aktif", value: stats.active, icon: CircleDot, color: "rgb(var(--sx-accent-rgb))" },
                  { key: "overdue", label: "Süresi Geçti", value: stats.overdue, icon: AlertTriangle, color: "#f43f5e" },
                  { key: "soon", label: "Yaklaşan", value: stats.soon, icon: Clock, color: "#f59e0b" },
                  { key: "done", label: "Tamamlanan", value: stats.done, icon: CheckCircle2, color: "#10b981" },
                ].map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setActiveKey("tasks")}
                      data-testid={`kolay-stat-${s.key}`}
                      className="glass-panel rounded-xl p-4 border border-sertex-cyan/20 text-left hover:border-sertex-cyan/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="h-4 w-4" style={{ color: s.color }} />
                        <span className="hud-text text-sertex-textMuted normal-case">{s.label}</span>
                      </div>
                      <div className="text-3xl font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <button type="button" onClick={() => setShowAdd(true)} data-testid="kolay-home-add" className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sertex-cyan/15 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/25 transition-colors font-mono text-sm neon-glow">
                  <Plus className="h-4 w-4" /> Yeni Görev Ekle
                </button>
                <button type="button" onClick={() => setActiveKey("tasks")} data-testid="kolay-home-all" className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60 transition-colors font-mono text-sm">
                  <ListTodo className="h-4 w-4" /> Tüm Görevler
                </button>
              </div>

              <div className="hud-text text-sertex-cyan mb-3">YAKLAŞAN SON TARİHLER</div>
              {loading ? (
                <div className="hud-text text-sertex-textMuted py-10 text-center">YÜKLENİYOR...</div>
              ) : upcoming.length === 0 ? (
                <div className="glass-panel corner-bracket rounded-xl p-8 text-center" data-testid="kolay-home-empty">
                  <div className="text-sertex-text mb-1">Yaklaşan son tarih yok</div>
                  <div className="hud-text text-sertex-textMuted normal-case">Tarihli aktif görevin bulunmuyor.</div>
                </div>
              ) : (
                <div className="space-y-2" data-testid="kolay-home-upcoming">
                  {upcoming.map((t) => {
                    const b = bucketOf(t);
                    const bc = b.color === "accent" ? "rgb(var(--sx-accent-rgb))" : b.color;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveKey("tasks")}
                        data-testid={`kolay-upcoming-${t.id}`}
                        className="w-full flex items-center gap-3 glass-panel rounded-lg p-3 border border-sertex-cyan/15 hover:border-sertex-cyan/40 transition-colors text-left"
                      >
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: bc, boxShadow: `0 0 6px ${bc}` }} />
                        <span className="flex-1 min-w-0 truncate text-sertex-text text-sm">{t.title}</span>
                        <span className="hud-text text-sertex-textMuted normal-case shrink-0">{fmtDateTime(t.due_date)}</span>
                        <ChevronRight className="h-4 w-4 text-sertex-textMuted shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* GÖREVLER — arama + ekle + iş kolu filtresi + ızgara */}
          {activeKey === "tasks" && (
            <>
              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-sertex-textMuted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Görevlerde ara..."
                    data-testid="kolay-search"
                    className="w-full pl-10 pr-3 py-3 rounded-xl bg-sertex-surface/60 border border-sertex-cyan/25 text-sertex-text font-mono text-sm placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  data-testid="kolay-add-task"
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sertex-cyan/15 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/25 transition-colors font-mono text-sm neon-glow"
                >
                  <Plus className="h-4 w-4" /> Yeni Görev Ekle
                </button>
              </div>

              {flatCats.length > 0 && (
                <div className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-sertex pb-1" data-testid="kolay-cat-filter">
                  {[{ id: "", name: "Tümü" }, ...flatCats, { id: "__none__", name: "Kolsuz" }].map((c) => {
                    const sel = catFilter === c.id;
                    return (
                      <button
                        key={c.id || "all"}
                        type="button"
                        onClick={() => setCatFilter(c.id)}
                        data-testid={`kolay-cat-chip-${c.id || "all"}`}
                        style={{ flexShrink: 0 }}
                        className={`px-3 py-1.5 rounded-full border text-xs font-mono transition-colors whitespace-nowrap ${
                          sel
                            ? "border-sertex-cyan bg-sertex-cyan/15 text-sertex-cyan"
                            : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50"
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="hud-text text-sertex-cyan mb-3">BUGÜNKÜ GÖREVLER</div>

              {loading ? (
                <div className="hud-text text-sertex-textMuted py-10 text-center" data-testid="kolay-loading">YÜKLENİYOR...</div>
              ) : activeTasks.length === 0 ? (
                <div className="glass-panel corner-bracket rounded-xl p-8 text-center" data-testid="kolay-empty">
                  <div className="text-sertex-text text-lg mb-1">🎉 Aktif görevin yok</div>
                  <div className="hud-text text-sertex-textMuted normal-case mb-4">
                    {q || catFilter ? "Eşleşen görev bulunamadı." : "Yeni bir görev ekleyerek başla."}
                  </div>
                  {!q && !catFilter && (
                    <button type="button" onClick={() => setShowAdd(true)} data-testid="kolay-empty-add" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan/10 font-mono text-sm">
                      <Plus className="h-4 w-4" /> Görev Ekle
                    </button>
                  )}
                </div>
              ) : canReorder ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={activeTasks.map((t) => t.id)} strategy={rectSortingStrategy}>
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
                      data-testid="kolay-task-grid"
                    >
                      {activeTasks.map((t) => (
                        <KolaySortableCard key={t.id} task={t} number={numberOf[t.id]} catName={catName} onComplete={completeTask} onMenu={openMenu} collapsed={collapsedIds.has(t.id)} onToggleCollapse={toggleCollapse} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }} data-testid="kolay-task-grid">
                  {activeTasks.map((t) => (
                    <KolayCardBody key={t.id} task={t} number={numberOf[t.id]} catName={catName} onComplete={completeTask} onMenu={openMenu} collapsed={collapsedIds.has(t.id)} onToggleCollapse={toggleCollapse} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* NOTLAR — Kolay içinde */}
          {activeKey === "notes" && <KolayNotes />}

          {/* ARŞİV — biten görevler + iş koluna göre gruplama */}
          {activeKey === "archive" && <KolayArchive catName={catName} />}

          {/* DOSYALAR — mevcut FilePanel yeniden kullanıldı */}
          {activeKey === "files" && (
            <div className="glass-panel rounded-xl border border-sertex-cyan/20 p-4" data-testid="kolay-files">
              <FilePanel />
            </div>
          )}

          {/* EKİP — mevcut TeamPanel yeniden kullanıldı */}
          {activeKey === "team" && (
            <div className="glass-panel rounded-xl border border-sertex-cyan/20 p-4" data-testid="kolay-team">
              <TeamPanel />
            </div>
          )}
        </div>
      </div>

      {/* TAM Neural Link ⋮ menüsü (gerçek ContextMenu bileşeni) */}
      {ctxMenu && ctxTask && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          task={ctxTask}
          onAction={(action, extra) => handleAction(ctxTask, action, extra)}
          onClose={closeMenu}
          isTeamView={false}
          onReassign={() => setReassigning(ctxTask)}
          categories={cats}
          onSetCategory={(catId) => setTaskCategory(ctxTask.id, catId)}
          onSetReminderDays={(d) => setTaskReminderDays(ctxTask.id, d)}
          onSetReminderDisabled={(v) => setTaskReminderDisabled(ctxTask.id, v)}
          currentUser={user}
          onOpenLockConfig={() => setLockConfig(ctxTask)}
          onOpenUnlockOtp={() => setUnlockOtp(ctxTask)}
          onIssueOtp={() => issueOtp(ctxTask)}
          displayNumber={numberOf[ctxTask.id]}
          onPinNumber={(n) => setTaskPin(ctxTask.id, true, n)}
          onUnpinNumber={() => setTaskPin(ctxTask.id, false)}
          archiveGroup={null}
          isAdmin={false}
        />
      )}

      {/* Modallar — Neural Link ile aynı bileşenler */}
      {editing && (
        <EditTaskModal task={editing} onClose={() => setEditing(null)} onSave={saveEdit} isTeamView={false} categories={cats} teamMembers={[]} currentUser={user} />
      )}
      {sharing && (
        <ShareTaskModal task={sharing} onClose={() => setSharing(null)} onSaved={() => { setSharing(null); load(); }} />
      )}
      {reassigning && (
        <ReassignModal task={reassigning} onClose={() => setReassigning(null)} onSave={(uid) => reassignTask(reassigning.id, uid)} onTransferCompany={(cid) => transferTaskToCompany(reassigning.id, cid)} />
      )}
      {lockConfig && (
        <LockConfigModal task={lockConfig} onClose={() => setLockConfig(null)} onSaved={() => { setLockConfig(null); load(); }} />
      )}
      {unlockOtp && (
        <UnlockOtpModal task={unlockOtp} onClose={() => setUnlockOtp(null)} onVerified={() => { setUnlockOtp(null); load(); }} />
      )}
      {otpDisplay && (
        <OtpDisplayModal task={otpDisplay.task} code={otpDisplay.code} expiresAt={otpDisplay.expires_at} ttlMinutes={otpDisplay.ttl_minutes} onClose={() => setOtpDisplay(null)} />
      )}
      {linkModal && (
        <LinkTasksModal candidateTasks={linkCandidates.candidates} preselectedIds={linkCandidates.preselected} group={linkCandidates.group} onClose={() => setLinkModal(null)} onSaved={() => { setLinkModal(null); load(); }} />
      )}
      {showAdd && (
        <KolayAddModal cats={cats} onClose={() => setShowAdd(false)} onCreated={load} />
      )}
    </div>
  );
};

export default KolayInterface;
