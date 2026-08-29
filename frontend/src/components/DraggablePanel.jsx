import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import { Minus, Square, GripVertical, ChevronRight, ChevronLeft, ChevronUp, ChevronDown, Palette, Move } from "lucide-react";

// Persist window geometry per panel id in localStorage
const STORAGE_KEY = "sertex_windows_v1";

// Dock positions available for each panel
const DOCK_OPTIONS = [
  { key: "free", label: "Serbest" },
  { key: "right", label: "Sağ" },
  { key: "left", label: "Sol" },
  { key: "top", label: "Üst" },
  { key: "bottom", label: "Alt" },
];

// Available accent colors — chosen for the dark holographic theme
const ACCENTS = [
  { key: "cyan",    hex: "#00f0ff", label: "Cyan" },
  { key: "blue",    hex: "#60a5fa", label: "Mavi" },
  { key: "violet",  hex: "#a78bfa", label: "Menekşe" },
  { key: "pink",    hex: "#f472b6", label: "Pembe" },
  { key: "rose",    hex: "#fb7185", label: "Gül" },
  { key: "amber",   hex: "#fbbf24", label: "Kehribar" },
  { key: "lime",    hex: "#a3e635", label: "Limon" },
  { key: "emerald", hex: "#34d399", label: "Zümrüt" },
  { key: "white",   hex: "#e5e7eb", label: "Beyaz" },
];
const DEFAULT_ACCENT = ACCENTS[0].hex;

const loadState = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (e) {
    return {};
  }
};

