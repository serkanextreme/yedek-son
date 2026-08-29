import { confirmDialog } from "@/lib/confirm";
import { promptDialog } from "@/lib/confirm";
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  StickyNote,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ListTodo,
  Brain,
  FolderOpen,
  HardDrive,
  Mail,
  Users,
  AlertOctagon,
} from "lucide-react";
import { chatApi, notesApi, statsApi } from "../lib/api";
import { parseCapacityToMb, formatMb } from "../lib/capacity";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { isAdminLike, isSuperAdmin } from "../lib/roles";
import NeuralLinkHeader from "./sidebar/NeuralLinkHeader";
import SidebarTabBar from "./sidebar/SidebarTabBar";
import SidebarTabContent from "./sidebar/SidebarTabContent";
import FloatingTabsHost from "./sidebar/FloatingTabsHost";
import QuickPresetSwitcher from "./QuickPresetSwitcher";

// ---- LocalStorage keys (DO NOT rename — user data lives here) --------------
const TAB_ORDER_KEY = "sertex_tab_order_v1";
const SIDEBAR_DIMS_KEY = "sertex_sidebar_dims_v1";
const SIDEBAR_DOCK_KEY = "sertex_sidebar_dock_v1";
const FLOATING_TABS_KEY = "sertex_floating_tabs_v1";
const PRESETS_KEY = "sertex_layout_presets_v1";
const ACTIVE_PRESET_KEY = "sertex_layout_active_preset_v1";
const LAYOUT_KEYS = [
  "sertex_windows_v1",
  "sertex_sidebar_dock_v1",
  "sertex_sidebar_dims_v1",
  "sertex_hud_all_hidden_v1",
  // Faz 9 CP4.13 — include floating-tab state + per-tab accents in presets
  // so saving a "renk teması" also captures which sidebar tabs are detached,
  // their geometry, and their per-tab accent colours. Backward-compatible
  // with older preset entries that don't have these keys (applySnapshot
  // skips missing values so old presets simply don't touch this LS).
  "sertex_floating_tabs_v1",
  "sertex_floating_tabs_geom_v1",
];

const DEFAULT_SIDEBAR_WIDTH = 440;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 900;
const MIN_SIDEBAR_HEIGHT = 300;
const DEFAULT_SIDEBAR_HORIZ_HEIGHT = 380;

const DOCK_NEXT = { right: "bottom", bottom: "left", left: "top", top: "right" };
const DOCK_LABEL = { right: "SAĞ", left: "SOL", top: "ÜST", bottom: "ALT" };

