import React, { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, Check, RotateCcw, Trash2 } from "lucide-react";

/**
 * Compact floating "quick preset" switcher.
 *
 * Renders only when the sidebar is CLOSED and the user has saved ≥1 layout
 * preset. Lets the user hop between saved HUD layouts without having to
 * open the sidebar first. Sits just past the `sidebar-toggle` button on the
 * same edge (falls back to top-left if `dock` isn't recognised).
 *
 * All state (presets list, active preset, load handler) is passed in from
 * `Sidebar.jsx` — this component owns no persistence and NEVER mutates
 * anything the sidebar didn't already mutate itself.
 */
const QuickPresetSwitcher = ({ presets, activePreset, onLoadPreset, onOverwritePreset, onDeletePreset, dock, sidebarOpen, sidebarDims }) => {
  const [open, setOpen] = useState(false);
  // Faz 9 CP4.4 — track which preset the cursor is on so we can float a
  // larger preview next to the dropdown. `null` = nothing hovered.
  const [previewName, setPreviewName] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const names = Object.keys(presets || {}).sort();
  if (sidebarOpen || names.length === 0) return null;

  // Position the trigger a touch offset from the sidebar-toggle button so
  // both can be reached at a glance. Falls back to a safe top-left corner
  // if the dock is anything unexpected. The sidebar toggle itself lives at
  // `top: 50%` when docked left/right — we place ourselves ~40 px past it
  // on the same axis.
  const style = { position: "fixed", zIndex: 40 };
  if (dock === "right") {
    style.top = "calc(50% + 40px)";
    style.right = 4;
    style.transform = "translateY(-50%)";
  } else if (dock === "left") {
    style.top = "calc(50% + 40px)";
    style.left = 4;
    style.transform = "translateY(-50%)";
  } else if (dock === "top") {
    style.top = 4;
    style.left = "calc(50% + 40px)";
    style.transform = "translateX(-50%)";
  } else if (dock === "bottom") {
    style.bottom = 4;
    style.left = "calc(50% + 40px)";
    style.transform = "translateX(-50%)";
  } else {
    style.top = 60;
    style.left = 4;
  }

  const label = activePreset && presets[activePreset] ? activePreset : "DÜZEN";

  return (
    <div ref={ref} style={style} data-testid="quick-preset-switcher">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="quick-preset-toggle"
        title={`Kayıtlı düzenler (${names.length})`}
        className={`glass-panel border rounded flex items-center gap-1 px-2 py-1 hud-text transition-colors ${
          open
            ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10 neon-glow"
            : "border-sertex-cyan/30 text-sertex-cyan/80 hover:bg-sertex-cyan/10"
        }`}
      >
        <Bookmark className="h-3 w-3" />
        <span className="max-w-[80px] truncate">{label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          data-testid="quick-preset-list"
          className="mt-1 glass-panel border border-sertex-cyan/40 rounded p-1 min-w-[220px] max-h-[420px] overflow-y-auto scrollbar-sertex shadow-lg"
          onMouseLeave={() => setPreviewName(null)}
        >
          {names.map((n) => {
            const isActive = n === activePreset;
            const thumb = presets[n]?.__thumbnail;
            return (
              <div
                key={n}
                className={`w-full flex items-center gap-2 px-1.5 py-1.5 rounded transition-colors group ${
                  isActive
                    ? "bg-sertex-cyan/15 text-sertex-cyan"
                    : "text-sertex-textSecondary hover:bg-sertex-cyan/10 hover:text-sertex-cyan"
                }`}
                onMouseEnter={() => setPreviewName(n)}
              >
                <button
                  type="button"
                  data-testid={`quick-preset-item-${n}`}
                  onClick={() => {
                    onLoadPreset(n);
                    setOpen(false);
                  }}
                  onFocus={() => setPreviewName(n)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left text-xs font-mono"
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      data-testid={`quick-preset-thumb-${n}`}
                      className="w-16 h-9 rounded object-cover shrink-0 border border-sertex-cyan/30"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="w-16 h-9 rounded shrink-0 border border-sertex-cyan/20 bg-sertex-cyan/5 flex items-center justify-center"
                    >
                      <Bookmark className="h-3 w-3 text-sertex-cyan/40" />
                    </div>
                  )}
                  <span className="flex-1 truncate">{n}</span>
                </button>
                {isActive && <Check className="h-3 w-3 shrink-0" />}
                {onOverwritePreset && (
                  // Faz 9 CP4.8 — one-click "üzerine yaz" quick-action.
                  // Hidden by default, revealed on row hover / focus-within
                  // so the row stays clean at rest but stays discoverable.
                  <button
                    type="button"
                    data-testid={`quick-preset-overwrite-${n}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOverwritePreset(n);
                    }}
                    title="Şu anki düzeni bu preset'in üzerine yaz"
                    className="p-1 rounded border border-sertex-cyan/30 text-sertex-cyan/70 hover:text-sertex-cyan hover:bg-sertex-cyan/20 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
                {onDeletePreset && (
                  // Faz 9 CP4.9 — hover-visible delete. Confirms via
                  // native browser dialog before removing; safe because
                  // the confirmation is unskippable.
                  <button
                    type="button"
                    data-testid={`quick-preset-delete-${n}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePreset(n);
                    }}
                    title={`"${n}" düzenini sil`}
                    className="p-1 rounded border border-sertex-danger/30 text-sertex-danger/70 hover:text-sertex-danger hover:bg-sertex-danger/20 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Faz 9 CP4.4 — full-size hover preview popover. Renders only when
          the dropdown is open, an item is hovered, and that item has a
          stored thumbnail. Position mirrors the dock so the popover never
          overlaps the trigger: on right/left docks it sits horizontally
          beside the dropdown, on top/bottom docks it drops beneath. */}
      {open && previewName && presets[previewName]?.__thumbnail && (
        <div
          data-testid={`quick-preset-preview-${previewName}`}
          className="absolute glass-panel border border-sertex-cyan/50 rounded-md p-1.5 shadow-2xl pointer-events-none"
          style={(() => {
            // Preview card is 400×225 (16:9-ish). Anchor it opposite to the
            // trigger side so it doesn't get clipped by the viewport edge.
            // Explicit width because the switcher container is only ~220 px
            // wide — without a width the absolute box would shrink-wrap.
            const s = {
              zIndex: 60,
              background: "rgba(6,10,20,0.92)",
              width: 420,
            };
            if (dock === "right") {
              // Trigger sits on the right → put preview to its LEFT.
              s.right = "calc(100% + 8px)";
              s.top = 0;
            } else if (dock === "left") {
              s.left = "calc(100% + 8px)";
              s.top = 0;
            } else if (dock === "top") {
              s.top = "calc(100% + 8px)";
              s.left = 0;
            } else if (dock === "bottom") {
              s.bottom = "calc(100% + 8px)";
              s.left = 0;
            } else {
              s.left = "calc(100% + 8px)";
              s.top = 0;
            }
            return s;
          })()}
        >
          <img
            src={presets[previewName].__thumbnail}
            alt=""
            className="rounded w-full"
            style={{ height: 225, objectFit: "cover" }}
          />
          <div className="mt-1.5 px-1 hud-text text-sertex-cyan flex items-center justify-between">
            <span className="truncate">{previewName}</span>
            {previewName === activePreset && (
              <span className="text-[9px] text-emerald-300 ml-2 shrink-0">AKTİF</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickPresetSwitcher;
