import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Reorder, useDragControls } from "framer-motion";
import {
  Plus,
  AlertTriangle,
  X,
  GripVertical,
  Archive,
  ArchiveRestore,
  User,
  Tag,
  Users,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronRight,
  ChevronDown,
  Printer,
  ListChecks,
  FileSpreadsheet,
  FileText,
  Link2,
  ExternalLink,
  Search,
  Trash2,
  ClipboardPaste,
} from "lucide-react";
import { tasksApi, teamApi, taskCategoriesApi, reminderConfigApi, taskAttachmentsApi } from "../lib/api";
import { openDetachedPanel } from "../lib/detachedPanels";
import { getDescendantIds, getCategoryPath, flattenTree } from "../lib/categoryTree";
import { getCatTreeExpandedSet } from "../lib/catTreePrefs";
import { getCatFilterExpandedSet, setCatFilterExpanded, saveCatFilterExpandedSet } from "../lib/catFilterPrefs";
import { LOCK_KEY_LABELS, LOCK_KEY_ORDER } from "../lib/taskLocks";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
// Faz 9 CP5 — extracted helpers (behavior unchanged).
import {
  REMINDER_DAY_CHOICES,
  ACTION_LOCK_MAP,
  LOCK_AUDIT_EVENT_META,
  formatAuditPayload,
  hasActiveUnlock,
  canManageLocks,
  isActionLocked,
  isOverdue,
  resolveThreshold,
  dueSoonLayer,
  statusStyle,
  playReminderBeep,
} from "../lib/taskHelpers";
import { UnlockOtpModal } from "./tasks/UnlockOtpModal";
import { ReassignModal } from "./tasks/ReassignModal";
import { EditTaskModal } from "./tasks/EditTaskModal";
import { MultiAssigneeSelect } from "./tasks/MultiAssigneeSelect";
import { PendingAttachments } from "./tasks/PendingAttachments";
import { PersonFilterSelect } from "./tasks/PersonFilterSelect";
import CategorySelect from "./tasks/CategorySelect";
import { CompanyCombobox } from "./tasks/CompanyCombobox";
import { LinkTasksModal } from "./tasks/LinkTasksModal";
import { RecurringReminderFields } from "./tasks/RecurringReminderFields";
import { defaultRecurringValue, resolveRecurringReminder } from "../lib/reminderUtils";
import { showReminderToast } from "../lib/reminderToast";
import { confirmDialog, promptDialog } from "../lib/confirm";
import { printTasks, exportTasksExcel, exportTasksWord } from "../lib/taskExport";
import ExportSelectModal from "./ExportSelectModal";
import { CopyTaskModal } from "./tasks/CopyTaskModal";
import { TaskPasteMenu } from "./tasks/TaskPasteMenu";
import { TemplateBar } from "./tasks/TemplateBar";
import { TemplatesModal } from "./tasks/TemplatesModal";
import { useTaskClipboard, clearTaskClipboard } from "../lib/taskClipboard";

// Faz 9 CP6 — TasksPanel bileşenleri ayrı dosyalara taşındı (davranış birebir aynı).
import { TaskCard } from "./TaskCard";
import {
  ReorderableTaskCard,
  DetachedPlaceholderCard,
  ReorderablePlaceholder,
  OuterTaskRow,
  GroupWindowMemberRow,
  StaticTaskGroupBlock,
  TaskGroupBlock,
  DetachedTaskWindow,
  DetachedGroupWindow,
  GroupDetachedRow,
} from "./TaskGroupViews";
const FILTER_ORDER_KEY = "sertex_task_filter_order_v1";

// Faz 9 CP5 — helpers moved to /lib/taskHelpers.js (ACTION_LOCK_MAP,
// LOCK_AUDIT_EVENT_META, formatAuditPayload, hasActiveUnlock, canManageLocks,
// isActionLocked, isOverdue, resolveThreshold, dueSoonLayer, statusStyle,
// playReminderBeep). Import block at the top of this file.
// LOCK_KEY_LABELS and LOCK_KEY_ORDER live in /lib/taskLocks.js.


const DETACHED_IDS_KEY = "sertex_detached_task_ids_v1";
const DETACHED_GROUP_IDS_KEY = "sertex_detached_group_ids_v1";
const useReminderScheduler = (tasks, onFire, onFireSub) => {
  useEffect(() => {
    // Request notification permission on first mount
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const check = () => {
      const now = Date.now();
      tasks.forEach((t) => {
        if (t.archived) return;
        // Parent task reminder
        if (t.reminder_at && !t.reminder_fired && t.status !== "done") {
          const when = new Date(t.reminder_at).getTime();
          if (when <= now && when > now - 5 * 60 * 1000) {
            onFire(t);
          }
        }
        // Subtask due-date reminders
        const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
        subs.forEach((s, idx) => {
          if (!s.due_date || s.reminder_fired) return;
          if (s.done || s.status === "done" || s.status === "paused") return;
          const when = new Date(s.due_date).getTime();
          if (when <= now && when > now - 5 * 60 * 1000) {
            onFireSub(t, idx);
          }
        });
      });
    };
    check();
    const iv = setInterval(check, 20000);
    return () => clearInterval(iv);
  }, [tasks, onFire, onFireSub]);
};

// ============ MAIN PANEL ============
const ALL_FILTERS = ["aktif", "gecti", "bekliyor", "bitti"];
const DEFAULT_FILTER_ORDER = ["aktif", "gecti", "bekliyor", "bitti"];

// Draggable stat/filter button (long-press or grip)
const DraggableStat = ({ stat, active, onToggle }) => {
  const controls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);
  return (
    <Reorder.Item
      value={stat.key}
      dragListener={false}
      dragControls={controls}
      as="div"
      className="min-w-0"
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setTimeout(() => setIsDragging(false), 50)}
      whileDrag={{ scale: 1.08, zIndex: 50, boxShadow: "0 6px 24px rgba(0,240,255,0.5)" }}
      data-testid={`task-stat-wrap-${stat.key}`}
    >
      <div
        onClick={(e) => {
          if (isDragging) return;
          onToggle();
        }}
        onPointerDown={(e) => {
          const target = e.currentTarget;
          const startX = e.clientX;
          const startY = e.clientY;
          const timer = setTimeout(() => controls.start(e), 250);
          const cancel = (ev) => {
            if (ev && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)) {
              clearTimeout(timer);
              target.removeEventListener("pointermove", cancel);
              target.removeEventListener("pointerup", clear);
            }
          };
          const clear = () => {
            clearTimeout(timer);
            target.removeEventListener("pointermove", cancel);
            target.removeEventListener("pointerup", clear);
          };
          target.addEventListener("pointermove", cancel);
          target.addEventListener("pointerup", clear);
        }}
        data-testid={`task-stat-${stat.key}`}
        aria-pressed={active}
        title={`${stat.label} — sıralamak için basılı tutup sürükleyin`}
        style={{ cursor: "grab" }}
        className={`relative glass-panel border rounded-md px-1 py-1.5 transition-all select-none ${
          active
            ? `border-transparent ring-2 ${stat.ring} bg-sertex-cyan/10 scale-[1.03]`
            : "border-sertex-cyan/20 hover:border-sertex-cyan/40 hover:bg-sertex-cyan/5"
        }`}
      >
        <span
          onPointerDown={(e) => {
            e.stopPropagation();
            controls.start(e);
          }}
          className="absolute top-0.5 left-0.5 text-sertex-cyan/60 hover:text-sertex-cyan cursor-grab active:cursor-grabbing touch-none"
          data-testid={`task-stat-grip-${stat.key}`}
          title="Sürükleyerek sırala"
        >
          <GripVertical className="h-3 w-3" />
        </span>
        <div className={`display-text text-lg tabular-nums text-center ${stat.color}`}>{stat.value}</div>
        <div className="hud-text text-sertex-textMuted text-[9px] text-center">{stat.label}</div>
      </div>
    </Reorder.Item>
  );
};

const CAT_ORDER_KEY = "sertex_category_order_v1";
const loadCatOrder = () => {
  try { return JSON.parse(localStorage.getItem(CAT_ORDER_KEY) || "[]") || []; }
  catch { return []; }
};

// Görev → İş Kolu sürükle-bırak: bırakma noktasındaki (imleç) DOM yığınından
// ilk `data-cat-drop` taşıyan elemanı bulur. Framer Motion drag olayının
// clientX/clientY'sini (yoksa info.point) kullanır. `elementsFromPoint`
// (çoğul) sürüklenen kart imlecin üstünde olsa bile altındaki çipi yakalar.
const findCatDropTarget = (event, info) => {
  let x, y;
  if (event && typeof event.clientX === "number") { x = event.clientX; y = event.clientY; }
  else if (event?.changedTouches?.[0]) { x = event.changedTouches[0].clientX; y = event.changedTouches[0].clientY; }
  else if (info?.point) { x = info.point.x; y = info.point.y; }
  if (x == null || y == null) return null;
  const stack = (typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(x, y)
    : [document.elementFromPoint(x, y)]) || [];
  for (const node of stack) {
    const c = node && node.closest && node.closest("[data-cat-drop]");
    if (c) return c.getAttribute("data-cat-drop");
  }
  return null;
};