const Sidebar = ({ lang, open, setOpen, activeConversationId, onSelectConversation, onNewChat, refreshKey }) => {
  const { user, teamFeaturesVisible } = useAuth();
  const isAdmin = isAdminLike(user);
  const isSuper = isSuperAdmin(user);
  // Faz 8 CP3 — managers get the extra "Ekibim" tab that surfaces per-member
  // task rollups. Employees don't need it (they only see themselves).
  const isManagerOrAdmin = isAdminLike(user) || user?.role === "manager";
  // Ekip sekmeleri kişisel modda gizli — sahip hariç (teamFeaturesVisible kapsar).
  const canSeeTeam = isManagerOrAdmin && teamFeaturesVisible;
  const [tab, setTab] = useState("history");
  const [conversations, setConversations] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteInput, setNoteInput] = useState("");
  // Faz 9 CP8 — Bottom-nav (mobile) drives the sidebar tab via a custom
  // event so SertexMain doesn't need to prop-drill setTab.
  React.useEffect(() => {
    const onSwitch = (ev) => {
      const t = ev?.detail;
      if (typeof t === "string" && t) setTab(t);
    };
    window.addEventListener("sertex:sidebar-tab", onSwitch);
    return () => window.removeEventListener("sertex:sidebar-tab", onSwitch);
  }, []);

  // ---- Role-based tab visibility helper --------------------------------
  const canSeeTab = (tk) => {
    if (tk === "backup") return isSuper;
    if (tk === "team") return canSeeTeam;
    // Faz 8 CP6 — "Yarım Kalan İşler" tab is only relevant for managers +
    // admin (they reassign orphans). Employees never see it.
    if (tk === "orphans") return canSeeTeam;
    return true;
  };

  // Aktif sekme gizlendiyse (mod değişimi) güvenli sekmeye düş.
  React.useEffect(() => {
    if (!canSeeTab(tab)) setTab("history");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamFeaturesVisible, tab]);

  const DEFAULT_ORDER_BASE = ["history", "tasks", "memory", "files", "email", "notes"];
  const DEFAULT_ORDER = (() => {
    const order = [...DEFAULT_ORDER_BASE];
    // Seed team/orphans by ROLE (manager/admin) — NOT by current mode — so the
    // tabOrder always carries them; render-time `canSeeTab` filtering handles
    // show/hide on Çift Mod switches without a reload.
    if (isManagerOrAdmin) {
      const idx = order.indexOf("tasks");
      order.splice(idx + 1, 0, "team");
      // "orphans" lives right after "team" (also manager/admin only).
      order.splice(idx + 2, 0, "orphans");
    }
    if (isSuper) order.push("backup");
    return order;
  })();
  const [tabOrder, setTabOrder] = useState(() => {
    try {
      const raw = localStorage.getItem(TAB_ORDER_KEY);
      if (!raw) return DEFAULT_ORDER;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const missing = DEFAULT_ORDER.filter((k) => !parsed.includes(k));
        const cleaned = parsed.filter((k) => DEFAULT_ORDER.includes(k));
        return [...cleaned, ...missing];
      }
    } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    return DEFAULT_ORDER;
  });

  const persistOrder = (next) => {
    setTabOrder(next);
    try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(next)); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
  };

  // Reorder only touches currently-visible tabs; merge the reordered visible
  // subset back into the full order so hidden tabs (e.g. team/orphans while in
  // personal mode) keep their slot and reappear correctly on a mode switch.
  const handleReorder = (newVisible) => {
    let vi = 0;
    const merged = tabOrder.map((tk) => (canSeeTab(tk) ? (newVisible[vi++] ?? tk) : tk));
    persistOrder(merged);
  };

  // ---- Floating (detached) tabs state -----------------------------------
  const [floatingTabs, setFloatingTabs] = useState(() => {
    try {
      const raw = localStorage.getItem(FLOATING_TABS_KEY);
      if (!raw) return {};
      const p = JSON.parse(raw);
      return p && typeof p === "object" ? p : {};
    } catch { return {}; }
  });
  const persistFloating = (next) => {
    setFloatingTabs(next);
    try { localStorage.setItem(FLOATING_TABS_KEY, JSON.stringify(next)); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
  };

  // Per-tab z-index so the last-clicked floating window comes to the front.
  const [tabZ, setTabZ] = useState({});
  const zCounterRef = React.useRef(50);
  const focusFloating = (tabKey) => {
    zCounterRef.current += 1;
    const z = zCounterRef.current;
    setTabZ((prev) => ({ ...prev, [tabKey]: z }));
  };

  const detachTab = (tabKey) => {
    if (floatingTabs[tabKey]) { focusFloating(tabKey); return; }
    const next = { ...floatingTabs, [tabKey]: true };
    persistFloating(next);
    if (tab === tabKey) {
      const stillDocked = tabOrder.find(
        (tk) => !next[tk] && canSeeTab(tk)
      );
      if (stillDocked) setTab(stillDocked);
    }
    focusFloating(tabKey);
  };

  const dockTab = (tabKey) => {
    const next = { ...floatingTabs };
    delete next[tabKey];
    persistFloating(next);
    setTab(tabKey);
  };

  // ---- Dock position ---------------------------------------------------
  const [dock, setDock] = useState(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_DOCK_KEY);
      if (v && ["right", "left", "top", "bottom"].includes(v)) return v;
    } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    return "right";
  });

  const cycleDock = () => {
    const next = DOCK_NEXT[dock];
    setDock(next);
    try { localStorage.setItem(SIDEBAR_DOCK_KEY, next); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    toast.success(`Panel konumu: ${DOCK_LABEL[next]}`);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("sertex:clamp-panels"));
    }, 60);
  };

  // ---- HUD panels visibility --------------------------------------------
  const [allHidden, setAllHidden] = useState(() => {
    try { return localStorage.getItem("sertex_hud_all_hidden_v1") === "1"; } catch { return false; }
  });
  const toggleAllPanels = () => {
    const next = !allHidden;
    setAllHidden(next);
    try { localStorage.setItem("sertex_hud_all_hidden_v1", next ? "1" : "0"); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    window.dispatchEvent(new CustomEvent("sertex:toggle-all-panels", { detail: { hide: next } }));
    toast.success(next ? "Tüm paneller gizlendi" : "Tüm paneller gösterildi");
  };

  const resetAllPanels = async () => {
    if (!(await confirmDialog({ message: "Tüm HUD panellerinin konumu, boyutu, rengi ve dock ayarları fabrika ayarına döndürülecek. Onaylıyor musun?", danger: true }))) return;
    try { localStorage.removeItem("sertex_windows_v1"); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    try { localStorage.removeItem("sertex_hud_all_hidden_v1"); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    setAllHidden(false);
    window.dispatchEvent(new CustomEvent("sertex:reset-all-panels"));
    toast.success("Panel konumları sıfırlandı");
  };

  // ---- Layout Presets ---------------------------------------------------
  const [presets, setPresets] = useState(() => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [activePreset, setActivePreset] = useState(() => {
    try { return localStorage.getItem(ACTIVE_PRESET_KEY) || ""; } catch { return ""; }
  });

  const persistPresets = (next) => {
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
  };

  const captureCurrentLayout = () => {
    const snap = {};
    for (const k of LAYOUT_KEYS) {
      try { snap[k] = localStorage.getItem(k); } catch { snap[k] = null; }
    }
    return snap;
  };

  const applySnapshot = (snap) => {
    for (const k of LAYOUT_KEYS) {
      try {
        if (snap[k] == null) localStorage.removeItem(k);
        else localStorage.setItem(k, snap[k]);
      } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    }
    window.location.reload();
  };

  const savePreset = async () => {
    // Faz 9 CP4.3 — capture a small thumbnail (JPEG @ 800×450 for retina
    // crispness in the ~420×225 hover preview, ~40-60 KB base64) BEFORE the
    // name prompt so the frozen HUD is what gets pictured, not the browser
    // prompt. Import is dynamic so the ~250 KB html2canvas bundle only
    // downloads on first save. Any capture failure is silent — the preset
    // still saves without a thumbnail (backward compatible with older
    // presets that never had one).
    let thumbnail = null;
    try {
      const mod = await import("html2canvas");
      const html2canvas = mod.default || mod;
      const c = await html2canvas(document.body, {
        scale: 0.5,
        backgroundColor: "#0a0e17",
        logging: false,
        useCORS: true,
        ignoreElements: (el) => {
          const tag = el.tagName;
          return tag === "IFRAME" || tag === "VIDEO" || el.classList?.contains?.("sonner-toast");
        },
      });
      // Downscale to a retina-sharp thumb (800×450 = same 16:9 as the
      // 420×225 preview → ~2x pixel density so hovering doesn't look
      // pixelated). Higher JPEG quality (0.75) keeps text legible.
      const target = document.createElement("canvas");
      target.width = 800;
      target.height = 450;
      const ctx = target.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(c, 0, 0, 800, 450);
      thumbnail = target.toDataURL("image/jpeg", 0.75);
    } catch (e) {
      // Ignore: preset just gets saved without a thumb.
    }

    const name = await promptDialog({
      title: "DÜZEN KAYDET",
      message: "Bu düzeni ne isimle kaydedeyim?",
      defaultValue: "Yeni Düzen",
      confirmText: "KAYDET",
    });
    if (!name || !name.trim()) return;
    const key = name.trim();
    const snap = captureCurrentLayout();
    if (thumbnail) snap.__thumbnail = thumbnail;
    const next = { ...presets, [key]: snap };
    persistPresets(next);
    setActivePreset(key);
    try { localStorage.setItem(ACTIVE_PRESET_KEY, key); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    toast.success(`"${key}" düzeni kaydedildi`);
  };

  const loadPreset = (name) => {
    if (!name || !presets[name]) return;
    setActivePreset(name);
    try { localStorage.setItem(ACTIVE_PRESET_KEY, name); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    toast.success(`"${name}" düzeni yükleniyor...`);
    setTimeout(() => applySnapshot(presets[name]), 250);
  };

  // Faz 9 CP4.8 — Preset "Üzerine Yaz" one-click quick-action.
  // Called from QuickPresetSwitcher's hover-visible ↻ icon. Captures a
  // fresh HD thumbnail + current HUD snapshot and overwrites the named
  // preset without prompting. `savePreset` above is untouched.
  const overwritePreset = async (name) => {
    if (!name || !presets[name]) return;
    let thumbnail = null;
    try {
      const mod = await import("html2canvas");
      const html2canvas = mod.default || mod;
      const c = await html2canvas(document.body, {
        scale: 0.5,
        backgroundColor: "#0a0e17",
        logging: false,
        useCORS: true,
        ignoreElements: (el) => {
          const tag = el.tagName;
          return tag === "IFRAME" || tag === "VIDEO" || el.classList?.contains?.("sonner-toast");
        },
      });
      const target = document.createElement("canvas");
      target.width = 800;
      target.height = 450;
      const ctx = target.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(c, 0, 0, 800, 450);
      thumbnail = target.toDataURL("image/jpeg", 0.75);
    } catch (e) {
      // Thumb capture is best-effort; overwrite still proceeds.
    }
    const snap = captureCurrentLayout();
    if (thumbnail) snap.__thumbnail = thumbnail;
    const next = { ...presets, [name]: snap };
    persistPresets(next);
    setActivePreset(name);
    try { localStorage.setItem(ACTIVE_PRESET_KEY, name); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    toast.success(`"${name}" düzeni güncellendi`);
  };

  const deletePreset = async () => {
    if (!activePreset || !presets[activePreset]) return;
    if (!(await confirmDialog({ message: `"${activePreset}" düzenini silmek istiyor musun?`, danger: true }))) return;
    const next = { ...presets };
    delete next[activePreset];
    persistPresets(next);
    setActivePreset("");
    try { localStorage.removeItem(ACTIVE_PRESET_KEY); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    toast.success("Düzen silindi");
  };

  // Faz 9 CP4.9 — Delete-by-name for the QuickPresetSwitcher's hover-visible
  // 🗑️ icon. Kept separate from `deletePreset` (which operates on the
  // currently-active preset) so neither pathway can break the other.
  const deletePresetByName = async (name) => {
    if (!name || !presets[name]) return;
    if (!(await confirmDialog({ message: `"${name}" düzenini silmek istiyor musun?`, danger: true }))) return;
    const next = { ...presets };
    delete next[name];
    persistPresets(next);
    if (activePreset === name) {
      setActivePreset("");
      try { localStorage.removeItem(ACTIVE_PRESET_KEY); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    }
    toast.success(`"${name}" düzeni silindi`);
  };

  const isHorizontal = dock === "top" || dock === "bottom";

  // ---- Sidebar dimensions (user-resizable) ------------------------------
  const [dims, setDims] = useState(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_DIMS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          width: Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, p.width || DEFAULT_SIDEBAR_WIDTH)),
          height: p.height ? Math.max(MIN_SIDEBAR_HEIGHT, p.height) : null,
        };
      }
    } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
    return { width: DEFAULT_SIDEBAR_WIDTH, height: null };
  });

  const persistDims = (next) => {
    setDims(next);
    try { localStorage.setItem(SIDEBAR_DIMS_KEY, JSON.stringify(next)); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
  };

  const resetDims = () => {
    persistDims({ width: DEFAULT_SIDEBAR_WIDTH, height: null });
    toast.success(lang === "tr" ? "Panel boyutu sıfırlandı" : "Panel size reset");
  };

  // Team Faz 2 · notification bell → task jump. When the user clicks a
  // notification in the popover we get bumped to the "Görevler" tab and open
  // the sidebar so the user can see the highlighted card immediately.
  useEffect(() => {
    const onJump = () => {
      setTab("tasks");
      setOpen(true);
    };
    window.addEventListener("sertex:task-jump", onJump);
    return () => window.removeEventListener("sertex:task-jump", onJump);
  }, [setOpen]);

  useEffect(() => {
    const t = setTimeout(() => {
      window.dispatchEvent(new CustomEvent("sertex:clamp-panels"));
    }, 80);
    return () => clearTimeout(t);
  }, [open, dock, dims.width, dims.height]);

  // Publish sidebar occupancy as CSS vars — chip stacks respect it
  useEffect(() => {
    const root = document.documentElement;
    const w = open ? dims.width : 0;
    const h = open ? (dims.height || DEFAULT_SIDEBAR_HORIZ_HEIGHT) : 0;
    root.style.setProperty("--sx-sb-right",  dock === "right"  && open ? `${w}px` : "0px");
    root.style.setProperty("--sx-sb-left",   dock === "left"   && open ? `${w}px` : "0px");
    root.style.setProperty("--sx-sb-top",    dock === "top"    && open ? `${h}px` : "0px");
    root.style.setProperty("--sx-sb-bottom", dock === "bottom" && open ? `${h}px` : "0px");
  }, [dock, open, dims.width, dims.height]);

  // ---- Compute dock-based styles ----------------------------------------
  const asideStyle = {};
  const animInit = { opacity: 0 };
  const animShow = { opacity: 1 };
  const animExit = { opacity: 0 };
  const borderCls = "border-sertex-cyan/20";
  let borderSide = "border-l";
  let toggleStyle = {};
  let ToggleIconOpen, ToggleIconClosed;
  let resizeInner = null;

  if (dock === "right") {
    asideStyle.top = 0; asideStyle.right = 0;
    asideStyle.width = dims.width; asideStyle.height = dims.height || "100%";
    animInit.x = 400; animExit.x = 400; animShow.x = 0;
    borderSide = "border-l";
    toggleStyle = { top: "50%", right: open ? dims.width : 0, transform: "translateY(-50%)" };
    ToggleIconOpen = ChevronRight; ToggleIconClosed = ChevronLeft;
    resizeInner = { axis: "x", cursor: "ew-resize", edge: "left" };
  } else if (dock === "left") {
    asideStyle.top = 0; asideStyle.left = 0;
    asideStyle.width = dims.width; asideStyle.height = dims.height || "100%";
    animInit.x = -400; animExit.x = -400; animShow.x = 0;
    borderSide = "border-r";
    toggleStyle = { top: "50%", left: open ? dims.width : 0, transform: "translateY(-50%)" };
    ToggleIconOpen = ChevronLeft; ToggleIconClosed = ChevronRight;
    resizeInner = { axis: "x", cursor: "ew-resize", edge: "right" };
  } else if (dock === "top") {
    asideStyle.top = 0; asideStyle.left = 0; asideStyle.right = 0;
    asideStyle.height = dims.height || DEFAULT_SIDEBAR_HORIZ_HEIGHT;
    animInit.y = -400; animExit.y = -400; animShow.y = 0;
    borderSide = "border-b";
    toggleStyle = { left: "50%", top: open ? (dims.height || DEFAULT_SIDEBAR_HORIZ_HEIGHT) : 0, transform: "translateX(-50%)" };
    ToggleIconOpen = ChevronUp; ToggleIconClosed = ChevronDown;
    resizeInner = { axis: "y", cursor: "ns-resize", edge: "bottom" };
  } else if (dock === "bottom") {
    asideStyle.bottom = 0; asideStyle.left = 0; asideStyle.right = 0;
    asideStyle.height = dims.height || DEFAULT_SIDEBAR_HORIZ_HEIGHT;
    animInit.y = 400; animExit.y = 400; animShow.y = 0;
    borderSide = "border-t";
    toggleStyle = { left: "50%", bottom: open ? (dims.height || DEFAULT_SIDEBAR_HORIZ_HEIGHT) : 0, transform: "translateX(-50%)" };
    ToggleIconOpen = ChevronDown; ToggleIconClosed = ChevronUp;
    resizeInner = { axis: "y", cursor: "ns-resize", edge: "top" };
  }

  // ---- Bounds div: HUD panels cannot drag behind the sidebar -----------
  const currentHeight = dims.height || DEFAULT_SIDEBAR_HORIZ_HEIGHT;
  const boundsStyle = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: -1 };
  if (open) {
    if (dock === "right") boundsStyle.right = dims.width;
    else if (dock === "left") boundsStyle.left = dims.width;
    else if (dock === "top") boundsStyle.top = currentHeight;
    else if (dock === "bottom") boundsStyle.bottom = currentHeight;
  }

  // Sidebar edge resize
  const startResize = (e, edge) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX; const startY = e.clientY;
    const startW = dims.width;
    const startH = dims.height ?? (isHorizontal ? DEFAULT_SIDEBAR_HORIZ_HEIGHT : window.innerHeight);
    const onMove = (ev) => {
      let nextW = startW;
      let nextH = dims.height ?? startH;
      if (edge === "left")   nextW = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startW + (startX - ev.clientX)));
      else if (edge === "right")  nextW = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startW + (ev.clientX - startX)));
      else if (edge === "bottom") nextH = Math.min(window.innerHeight - 20, Math.max(MIN_SIDEBAR_HEIGHT, startH + (ev.clientY - startY)));
      else if (edge === "top")    nextH = Math.min(window.innerHeight - 20, Math.max(MIN_SIDEBAR_HEIGHT, startH + (startY - ev.clientY)));
      setDims((prev) => ({ ...prev, width: nextW, height: nextH ?? prev.height }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDims((prev) => {
        try { localStorage.setItem(SIDEBAR_DIMS_KEY, JSON.stringify(prev)); } catch (e) { console.warn("[Sidebar.jsx] hata bastırıldı:", e); }
        return prev;
      });
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = (edge === "left" || edge === "right") ? "ew-resize" : "ns-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ---- Tab meta (icons/labels/testIds) ---------------------------------
  const TAB_META = {
    history: { icon: MessageSquare, label: lang === "tr" ? "Geçmiş" : "History", testId: "tab-history" },
    tasks:   { icon: ListTodo,      label: "Görevler", testId: "tab-tasks" },
    team:    { icon: Users,         label: "Ekibim",   testId: "tab-team" },
    orphans: { icon: AlertOctagon,  label: "Yarım Kalan", testId: "tab-orphans" },
    memory:  { icon: Brain,         label: "Hafıza",   testId: "tab-memory" },
    files:   { icon: FolderOpen,    label: "Dosyalar", testId: "tab-files" },
    email:   { icon: Mail,          label: "E-posta",  testId: "tab-email" },
    notes:   { icon: StickyNote,    label: lang === "tr" ? "Notlar" : "Notes", testId: "tab-notes" },
    backup:  { icon: HardDrive,     label: "Yedek",    testId: "tab-backup" },
  };

  // ---- Data loading ----------------------------------------------------
  const loadConversations = () => chatApi.listConversations().then(setConversations).catch(() => {});
  const loadNotes = () => notesApi.list().then(setNotes).catch(() => {});
  const [stats, setStats] = useState(null);
  const loadStats = () => statsApi.summary().then(setStats).catch(() => {});

  useEffect(() => {
    loadConversations();
    loadNotes();
    loadStats();
  }, [refreshKey]);

  const addNote = async () => {
    if (!noteInput.trim()) return;
    await notesApi.create(noteInput.trim());
    setNoteInput("");
    loadNotes();
    loadStats();
    toast.success(lang === "tr" ? "Not eklendi" : "Note added");
  };

  const deleteNote = async (id) => {
    await notesApi.delete(id);
    loadNotes();
    loadStats();
  };

  const deleteConversation = async (id) => {
    await chatApi.deleteConversation(id);
    loadConversations();
    loadStats();
    if (activeConversationId === id) onNewChat();
  };

  // Clicking a NEURAL LINK counter → jump to that tab (or focus its floating window)
  const handleStatClick = (tabKey) => {
    if (!tabKey || !TAB_META[tabKey]) return;
    if (!canSeeTab(tabKey)) return;
    setTab(tabKey);
    if (floatingTabs[tabKey]) focusFloating(tabKey);
  };

  // Admin-only: edit the system-wide storage quota that drives the NEURAL LINK
  // progress bar. Accepts input in GB (`10`, `10 GB`, `10G`), MB (`500 MB`,
  // `500M`) or TB (`2 TB`). Bare numbers default to GB for backward compat.
  const editSystemQuota = async () => {
    if (!isAdmin) return;
    try {
      const info = await statsApi.getSystemQuota();
      const current = formatMb(info.quota_mb);
      const answer = await promptDialog({
        title: "SİSTEM KAPASİTESİ",
        message:
        `Sistem depolama kapasitesi — şu an ${current}\n\n` +
        `Örnek: "10 GB", "500 MB", "1.5 GB", "2 TB"\n` +
        `Birim yazmazsan GB kabul edilir.\n\n` +
        `Aralık: ${formatMb(info.min_mb)} — ${formatMb(info.max_mb)}`,
        defaultValue: current,
        confirmText: "KAYDET",
      });
      if (answer == null) return; // cancel
      const mb = parseCapacityToMb(answer, "gb");
      if (mb == null || mb <= 0) {
        toast.error("Geçersiz değer. Örn: 500 MB veya 10 GB");
        return;
      }
      if (mb < info.min_mb || mb > info.max_mb) {
        toast.error(`Değer ${formatMb(info.min_mb)} — ${formatMb(info.max_mb)} aralığında olmalı`);
        return;
      }
      await statsApi.setSystemQuota(mb);
      toast.success(`Kapasite ${formatMb(mb)} olarak ayarlandı`);
      loadStats(); // bar reshapes immediately
    } catch (e) {
      toast.error("Kapasite güncellenemedi");
    }
  };

  // ---- Sidebar bounds (for drop-to-dock detection) ---------------------
  const [viewport, setViewport] = React.useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1200,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const sidebarBounds = React.useMemo(() => {
    if (!open) return null;
    const w = dims.width;
    const h = dims.height || DEFAULT_SIDEBAR_HORIZ_HEIGHT;
    const winH = viewport.h;
    const winW = viewport.w;
    if (dock === "right")  return { left: winW - w, right: winW, top: 0, bottom: dims.height || winH };
    if (dock === "left")   return { left: 0, right: w, top: 0, bottom: dims.height || winH };
    if (dock === "top")    return { left: 0, right: winW, top: 0, bottom: h };
    if (dock === "bottom") return { left: 0, right: winW, top: winH - h, bottom: winH };
    return null;
  }, [dock, dims.width, dims.height, open, viewport.w, viewport.h]);

  const activeFloatingKeys = Object.keys(floatingTabs).filter(
    (tk) => TAB_META[tk] && canSeeTab(tk)
  );

  // Shared tab body renderer — used both for the sidebar's active tab and for
  // each detached floating window.
  const renderBody = (tk) => (
    <SidebarTabContent
      tabKey={tk}
      lang={lang}
      refreshKey={refreshKey}
      isAdmin={isAdmin}
      onDataChanged={loadStats}
      conversations={conversations}
      activeConversationId={activeConversationId}
      onSelectConversation={onSelectConversation}
      onNewChat={onNewChat}
      onDeleteConversation={deleteConversation}
      notes={notes}
      noteInput={noteInput}
      setNoteInput={setNoteInput}
      onAddNote={addNote}
      onDeleteNote={deleteNote}
    />
  );

  return (
    <>
      {/* Bounds container — panels cannot drag behind the sidebar */}
      <div id="hud-bounds" style={boundsStyle} aria-hidden="true" data-testid="hud-bounds" />

      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        onDoubleClick={resetDims}
        title={open ? "Kapat (çift tıkla: boyutu sıfırla)" : "Aç"}
        className="fixed z-40 glass-panel border-sertex-cyan/30 p-1.5 hover:bg-sertex-cyan/10 transition-colors"
        style={toggleStyle}
        data-testid="sidebar-toggle"
      >
        {open ? (
          <ToggleIconOpen className="h-4 w-4 text-sertex-cyan" />
        ) : (
          <ToggleIconClosed className="h-4 w-4 text-sertex-cyan" />
        )}
      </button>

      {/* Faz 9 CP4.2 — Quick preset switcher (visible only when sidebar is
          closed and the user has ≥1 saved preset). Uses the same load handler
          the sidebar itself uses, so no duplicated state or persistence. */}
      <QuickPresetSwitcher
        presets={presets}
        activePreset={activePreset}
        onLoadPreset={loadPreset}
        onOverwritePreset={overwritePreset}
        onDeletePreset={deletePresetByName}
        dock={dock}
        sidebarOpen={open}
      />

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={animInit}
            animate={animShow}
            exit={animExit}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            style={asideStyle}
            className={`fixed z-30 glass-panel ${borderSide} ${borderCls} flex flex-col`}
            data-testid="sidebar"
          >
            {resizeInner && (
              <div
                onMouseDown={(e) => startResize(e, resizeInner.edge)}
                data-testid={`sidebar-resize-${resizeInner.edge}`}
                title="Boyutlandırmak için sürükleyin"
                className={`absolute z-40 group ${
                  resizeInner.axis === "x"
                    ? `top-0 ${resizeInner.edge === "left" ? "left-0" : "right-0"} h-full w-1.5 cursor-ew-resize`
                    : `left-0 ${resizeInner.edge === "top" ? "top-0" : "bottom-0"} w-full h-1.5 cursor-ns-resize`
                }`}
              >
                <div
                  className={`absolute bg-sertex-cyan/30 group-hover:bg-sertex-cyan/80 group-hover:shadow-[0_0_8px_rgba(0,240,255,0.8)] transition-all ${
                    resizeInner.axis === "x"
                      ? `top-1/2 -translate-y-1/2 ${resizeInner.edge === "left" ? "left-0 rounded-r" : "right-0 rounded-l"} h-16 w-1`
                      : `left-1/2 -translate-x-1/2 ${resizeInner.edge === "top" ? "top-0 rounded-b" : "bottom-0 rounded-t"} w-16 h-1`
                  }`}
                />
              </div>
            )}

            <NeuralLinkHeader
              lang={lang}
              stats={stats}
              dock={dock}
              allHidden={allHidden}
              presets={presets}
              activePreset={activePreset}
              isAdmin={isAdmin}
              onResetAllPanels={resetAllPanels}
              onToggleAllPanels={toggleAllPanels}
              onCycleDock={cycleDock}
              onSavePreset={savePreset}
              onLoadPreset={loadPreset}
              onDeletePreset={deletePreset}
              onStatClick={handleStatClick}
              onEditSystemQuota={editSystemQuota}
            />

            <SidebarTabBar
              tabOrder={tabOrder}
              canSeeTab={canSeeTab}
              tabMeta={TAB_META}
              activeTab={tab}
              setActiveTab={setTab}
              onReorder={handleReorder}
              floatingTabs={floatingTabs}
              onDetach={detachTab}
              onFocusFloating={focusFloating}
            />

            <div className="flex-1 overflow-y-auto scrollbar-sertex p-3 space-y-2">
              {floatingTabs[tab] ? (
                <div className="text-center py-8 space-y-3" data-testid={`sidebar-tab-floating-${tab}`}>
                  <div className="hud-text text-sertex-textMuted">
                    Bu sekme ayrı bir pencerede yüzüyor.
                  </div>
                  <button
                    onClick={() => dockTab(tab)}
                    className="mx-auto py-1.5 px-3 border border-sertex-cyan/40 bg-sertex-cyan/10 hover:bg-sertex-cyan/20 rounded text-xs hud-text text-sertex-cyan flex items-center gap-1 transition-colors"
                    data-testid={`sidebar-redock-${tab}`}
                  >
                    ⬅ Sidebar'a Geri Koy
                  </button>
                  <button
                    onClick={() => focusFloating(tab)}
                    className="mx-auto py-1 px-3 text-[10px] hud-text text-sertex-textMuted hover:text-sertex-cyan transition-colors"
                    data-testid={`sidebar-focus-floating-${tab}`}
                  >
                    veya yüzen pencereyi öne getir
                  </button>
                </div>
              ) : (
                renderBody(tab)
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <FloatingTabsHost
        activeFloatingKeys={activeFloatingKeys}
        tabMeta={TAB_META}
        tabZ={tabZ}
        onFocus={focusFloating}
        onDock={dockTab}
        sidebarBounds={sidebarBounds}
        renderBody={renderBody}
      />
    </>
  );
};

export default Sidebar;