const saveState = (id, patch) => {
  try {
    const all = loadState();
    all[id] = { ...(all[id] || {}), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) { console.warn("[DraggablePanel.jsx] hata bastırıldı:", e); }
};

/**
 * DraggablePanel — Windows-like floating HUD window.
 * Props:
 *   id: unique key for persistence
 *   title: shown in the drag header
 *   defaultPos: { x, y } (can be negative from right edge if `anchorRight`)
 *   defaultSize: { width, height }
 *   minWidth, minHeight
 *   anchorRight: if true, position is calculated from right edge
 *   children: panel content
 *   minimizedContent: optional custom minimized label
 */
const DraggablePanel = ({
  id,
  title,
  defaultPos,
  defaultSize,
  minWidth = 200,
  minHeight = 60,
  anchorRight = false,
  children,
  headerRight,
  testId,
}) => {
  const [saved] = useState(() => loadState()[id] || {});
  const initialPos = {
    x: saved.x ?? (anchorRight ? window.innerWidth - defaultPos.x - defaultSize.width : defaultPos.x),
    y: saved.y ?? defaultPos.y,
  };
  const initialSize = {
    width: saved.width ?? defaultSize.width,
    height: saved.height ?? defaultSize.height,
  };
  const [pos, setPos] = useState(initialPos);
  const [size, setSize] = useState(initialSize);
  const [minimized, setMinimized] = useState(saved.minimized ?? false);
  const [hidden, setHidden] = useState(saved.hidden ?? false);
  const [accent, setAccent] = useState(saved.accent ?? DEFAULT_ACCENT);
  const [dock, setDock] = useState(saved.dock ?? "free");
  const [showPalette, setShowPalette] = useState(false);
  const [showDockMenu, setShowDockMenu] = useState(false);
  const paletteRef = useRef(null);
  const dockRef = useRef(null);
  // Track whether the user is actively dragging so we can ignore spurious
  // Rnd `onDragStop` invocations (Rnd sometimes fires drag events on mount,
  // resize, or programmatic position updates — those would run `applySnap`
  // and silently drift the panel to a nearby edge, e.g. 20 px → 25 px when
  // another panel sits 5 px below).
  const draggingRef = useRef(false);

  useEffect(() => {
    saveState(id, { minimized });
  }, [id, minimized]);

  useEffect(() => {
    saveState(id, { hidden });
  }, [id, hidden]);

  useEffect(() => {
    saveState(id, { accent });
  }, [id, accent]);

  useEffect(() => {
    saveState(id, { dock });
  }, [id, dock]);

  // Close dock menu when clicking outside
  useEffect(() => {
    if (!showDockMenu) return;
    const onDoc = (e) => {
      if (dockRef.current && !dockRef.current.contains(e.target)) {
        setShowDockMenu(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showDockMenu]);

  // NOTE: auto-clamp on bounds change removed by user request — panels stay where
  // the user placed them; if two panels overlap, the user drags one aside.
  // The `bounds="#hud-bounds"` on Rnd still restricts NEW drag operations, so users
  // can't accidentally drag a panel behind the sidebar.

  // Listen for "toggle all HUD panels" event (fired from sidebar's "Tümünü Gizle/Aç" button)
  useEffect(() => {
    const onToggleAll = (e) => {
      const shouldHide = e?.detail?.hide;
      setHidden(!!shouldHide);
    };
    window.addEventListener("sertex:toggle-all-panels", onToggleAll);
    return () => window.removeEventListener("sertex:toggle-all-panels", onToggleAll);
  }, []);

  // Listen for "reset all panels" event → restore to factory defaults from props
  useEffect(() => {
    const onReset = () => {
      setPos({
        x: anchorRight
          ? window.innerWidth - defaultPos.x - defaultSize.width
          : defaultPos.x,
        y: defaultPos.y,
      });
      setSize({ width: defaultSize.width, height: defaultSize.height });
      setMinimized(false);
      setHidden(false);
      setAccent(DEFAULT_ACCENT);
      setDock("free");
    };
    window.addEventListener("sertex:reset-all-panels", onReset);
    return () => window.removeEventListener("sertex:reset-all-panels", onReset);
  }, [anchorRight, defaultPos.x, defaultPos.y, defaultSize.width, defaultSize.height]);

  // NOTE (Faz 9 CP4.1 — Panel-drift fix): the `sertex:shift-down-{testId}` event
  // listener + companion `showPanel()` overlap detection were removed. Both
  // used to mutate a panel's y-position (and localStorage) whenever another
  // panel was hidden/restored nearby, causing a cumulative downward drift
  // (~5 px per cycle) that eventually slid panels off-screen. Panels now stay
  // exactly where the user placed them — matching the invariant already
  // documented at line 120 above.

  // Close palette popover when clicking outside
  useEffect(() => {
    if (!showPalette) return;
    const onDoc = (e) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target)) {
        setShowPalette(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showPalette]);

  const toggleMinimize = () => setMinimized((m) => !m);
  const hidePanel = () => setHidden(true);
  const showPanel = () => setHidden(false);

  // ---- Snap-to-edge helper lines (visible during active drag only) ----
  const SNAP_THRESHOLD = 8;
  const [snapLines, setSnapLines] = useState([]); // [{orient:'v'|'h', at:number}]

  /** Compute snap targets from hud-bounds + other panels + screen halves. */
  const collectSnapTargets = () => {
    const targets = { v: [], h: [] };
    // hud-bounds edges (respects sidebar)
    const bounds = document.getElementById("hud-bounds")?.getBoundingClientRect();
    if (bounds) {
      targets.v.push(bounds.left, bounds.right, bounds.left + bounds.width / 2);
      targets.h.push(bounds.top, bounds.bottom, bounds.top + bounds.height / 2);
    } else {
      targets.v.push(0, window.innerWidth, window.innerWidth / 2);
      targets.h.push(0, window.innerHeight, window.innerHeight / 2);
    }
    // Other panel edges — outer Rnd wrappers are marked with data-sertex-panel="1"
    document.querySelectorAll('[data-sertex-panel="1"]').forEach((el) => {
      if (el.getAttribute("data-testid") === testId) return; // skip self
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) return;
      targets.v.push(r.left, r.right);
      targets.h.push(r.top, r.bottom);
    });
    return targets;
  };

  const applySnap = (x, y) => {
    const w = size.width;
    const h = minimized ? 34 : size.height;
    const targets = collectSnapTargets();
    const edgesX = [x, x + w / 2, x + w]; // left, centerX, right
    const edgesY = [y, y + h / 2, y + h]; // top, centerY, bottom
    let snapX = x;
    let snapY = y;
    let bestX = SNAP_THRESHOLD + 1;
    let bestY = SNAP_THRESHOLD + 1;
    let lineX = null;
    let lineY = null;
    for (let i = 0; i < edgesX.length; i++) {
      for (const t of targets.v) {
        const d = Math.abs(edgesX[i] - t);
        if (d <= SNAP_THRESHOLD && d < bestX) {
          bestX = d;
          snapX = t - (i === 0 ? 0 : i === 1 ? w / 2 : w);
          lineX = t;
        }
      }
    }
    for (let i = 0; i < edgesY.length; i++) {
      for (const t of targets.h) {
        const d = Math.abs(edgesY[i] - t);
        if (d <= SNAP_THRESHOLD && d < bestY) {
          bestY = d;
          snapY = t - (i === 0 ? 0 : i === 1 ? h / 2 : h);
          lineY = t;
        }
      }
    }
    const lines = [];
    if (lineX !== null) lines.push({ orient: "v", at: lineX });
    if (lineY !== null) lines.push({ orient: "h", at: lineY });
    setSnapLines(lines);
    return { x: snapX, y: snapY };
  };

  // Determine which EDGE the restore chip should stack on.
  //   Docked panel → same edge as its dock
  //   Free panel   → nearest edge based on center point
  let chipEdge, RestoreIcon, HideIcon;
  if (dock === "right") {
    chipEdge = "right"; RestoreIcon = ChevronLeft; HideIcon = ChevronRight;
  } else if (dock === "left") {
    chipEdge = "left"; RestoreIcon = ChevronRight; HideIcon = ChevronLeft;
  } else if (dock === "top") {
    chipEdge = "top"; RestoreIcon = ChevronDown; HideIcon = ChevronUp;
  } else if (dock === "bottom") {
    chipEdge = "bottom"; RestoreIcon = ChevronUp; HideIcon = ChevronDown;
  } else {
    const panelCenterX = pos.x + size.width / 2;
    const isLeftSide = panelCenterX < window.innerWidth / 2;
    chipEdge = isLeftSide ? "left" : "right";
    RestoreIcon = isLeftSide ? ChevronRight : ChevronLeft;
    HideIcon = isLeftSide ? ChevronLeft : ChevronRight;
  }
  const chipBorderRadius = {
    left: "0 6px 6px 0",
    right: "6px 0 0 6px",
    top: "0 0 6px 6px",
    bottom: "6px 6px 0 0",
  }[chipEdge];

  // Render restore chip when hidden — portal into the edge's flex stack container.
  if (hidden) {
    const container = typeof document !== "undefined"
      ? document.getElementById(`chip-stack-${chipEdge}`)
      : null;
    const chipBtn = (
      <button
        onClick={showPanel}
        style={{ borderRadius: chipBorderRadius, borderColor: accent + "80", color: accent, pointerEvents: "auto" }}
        className="glass-panel px-1.5 py-1.5 flex items-center gap-1 hover:brightness-125 transition-all group border shrink-0"
        data-testid={`${testId}-restore`}
        title={`${title} — göster`}
      >
        <RestoreIcon className="h-3.5 w-3.5" style={{ color: accent }} />
        <span className="hud-text max-w-[110px] truncate" style={{ color: accent, opacity: 0.85 }}>
          {title}
        </span>
      </button>
    );
    // Fallback if portal target missing (defensive)
    if (!container) return chipBtn;
    return createPortal(chipBtn, container);
  }

  // Panel body — same JSX used for free (Rnd) and docked (fixed) modes.
  const bodyContent = (
    <div
      className="w-full h-full glass-panel corner-bracket flex flex-col overflow-hidden"
      style={{ position: "relative", borderColor: accent + "40", "--panel-accent": accent }}
    >
        {/* Drag header */}
        <div
          className={`panel-drag-${id} flex items-center justify-between px-2 py-1 border-b select-none transition-colors ${dock === "free" ? "cursor-move" : "cursor-default"}`}
          style={{
            borderBottomColor: accent + "33",
            backgroundColor: accent + "0d",
          }}
          onDoubleClick={toggleMinimize}
          data-testid={`${testId}-header`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <GripVertical className="h-3 w-3 text-sertex-textMuted shrink-0" />
            <span className="hud-text truncate" style={{ color: accent }}>{title}</span>
          </div>
          <div
            className="flex items-center gap-1 relative"
            // Faz 9 CP4.1: swallow native mousedown so Rnd doesn't interpret a
            // click on these header buttons as a zero-distance drag (which
            // would fire onDragStart+onDragStop and let applySnap slide the
            // panel to a nearby edge, causing the +5 px hide/show drift).
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {headerRight}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDockMenu((s) => !s);
                setShowPalette(false);
              }}
              data-testid={`${testId}-dock`}
              className="p-0.5 hover:bg-white/10 rounded-sm text-sertex-textMuted transition-colors"
              style={{ color: showDockMenu || dock !== "free" ? accent : undefined }}
              title="Konumlandır"
            >
              <Move className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowPalette((s) => !s);
                setShowDockMenu(false);
              }}
              data-testid={`${testId}-palette`}
              className="p-0.5 hover:bg-white/10 rounded-sm text-sertex-textMuted transition-colors"
              style={{ color: showPalette ? accent : undefined }}
              title="Renk seç"
            >
              <Palette className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMinimize();
              }}
              data-testid={`${testId}-minimize`}
              className="p-0.5 hover:bg-white/10 rounded-sm text-sertex-textMuted hover:text-white transition-colors"
              title={minimized ? "Büyüt" : "Küçült"}
            >
              {minimized ? (
                <Square className="h-3 w-3" />
              ) : (
                <Minus className="h-3 w-3" />
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                hidePanel();
              }}
              data-testid={`${testId}-hide`}
              className="p-0.5 hover:bg-white/10 rounded-sm text-sertex-textMuted hover:text-white transition-colors"
              title="Gizle (kenara al)"
            >
              <HideIcon className="h-3 w-3" />
            </button>

            {/* Dock menu popover */}
            {showDockMenu && (
              <div
                ref={dockRef}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                data-testid={`${testId}-dock-popover`}
                className="absolute top-6 right-0 z-50 glass-panel border rounded-md p-2 shadow-lg"
                style={{ borderColor: accent + "55" }}
              >
                <div className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: accent }}>
                  Konum
                </div>
                <div className="grid grid-cols-2 gap-1 w-[120px]">
                  {DOCK_OPTIONS.map((d) => (
                    <button
                      key={d.key}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDock(d.key);
                        setShowDockMenu(false);
                      }}
                      data-testid={`${testId}-dock-${d.key}`}
                      className="px-1.5 py-1 rounded border text-[10px] font-mono hover:brightness-125 transition-all"
                      style={{
                        borderColor: dock === d.key ? accent : accent + "33",
                        background: dock === d.key ? accent + "1a" : "transparent",
                        color: dock === d.key ? accent : "#94a3b8",
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Palette popover */}
            {showPalette && (
              <div
                ref={paletteRef}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                data-testid={`${testId}-palette-popover`}
                className="absolute top-6 right-0 z-50 glass-panel border rounded-md p-2 shadow-lg"
                style={{ borderColor: accent + "55" }}
              >
                <div className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: accent }}>
                  Renk Seç
                </div>
                <div className="grid grid-cols-5 gap-1.5 w-[130px]">
                  {ACCENTS.map((c) => (
                    <button
                      key={c.key}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAccent(c.hex);
                        setShowPalette(false);
                      }}
                      data-testid={`${testId}-color-${c.key}`}
                      title={c.label}
                      className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-125 ${
                        accent === c.hex ? "border-white" : "border-white/20"
                      }`}
                      style={{
                        background: c.hex,
                        boxShadow: accent === c.hex ? `0 0 8px ${c.hex}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        {!minimized && (
          <div className="flex-1 overflow-auto scrollbar-sertex">{children}</div>
        )}
      </div>
  );

  // Docked mode: fixed-positioned along an edge, full length along that edge
  if (dock !== "free") {
    const dockedStyle = { position: "fixed", zIndex: 30 };
    if (dock === "right") {
      dockedStyle.top = 0; dockedStyle.right = 0; dockedStyle.bottom = 0;
      dockedStyle.width = size.width;
    } else if (dock === "left") {
      dockedStyle.top = 0; dockedStyle.left = 0; dockedStyle.bottom = 0;
      dockedStyle.width = size.width;
    } else if (dock === "top") {
      dockedStyle.top = 0; dockedStyle.left = 0; dockedStyle.right = 0;
      dockedStyle.height = minimized ? 34 : size.height;
    } else if (dock === "bottom") {
      dockedStyle.bottom = 0; dockedStyle.left = 0; dockedStyle.right = 0;
      dockedStyle.height = minimized ? 34 : size.height;
    }
    return (
      <div style={dockedStyle} data-testid={testId}>
        {bodyContent}
      </div>
    );
  }

  return (
    <>
      {snapLines.map((l, i) => (
        <div
          key={i}
          className="fixed pointer-events-none"
          style={{
            zIndex: 55,
            background: accent,
            boxShadow: `0 0 6px ${accent}`,
            ...(l.orient === "v"
              ? { left: l.at, top: 0, bottom: 0, width: 1 }
              : { top: l.at, left: 0, right: 0, height: 1 }),
          }}
        />
      ))}
      <Rnd
      size={{ width: size.width, height: minimized ? 34 : size.height }}
      position={pos}
      minWidth={minWidth}
      minHeight={minimized ? 34 : minHeight}
      maxWidth={window.innerWidth - 20}
      maxHeight={window.innerHeight - 20}
      bounds="#hud-bounds"
      dragHandleClassName={`panel-drag-${id}`}
      enableResizing={!minimized}
      onDragStart={() => {
        draggingRef.current = true;
      }}
      onDrag={(e, d) => {
        if (!draggingRef.current) return;
        const snapped = applySnap(d.x, d.y);
        if (snapped.x !== d.x || snapped.y !== d.y) {
          // Nudge Rnd to the snapped coordinates
          return snapped;
        }
      }}
      onDragStop={(e, d) => {
        // Guard: Rnd occasionally fires this outside a real drag (StrictMode
        // re-renders, unmount cleanup, ResizeObserver ticks). Snapping then
        // would push us onto a nearby panel edge and permanently save the
        // drifted y. Skip unless the user actually dragged.
        if (!draggingRef.current) return;
        draggingRef.current = false;
        const snapped = applySnap(d.x, d.y);
        setPos(snapped);
        saveState(id, snapped);
        setSnapLines([]);
      }}
      onResizeStop={(e, direction, ref, delta, newPos) => {
        const w = parseInt(ref.style.width, 10);
        const h = parseInt(ref.style.height, 10);
        setSize({ width: w, height: h });
        setPos(newPos);
        saveState(id, { width: w, height: h, x: newPos.x, y: newPos.y });
      }}
      className="z-30"
      data-testid={testId}
      data-sertex-panel="1"
      resizeHandleStyles={{
        bottomRight: {
          background:
            "linear-gradient(135deg, transparent 55%, rgba(0,240,255,0.5) 55%, rgba(0,240,255,0.5) 60%, transparent 60%, transparent 70%, rgba(0,240,255,0.35) 70%, rgba(0,240,255,0.35) 75%, transparent 75%)",
          width: 14,
          height: 14,
          right: 2,
          bottom: 2,
        },
      }}
    >
      {bodyContent}
    </Rnd>
    </>
  );
};

export default DraggablePanel;