const TasksPanel = ({ refreshSignal, onDataChanged, detached = false, initialCategory = null, onDock }) => {
  const { isTeamView, user } = useAuth();
  const [tasks, setTasks] = useState([]);
  // GÖREV BAĞLAMA — gruplar (id → {name, show_progress}) + modal durumu.
  const [groups, setGroups] = useState([]);
  const [linkModal, setLinkModal] = useState(null); // { mode:'create'|'edit', taskId?, groupId? }
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  // Arşiv grupları: 'done' (BİTMİŞ) · 'cancelled' (İPTAL) · 'deleted' (SİLİNMİŞ/çöp).
  const [archiveGroup, setArchiveGroup] = useState("done");
  const [archiveCounts, setArchiveCounts] = useState({ done: 0, cancelled: 0, deleted: 0 });
  // Arşiv v2 — global ayarlar (neden politikası + otomatik temizlik) + kişi yetkileri.
  const [taskSettings, setTaskSettings] = useState({
    delete_reason_policy: "optional",
    trash_autoclean_enabled: false,
    trash_autoclean_days: 30,
    caps: { perm_delete: false, empty_trash: false, manage_policy: false },
  });
  // Genel aramada arşiv sonuçları (BİTMİŞ/İPTAL/SİLİNMİŞ) — ayrı bölümde gösterilir.
  const [archiveSearchResults, setArchiveSearchResults] = useState([]);
  // Arşiv sıralama yönü: 'new' (yeni→eski) | 'old' | 'az'
  const [archiveSort, setArchiveSort] = useState("new");
  // Arşivde iş koluna (kategori) göre gruplama — varsayılan kapalı (düz liste).
  const [archiveByCategory, setArchiveByCategory] = useState(false);
  // Gruplu arşivde katlanmış (kapalı) iş kolu başlıkları.
  const [collapsedArchiveCats, setCollapsedArchiveCats] = useState(() => new Set());
  const toggleArchiveCat = (key) =>
    setCollapsedArchiveCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [companyName, setCompanyName] = useState("");
  // UX Enhancement — track whether companyName was auto-filled by the
  // assignee picker (so we can overwrite it when the pick changes) vs.
  // manually typed by the user (leave alone).
  const [companyAutoFilled, setCompanyAutoFilled] = useState(false);
  // Faz 8 CP3 — visible team members (used to populate the assignee dropdown
  // in Team-view mode). Empty for pure employees.
  const [teamMembers, setTeamMembers] = useState([]);
  const [assigneeUserIds, setAssigneeUserIds] = useState([]); // [] = assign to self
  // Yeni Görev formu — görev oluşunca yüklenecek bekleyen dosyalar.
  const [pendingFiles, setPendingFiles] = useState([]);
  // Faz 8 CP4 · İş Kolları — filter chip'leri + form dropdown + context menu.
  const [categories, setCategories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState(initialCategory || ""); // "" = all, "__none__" = uncategorized
  const [newCategoryId, setNewCategoryId] = useState("");
  // Görev arama — binlerce görev içinde başlık/açıklama/kişi/şirket/iş kolu/alt
  // görevlere göre canlı arama. Hiçbir mevcut filtreyi bozmaz (üstüne biner).
  const [searchQuery, setSearchQuery] = useState("");
  // İş kolu çiplerini sürükle-bırak ile sırala — kişisel (localStorage),
  // sekmeler/pencereler arası olayla senkron. Backend'e dokunmaz.
  const [catOrder, setCatOrder] = useState(loadCatOrder);
  const [dragCatId, setDragCatId] = useState(null);
  const [dragOverCatId, setDragOverCatId] = useState(null);
  // Görev → İş Kolu sürükle-bırakta imlecin o an üstünde olduğu çip.
  const [taskDragOverCatId, setTaskDragOverCatId] = useState(null);
  // Görev Kopyalama (Kopyala → Yapıştır).
  const [copyModalTask, setCopyModalTask] = useState(null);
  const [pasteMenu, setPasteMenu] = useState(null); // { x, y, categoryId, categoryName }
  const clipboard = useTaskClipboard();
  // Görev Şablonları (Şablon Kütüphanesi).
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesRefresh, setTemplatesRefresh] = useState(0);
  const orderedCategories = useMemo(() => {
    if (!catOrder.length) return categories;
    const pos = new Map(catOrder.map((id, i) => [id, i]));
    return [...categories].sort((a, b) => {
      const pa = pos.has(a.id) ? pos.get(a.id) : Infinity;
      const pb = pos.has(b.id) ? pos.get(b.id) : Infinity;
      if (pa === pb) return 0;
      return pa - pb;
    });
  }, [categories, catOrder]);
  useEffect(() => {
    const h = () => setCatOrder(loadCatOrder());
    window.addEventListener("sertex:category-order", h);
    return () => window.removeEventListener("sertex:category-order", h);
  }, []);
  // İş kolu sırasını sunucudan çek (cihazlar arası senkron). localStorage
  // anlık boyar; sunucu değeri gelince onu esas al ve cache'i güncelle.
  useEffect(() => {
    taskCategoriesApi.getOrder().then((d) => {
      const order = Array.isArray(d?.order) ? d.order : [];
      if (order.length) {
        setCatOrder(order);
        try { localStorage.setItem(CAT_ORDER_KEY, JSON.stringify(order)); } catch (e) { /* ignore */ }
      }
    }).catch(() => {});
  }, [refreshSignal]);
  const persistCatOrder = (ids) => {
    setCatOrder(ids);
    try { localStorage.setItem(CAT_ORDER_KEY, JSON.stringify(ids)); } catch (e) { /* ignore */ }
    window.dispatchEvent(new Event("sertex:category-order"));
    // Sunucuya kaydet (localStorage zaten güncel; hata olursa kullanıcıyı uyar).
    taskCategoriesApi.setOrder(ids).catch(() =>
      toast.error("İş kolu sırası sunucuya kaydedilemedi — diğer cihazlarla eşitlenmeyebilir")
    );
  };
  const handleCatDrop = (targetId) => {
    if (!dragCatId || dragCatId === targetId) { setDragCatId(null); setDragOverCatId(null); return; }
    // Sadece AYNI SEVIYEDEKI kardeşler arasında sıralama (ağaç yapısı korunur).
    const byId = Object.fromEntries(categories.map((c) => [c.id, c]));
    const dp = byId[dragCatId]?.parent_id || null;
    const tp = byId[targetId]?.parent_id || null;
    if (dp !== tp) {
      toast.info("Sadece aynı seviyedeki iş kolları arasında sıralama yapılabilir");
      setDragCatId(null); setDragOverCatId(null);
      return;
    }
    const ids = orderedCategories.map((c) => c.id);
    const from = ids.indexOf(dragCatId);
    const to = ids.indexOf(targetId);
    if (from !== -1 && to !== -1) {
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      persistCatOrder(ids);
    }
    setDragCatId(null); setDragOverCatId(null);
  };
  // Görev sürüklenirken hedef çipi vurgula (imleç üstündeki çip).
  const handleTaskDragToCategory = (event, info) => {
    const target = findCatDropTarget(event, info);
    setTaskDragOverCatId((prev) => (prev === target ? prev : target));
  };
  // Görev bir iş kolu çipine bırakıldı → o iş koluna taşı (KOLSUZ → kaldır).
  const handleTaskDropCategory = (task, event, info) => {
    const target = findCatDropTarget(event, info);
    setTaskDragOverCatId(null);
    if (!target || !task) return;
    const current = task.category_id || "";
    const next = target === "__none__" ? "" : target;
    if (current === next) return;
    setTaskCategory(task.id, next);
  };
  // Faz 8 CP5 — Due-soon reminder overrides on the new-task form.
  // reminderDays: null = varsayılan (hiyerarşi); sayı = özel; -1 = kapalı.
  const [newReminderDays, setNewReminderDays] = useState(null);
  const [newReminderDisabled, setNewReminderDisabled] = useState(false);
  // Tekrarlı hatırlatıcı — oluşturma formunda ayarlanabilir ("her yerde olsun").
  const [newReminder, setNewReminder] = useState(defaultRecurringValue());
  // Config from /api/settings/reminder-config — used for visual layer + form hint.
  const [reminderConfig, setReminderConfig] = useState(null);
  const [editing, setEditing] = useState(null);
  const [tick, setTick] = useState(0);
  // Görevler sekmesi: "mine" (Benim Görevlerim) | "team" (Personel Görevleri).
  const [taskScope, setTaskScope] = useState("mine");
  // Team scope — which person's tasks to show ("" = Tümü).
  const [personFilter, setPersonFilter] = useState("");
  // Görev kartı Küçült/Büyüt — collapsed görev id'leri (localStorage'da hatırlanır).
  const COLLAPSE_KEY = "sertex_collapsed_task_ids";
  const [collapsedIds, setCollapsedIds] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const persistCollapsed = (set) => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(set)));
    } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
  };
  const toggleCollapse = (id) => {
    setCollapsedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistCollapsed(next);
      return next;
    });
  };
  const setAllCollapsed = (ids, collapsed) => {
    setCollapsedIds((s) => {
      const next = new Set(s);
      ids.forEach((id) => (collapsed ? next.add(id) : next.delete(id)));
      persistCollapsed(next);
      return next;
    });
  };
  // Task 4 — dışarı alınmış (detached) görev id'leri (yüzen pencerede açık).
  // Kalıcı değil; sayfa yenilenince pencereler kapanır, kartlar listeye döner.
  const [detachedIds, setDetachedIds] = useState(() => {
    try {
      const raw = localStorage.getItem(DETACHED_IDS_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const toggleDetach = (id) => {
    setDetachedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem(DETACHED_IDS_KEY, JSON.stringify(Array.from(next))); } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
      return next;
    });
  };
  // GÖREV BAĞLAMA — dışarı alınan grup id'leri (localStorage'da kalıcı).
  const [detachedGroupIds, setDetachedGroupIds] = useState(() => {
    try {
      const raw = localStorage.getItem(DETACHED_GROUP_IDS_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const toggleGroupDetach = (gid) => {
    setDetachedGroupIds((s) => {
      const next = new Set(s);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      try { localStorage.setItem(DETACHED_GROUP_IDS_KEY, JSON.stringify(Array.from(next))); } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
      return next;
    });
  };
  // Multi-select filter: empty = show all, otherwise show only selected buckets
  const [filters, setFilters] = useState([]); // array of 'aktif'|'gecti'|'bekliyor'|'bitti'

  const [filterOrder, setFilterOrder] = useState(() => {
    try {
      const raw = localStorage.getItem(FILTER_ORDER_KEY);
      if (!raw) return DEFAULT_FILTER_ORDER;
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.length === DEFAULT_FILTER_ORDER.length &&
        DEFAULT_FILTER_ORDER.every((k) => parsed.includes(k))
      ) {
        return parsed;
      }
    } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
    return DEFAULT_FILTER_ORDER;
  });

  const persistFilterOrder = (next) => {
    setFilterOrder(next);
    try {
      localStorage.setItem(FILTER_ORDER_KEY, JSON.stringify(next));
    } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
  };

  const toggleFilter = (key) => {
    setFilters((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]
    );
  };

  const clearFilters = () => setFilters([]);

  const caps = taskSettings.caps || {};
  const ARCHIVE_VIEW = { done: "archived", cancelled: "cancelled", deleted: "trash" };

  const load = useCallback(() => {
    if (showArchived) {
      tasksApi.list(true, taskScope, ARCHIVE_VIEW[archiveGroup] || "archived").then(setTasks).catch(() => {});
      tasksApi.archiveCounts(taskScope).then(setArchiveCounts).catch(() => {});
    } else {
      tasksApi.list(false, taskScope).then(setTasks).catch(() => {});
    }
    // GÖREV BAĞLAMA — grup meta'sını (isim/ilerleme bayrağı) yükle.
    tasksApi.listGroups().then(setGroups).catch(() => setGroups([]));
    // Also refresh archived count (lightweight, only for badge) — always for
    // the personal scope so the badge reflects the user's own archive.
    if (!showArchived) {
      tasksApi.archiveCounts(taskScope)
        .then((c) => { setArchiveCounts(c); setArchivedCount((c.done || 0) + (c.cancelled || 0) + (c.deleted || 0)); })
        .catch(() => {});
    }
  }, [showArchived, taskScope, archiveGroup]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  // Toast hızlı aksiyonu (ertele/tamamla) sonrası listeyi tazele.
  useEffect(() => {
    const onAction = () => load();
    window.addEventListener("sertex:reminder-action", onAction);
    return () => window.removeEventListener("sertex:reminder-action", onAction);
  }, [load]);

  // When switching to the team scope we need team members for the person
  // filter chips; fetch them (silent-fail for pure employees).
  useEffect(() => {
    if (taskScope === "team" && isTeamView) {
      teamApi.members().then(setTeamMembers).catch(() => setTeamMembers([]));
      setPersonFilter("");
    }
  }, [taskScope, isTeamView]);

  // Faz 8 CP3 — fetch team members visible to the caller. Silent-fail on
  // employees/unauthenticated (backend returns []). Only refetch when the
  // add-form opens so we surface any freshly-granted visibility rows.
  useEffect(() => {
    if (!showAddForm) return;
    teamApi.members().then(setTeamMembers).catch(() => setTeamMembers([]));
  }, [showAddForm]);

  // Görevi Düzenle modalı açılınca ekip üyelerini yükle — böylece GÖREV SAHİBİ
  // ve ŞİRKET alanları (şirkete bağlı personel listesi) dropdown olarak gelir.
  // "Benim Görevlerim"den düzenlerken teamMembers boş kalmasın diye gerekli.
  useEffect(() => {
    if (editing && isTeamView) {
      teamApi.members().then(setTeamMembers).catch(() => {});
    }
  }, [editing, isTeamView]);

  // Faz 8 CP4 — load categories once (silent-fail on 401/employee-no-company).
  useEffect(() => {
    taskCategoriesApi.list("my_tasks").then(setCategories).catch(() => setCategories([]));
  }, [refreshSignal]);

  // Faz 8 CP5 — load reminder config (drives the visual due-soon layer and the
  // "Şirket varsayılanı" hint in the new-task form + settings). Refreshed on
  // parent data-signal so a settings change is reflected without a hard reload.
  useEffect(() => {
    reminderConfigApi.get().then(setReminderConfig).catch(() => setReminderConfig(null));
  }, [refreshSignal]);

  // Team Faz 2 · notification bell → task jump. Store the jumped-to id so the
  // TaskCard can render a temporary highlight ring + scrollIntoView after the
  // task list re-renders. The highlight auto-clears after 4 s so it doesn't
  // sticks around forever if the user is idle.
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);

  // Faz 9 CP4.35 — track active reminder beeps so we can cancel their queued
  // 2nd-beep + AudioContext close timeouts when the panel unmounts.
  const activeBeepsRef = useRef(new Set());
  useEffect(() => () => {
    // Copy to avoid mutation during iteration.
    const beeps = Array.from(activeBeepsRef.current);
    activeBeepsRef.current.clear();
    beeps.forEach((h) => { try { h.cancel(); } catch { /* ok */ } });
  }, []);
  const beep = useCallback(() => {
    const handle = playReminderBeep();
    activeBeepsRef.current.add(handle);
    // Auto-remove from set after natural completion so the set doesn't grow.
    setTimeout(() => activeBeepsRef.current.delete(handle), 1400);
    return handle;
  }, []);
  useEffect(() => {
    const doJump = (tid) => {
      if (!tid) return;
      setHighlightedTaskId(tid);
      // Wait for React to render, then scroll and pulse.
      setTimeout(() => {
        const el = document.querySelector(`[data-testid="task-item-${tid}"]`);
        if (el && el.scrollIntoView) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 250);
      // Auto-clear so the pulse doesn't stay indefinitely.
      setTimeout(() => setHighlightedTaskId((cur) => (cur === tid ? null : cur)), 4000);
    };
    // 1) Handle any pending jump that was dispatched BEFORE this panel
    //    mounted (e.g., a notification click switched to the Görevler tab
    //    and thus mounted us for the first time).
    const pending = window.__sertex_pending_task_jump;
    if (pending && Date.now() - pending.ts < 5000) {
      delete window.__sertex_pending_task_jump;
      // Refresh once so a task that just became visible is in state.
      load();
      doJump(pending.task_id);
    }
    // 2) Also listen live for subsequent jumps while we're mounted.
    const onJump = (ev) => {
      const tid = ev?.detail?.task_id;
      if (!tid) return;
      delete window.__sertex_pending_task_jump;
      load();
      doJump(tid);
    };
    window.addEventListener("sertex:task-jump", onJump);
    return () => window.removeEventListener("sertex:task-jump", onJump);
  }, [load]);

  // Faz 9 CP4.33 — Global unlock request from NotificationBell.
  // Clicking a `task_unlock_offered` notification fires a
  // `sertex:task-unlock-request` CustomEvent. We refetch the task, then
  // open the panel-scoped UnlockOtpModal without navigating first — quick
  // path (2 clicks: bell → row → done).
  //
  // Faz 9 CP4.34 — race-safe. Previous listener depended on outer `load`
  // (which changed identity across renders) — the effect captured a stale
  // closure so late unlock events would refetch based on old filter state.
  // Now the listener only depends on the stable `tasksApi.get` API and
  // `mounted` guard prevents state updates after unmount.
  const [pendingUnlockTask, setPendingUnlockTask] = useState(null);
  useEffect(() => {
    let mounted = true;
    const onUnlock = async (ev) => {
      const tid = ev?.detail?.task_id;
      if (!tid) return;
      try {
        // Fetch the task in isolation — no need to refresh the whole list
        // before opening the modal. The modal itself calls `onLockChanged`
        // (which triggers `load()`) after the OTP is verified.
        const t = await tasksApi.get(tid);
        if (mounted && t) setPendingUnlockTask(t);
        else if (mounted) toast.error("Görev bulunamadı — belki silindi ya da izin yok");
      } catch {
        if (mounted) toast.error("Görev yüklenemedi");
      }
    };
    window.addEventListener("sertex:task-unlock-request", onUnlock);
    return () => {
      mounted = false;
      window.removeEventListener("sertex:task-unlock-request", onUnlock);
    };
  }, []);

  // Arşiv ayarlarını yükle (neden politikası + otomatik temizlik + kişi yetkileri).
  useEffect(() => {
    let alive = true;
    tasksApi.getSettings().then((s) => { if (alive) setTaskSettings(s); }).catch(() => {});
    return () => { alive = false; };
  }, [showArchived]);

  // Genel arama arşivi de tarasın — aktif görünümde arama yapılınca arşiv
  // (BİTMİŞ/İPTAL/SİLİNMİŞ) eşleşmelerini ayrı bölümde göstermek için debounce'lu getir.
  useEffect(() => {
    const q = searchQuery.trim();
    if (showArchived || q.length < 2) { setArchiveSearchResults([]); return; }
    const h = setTimeout(() => {
      tasksApi.searchArchive(q, taskScope).then(setArchiveSearchResults).catch(() => setArchiveSearchResults([]));
    }, 300);
    return () => clearTimeout(h);
  }, [searchQuery, showArchived, taskScope]);

  // Neden notu iste — politikaya göre. Döner: {ok, reason}. İptal → {ok:false}.
  const askReason = async (verb) => {
    const policy = taskSettings.delete_reason_policy;
    if (policy === "off") return { ok: true, reason: "" };
    // "required" ise boş bırakılamaz — geçerli girene kadar tekrar sor.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await promptDialog({
        title: verb === "cancel" ? "GÖREVİ İPTAL ET" : "GÖREVİ SİL",
        message: policy === "required"
          ? `Bu işlem için bir neden girmeniz zorunlu.`
          : `İsterseniz kısa bir neden ekleyin (boş bırakabilirsiniz).`,
        placeholder: "Neden (kısa not)...",
        confirmText: verb === "cancel" ? "İPTAL ET" : "SİL",
        cancelText: "VAZGEÇ",
        danger: true,
      });
      if (r === null) return { ok: false };
      const reason = (r || "").trim();
      if (policy === "required" && !reason) {
        toast.error("Bu işlem için neden zorunlu");
        continue;
      }
      return { ok: true, reason };
    }
  };

  const setArchived = async (id, archived) => {
    // Optimistic remove/keep depending on view
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setArchivedCount((c) => (archived ? c + 1 : Math.max(0, c - 1)));
    // Faz 9 CP8.4 — show the confirmation toast IMMEDIATELY after the
    // optimistic UI update (the user already sees the row leave). Waiting
    // for the network round-trip made the toast feel very laggy on mobile
    // (2-3s delay on slow connections). If the backend rejects the change
    // we roll back with an error toast + full reload.
    toast.success(archived ? "Görev arşivlendi" : "Arşivden çıkarıldı");
    try {
      await tasksApi.setArchived(id, archived);
    } catch (e) {
      toast.error("İşlem başarısız — geri alınıyor");
      load();
    }
  };

  // İptal Et — görevi "iptal edilmiş" işaretle + arşive taşı (İPTAL grubu).
  const cancelTask = async (id) => {
    const res = await askReason("cancel");
    if (!res.ok) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success("Görev iptal edildi");
    try {
      await tasksApi.cancel(id, res.reason);
      load();
    } catch (e) {
      toast.error(e?.response?.status === 423 ? (e.response.data?.detail || "Görev kilitli") : "İptal başarısız");
      load();
    }
  };

  // İptali geri al — görevi aktif listeye döndür.
  const uncancelTask = async (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success("Görev geri yüklendi");
    try {
      await tasksApi.uncancel(id);
      load();
    } catch (e) {
      toast.error("Geri yükleme başarısız");
      load();
    }
  };

  // Çöp kutusundan geri yükle.
  const restoreTask = async (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success("Görev geri yüklendi");
    try {
      await tasksApi.restore(id);
      load();
    } catch (e) {
      toast.error("Geri yükleme başarısız");
      load();
    }
  };

  // Kalıcı Sil (yalnızca admin) — çöp kutusundaki görevi geri dönüşsüz sil.
  const permanentDeleteTask = async (id) => {
    const ok = await confirmDialog({
      title: "Kalıcı Sil",
      message: "Bu görev geri dönüşü olmayacak şekilde kalıcı olarak silinecek. Emin misiniz?",
      confirmText: "Kalıcı Sil",
      danger: true,
    });
    if (!ok) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await tasksApi.permanentDelete(id);
      toast.success("Görev kalıcı olarak silindi");
      load();
    } catch (e) {
      toast.error(e?.response?.status === 403 ? "Kalıcı silme yetkiniz yok" : "Silme başarısız");
      load();
    }
  };

  // Çöp Kutusunu Boşalt (yalnızca admin).
  const emptyTrash = async () => {
    const ok = await confirmDialog({
      title: "Çöp Kutusunu Boşalt",
      message: "Çöp kutusundaki TÜM görevler kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misiniz?",
      confirmText: "Kalıcı Sil",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await tasksApi.emptyTrash(taskScope);
      toast.success(`${r.deleted || 0} görev kalıcı olarak silindi`);
      load();
    } catch (e) {
      toast.error(e?.response?.status === 403 ? "Yetkiniz yok" : "Boşaltma başarısız");
    }
  };

  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(i);
  }, []);

  // Fire reminders
  const fireReminder = useCallback(
    async (task) => {
      showReminderToast(task);
      beep();
      const repeatLeft = task.reminder_repeat_left;
      const intervalMin = task.reminder_interval_min;
      const isRecurring = intervalMin && repeatLeft && repeatLeft > 1;
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("SERTEX Hatırlatma", {
            body: task.title + (task.description ? "\n" + task.description : ""),
            icon: "/favicon.ico",
            tag: `sertex-${task.id}-${repeatLeft || 0}`,
          });
        } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
      }
      try {
        if (isRecurring) {
          // Tekrarlı — bir sonraki hatırlatmayı planla, kalan sayıyı azalt.
          const nextIso = new Date(Date.now() + intervalMin * 60 * 1000).toISOString();
          await tasksApi.rescheduleReminder(task.id, nextIso, repeatLeft - 1);
        } else {
          // Son tekrar (veya tekrarsız) — hatırlatmayı bitir.
          await tasksApi.markReminderFired(task.id);
        }
        load();
      } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
    },
    [load, beep]
  );

  // Fire subtask reminders (when its due_date arrives)
  const fireSubReminder = useCallback(
    async (task, subIdx) => {
      const sub = task.subtasks?.[subIdx];
      if (!sub) return;
      toast(
        <div>
          <div className="font-mono text-sertex-cyan neon-glow mb-1">🔔 ALT GÖREV HATIRLATMA</div>
          <div className="font-mono text-xs text-sertex-textMuted">{task.title}</div>
          <div className="font-mono text-sm">↳ {sub.text}</div>
        </div>,
        { duration: 15000 }
      );
      beep();
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("SERTEX · Alt görev", {
            body: `${task.title}\n↳ ${sub.text}`,
            icon: "/favicon.ico",
            tag: `sertex-sub-${sub.id}`,
          });
        } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
      }
      // Persist reminder_fired=true on this subtask
      const nextSubs = (task.subtasks || []).map((s, i) =>
        i === subIdx ? { ...s, reminder_fired: true } : s
      );
      // Optimistic update in state
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, subtasks: nextSubs } : t)));
      try {
        await tasksApi.setSubtasks(task.id, nextSubs);
      } catch (e) {
        // ignore, will retry on next interval
      }
    },
    [beep]
  );

  useReminderScheduler(tasks, fireReminder, fireSubReminder);

  // Global gözcü (ReminderWatcher) ile çift tetiklemeyi önlemek için: bu panel
  // mount'luyken sayaç > 0 olur ve gözcü PAS geçer (firing'i panel yapar).
  useEffect(() => {
    window.__sertexTaskPanels = (window.__sertexTaskPanels || 0) + 1;
    return () => {
      window.__sertexTaskPanels = Math.max(0, (window.__sertexTaskPanels || 1) - 1);
    };
  }, []);

  const addTask = async () => {
    if (!title.trim()) {
      toast.error("Başlık gerekli");
      return;
    }
    // Yumuşak doğrulama — başlangıç, bitişten sonra olamaz (ikisi de opsiyonel).
    if (startDate && dueDate && new Date(startDate) > new Date(dueDate)) {
      toast.error("Başlangıç tarihi bitiş tarihinden sonra olamaz");
      return;
    }
    try {
      // Görev Paylaşımı — assignment routing (self may be included):
      //   0 seçili veya sadece "kendim" → kişisel görev (extras yok).
      //   yalnız 1 BAŞKA kişi → tekil devir (assignee_user_id).
      //   2+ (kendim dahil olabilir) → çok kişili görev (assignee_user_ids).
      const ids = assigneeUserIds;
      const others = ids.filter((x) => x !== user?.id);
      const includesSelf = user?.id ? ids.includes(user.id) : false;
      const extras = {
        assignee_name: assigneeName.trim() || null,
        company_name: companyName.trim() || null,
      };
      let mode = "self";
      if (ids.length === 0 || (ids.length === 1 && includesSelf)) {
        mode = "self";
      } else if (others.length === 1 && !includesSelf) {
        mode = "single";
        extras.assignee_user_id = others[0];
      } else {
        mode = "multi";
        extras.assignee_user_ids = ids;
      }
      if (newCategoryId) {
        extras.category_id = newCategoryId;
      }
      if (startDate) {
        extras.start_date = new Date(startDate).toISOString();
      }
      // Faz 8 CP5 — apply due-soon overrides from the form.
      if (newReminderDisabled) {
        extras.reminder_disabled = true;
      } else if (newReminderDays != null) {
        extras.reminder_days = newReminderDays;
      }
      // Tekrarlı hatırlatıcı (ilk zaman + kaç defa + aralık).
      const rr = resolveRecurringReminder(newReminder);
      if (rr.error) {
        toast.error(rr.error);
        return;
      }
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
      // Bekleyen dosyaları yeni göreve yükle (parçalı). Görev zaten oluştu;
      // dosya hatası olsa bile görev kaybolmaz — sadece uyarı gösterilir.
      if (created?.id && pendingFiles.length) {
        let okCount = 0;
        for (const f of pendingFiles) {
          try {
            await taskAttachmentsApi.upload(created.id, f);
            okCount += 1;
          } catch (err) {
            toast.error(`Dosya yüklenemedi: ${f.name}`);
          }
        }
        if (okCount) toast.success(`${okCount} dosya göreve eklendi`);
      }
      const firstOther = teamMembers.find((m) => m.id === others[0]);
      setTitle("");
      setDescription("");
      setDueDate("");
      setStartDate("");
      setAssigneeName("");
      setCompanyName("");
      setCompanyAutoFilled(false);
      setAssigneeUserIds([]);
      setPendingFiles([]);
      setNewCategoryId("");
      setNewReminderDays(null);
      setNewReminderDisabled(false);
      setNewReminder(defaultRecurringValue());
      setShowAddForm(false);
      load();
      onDataChanged?.();
      toast.success(
        mode === "multi"
          ? `Görev ${ids.length} kişiye atandı${includesSelf ? " (siz dahil)" : ""}`
          : mode === "single" && firstOther
          ? `Görev ${firstOther.username} kullanıcısına atandı`
          : "Görev eklendi"
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Eklenemedi");
    }
  };

  const setStatus = async (id, status) => {
    try {
      await tasksApi.setStatus(id, status);
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error("Güncellenemedi");
    }
  };

  const removeTask = async (id) => {
    const res = await askReason("delete");
    if (!res.ok) return;
    try {
      await tasksApi.delete(id, res.reason);
      load();
      onDataChanged?.();
      toast.success("Çöp kutusuna taşındı");
    } catch (e) {
      // Faz 9 CP4.27 — 423 = task locked. Show the actionable detail from the
      // backend instead of a generic "Silinemedi" so the user knows to ask
      // their manager for an OTP.
      if (e?.response?.status === 423) {
        toast.error(e.response.data?.detail || "Görev kilitli — müdürünüzden şifre isteyin");
      } else {
        toast.error("Silinemedi");
      }
    }
  };

  // Faz 8 CP3 — transfer ownership. Called by TaskCard → ReassignModal.
  const reassignTask = async (id, newOwnerId) => {
    await tasksApi.reassign(id, newOwnerId);
    load();
    onDataChanged?.();
  };

  // Şirkete Devret — görevi bir şirkete aktar (sahipsiz + kolsuz orphan).
  const transferTaskToCompany = async (id, companyId) => {
    await tasksApi.transferToCompany(id, companyId);
    load();
    onDataChanged?.();
  };

  // Alt görevi tam bir göreve dönüştür (promote) → sunucuda oluştur + listeyi
  // yenile. Ana görevden alt görev çıkar; yeni görev "alt unsuru" rozetli gelir.
  const promoteSubtask = async (taskId, subId) => {
    try {
      const created = await tasksApi.promoteSubtask(taskId, subId);
      toast.success(`Alt görev göreve dönüştürüldü: ${created?.title || ""}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Göreve dönüştürülemedi");
    }
    load();
    onDataChanged?.();
  };

  // Promote'u geri al → görevi ana görevin alt görevine geri çevir.
  const demoteToSubtask = async (taskId) => {
    try {
      await tasksApi.demoteToSubtask(taskId);
      toast.success("Görev tekrar alt göreve dönüştürüldü");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Alt göreve dönüştürülemedi");
    }
    load();
    onDataChanged?.();
  };

  // Sıra numarası sabitle/kaldır. pinned=true iken number verilir (otomatik veya
  // elle). Elle aynı numara başka bir sabit göreve verilmişse engellenir.
  const setTaskPin = async (taskId, pinned, number) => {
    if (pinned && number != null) {
      const dup = tasks.find(
        (t) => t.id !== taskId && t.status !== "done" && t.number_pinned && t.pinned_number === number,
      );
      if (dup) {
        toast.error(`${number} numarası zaten "${dup.title}" görevine sabit`);
        return;
      }
    }
    try {
      await tasksApi.update(taskId, {
        number_pinned: pinned,
        pinned_number: pinned ? number : null,
      });
      toast.success(pinned ? `Sıra numarası sabitlendi: ${number}` : "Sıra numarası sabiti kaldırıldı");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "İşlem başarısız");
    }
    load();
    onDataChanged?.();
  };

  // Dürt / Hatırlat — personele görev hatırlatması gönder (çan + push).
  const [nudgeCounts, setNudgeCounts] = useState({});
  const nudgeTask = async (id, task) => {
    try {
      const r = await tasksApi.nudge(id);
      const n = r?.count_today || 0;
      if (n > 0) setNudgeCounts((m) => ({ ...m, [id]: n }));
      toast.success(
        n > 1
          ? `Hatırlatma gönderildi · bugün ${n}. kez`
          : `Hatırlatma gönderildi: ${task?.assignee_name || "personel"}`
      );
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 429) toast.warning(detail || "Çok sık — biraz sonra tekrar deneyin");
      else toast.error(detail || "Hatırlatma gönderilemedi");
    }
  };

  // Faz 8 CP4 — move a task into (or out of) an iş kolu.
  const setTaskCategory = async (id, categoryId) => {
    try {
      // Backend accepts empty string for "clear" via the special-cased branch.
      await tasksApi.update(id, { category_id: categoryId || "" });
      const name = categoryId
        ? (categories.find((c) => c.id === categoryId)?.name || "İş Kolu")
        : "Kolsuz";
      toast.success(`Görev → ${name}`);
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Değiştirilemedi");
    }
  };

  // Görev Kopyalama — panodaki görevi hedef iş koluna (categoryId; null =
  // KOLSUZ) çoğalt. Pano temizlenene kadar durur → çok kez yapıştırılabilir.
  const handlePaste = async (categoryId, categoryName) => {
    if (!clipboard?.sourceId) return;
    try {
      await tasksApi.duplicate(clipboard.sourceId, {
        include_subtasks: !!clipboard.includeSubtasks,
        include_attachments: !!clipboard.includeAttachments,
        category_id: categoryId || null,
      });
      toast.success(`Yapıştırıldı → ${categoryName || "Kolsuz"}`);
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Yapıştırılamadı");
    }
  };

  // Şablondan görev oluştur (instantiate) → oluşan görevi Düzenle'de aç.
  const handleUseTemplate = (task) => {
    load();
    onDataChanged?.();
    if (task) setEditing(task);
  };

  // Faz 8 CP5 — task-level due-soon overrides via context menu.
  const setTaskReminderDays = async (id, days) => {
    try {
      // null → clear override (fall back to hierarchy). Whitelisted server-side.
      await tasksApi.update(id, {
        reminder_days: days == null ? 0 : days,
        reminder_disabled: false,
      });
      toast.success(
        days == null
          ? "Uyarı: varsayılan (hiyerarşi)"
          : `Uyarı: ${days} gün önce`,
      );
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error("Değiştirilemedi");
    }
  };
  const setTaskReminderDisabled = async (id, disabled) => {
    try {
      await tasksApi.update(id, { reminder_disabled: !!disabled });
      toast.success(disabled ? "Bu görev için hatırlatıcı kapatıldı" : "Hatırlatıcı yeniden aktif");
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error("Değiştirilemedi");
    }
  };
  const setTaskDigestMuted = async (id, muted) => {
    try {
      await tasksApi.update(id, { digest_muted: !!muted });
      toast.success(muted ? "Bu görev sabah özetinden çıkarıldı" : "Bu görev sabah özetine eklendi");
      load();
      onDataChanged?.();
    } catch (e) {
      toast.error("Değiştirilemedi");
    }
  };

  const saveEdit = async (patch) => {
    try {
      await tasksApi.update(editing.id, patch);
      load();
      toast.success("Kaydedildi");
    } catch (e) {
      toast.error("Kaydedilemedi");
    }
  };

  const setReminder = async (id, iso, opts = {}) => {
    try {
      await tasksApi.setReminder(id, iso, opts);
      load();
      const d = new Date(iso);
      const base = `Hatırlatma kuruldu: ${d.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`;
      toast.success(opts.repeatTotal > 1 ? `${base} · ${opts.repeatTotal} defa tekrar` : base);
    } catch (e) {
      toast.error("Hatırlatma kurulamadı");
    }
  };

  const clearReminder = async (id) => {
    try {
      await tasksApi.setReminder(id, null);
      load();
      toast.success("Hatırlatma iptal edildi");
    } catch (e) {
      toast.error("İptal edilemedi");
    }
  };

  const setSubtasks = async (id, subtasks) => {
    // Faz 9 CP4.34 — task-scoped rollback. Previously a failed setSubtasks
    // called `load()` which reset the ENTIRE task list, wiping any other
    // concurrent optimistic updates (drag order, status flips, etc.). Now
    // we snapshot only the affected task's previous subtasks and revert
    // just that field on failure.
    let prevSubtasks;
    setTasks((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      if (prevSubtasks === undefined) prevSubtasks = t.subtasks;
      return { ...t, subtasks };
    }));
    try {
      await tasksApi.setSubtasks(id, subtasks);
    } catch (e) {
      toast.error("Alt görev kaydedilemedi");
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, subtasks: prevSubtasks } : t)));
    }
  };

  const handleReorderTasks = async (nextTasks) => {
    // Faz 9 CP8.3 — CRITICAL FIX: previously `setTasks(nextTasks)` alone
    // was insufficient because the derived `sorted` memo re-sorts by each
    // task's `sort_order` (desc). Since the dragged tasks still carried
    // their OLD sort_order values, the sort silently reverted the user's
    // drag order on the very next render — making reorder appear broken
    // ("doesn't stick"). We now stamp each row with the NEW sort_order
    // locally (matching the backend formula `n - idx`) so the derived
    // `sorted` view stays in sync until the backend confirms.
    const n = nextTasks.length;
    const now = new Date().toISOString();
    const stamped = nextTasks.map((t, idx) => ({
      ...t,
      sort_order: n - idx,
      updated_at: now,
    }));
    setTasks(stamped);
    try {
      await tasksApi.reorder(nextTasks.map((t) => t.id));
    } catch (e) {
      toast.error("Sıra kaydedilemedi");
      load();
    }
  };

  // Faz 9 CP4.31 — When a category filter is active we can still drag-reorder
  // within the filtered subset. This helper preserves the positions of
  // non-visible tasks — only the filtered rows shuffle among their original
  // slots in the master list. Backend then persists the full new order.
  //
  // Faz 9 CP8.2 — CRITICAL FIX: we index against `sorted` (the frontend's
  // canonical UI order), NOT `tasks` (raw API response). Reorder.Group is
  // fed with `filtered = sorted.filter(...)`, so nextFiltered maps back to
  // positions in `sorted`. Using `tasks` here made the mapping drift when
  // the backend's created_at fallback disagreed with the frontend's
  // status/due-date score — reorder appeared to "not stick" for users
  // with a mix of ordered + unordered tasks under AKTİF/GEÇTİ filters.
  const handleReorderFiltered = async (nextFiltered) => {
    const visibleIds = new Set(nextFiltered.map((t) => t.id));
    const visiblePositions = [];
    sorted.forEach((t, idx) => { if (visibleIds.has(t.id)) visiblePositions.push(idx); });
    if (visiblePositions.length !== nextFiltered.length) {
      // Safety net — fallback to a full reload if something desyncs.
      load();
      return;
    }
    const next = [...sorted];
    visiblePositions.forEach((pos, i) => { next[pos] = nextFiltered[i]; });
    await handleReorderTasks(next);
  };

  const sorted = showArchived
    ? [...tasks].sort((a, b) => {
        // Arşiv sıralaması: tarih (silme/iptal/arşiv zamanı) veya A-Z.
        if (archiveSort === "az") return (a.title || "").localeCompare(b.title || "", "tr");
        const dt = (t) => t.deleted_at || t.cancelled_at || t.archived_at || t.updated_at || "";
        const da = dt(a), db2 = dt(b);
        if (da === db2) return 0;
        return archiveSort === "old" ? (da < db2 ? -1 : 1) : (da > db2 ? -1 : 1);
      })
    : [...tasks].sort((a, b) => {
    // Faz 9 CP4.32 — user drag order wins. Backend's /tasks/reorder assigns
    // `sort_order = n - idx` (desc = first). Any task with a persisted
    // sort_order sorts among itself by that value; the remainder falls back
    // to the legacy status/due-date scoring so brand-new tasks still land in
    // a sensible spot.
    const ao = a.sort_order;
    const bo = b.sort_order;
    if (ao != null && bo != null) {
      if (ao !== bo) return bo - ao; // desc
    } else if (ao != null) return -1;
    else if (bo != null) return 1;
    const scoreOf = (t) => {
      if (isOverdue(t)) return 0;
      if (t.status === "pending") return 1;
      if (t.status === "paused") return 2;
      return 3;
    };
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sa !== sb) return sa - sb;
    if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });

  // "Bu görevden çıkanlar" — promote ile bu görevden türeyen görevleri
  // yüklü listeden (ekstra istek yok) ana görev id'sine göre grupla.
  // Her çocuğa gerçek durum kovası (__bucket) eklenir: gecti(kırmızı)/
  // bitti(yeşil)/bekliyor(sarı)/aktif(cyan) — overdue hesaplanır.
  const promotedChildrenMap = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      const pid = t.promoted_from_task_id;
      if (!pid) continue;
      const bucket = isOverdue(t)
        ? "gecti"
        : t.status === "done"
        ? "bitti"
        : t.status === "paused"
        ? "bekliyor"
        : "aktif";
      (map[pid] = map[pid] || []).push({ ...t, __bucket: bucket });
    }
    return map;
  }, [tasks]);

  const bucketOf = (t) => {
    if (isOverdue(t)) return "gecti";
    if (t.status === "done") return "bitti";
    if (t.status === "paused") return "bekliyor";
    return "aktif";
  };

  // ================= GÖREV BAĞLAMA (Task Groups) =================
  const groupById = useMemo(
    () => Object.fromEntries((groups || []).map((g) => [g.id, g])),
    [groups]
  );
  // Numaralandırma (done olmayanlar sıralı) — sabitlenmiş numaralar atlanır.
  // Sabit görev kendi pinned_number'ını gösterir; dinamik görevler bu
  // numaraları rezerve kabul edip atlar (çakışma olmaz).
  const numById = useMemo(() => {
    const m = {};
    const reserved = new Set();
    for (const t of sorted) {
      if (t.status !== "done" && t.number_pinned && t.pinned_number != null) {
        reserved.add(t.pinned_number);
      }
    }
    let c = 0;
    for (const t of sorted) {
      if (t.status === "done") { m[t.id] = null; continue; }
      if (t.number_pinned && t.pinned_number != null) { m[t.id] = t.pinned_number; continue; }
      c += 1;
      while (reserved.has(c)) c += 1;
      m[t.id] = c;
    }
    return m;
  }, [sorted]);
  // Bağlı görevleri tek blok haline getir; sıra global sort_order'dan gelir.
  const groupRows = useMemo(() => {
    const rows = [];
    const byGid = {};
    for (const t of sorted) {
      const gid = t.group_id && groupById[t.group_id] ? t.group_id : null;
      if (gid) {
        let row = byGid[gid];
        if (!row) {
          row = { key: `g:${gid}`, type: "group", group: groupById[gid], tasks: [] };
          byGid[gid] = row;
          rows.push(row);
        }
        row.tasks.push(t);
      } else {
        rows.push({ key: `t:${t.id}`, type: "task", task: t });
      }
    }
    // Tek üyeli grup kalırsa (veri drift) blok gösterme, tekil satıra indir.
    return rows.map((r) =>
      r.type === "group" && r.tasks.length < 2 && r.tasks[0]
        ? { key: `t:${r.tasks[0].id}`, type: "task", task: r.tasks[0] }
        : r
    );
  }, [sorted, groupById]);
  const rowKeys = useMemo(() => groupRows.map((r) => r.key), [groupRows]);
  const rowByKey = useMemo(
    () => Object.fromEntries(groupRows.map((r) => [r.key, r])),
    [groupRows]
  );

  const cardPropsFor = (t) => ({
    task: t,
    displayNumber: numById[t.id],
    collapsed: collapsedIds.has(t.id),
    onToggleCollapse: () => toggleCollapse(t.id),
    onToggleDetach: () => toggleDetach(t.id),
    onStatusChange: (status) => setStatus(t.id, status),
    onDelete: () => removeTask(t.id),
    onEdit: () => setEditing(t),
    onCopy: () => setCopyModalTask(t),
    onSetReminder: (iso, opts) => setReminder(t.id, iso, opts),
    onClearReminder: () => clearReminder(t.id),
    onSetSubtasks: (subs) => setSubtasks(t.id, subs),
    onSetArchived: (v) => setArchived(t.id, v),
    onReassign: (uid) => reassignTask(t.id, uid),
    onTransferCompany: (cid) => transferTaskToCompany(t.id, cid),
    onPromoteSubtask: (subId) => promoteSubtask(t.id, subId),
    onDemoteToSubtask: () => demoteToSubtask(t.id),
    onDemoteChild: (childId) => demoteToSubtask(childId),
    onPinNumber: (number) => setTaskPin(t.id, true, number),
    onUnpinNumber: () => setTaskPin(t.id, false, null),
    promotedChildren: promotedChildrenMap[t.id] || [],
    highlight: searchQuery,
    isTeamView,
    isHighlighted: highlightedTaskId === t.id,
    categoryName: categories.find((c) => c.id === t.category_id)?.name || null,
    categories,
    onSetCategory: (cid) => setTaskCategory(t.id, cid),
    reminderConfig,
    onSetReminderDays: (d) => setTaskReminderDays(t.id, d),
    onSetReminderDisabled: (v) => setTaskReminderDisabled(t.id, v),
    onToggleDigestMute: (v) => setTaskDigestMuted(t.id, v),
    currentUser: user,
    onLockChanged: () => { load(); onDataChanged?.(); },
    onLinkTasks: () => setLinkModal({ mode: "create", taskId: t.id }),
    onEditGroup: () => t.group_id && setLinkModal({ mode: "edit", groupId: t.group_id }),
    onRemoveFromGroup: () => t.group_id && removeFromGroup(t.group_id, t.id),
    // Görev → İş Kolu sürükle-bırak (Reorder.Item wrapper tarafından kullanılır).
    onDragToCategory: handleTaskDragToCategory,
    onDropToCategory: (e, info) => handleTaskDropCategory(t, e, info),
    // Arşiv grupları — İptal Et / Geri Yükle / Kalıcı Sil.
    archiveGroup: showArchived ? archiveGroup : null,
    canPermanentDelete: !!caps.perm_delete,
    archiveSettings: { trash_autoclean_enabled: taskSettings.trash_autoclean_enabled, trash_autoclean_days: taskSettings.trash_autoclean_days },
    onCancel: () => cancelTask(t.id),
    onUncancel: () => uncancelTask(t.id),
    onRestore: () => restoreTask(t.id),
    onPermanentDelete: () => permanentDeleteTask(t.id),
  });

  const renderMember = (t) => {
    if (detachedIds.has(t.id)) {
      return (
        <ReorderablePlaceholder
          key={t.id}
          task={t}
          displayNumber={numById[t.id]}
          onDock={() => toggleDetach(t.id)}
        />
      );
    }
    return <ReorderableTaskCard key={t.id} {...cardPropsFor(t)} />;
  };

  const handleReorderRows = async (nextKeys) => {
    const ids = [];
    for (const k of nextKeys) {
      const r = rowByKey[k];
      if (!r) continue;
      if (r.type === "group") ids.push(...r.tasks.map((t) => t.id));
      else ids.push(r.task.id);
    }
    const byId = Object.fromEntries(sorted.map((t) => [t.id, t]));
    const next = ids.map((id) => byId[id]).filter(Boolean);
    if (next.length === sorted.length) await handleReorderTasks(next);
  };

  const handleReorderGroup = async (gid, nextGroupTasks) => {
    const ids = [];
    for (const r of groupRows) {
      if (r.type === "group" && r.group.id === gid) ids.push(...nextGroupTasks.map((t) => t.id));
      else if (r.type === "group") ids.push(...r.tasks.map((t) => t.id));
      else ids.push(r.task.id);
    }
    const byId = Object.fromEntries(sorted.map((t) => [t.id, t]));
    const next = ids.map((id) => byId[id]).filter(Boolean);
    if (next.length === sorted.length) await handleReorderTasks(next);
  };

  const removeFromGroup = async (gid, tid) => {
    try {
      await tasksApi.removeGroupMember(gid, tid);
      toast.success("Görev gruptan çıkarıldı");
      load();
      onDataChanged?.();
    } catch (e) {
      console.error("[TasksPanel] gruptan çıkarma hatası:", e);
      toast.error("Çıkarılamadı");
    }
  };

  const dissolveGroup = async (group) => {
    const ok = await confirmDialog({
      title: "BAĞLANTIYI ÇÖZ",
      message: `"${group.name || "Bağlı Görevler"}" grubunun bağlantısını çözmek istiyor musunuz?\nGörevler silinmez, sadece bağlantıları kaldırılır.`,
      confirmText: "ÇÖZ",
      danger: true,
    });
    if (!ok) return;
    try {
      await tasksApi.deleteGroup(group.id);
      toast.success("Grup bağlantısı çözüldü");
      load();
      onDataChanged?.();
    } catch (e) {
      console.error("[TasksPanel] grup çözme hatası:", e);
      toast.error("İşlem başarısız");
    }
  };

  // Modal aday görevleri + ön seçim.
  const linkCandidates = useMemo(() => {
    if (!linkModal) return { candidates: [], preselected: [], group: null };
    const ungrouped = sorted.filter((t) => !t.group_id && !t.archived);
    if (linkModal.mode === "edit" && linkModal.groupId) {
      const members = sorted.filter((t) => t.group_id === linkModal.groupId);
      return {
        candidates: [...members, ...ungrouped],
        preselected: members.map((t) => t.id),
        group: groupById[linkModal.groupId] || null,
      };
    }
    return {
      candidates: ungrouped,
      preselected: linkModal.taskId ? [linkModal.taskId] : [],
      group: null,
    };
  }, [linkModal, sorted, groupById]);
  // ================= /GÖREV BAĞLAMA =================

  const filtered = (() => {
    // Arşiv görünümünde sidebar'daki iş kolu (kategori) çipleri ve durum filtre
    // çipleri GİZLİDİR (bkz. !showArchived koşulları). Ancak categoryFilter /
    // filters state'i aktif görünümden kalabilir; bunlar arşive uygulanırsa
    // arşiv araması "seçili kola ait olmayan" görevleri bulamaz (bug). Arşivin
    // kendi grup çipleri + sıralama + araması olduğu için burada bu iki filtreyi
    // yok sayıyoruz — arama tüm arşiv grubunu kapsar.
    let list = (showArchived || filters.length === 0)
      ? sorted
      : sorted.filter((t) => filters.includes(bucketOf(t)));
    // Faz 8 CP4 · category filter chip. Hiyerarşi: bir ana iş kolu seçilince
    // o kolun + TÜM alt kollarının görevleri gösterilir. (Arşivde uygulanmaz.)
    if (!showArchived) {
      if (categoryFilter === "__none__") {
        list = list.filter((t) => !t.category_id);
      } else if (categoryFilter) {
        const ids = getDescendantIds(categoryFilter, categories);
        list = list.filter((t) => t.category_id && ids.has(t.category_id));
      }
    }
    // Personel Görevleri — filter to a single person, or show NOTHING when the
    // "Tümü" tick is cleared (personFilter === "__none__").
    if (taskScope === "team") {
      if (personFilter === "__none__") {
        list = [];
      } else if (personFilter) {
        list = list.filter((t) => t.user_id === personFilter);
      }
    }
    // Görev arama — başlık/açıklama/kişi/şirket/iş kolu adı/alt görev metni.
    const q = searchQuery.trim().toLocaleLowerCase("tr");
    if (q) {
      list = list.filter((t) => {
        const catName = categories.find((c) => c.id === t.category_id)?.name || "";
        const hay = [
          t.title,
          t.description,
          t.assignee_name,
          t.company_name,
          catName,
          ...(Array.isArray(t.subtasks) ? t.subtasks.map((s) => s?.text) : []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("tr");
        return hay.includes(q);
      });
    }
    return list;
  })();

  // Personel Görevleri — distinct owners present in the loaded team tasks, so
  // we can render person filter chips with counts. Names resolved via
  // teamMembers (id → username), falling back to the task's assignee_name.
  const teamOwners = (() => {
    if (taskScope !== "team") return [];
    const nameById = {};
    for (const m of teamMembers) nameById[m.id] = m.username;
    const byId = {};
    for (const t of tasks) {
      const oid = t.user_id;
      if (!oid) continue;
      if (!byId[oid]) {
        byId[oid] = {
          id: oid,
          name: nameById[oid] || t.assignee_name || "Kullanıcı",
          count: 0,
          overdue: 0,
          active: 0,
          done: 0,
        };
      }
      const o = byId[oid];
      o.count++;
      if (t.status === "done") o.done++;
      else if (isOverdue(t)) o.overdue++;
      else if (t.status === "pending") o.active++;
    }
    // Sort: people with overdue tasks first (most behind on top), then by load.
    return Object.values(byId).sort(
      (a, b) => b.overdue - a.overdue || b.count - a.count
    );
  })();

  // Personel Görevleri — aggregate summary across all staff (header strip).
  const teamSummary = (() => {
    if (taskScope !== "team") return null;
    return teamOwners.reduce(
      (acc, o) => {
        acc.overdue += o.overdue;
        acc.active += o.active;
        acc.done += o.done;
        acc.people += 1;
        return acc;
      },
      { overdue: 0, active: 0, done: 0, people: 0 }
    );
  })();

  // Per-category progress. Hiyerarşi: bir kategorinin sayısı kendisi + tüm
  // alt kollarındaki görevleri kapsar (ana kol toplamı gösterir).
  // {catId: {total, done}} + __none__ + __all__.
  const categoryCounts = (() => {
    if (!categories.length) return null;
    const dt = {};
    const dd = {};
    for (const c of categories) { dt[c.id] = 0; dd[c.id] = 0; }
    let noneT = 0;
    let noneD = 0;
    let allD = 0;
    for (const t of sorted) {
      const isDone = t.status === "done";
      if (isDone) allD++;
      if (t.category_id && dt[t.category_id] !== undefined) {
        dt[t.category_id]++;
        if (isDone) dd[t.category_id]++;
      } else if (!t.category_id) {
        noneT++;
        if (isDone) noneD++;
      }
    }
    const m = {
      __none__: { total: noneT, done: noneD },
      __all__: { total: sorted.length, done: allD },
    };
    for (const c of categories) {
      let total = 0;
      let done = 0;
      for (const id of getDescendantIds(c.id, categories)) {
        total += dt[id] || 0;
        done += dd[id] || 0;
      }
      m[c.id] = { total, done };
    }
    return m;
  })();

  // Stat cards reflect the currently-scoped set (independent of the status
  // filter chips): in team scope they follow the selected person — or empty
  // when "Tümü" is unchecked (personFilter === "__none__").
  const statsBase = (() => {
    if (taskScope !== "team") return tasks;
    if (personFilter === "__none__") return [];
    if (personFilter) return tasks.filter((t) => t.user_id === personFilter);
    return tasks;
  })();

  const stats = {
    pending: statsBase.filter((t) => t.status === "pending" && !isOverdue(t)).length,
    done: statsBase.filter((t) => t.status === "done").length,
    paused: statsBase.filter((t) => t.status === "paused").length,
    overdue: statsBase.filter((t) => isOverdue(t)).length,
  };

  // Task 1 — "Tümünü Küçült / Büyüt" için o an görünen görev id'leri.
  const searchActive = !!searchQuery.trim();
  const visibleTaskList = taskScope === "team"
    ? filtered
    : ((showArchived || (filters.length === 0 && !categoryFilter)) && !searchActive ? sorted : filtered);
  const visibleTaskIds = visibleTaskList.map((t) => t.id);

  // Toplu "iş kolu ağaçlarını aç/kapat" — kartlara CustomEvent yayar; her kart
  // kendi durumunu ayarlar + KİŞİYE ÖZEL kalıcı olarak yazar (bozmadan).
  const [allTreesOpen, setAllTreesOpen] = useState(false);
  const hasHierCats = useMemo(() => categories.some((c) => c.parent_id), [categories]);
  // Görünen görevlerden HİYERARŞİK iş kolu olanların id'leri (ağaç açılabilir).
  const visibleHierTaskIds = useMemo(
    () => visibleTaskList
      .filter((t) => t.category_id && getCategoryPath(t.category_id, categories).length > 1)
      .map((t) => t.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTaskList, categories]
  );
  // Buton etiketi/gerçek durum senkronu — kalıcı set'ten türetilir (reload
  // sonrası doğru etiket + tek tıkla doğru aksiyon).
  useEffect(() => {
    const sync = () => {
      const set = getCatTreeExpandedSet(user?.id);
      setAllTreesOpen(visibleHierTaskIds.length > 0 && visibleHierTaskIds.every((id) => set.has(id)));
    };
    sync();
    window.addEventListener("sertex:cattree-changed", sync);
    return () => window.removeEventListener("sertex:cattree-changed", sync);
  }, [visibleHierTaskIds, user?.id]);
  const toggleAllCatTrees = () => {
    // Gerçek durumu kalıcı set'ten oku; tersini uygula (reload sonrası no-op yok).
    const set = getCatTreeExpandedSet(user?.id);
    const allOpen = visibleHierTaskIds.length > 0 && visibleHierTaskIds.every((id) => set.has(id));
    const next = !allOpen;
    window.dispatchEvent(new CustomEvent("sertex:cattree-set-all", { detail: { expanded: next } }));
    setAllTreesOpen(next);
  };

  // ---- Sidebar İŞ KOLU FİLTRE AĞACI (tıklanabilir, açılır-kapanır liste) ----
  // Ağaç, orderedCategories sırasını korur (kardeş sürükle-sırala için).
  // Ata görünmüyorsa (my_tasks kapsamı) o düğüm kök gibi gösterilir (orphan).
  const catForest = useMemo(() => {
    const visibleIds = new Set(orderedCategories.map((c) => c.id));
    const childrenOf = (id) => orderedCategories.filter((c) => (c.parent_id || null) === id);
    const build = (node) => ({ ...node, children: childrenOf(node.id).map(build) });
    return orderedCategories
      .filter((c) => !c.parent_id || !visibleIds.has(c.parent_id))
      .map(build);
  }, [orderedCategories]);
  const [filterExpanded, setFilterExpanded] = useState(() => getCatFilterExpandedSet(user?.id));
  useEffect(() => {
    setFilterExpanded(getCatFilterExpandedSet(user?.id));
  }, [user?.id]);
  const toggleFilterNode = (id) => {
    const isOpen = filterExpanded.has(id);
    const next = new Set(filterExpanded);
    if (isOpen) next.delete(id);
    else next.add(id);
    setFilterExpanded(next);
    setCatFilterExpanded(user?.id, id, !isOpen);
  };
  // Filtre ağacında chevron gösteren (çocuğu olan, görünür) düğüm id'leri.
  const expandableFilterIds = useMemo(() => {
    const vis = new Set(orderedCategories.map((c) => c.id));
    const parents = new Set(
      orderedCategories.map((c) => c.parent_id).filter((pid) => pid && vis.has(pid))
    );
    return Array.from(parents);
  }, [orderedCategories]);
  const allFilterOpen =
    expandableFilterIds.length > 0 && expandableFilterIds.every((id) => filterExpanded.has(id));
  const toggleAllFilterNodes = () => {
    const next = allFilterOpen ? new Set() : new Set(expandableFilterIds);
    setFilterExpanded(next);
    saveCatFilterExpandedSet(user?.id, Array.from(next));
  };
  const renderFilterNode = (node, depth) => {
    const hasKids = node.children && node.children.length > 0;
    const isOpen = filterExpanded.has(node.id);
    const p = categoryCounts && categoryCounts[node.id];
    const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
    const isActive = categoryFilter === node.id;
    return (
      <div key={node.id}>
        <div
          draggable
          data-cat-drop={node.id}
          onDragStart={(e) => { setDragCatId(node.id); try { e.dataTransfer.effectAllowed = "move"; } catch (err) { /* ignore */ } }}
          onDragOver={(e) => { e.preventDefault(); if (dragOverCatId !== node.id) setDragOverCatId(node.id); }}
          onDrop={(e) => { e.preventDefault(); handleCatDrop(node.id); }}
          onDragEnd={() => { setDragCatId(null); setDragOverCatId(null); }}
          onContextMenu={(e) => {
            if (!clipboard?.sourceId) return; // pano boşsa tarayıcı menüsü açılsın
            e.preventDefault();
            setPasteMenu({ x: e.clientX, y: e.clientY, categoryId: node.id, categoryName: node.name });
          }}
          data-testid={`category-node-${node.name}`}
          style={{ marginLeft: depth * 14 }}
          title="Sürükleyerek aynı seviyede sırala · görevi buraya bırakınca bu iş koluna taşınır"
          className={`group flex items-center rounded border transition-colors cursor-grab active:cursor-grabbing ${
            dragCatId === node.id ? "opacity-40" : ""
          } ${
            (dragOverCatId === node.id && dragCatId && dragCatId !== node.id) || taskDragOverCatId === node.id
              ? "ring-2 ring-sertex-cyan/80 bg-sertex-cyan/10"
              : ""
          } ${isActive ? "border-sertex-cyan bg-sertex-cyan/10" : "border-sertex-cyan/25"}`}
        >
          {hasKids ? (
            <button
              onClick={() => toggleFilterNode(node.id)}
              data-testid={`category-node-toggle-${node.name}`}
              title={isOpen ? "Alt kolları gizle" : "Alt kolları göster"}
              className="pl-1 py-1 text-sertex-textMuted hover:text-sertex-cyan shrink-0"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <GripVertical className="h-2.5 w-2.5 text-sertex-textMuted/50 shrink-0" />
          <button
            onClick={() => setCategoryFilter(node.id)}
            data-testid={`category-chip-${node.name}`}
            className={`flex-1 min-w-0 pl-1 pr-2 py-1 hud-text flex items-center gap-1 text-left ${
              isActive ? "text-sertex-cyan" : "text-sertex-textMuted hover:text-sertex-cyan"
            }`}
          >
            <Tag className="h-2.5 w-2.5 shrink-0" />
            {node.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: node.color }} />}
            <span className="truncate">{node.name}</span>
            {p && (
              <span
                className="inline-flex items-center gap-1 opacity-70 shrink-0 ml-auto"
                data-testid={`category-chip-progress-${node.name}`}
                title={`${p.done}/${p.total} tamamlandı · %${pct}`}
              >
                ({p.done}/{p.total})
                <span className="inline-block w-6 h-1 rounded-full bg-sertex-cyan/15 overflow-hidden align-middle">
                  <span className="block h-full bg-emerald-400/80" style={{ width: `${pct}%` }} />
                </span>
              </span>
            )}
          </button>
          {!detached && (
            <button
              onClick={() => openDetachedPanel({ category: node.id, categoryName: node.name })}
              data-testid={`category-detach-${node.name}`}
              title={`"${node.name}" iş kolunu ayrı pencerede aç`}
              className="px-1.5 self-stretch flex items-center border-l border-sertex-cyan/20 text-sertex-textMuted hover:text-sertex-cyan transition-colors shrink-0"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        {hasKids && isOpen && node.children.map((ch) => renderFilterNode(ch, depth + 1))}
      </div>
    );
  };


  // GÖREV BAĞLAMA — Personel Görevleri (team) için grup-farkındalıklı satırlar
  // (statik, sürükleme yok — bu görünüm zaten salt-okunur).
  const teamRows = useMemo(() => {
    const rows = [];
    const byGid = {};
    for (const t of filtered) {
      const gid = t.group_id && groupById[t.group_id] ? t.group_id : null;
      if (gid) {
        let row = byGid[gid];
        if (!row) {
          row = { key: `g:${gid}`, type: "group", group: groupById[gid], tasks: [] };
          byGid[gid] = row;
          rows.push(row);
        }
        row.tasks.push(t);
      } else {
        rows.push({ key: `t:${t.id}`, type: "task", task: t });
      }
    }
    return rows.map((r) =>
      r.type === "group" && r.tasks.length < 2 && r.tasks[0]
        ? { key: `t:${r.tasks[0].id}`, type: "task", task: r.tasks[0] }
        : r
    );
  }, [filtered, groupById]);
  const renderStaticMember = (t) =>
    detachedIds.has(t.id) ? (
      <DetachedPlaceholderCard
        key={t.id}
        task={t}
        displayNumber={numById[t.id]}
        onDock={() => toggleDetach(t.id)}
      />
    ) : (
      <TaskCard
        key={t.id}
        {...cardPropsFor(t)}
        onNudge={() => nudgeTask(t.id, t)}
        nudgeCount={nudgeCounts[t.id] || 0}
      />
    );
  const allVisibleCollapsed =
    visibleTaskIds.length > 0 && visibleTaskIds.every((id) => collapsedIds.has(id));
  const toggleAllCollapsed = () => setAllCollapsed(visibleTaskIds, !allVisibleCollapsed);

  const [showExportSelect, setShowExportSelect] = useState(false);
  const bulkExport = async (kind) => {
    const list = visibleTaskList;
    if (!list.length) {
      toast.error("Dışa aktarılacak görev yok");
      return;
    }
    const catMap = Object.fromEntries((categories || []).map((c) => [c.id, c.name]));
    const heading = `Görev Listesi (${list.length})`;
    try {
      if (kind === "print") printTasks(list, catMap, { heading });
      else if (kind === "excel") exportTasksExcel(list, catMap);
      else if (kind === "word") await exportTasksWord(list, catMap, { heading });
      toast.success(`${list.length} görev dışa aktarıldı`);
    } catch (e) {
      console.error("[TasksPanel] toplu dışa aktarma hatası:", e);
      toast.error(
        e?.message === "popup-blocked"
          ? "Yazdırma penceresi engellendi — tarayıcıda açılır pencerelere izin verin"
          : "Dışa aktarılamadı"
      );
    }
  };

  return (
    <div className="space-y-3" data-testid="tasks-panel">
      {!detached && (
        <div className="flex justify-end -mb-1" data-testid="tasks-panel-detach-bar">
          <button
            onClick={() =>
              openDetachedPanel({
                category:
                  categoryFilter && categoryFilter !== "__none__" ? categoryFilter : null,
                categoryName:
                  categoryFilter && categoryFilter !== "__none__"
                    ? categories.find((c) => c.id === categoryFilter)?.name || "İŞ KOLU"
                    : "GÖREVLER",
              })
            }
            data-testid="detach-panel-btn"
            title="Görevler panelini (veya seçili iş kolunu) ayrı pencerede aç"
            className="p-1 px-2 rounded border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60 transition-colors flex items-center gap-1 hud-text"
          >
            <ExternalLink className="h-3 w-3" /> DIŞARI TAŞI
          </button>
        </div>
      )}
      {/* Görevler sekmesi — sadece admin/müdür (isTeamView) için */}
      {isTeamView && (
        <div className="space-y-2" data-testid="task-scope-tabs">
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg border border-sertex-cyan/25 bg-sertex-surface/40">
            {[
              { key: "mine", label: "Benim Görevlerim", icon: User },
              { key: "team", label: "Personel Görevleri", icon: Users },
            ].map((tab) => {
              const active = taskScope === tab.key;
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    setTaskScope(tab.key);
                    setShowArchived(false);
                    setShowAddForm(false);
                  }}
                  data-testid={`task-scope-${tab.key}`}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-md hud-text transition-colors ${
                    active
                      ? "bg-sertex-cyan/20 text-sertex-cyan border border-sertex-cyan/50"
                      : "text-sertex-textMuted hover:text-sertex-text"
                  }`}
                >
                  <TabIcon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {taskScope === "team" && (
            <div className="space-y-2">
              {teamSummary && teamSummary.people > 0 && (
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 hud-text px-1"
                  data-testid="team-summary-strip"
                >
                  <span className="text-sertex-textMuted">
                    <Users className="inline h-3 w-3 mr-1 -mt-0.5" />
                    {teamSummary.people} personel
                  </span>
                  <span className={teamSummary.overdue > 0 ? "text-rose-300" : "text-sertex-textMuted/60"}>
                    <AlertTriangle className="inline h-3 w-3 mr-1 -mt-0.5" />
                    {teamSummary.overdue} geciken
                  </span>
                  <span className="text-sertex-cyan">{teamSummary.active} aktif</span>
                  <span className="text-emerald-300/90">{teamSummary.done} bitti</span>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5" data-testid="task-person-filter-wrap">
                <div className="w-full">
                  <PersonFilterSelect
                    owners={teamOwners}
                    value={personFilter}
                    onChange={setPersonFilter}
                    totalCount={tasks.length}
                  />
                </div>
                {teamOwners.length === 0 && (
                  <span className="hud-text text-sertex-textMuted px-1 py-1">
                    Personelinize ait görev bulunmuyor.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {!showArchived && (() => {
        const STAT_META = {
          aktif: { key: "aktif", label: "AKTİF", value: stats.pending, color: "text-sertex-cyan", ring: "ring-sertex-cyan" },
          gecti: { key: "gecti", label: "GEÇTİ", value: stats.overdue, color: "text-rose-300", ring: "ring-rose-400" },
          bekliyor: { key: "bekliyor", label: "BEKLİYOR", value: stats.paused, color: "text-yellow-300", ring: "ring-yellow-400" },
          bitti: { key: "bitti", label: "BİTTİ", value: stats.done, color: "text-emerald-300", ring: "ring-emerald-400" },
        };
        return (
          <Reorder.Group
            axis="x"
            values={filterOrder}
            onReorder={persistFilterOrder}
            as="div"
            className="grid grid-cols-4 gap-1.5"
            data-testid="task-stat-reorder-group"
          >
            {filterOrder.map((key) => {
              const s = STAT_META[key];
              if (!s) return null;
              return (
                <DraggableStat
                  key={s.key}
                  stat={s}
                  active={filters.includes(s.key)}
                  onToggle={() => toggleFilter(s.key)}
                />
              );
            })}
          </Reorder.Group>
        );
      })()}
      {showArchived && (() => {
        const ARCH_META = [
          { key: "done", label: "BİTMİŞ", value: archiveCounts.done, color: "text-emerald-300", ring: "ring-emerald-400", border: "border-emerald-400" },
          { key: "cancelled", label: "İPTAL", value: archiveCounts.cancelled, color: "text-amber-300", ring: "ring-amber-400", border: "border-amber-400" },
          { key: "deleted", label: "SİLİNMİŞ", value: archiveCounts.deleted, color: "text-rose-300", ring: "ring-rose-400", border: "border-rose-400" },
        ];
        return (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-3 gap-1.5" data-testid="archive-group-chips">
              {ARCH_META.map((a) => {
                const active = archiveGroup === a.key;
                return (
                  <button
                    key={a.key}
                    onClick={() => setArchiveGroup(a.key)}
                    data-testid={`archive-group-${a.key}`}
                    className={`glass-panel rounded-md px-2 py-1.5 flex flex-col items-center justify-center transition-all border ${
                      active ? `${a.border} ring-1 ${a.ring} bg-white/5` : "border-white/10 hover:border-white/25"
                    }`}
                  >
                    <span className={`text-lg font-bold leading-none ${a.color}`}>{a.value}</span>
                    <span className="hud-text text-[10px] mt-0.5 text-sertex-textMuted">{a.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1" data-testid="archive-sort">
                {[
                  { k: "new", label: "Yeni" },
                  { k: "old", label: "Eski" },
                  { k: "az", label: "A-Z" },
                ].map((s) => (
                  <button
                    key={s.k}
                    onClick={() => setArchiveSort(s.k)}
                    data-testid={`archive-sort-${s.k}`}
                    className={`px-2 py-0.5 rounded border text-[10px] font-mono hud-text transition-colors ${
                      archiveSort === s.k
                        ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                        : "border-white/10 text-sertex-textMuted hover:border-white/25"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {archiveGroup === "deleted" && caps.empty_trash && archiveCounts.deleted > 0 && (
                <button
                  onClick={emptyTrash}
                  data-testid="archive-empty-trash"
                  className="flex items-center gap-1 px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-400/10 hud-text transition-colors"
                >
                  <Trash2 className="h-3 w-3" /> ÇÖP KUTUSUNU BOŞALT
                </button>
              )}
            </div>
          </div>
        );
      })()}
      {!showArchived && filters.length > 0 && (
        <div className="flex items-center justify-between hud-text px-1">
          <span className="text-sertex-textMuted">
            FİLTRE: <span className="text-sertex-cyan">{filters.map((f) => f.toUpperCase()).join(" · ")}</span>
          </span>
          <button
            onClick={clearFilters}
            data-testid="task-clear-filters"
            className="text-sertex-cyan hover:text-sertex-text underline decoration-dotted"
          >
            Temizle
          </button>
        </div>
      )}

      {/* Görev arama — binlerce görev içinde hızlı bulma */}
      <div className="relative" data-testid="task-search-bar">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sertex-textMuted pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Görev ara… (başlık, açıklama, kişi, şirket, iş kolu)"
          data-testid="task-search-input"
          className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded-md pl-8 pr-8 py-1.5 text-xs font-mono text-sertex-text placeholder:text-sertex-textMuted/60 focus:border-sertex-cyan outline-none transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            data-testid="task-search-clear"
            title="Aramayı temizle"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-sertex-textMuted hover:text-sertex-cyan transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {searchActive && (
        <div className="hud-text text-[10px] text-sertex-cyan/70 -mt-1 px-1" data-testid="task-search-count">
          {filtered.length} sonuç bulundu
        </div>
      )}
      {searchActive && !showArchived && archiveSearchResults.length > 0 && (
        <div className="glass-panel rounded-md border border-white/10 p-2 space-y-1" data-testid="archive-search-results">
          <div className="hud-text text-[10px] text-sertex-textMuted flex items-center gap-1.5">
            <Archive className="h-3 w-3" /> ARŞİVDE BULUNANLAR ({archiveSearchResults.length})
          </div>
          {archiveSearchResults.slice(0, 20).map((t) => {
            const g = t.deleted ? "deleted" : t.cancelled ? "cancelled" : "done";
            const meta = { done: { label: "BİTMİŞ", cls: "text-emerald-300 border-emerald-400/40" }, cancelled: { label: "İPTAL", cls: "text-amber-300 border-amber-400/40" }, deleted: { label: "SİLİNMİŞ", cls: "text-rose-300 border-rose-400/40" } }[g];
            return (
              <button
                key={t.id}
                onClick={() => { setShowArchived(true); setArchiveGroup(g); }}
                data-testid={`archive-search-row-${t.id}`}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 transition-colors text-left"
              >
                <span className={`shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border ${meta.cls}`}>{meta.label}</span>
                <span className="flex-1 min-w-0 truncate text-xs font-mono text-sertex-text">
                  {t.title}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Şablondan Başla çubuğu + Şablon Kütüphanesi girişi */}
      {!showArchived && (
        <TemplateBar
          refreshKey={templatesRefresh}
          onUse={handleUseTemplate}
          onManage={() => setTemplatesOpen(true)}
        />
      )}

      {/* Görev Kopyalama panosu — dolu iken göster (iş koluna sağ tık → Yapıştır) */}
      {clipboard?.sourceId && !showArchived && (
        <div
          data-testid="task-clipboard-bar"
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-sertex-cyan/40 bg-sertex-cyan/5"
        >
          <ClipboardPaste className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
          <span className="hud-text text-sertex-cyan truncate flex-1">
            Kopyalandı: {clipboard.title}
          </span>
          <span className="hud-text text-sertex-textMuted/70 text-[10px] hidden md:inline shrink-0">
            iş koluna sağ tıkla → Yapıştır
          </span>
          <button
            onClick={() => clearTaskClipboard()}
            data-testid="task-clipboard-clear"
            className="hud-text text-rose-300 hover:text-rose-200 flex items-center gap-1 shrink-0"
          >
            <X className="h-3 w-3" /> Panoyu Temizle
          </button>
        </div>
      )}

      {/* İş Kolu FİLTRE ağacı — tıklanabilir, açılır-kapanır liste (ana kol → alt kol) */}
      {categories.length > 0 && !showArchived && (
        <div className="flex flex-col gap-1" data-testid="category-filter-bar">
          {expandableFilterIds.length > 0 && (
            <button
              onClick={toggleAllFilterNodes}
              data-testid="catfilter-toggle-all"
              title={allFilterOpen ? "Tüm alt kolları gizle" : "Tüm alt kolları göster"}
              className="self-end flex items-center gap-1 px-2 py-0.5 rounded border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50 hud-text transition-colors"
            >
              {allFilterOpen ? <ChevronsDownUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3" />}
              {allFilterOpen ? "HEPSİNİ KAPAT" : "HEPSİNİ AÇ"}
            </button>
          )}
          <button
            onClick={() => setCategoryFilter("")}
            data-testid="category-chip-all"
            className={`px-2 py-1 rounded hud-text border transition-colors flex items-center gap-1 ${
              categoryFilter === ""
                ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
            }`}
          >
            TÜMÜ {categoryCounts && <span className="opacity-70">({categoryCounts.__all__.done}/{categoryCounts.__all__.total})</span>}
          </button>
          {catForest.map((node) => renderFilterNode(node, 0))}
          <button
            onClick={() => setCategoryFilter("__none__")}
            onContextMenu={(e) => {
              if (!clipboard?.sourceId) return;
              e.preventDefault();
              setPasteMenu({ x: e.clientX, y: e.clientY, categoryId: null, categoryName: "Kolsuz" });
            }}
            data-testid="category-chip-none"
            data-cat-drop="__none__"
            title="Görevi buraya bırakınca iş kolundan çıkarılır"
            className={`px-2 py-1 rounded hud-text border transition-colors flex items-center gap-1 ${
              taskDragOverCatId === "__none__" ? "ring-2 ring-sertex-cyan/80 bg-sertex-cyan/10" : ""
            } ${
              categoryFilter === "__none__"
                ? "border-sertex-textMuted text-sertex-textMuted bg-sertex-textMuted/10"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
            }`}
          >
            KOLSUZ {categoryCounts && <span className="opacity-70">({categoryCounts.__none__.done}/{categoryCounts.__none__.total})</span>}
          </button>
        </div>
      )}

      {!showAddForm ? (
        <div className="flex items-center gap-2">
          {!showArchived && taskScope !== "team" && (
            <button
              onClick={() => setShowAddForm(true)}
              data-testid="task-add-toggle"
              className="flex-1 py-2 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> YENİ GÖREV
            </button>
          )}
          <button
            onClick={() => setShowArchived((v) => !v)}
            data-testid="archive-toggle"
            title={showArchived ? "Aktif görevlere dön" : "Arşivi göster"}
            className={`${showArchived ? "flex-1" : "shrink-0"} py-2 px-3 border rounded-md hud-text flex items-center justify-center gap-2 transition-colors ${
              showArchived
                ? "border-sertex-cyan text-sertex-bg bg-sertex-cyan hover:bg-sertex-cyan/90"
                : "border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60"
            }`}
          >
            {showArchived ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5" /> AKTİF'E DÖN
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" />
                <span>ARŞİV</span>
                {archivedCount > 0 && (
                  <span className="ml-1 px-1.5 rounded-full bg-sertex-cyan/20 text-sertex-cyan text-[10px]">
                    {archivedCount}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-2 glass-panel corner-bracket p-2 relative">
          <button
            onClick={() => setShowAddForm(false)}
            className="absolute top-1 right-1 p-0.5 text-sertex-textMuted hover:text-sertex-cyan"
          >
            <X className="h-3 w-3" />
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Görev başlığı"
            autoFocus
            data-testid="task-title-input"
            className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Açıklama (opsiyonel)"
            rows={2}
            data-testid="task-desc-input"
            className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">BAŞLANGIÇ</div>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="task-startdate-input"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
              />
            </div>
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">BİTİŞ</div>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                data-testid="task-duedate-input"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
              />
            </div>
          </div>
          <div className="space-y-2" style={{ display: isTeamView ? undefined : "none" }}>
            {teamMembers.length > 0 ? (
              <MultiAssigneeSelect
                members={teamMembers}
                selfUser={user ? { id: user.id, username: user.username } : null}
                selectedIds={assigneeUserIds}
                companyFilter={companyName}
                onChange={(ids) => {
                  setAssigneeUserIds(ids);
                  // Auto-fill company from the single OTHER selected assignee
                  // (ignore self). Skip when multiple others are chosen.
                  const others = ids.filter((x) => x !== user?.id);
                  if (companyAutoFilled || !companyName.trim()) {
                    if (others.length === 1) {
                      setCompanyName(teamMembers.find((m) => m.id === others[0])?.company_name || "");
                      setCompanyAutoFilled(true);
                    } else if (ids.length === 0) {
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
                data-testid="task-assignee-input"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
              />
            )}
            {/* Faz 9 CP8.5 — Company field: custom dark-themed combobox. */}
            <CompanyCombobox
              value={companyName}
              onChange={setCompanyName}
              onManualEdit={(isManual) => setCompanyAutoFilled(!isManual)}
              options={teamMembers.map((m) => m.company_name).filter(Boolean)}
              placeholder="Şirket (opsiyonel)"
              testId="task-company-input"
            />
          </div>
          {categories.length > 0 && (
            <CategorySelect
              categories={categories}
              value={newCategoryId}
              onChange={setNewCategoryId}
              testId="task-category-select"
            />
          )}
          {/* Faz 8 CP5 — Yaklaşan-son-tarih uyarı ayarı. Görev bazlı override.
              Note: option children must be plain strings; we precompute the
              dynamic default label to avoid <span> injection inside <option>. */}
          <div className="flex items-center gap-2">
            {(() => {
              const defaultLabel = reminderConfig?.effective
                ? `⏱ Uyarı: Varsayılan (${reminderConfig.effective} gün)`
                : "⏱ Uyarı: Varsayılan";
              return (
                <select
                  value={newReminderDisabled ? "__off__" : (newReminderDays == null ? "" : String(newReminderDays))}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__off__") {
                      setNewReminderDisabled(true);
                      setNewReminderDays(null);
                    } else if (v === "") {
                      setNewReminderDisabled(false);
                      setNewReminderDays(null);
                    } else {
                      setNewReminderDisabled(false);
                      setNewReminderDays(parseInt(v, 10));
                    }
                  }}
                  data-testid="task-reminder-days-select"
                  className="flex-1 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                >
                  <option value="">{defaultLabel}</option>
                  {REMINDER_DAY_CHOICES.map((d) => (
                    <option key={d} value={d}>{`⏱ Uyarı: ${d} gün önce`}</option>
                  ))}
                  <option value="__off__">🚫 Bu görev için hatırlatıcı kapalı</option>
                </select>
              );
            })()}
          </div>
          <RecurringReminderFields
            value={newReminder}
            onChange={setNewReminder}
            testPrefix="new-task-reminder"
          />
          {/* 📎 Görev oluşturulurken dosya ekle (görev oluşunca yüklenir) */}
          <PendingAttachments files={pendingFiles} onChange={setPendingFiles} />
          <button
            onClick={addTask}
            data-testid="task-add-submit"
            className="w-full py-1.5 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text transition-colors"
          >
            EKLE
          </button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex items-center justify-end gap-1.5" data-testid="task-bulk-export-toolbar">
          {taskScope !== "team" && (
            <button
              onClick={() => setLinkModal({ mode: "create" })}
              data-testid="link-tasks-toolbar-btn"
              title="Görevleri birbirine bağla (grup oluştur)"
              className="mr-auto flex items-center gap-1.5 px-2 py-1 rounded-md border border-sertex-cyan/40 text-sertex-cyan/90 hover:text-sertex-cyan hover:border-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors"
            >
              <Link2 className="h-3.5 w-3.5" /> BAĞLA
            </button>
          )}
          <span className="hud-text text-sertex-textMuted mr-0.5">DIŞA AKTAR ({filtered.length}):</span>
          <button
            onClick={() => setShowExportSelect(true)}
            data-testid="bulk-export-select"
            title="Görev seçip yazdır / dışa aktar"
            className="p-1.5 rounded-md border border-sertex-cyan/40 text-sertex-cyan/90 hover:text-sertex-cyan hover:border-sertex-cyan/70 transition-colors"
          >
            <ListChecks className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => bulkExport("print")}
            data-testid="bulk-export-print"
            title="Tümünü Yazdır / PDF"
            className="p-1.5 rounded-md border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60 transition-colors"
          >
            <Printer className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => bulkExport("excel")}
            data-testid="bulk-export-excel"
            title="Tümünü Excel (.xlsx)"
            className="p-1.5 rounded-md border border-emerald-500/30 text-emerald-300/80 hover:text-emerald-300 hover:border-emerald-500/60 transition-colors"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => bulkExport("word")}
            data-testid="bulk-export-word"
            title="Tümünü Word (.docx)"
            className="p-1.5 rounded-md border border-blue-500/30 text-blue-300/80 hover:text-blue-300 hover:border-blue-500/60 transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showExportSelect && (
        <ExportSelectModal
          tasks={visibleTaskList}
          categories={categories}
          onClose={() => setShowExportSelect(false)}
        />
      )}

      {visibleTaskIds.length > 0 && (
        <div className="flex items-center justify-end gap-2" data-testid="task-collapse-toolbar">
          {showArchived && categories.length > 0 && (
            <button
              onClick={() => setArchiveByCategory((v) => !v)}
              data-testid="archive-groupby-toggle"
              title={archiveByCategory ? "İş kolu gruplamayı kaldır (düz liste)" : "Biten görevleri iş koluna göre grupla"}
              className={`mr-auto flex items-center gap-1 px-2 py-1 rounded-md border hud-text transition-colors ${
                archiveByCategory
                  ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
                  : "border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60"
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              {archiveByCategory ? "GRUPLAMAYI KALDIR" : "İŞ KOLUNA GÖRE GRUPLA"}
            </button>
          )}
          {hasHierCats && (
            <button
              onClick={toggleAllCatTrees}
              data-testid="cattree-toggle-all"
              title={allTreesOpen ? "Tüm iş kolu ağaçlarını küçült" : "Tüm iş kolu ağaçlarını aç (ana kol → alt kol)"}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60 hud-text transition-colors"
            >
              <Tag className="h-3.5 w-3.5" />
              {allTreesOpen ? "İŞ KOLU AĞAÇLARINI KAPAT" : "İŞ KOLU AĞAÇLARINI AÇ"}
            </button>
          )}
          <button
            onClick={toggleAllCollapsed}
            data-testid="task-collapse-all"
            title={allVisibleCollapsed ? "Tüm görevleri büyüt" : "Tüm görevleri küçült"}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60 hud-text transition-colors"
          >
            {allVisibleCollapsed ? (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            )}
            {allVisibleCollapsed ? "TÜMÜNÜ BÜYÜT" : "TÜMÜNÜ KÜÇÜLT"}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="hud-text text-sertex-textMuted text-center py-8" data-testid="task-empty-state">
          {searchActive
            ? `"${searchQuery.trim()}" için görev bulunamadı.`
            : showArchived
            ? "Arşivde henüz görev yok."
            : taskScope === "team"
            ? (personFilter === "__none__"
                ? "Görüntülemek için bir personel seçin veya 'Tümü'nü işaretleyin."
                : personFilter
                ? "Bu kişiye ait görev yok."
                : "Personelinize ait görev bulunmuyor.")
            : filters.length > 0
            ? "Bu filtreye uygun görev yok."
            : "Henüz görev yok. Yukarıdaki butonla ekle."}
        </div>
      ) : taskScope === "team" ? (
        // Personel Görevleri — read-oriented list (no drag reorder across
        // people). Owner label shown via isTeamView on the card. Bağlı
        // görevler statik grup bloğu olarak gösterilir (sürükleme yok).
        <div className="space-y-2" data-testid="team-task-list">
          {teamRows.map((row) =>
            row.type === "group" ? (
              <StaticTaskGroupBlock
                key={row.key}
                group={row.group}
                tasks={row.tasks}
                renderStaticMember={renderStaticMember}
                onEditGroup={(g) => setLinkModal({ mode: "edit", groupId: g.id })}
                onDissolve={dissolveGroup}
              />
            ) : (
              renderStaticMember(row.task)
            )
          )}
        </div>
      ) : showArchived && archiveByCategory && !searchActive ? (
        (() => {
          // Arşivi iş koluna (kategori) göre grupla — statik kartlar, düz liste yerine.
          const buckets = new Map();
          for (const t of sorted) {
            const key = t.category_id || "__none__";
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(t);
          }
          const catNameOf = (id) => categories.find((c) => c.id === id)?.name || null;
          const entries = [...buckets.entries()].map(([key, tasks]) => ({
            key,
            name: key === "__none__" ? "Kolsuz" : (catNameOf(key) || "Bilinmeyen İş Kolu"),
            tasks,
          }));
          entries.sort((a, b) => {
            if (a.key === "__none__") return 1;
            if (b.key === "__none__") return -1;
            return a.name.localeCompare(b.name, "tr");
          });
          const allCollapsed = entries.length > 0 && entries.every((g) => collapsedArchiveCats.has(g.key));
          return (
            <div className="space-y-3" data-testid="archive-grouped-list">
              {entries.length > 1 && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCollapsedArchiveCats(allCollapsed ? new Set() : new Set(entries.map((g) => g.key)))}
                    data-testid="archive-cats-toggle-all"
                    title={allCollapsed ? "Tüm iş kollarını aç" : "Tüm iş kollarını kapat"}
                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-sertex-cyan/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60 hud-text transition-colors"
                  >
                    {allCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
                    {allCollapsed ? "HEPSİNİ AÇ" : "HEPSİNİ KAPAT"}
                  </button>
                </div>
              )}
              {entries.map((g) => {
                const isCollapsed = collapsedArchiveCats.has(g.key);
                return (
                  <div key={g.key} data-testid={`archive-cat-group-${g.key}`}>
                    <button
                      type="button"
                      onClick={() => toggleArchiveCat(g.key)}
                      data-testid={`archive-cat-toggle-${g.key}`}
                      className="w-full flex items-center gap-2 mb-1.5 px-1 group/cat"
                      title={isCollapsed ? "Aç" : "Kapat"}
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
                      <div className="space-y-2">
                        {g.tasks.map((t) => renderStaticMember(t))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()
      ) : (showArchived || (filters.length === 0 && !categoryFilter)) && !searchActive ? (
        <Reorder.Group
          axis="y"
          values={rowKeys}
          onReorder={handleReorderRows}
          className="space-y-2"
        >
          {rowKeys.map((key) => {
            const row = rowByKey[key];
            if (!row) return null;
            if (row.type === "group") {
              if (detachedGroupIds.has(row.group.id)) {
                return (
                  <GroupDetachedRow
                    key={key}
                    rowKey={key}
                    group={row.group}
                    count={row.tasks.length}
                    onDock={() => toggleGroupDetach(row.group.id)}
                  />
                );
              }
              return (
                <TaskGroupBlock
                  key={key}
                  rowKey={key}
                  group={row.group}
                  tasks={row.tasks}
                  renderMember={renderMember}
                  onReorderGroup={handleReorderGroup}
                  onEditGroup={(g) => setLinkModal({ mode: "edit", groupId: g.id })}
                  onDissolve={dissolveGroup}
                  onDetach={(g) => toggleGroupDetach(g.id)}
                />
              );
            }
            const t = row.task;
            const detached = detachedIds.has(t.id);
            return (
              <OuterTaskRow
                key={key}
                rowKey={key}
                detached={detached}
                placeholderProps={{
                  task: t,
                  displayNumber: numById[t.id],
                  onDock: () => toggleDetach(t.id),
                }}
                cardProps={cardPropsFor(t)}
              />
            );
          })}
        </Reorder.Group>
      ) : (
        // Faz 9 CP4.31 — Category filter path now uses Reorder.Group too so
        // the drag handle works when a category filter is active. Reordering
        // within a filter reshuffles only the visible slice; non-visible
        // tasks keep their positions in the master list.
        <Reorder.Group
          axis="y"
          values={filtered}
          onReorder={handleReorderFiltered}
          className="space-y-2"
          key={tick}
        >
          {(() => {
            // Pin-aware numaralama (görev listesiyle aynı kural): sabitlenenler
            // atlanır, sabit görev kendi pinned_number'ını gösterir.
            const reserved = new Set();
            for (const t of filtered) {
              if (t.status !== "done" && t.number_pinned && t.pinned_number != null) {
                reserved.add(t.pinned_number);
              }
            }
            let counter = 0;
            return filtered.map((t) => {
              const isDone = t.status === "done";
              let num = null;
              if (!isDone) {
                if (t.number_pinned && t.pinned_number != null) {
                  num = t.pinned_number;
                } else {
                  counter += 1;
                  while (reserved.has(counter)) counter += 1;
                  num = counter;
                }
              }
              if (detachedIds.has(t.id)) {
                return (
                  <ReorderablePlaceholder
                    key={t.id}
                    task={t}
                    displayNumber={num}
                    onDock={() => toggleDetach(t.id)}
                  />
                );
              }
              return (
                <ReorderableTaskCard
                  key={t.id}
                  task={t}
                  displayNumber={num}
                  collapsed={collapsedIds.has(t.id)}
                  onToggleCollapse={() => toggleCollapse(t.id)}
                  onToggleDetach={() => toggleDetach(t.id)}
                  onStatusChange={(status) => setStatus(t.id, status)}
                  onDelete={() => removeTask(t.id)}
                  onEdit={() => setEditing(t)}
                  onSetReminder={(iso, opts) => setReminder(t.id, iso, opts)}
                  onClearReminder={() => clearReminder(t.id)}
                  onSetSubtasks={(subs) => setSubtasks(t.id, subs)}
                  onSetArchived={(v) => setArchived(t.id, v)}
                  onReassign={(uid) => reassignTask(t.id, uid)}
                  onTransferCompany={(cid) => transferTaskToCompany(t.id, cid)}
                  onPromoteSubtask={(subId) => promoteSubtask(t.id, subId)}
                  onDemoteToSubtask={() => demoteToSubtask(t.id)}
                  onDemoteChild={(childId) => demoteToSubtask(childId)}
                  onPinNumber={(number) => setTaskPin(t.id, true, number)}
                  onUnpinNumber={() => setTaskPin(t.id, false, null)}
                  promotedChildren={promotedChildrenMap[t.id] || []}
                  highlight={searchQuery}
                  isTeamView={isTeamView}
                  isHighlighted={highlightedTaskId === t.id}
                  categoryName={categories.find((c) => c.id === t.category_id)?.name || null}
                  categories={categories}
                  onSetCategory={(cid) => setTaskCategory(t.id, cid)}
                  reminderConfig={reminderConfig}
                  onSetReminderDays={(d) => setTaskReminderDays(t.id, d)}
                  onSetReminderDisabled={(v) => setTaskReminderDisabled(t.id, v)}
                  currentUser={user}
                  onLockChanged={() => { load(); onDataChanged?.(); }}
                  onLinkTasks={() => setLinkModal({ mode: "create", taskId: t.id })}
                  onEditGroup={() => t.group_id && setLinkModal({ mode: "edit", groupId: t.group_id })}
                  onRemoveFromGroup={() => t.group_id && removeFromGroup(t.group_id, t.id)}
                  onDragToCategory={handleTaskDragToCategory}
                  onDropToCategory={(e, info) => handleTaskDropCategory(t, e, info)}
                  archiveGroup={showArchived ? archiveGroup : null}
                  canPermanentDelete={!!caps.perm_delete}
                  archiveSettings={{ trash_autoclean_enabled: taskSettings.trash_autoclean_enabled, trash_autoclean_days: taskSettings.trash_autoclean_days }}
                  onCancel={() => cancelTask(t.id)}
                  onUncancel={() => uncancelTask(t.id)}
                  onRestore={() => restoreTask(t.id)}
                  onPermanentDelete={() => permanentDeleteTask(t.id)}
                />
              );
            });
          })()}
        </Reorder.Group>
      )}

      <div className="hud-text text-sertex-textMuted text-[10px] pt-2 border-t border-sertex-cyan/15 leading-tight px-1">
        💡 Sayaç kutularına tıklayarak filtreleyin (birden fazla seçebilirsiniz) · Kartın sağındaki <span className="text-sertex-cyan">⋮</span> ile düzenle · hatırlat · Kartların sağ-alt köşesinden <span className="text-sertex-cyan">↘</span> tutup boyutlandırın · Alt göreve sağ tık / <span className="text-sertex-cyan">⋮</span> ile durum / tarih ekle · Alt görev başındaki <span className="text-sertex-cyan">⋮⋮</span> ile sırayı değiştirin · Alt görev kutusunun sağ-alt köşesinden <span className="text-sertex-cyan">↘</span> tutup boyutlandırın · Kart sol-üstündeki <span className="text-sertex-cyan">⋮⋮</span> ile görev sırasını değiştirin (kategori filtresi açıkken de aktif)
      </div>

      {editing && (
        <EditTaskModal
          task={editing}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          isTeamView={isTeamView}
          categories={categories}
          teamMembers={teamMembers}
          currentUser={user}
        />
      )}
      {/* Görev Kopyalama — Kopyala penceresi + iş koluna Yapıştır menüsü */}
      {copyModalTask && (
        <CopyTaskModal task={copyModalTask} onClose={() => setCopyModalTask(null)} />
      )}
      {pasteMenu && clipboard?.sourceId && (
        <TaskPasteMenu
          x={pasteMenu.x}
          y={pasteMenu.y}
          title={clipboard.title}
          targetName={pasteMenu.categoryName || "Kolsuz"}
          onPaste={() => handlePaste(pasteMenu.categoryId, pasteMenu.categoryName)}
          onClear={() => clearTaskClipboard()}
          onClose={() => setPasteMenu(null)}
        />
      )}
      {templatesOpen && (
        <TemplatesModal
          categories={categories}
          currentUser={user}
          onUse={handleUseTemplate}
          onClose={() => { setTemplatesOpen(false); setTemplatesRefresh((x) => x + 1); }}
        />
      )}
      {/* GÖREV BAĞLAMA — görevleri bağla / grubu düzenle modalı */}
      {linkModal && (
        <LinkTasksModal
          candidateTasks={linkCandidates.candidates}
          preselectedIds={linkCandidates.preselected}
          group={linkCandidates.group}
          onClose={() => setLinkModal(null)}
          onSaved={() => { load(); onDataChanged?.(); }}
        />
      )}
      {/* Faz 9 CP4.33 — global unlock modal fired from NotificationBell */}
      {pendingUnlockTask && (
        <UnlockOtpModal
          task={pendingUnlockTask}
          onClose={() => setPendingUnlockTask(null)}
          onVerified={() => { load(); onDataChanged?.(); setPendingUnlockTask(null); }}
        />
      )}
      {/* Task 4 — dışarı alınan görevler büyük yüzen pencerede */}
      {Array.from(detachedIds).map((id, idx) => {
        const t = tasks.find((x) => x.id === id);
        if (!t) return null;
        return (
          <DetachedTaskWindow key={id} task={t} index={idx} onDock={() => toggleDetach(id)}>
            <TaskCard
              task={t}
              displayNumber={null}
              detached
              onToggleDetach={() => toggleDetach(id)}
              onStatusChange={(status) => setStatus(t.id, status)}
              onDelete={() => { toggleDetach(t.id); removeTask(t.id); }}
              onEdit={() => setEditing(t)}
              onSetReminder={(iso, opts) => setReminder(t.id, iso, opts)}
              onClearReminder={() => clearReminder(t.id)}
              onSetSubtasks={(subs) => setSubtasks(t.id, subs)}
              onSetArchived={(v) => setArchived(t.id, v)}
              onReassign={(uid) => reassignTask(t.id, uid)}
              onTransferCompany={(cid) => transferTaskToCompany(t.id, cid)}
              onPromoteSubtask={(subId) => promoteSubtask(t.id, subId)}
              onDemoteToSubtask={() => demoteToSubtask(t.id)}
              onDemoteChild={(childId) => demoteToSubtask(childId)}
              onPinNumber={(number) => setTaskPin(t.id, true, number)}
              onUnpinNumber={() => setTaskPin(t.id, false, null)}
              promotedChildren={promotedChildrenMap[t.id] || []}
              highlight={searchQuery}
              isTeamView={isTeamView}
              categoryName={categories.find((c) => c.id === t.category_id)?.name || null}
              categories={categories}
              onSetCategory={(cid) => setTaskCategory(t.id, cid)}
              reminderConfig={reminderConfig}
              onSetReminderDays={(d) => setTaskReminderDays(t.id, d)}
              onSetReminderDisabled={(v) => setTaskReminderDisabled(t.id, v)}
              onToggleDigestMute={(v) => setTaskDigestMuted(t.id, v)}
              currentUser={user}
              onLockChanged={() => { load(); onDataChanged?.(); }}
            />
          </DetachedTaskWindow>
        );
      })}
      {/* GÖREV BAĞLAMA — dışarı alınan bağlı gruplar tek büyük pencerede */}
      {Array.from(detachedGroupIds).map((gid, idx) => {
        const group = groupById[gid];
        if (!group) return null;
        const members = sorted.filter((t) => t.group_id === gid);
        if (members.length === 0) return null;
        const doneCount = members.filter((t) => t.status === "done").length;
        return (
          <DetachedGroupWindow
            key={gid}
            group={group}
            doneCount={doneCount}
            total={members.length}
            index={detachedIds.size + idx}
            onDock={() => toggleGroupDetach(gid)}
          >
            <Reorder.Group
              axis="y"
              values={members}
              onReorder={(nt) => handleReorderGroup(gid, nt)}
              className="space-y-2"
            >
              {members.map((t) => (
                <GroupWindowMemberRow key={t.id} task={t} cardProps={cardPropsFor(t)} />
              ))}
            </Reorder.Group>
          </DetachedGroupWindow>
        );
      })}
    </div>
  );
};

export default TasksPanel;
