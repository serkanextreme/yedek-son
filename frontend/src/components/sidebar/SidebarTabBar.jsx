import React from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ExternalLink, GripVertical } from "lucide-react";

// Faz 9 CP4.11 — reflect a detached tab's accent colour on the sidebar
// tab button too so users don't lose track of colour → identity when the
// tab is re-docked. Reads from `sertex_floating_tabs_geom_v1` (same key
// FloatingTabWindow writes to) and re-syncs on the accent-changed event.
const GEOM_KEY = "sertex_floating_tabs_geom_v1";
const readAccentMap = () => {
  try {
    const all = JSON.parse(localStorage.getItem(GEOM_KEY) || "{}");
    const out = {};
    for (const [k, v] of Object.entries(all)) {
      if (v && v.accent) out[k] = v.accent;
    }
    return out;
  } catch {
    return {};
  }
};

/**
 * A single reorderable sidebar tab. Long-press / grip handle triggers the
 * horizontal drag-to-reorder gesture. When the tab is currently detached
 * (floating outside the sidebar), it renders muted/italic and clicking it
 * both focuses the floating window and activates it in the sidebar (so the
 * "redock" placeholder is directly reachable).
 */
const DraggableTab = ({
  tabKey,
  active,
  onClick,
  icon: Icon,
  label,
  testId,
  isFloating = false,
  onDetach,
  onFocusFloating,
  accent, // Faz 9 CP4.11 — optional per-tab accent (undefined = default cyan).
}) => {
  const controls = useDragControls();
  const [isDragging, setIsDragging] = React.useState(false);
  const useAccent = !!accent;
  return (
    <Reorder.Item
      value={tabKey}
      dragListener={false}
      dragControls={controls}
      as="div"
      className="flex-1 min-w-0 group/tab"
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setTimeout(() => setIsDragging(false), 50)}
      whileDrag={{ scale: 1.08, zIndex: 50, boxShadow: "0 6px 24px rgba(0,240,255,0.5)" }}
      data-testid={`tab-wrap-${tabKey}`}
    >
      <div
        className={`flex items-center gap-1.5 py-2 px-1 border-b-2 transition-colors hud-text text-[10px] select-none ${
          isFloating
            ? "border-transparent text-sertex-textMuted/50 italic"
            : active
            ? (useAccent ? "" : "border-sertex-cyan text-sertex-cyan neon-glow")
            : (useAccent ? "border-transparent" : "border-transparent text-sertex-textMuted hover:text-sertex-textSecondary")
        }`}
        style={useAccent && !isFloating ? {
          cursor: "grab",
          borderBottomColor: active ? accent : "transparent",
          color: active ? accent : accent + "aa",
          textShadow: active ? `0 0 6px ${accent}80` : undefined,
        } : undefined}
        onClick={() => {
          if (isDragging) return; // avoid selecting tab right after dropping
          if (isFloating) {
            // For floating tabs: bring window to front AND set as active
            // sidebar tab, so the redock placeholder shows in the sidebar body.
            onFocusFloating?.();
            onClick();
            return;
          }
          onClick();
        }}
        onPointerDown={(e) => {
          // Long-press on the label body also triggers reorder drag after 250ms
          const target = e.currentTarget;
          const startX = e.clientX;
          const startY = e.clientY;
          const timer = setTimeout(() => {
            controls.start(e);
          }, 250);
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
        title={
          isFloating
            ? `${label} — ayrı pencerede yüzüyor. Tıkla odakla.`
            : `${label} — basılı tutup sırala · ↗ butonu ile ayrı pencere yap`
        }
        data-testid={testId}
      >
        <span
          className="hidden xl:inline text-sertex-cyan/70 hover:text-sertex-cyan active:text-sertex-cyan cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(e) => {
            e.stopPropagation();
            controls.start(e);
          }}
          data-testid={`tab-grip-${tabKey}`}
          title="Sürükleyerek sırala"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate flex-1">{label}</span>
        {!isFloating && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDetach?.(); }}
            title="Sidebar'dan çıkart (yüzen pencere)"
            className="opacity-0 group-hover/tab:opacity-100 text-sertex-cyan/70 hover:text-sertex-cyan transition-opacity shrink-0"
            data-testid={`tab-detach-${tabKey}`}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
    </Reorder.Item>
  );
};

const SidebarTabBar = ({
  tabOrder,
  canSeeTab,
  tabMeta,
  activeTab,
  setActiveTab,
  onReorder,
  floatingTabs,
  onDetach,
  onFocusFloating,
}) => {
  // Faz 9 CP4.11 — subscribe to accent changes broadcast by FloatingTabWindow
  // and to the native `storage` event so cross-tab colour updates land too.
  const [accentMap, setAccentMap] = React.useState(readAccentMap);
  React.useEffect(() => {
    const refresh = () => setAccentMap(readAccentMap());
    window.addEventListener("sertex:floating-tab-accent-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("sertex:floating-tab-accent-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Only render tabs the current role+mode can see. Filtering here (rather than
  // in the parent's tabOrder state) means a Çift Mod quick-switch reveals/hides
  // team tabs instantly — no page reload needed.
  const visibleOrder = tabOrder.filter((tk) => (canSeeTab ? canSeeTab(tk) : true));

  return (
    <Reorder.Group
      axis="x"
      values={visibleOrder}
      onReorder={onReorder}
      className="flex border-b border-sertex-cyan/20"
      as="div"
      data-testid="sidebar-tab-bar"
    >
      {visibleOrder.map((tabKey) => {
        const meta = tabMeta[tabKey];
        if (!meta) return null;
        return (
          <DraggableTab
            key={tabKey}
            tabKey={tabKey}
            active={activeTab === tabKey}
            onClick={() => setActiveTab(tabKey)}
            icon={meta.icon}
            label={meta.label}
            testId={meta.testId}
            isFloating={!!floatingTabs[tabKey]}
            onDetach={() => onDetach(tabKey)}
            onFocusFloating={() => onFocusFloating(tabKey)}
            accent={accentMap[tabKey]}
          />
        );
      })}
    </Reorder.Group>
  );
};

export default SidebarTabBar;
