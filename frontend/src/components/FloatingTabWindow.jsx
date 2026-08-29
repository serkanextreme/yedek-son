import React, { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { Minus, Square, ArrowLeft, Palette } from "lucide-react";
import { ResizeGrip } from "./ResizeGrip";

/**
 * FloatingTabWindow — a sidebar tab detached into a resizable/movable
 * HUD-style window. Uses react-rnd (same lib as HUD panels). Position &
 * size persist per-tab in localStorage under `sertex_floating_tabs_geom_v1`.
 * Reattach is done either via the dock button in the header or by
 * dropping the window onto the sidebar bounds (visual feedback via border
 * glow).
 *
 * Faz 9 CP4.10 — per-tab accent colour picker. Mirrors the palette UX from
 * DraggablePanel. Accent is stored alongside geometry so it survives
 * detach/reattach and full reloads.
 */
const GEOM_KEY = "sertex_floating_tabs_geom_v1";
const DEFAULT_W = 380;
const DEFAULT_H = 480;
const MIN_W = 260;
const MIN_H = 180;

// Same palette as DraggablePanel — one canonical set of accent hexes so
// HUD panels and detached tabs share visual vocabulary.
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

const loadGeom = () => {
  try { return JSON.parse(localStorage.getItem(GEOM_KEY) || "{}"); } catch { return {}; }
};
const saveGeom = (tabKey, patch) => {
  try {
    const all = loadGeom();
    all[tabKey] = { ...(all[tabKey] || {}), ...patch };
    localStorage.setItem(GEOM_KEY, JSON.stringify(all));
  } catch (e) { console.warn("[FloatingTabWindow.jsx] hata bastırıldı:", e); }
};

// Faz 9 CP4.12 — delete a specific field from a tab's geom entry (used
// by the "Sıfırla" button to fully clear an accent so the sidebar
// falls back to default cyan styling rather than pinning to cyan).
const clearGeomField = (tabKey, field) => {
  try {
    const all = loadGeom();
    if (all[tabKey]) {
      delete all[tabKey][field];
      localStorage.setItem(GEOM_KEY, JSON.stringify(all));
    }
  } catch (e) { console.warn("[FloatingTabWindow.jsx] hata bastırıldı:", e); }
};

const overlapsBounds = (x, y, w, h, sb) => {
  if (!sb) return false;
  return !(x + w < sb.left || x > sb.right || y + h < sb.top || y > sb.bottom);
};

const FloatingTabWindow = ({
  tabKey,
  title,
  icon: Icon,
  testId,
  children,
  zIndex = 40,
  onFocus,
  onDock,
  sidebarBounds,
  initialOffset = 0,
}) => {
  const saved = loadGeom()[tabKey] || {};

  // If no saved position, choose a sensible spot away from the sidebar edge
  const clampX = (x) => Math.max(20, Math.min(window.innerWidth - MIN_W - 20, x));
  const clampY = (y) => Math.max(20, Math.min(window.innerHeight - MIN_H - 20, y));

  const [pos, setPos] = useState({
    x: clampX(saved.x ?? Math.round(window.innerWidth * 0.15 + initialOffset)),
    y: clampY(saved.y ?? Math.round(window.innerHeight * 0.15 + initialOffset)),
  });
  const [size, setSize] = useState({
    width: saved.width ?? DEFAULT_W,
    height: saved.height ?? DEFAULT_H,
  });
  const [minimized, setMinimized] = useState(!!saved.minimized);
  const [dragOverSidebar, setDragOverSidebar] = useState(false);
  // Faz 9 CP4.10 — per-tab accent.
  const [accent, setAccent] = useState(saved.accent ?? DEFAULT_ACCENT);
  const [showPalette, setShowPalette] = useState(false);
  const paletteRef = useRef(null);
  // When true, the accent useEffect below skips its persist so a Reset
  // action doesn't immediately re-write DEFAULT_ACCENT into LS.
  const skipNextAccentPersistRef = useRef(false);

  // Persist accent whenever it changes.
  useEffect(() => {
    if (skipNextAccentPersistRef.current) {
      skipNextAccentPersistRef.current = false;
      return;
    }
    saveGeom(tabKey, { accent });
    // Faz 9 CP4.11 — broadcast so SidebarTabBar re-reads its accent map
    // and repaints the corresponding tab button. Detached-vs-docked visual
    // continuity without any new UI on the sidebar itself.
    try {
      window.dispatchEvent(new CustomEvent("sertex:floating-tab-accent-changed", {
        detail: { tabKey, accent },
      }));
    } catch (e) { console.warn("[FloatingTabWindow.jsx] hata bastırıldı:", e); }
  }, [tabKey, accent]);

  // Faz 9 CP4.12 — reset accent to default (removes it from LS entirely
  // so the sidebar reverts to its default cyan styling rather than
  // pinning the explicit cyan colour).
  const resetAccent = () => {
    clearGeomField(tabKey, "accent");
    skipNextAccentPersistRef.current = true;
    setAccent(DEFAULT_ACCENT);
    try {
      window.dispatchEvent(new CustomEvent("sertex:floating-tab-accent-changed", {
        detail: { tabKey, accent: null },
      }));
    } catch (e) { console.warn("[FloatingTabWindow.jsx] hata bastırıldı:", e); }
    setShowPalette(false);
  };

  // Close palette popover on outside click.
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

  const toggleMinimize = () => {
    setMinimized((v) => {
      const next = !v;
      saveGeom(tabKey, { minimized: next });
      return next;
    });
  };

  const focus = () => { onFocus?.(); };

  return (
    <Rnd
      position={pos}
      size={{ width: size.width, height: minimized ? 42 : size.height }}
      minWidth={MIN_W}
      minHeight={minimized ? 42 : MIN_H}
      bounds="window"
      dragHandleClassName={`floating-tab-header-${tabKey}`}
      onDragStart={focus}
      onDrag={(e, d) => {
        if (sidebarBounds) {
          const w = size.width;
          const h = minimized ? 42 : size.height;
          setDragOverSidebar(overlapsBounds(d.x, d.y, w, h, sidebarBounds));
        }
      }}
      onDragStop={(e, d) => {
        const w = size.width;
        const h = minimized ? 42 : size.height;
        if (sidebarBounds && overlapsBounds(d.x, d.y, w, h, sidebarBounds)) {
          setDragOverSidebar(false);
          onDock?.();
          return;
        }
        setDragOverSidebar(false);
        setPos({ x: d.x, y: d.y });
        saveGeom(tabKey, { x: d.x, y: d.y });
      }}
      onResizeStop={(e, dir, ref, delta, p) => {
        const w = parseInt(ref.style.width, 10) || DEFAULT_W;
        const h = parseInt(ref.style.height, 10) || DEFAULT_H;
        setSize({ width: w, height: h });
        setPos(p);
        saveGeom(tabKey, { x: p.x, y: p.y, width: w, height: h });
      }}
      onMouseDown={focus}
      style={{ zIndex }}
      enableResizing={!minimized}
      resizeHandleComponent={{ bottomRight: <ResizeGrip testId={testId} /> }}
      data-testid={`floating-${testId}`}
    >
      <div
        className="h-full flex flex-col glass-panel rounded-md overflow-hidden border transition-colors"
        style={{
          borderColor: dragOverSidebar ? accent : accent + "66",
          boxShadow: dragOverSidebar
            ? `0 0 24px ${accent}b0`
            : `0 4px 20px rgba(0,0,0,0.4)`,
        }}
      >
        <div
          className={`floating-tab-header-${tabKey} flex items-center gap-1.5 px-2 py-1.5 border-b cursor-move select-none`}
          style={{
            borderBottomColor: accent + "40",
            backgroundColor: accent + "0d",
          }}
        >
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />}
          <div className="flex-1 min-w-0 hud-text truncate" style={{ color: accent }}>
            {title}
            {dragOverSidebar && (
              <span className="ml-2 text-[9px] font-mono" style={{ color: accent, opacity: 0.8 }}>↩ dock</span>
            )}
          </div>
          {/* Palette (accent color picker) */}
          <div
            className="relative"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setShowPalette((s) => !s); }}
              title="Renk seç"
              className="p-0.5 hover:bg-white/10 rounded-sm transition-colors"
              style={{ color: showPalette ? accent : undefined }}
              data-testid={`floating-${testId}-palette`}
            >
              <Palette className="h-3 w-3" />
            </button>
            {showPalette && (
              <div
                ref={paletteRef}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                data-testid={`floating-${testId}-palette-popover`}
                className="absolute top-6 right-0 z-50 glass-panel border rounded-md p-2 shadow-lg"
                style={{ borderColor: accent + "55", background: "rgba(6,10,20,0.94)" }}
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
                      data-testid={`floating-${testId}-color-${c.key}`}
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
                <button
                  onClick={(e) => { e.stopPropagation(); resetAccent(); }}
                  data-testid={`floating-${testId}-color-reset`}
                  title="Rengi varsayılana döndür"
                  className="mt-2 w-full flex items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wider py-1 rounded border border-sertex-textMuted/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50 transition-colors"
                >
                  ↺ Sıfırla
                </button>
              </div>
            )}
          </div>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); toggleMinimize(); }}
            title={minimized ? "Genişlet" : "Küçült"}
            className="p-0.5 hover:text-sertex-cyan transition-colors"
            style={{ color: "#94a3b8" }}
            data-testid={`floating-${testId}-min`}
          >
            {minimized ? <Square className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDock?.(); }}
            title="Sidebar'a geri koy"
            className="p-0.5 border rounded transition-colors"
            style={{
              borderColor: accent + "66",
              color: accent,
              background: "transparent",
            }}
            data-testid={`floating-${testId}-dock`}
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
        </div>
        {!minimized && (
          <div className="flex-1 overflow-y-auto scrollbar-sertex p-3 space-y-2">
            {children}
          </div>
        )}
      </div>
    </Rnd>
  );
};

export default FloatingTabWindow;
