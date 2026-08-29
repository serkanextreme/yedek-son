import React from "react";
import FloatingTabWindow from "../FloatingTabWindow";

/**
 * Renders all currently-detached ("floating") sidebar tabs outside the
 * sidebar aside. Each entry becomes a separate resizable/movable HUD-style
 * window (react-rnd). The parent (Sidebar) owns:
 *   - the floatingTabs map (which tabs are floating)
 *   - the per-tab z-index map + zCounterRef
 *   - the sidebarBounds rect (for drop-onto-sidebar auto-dock)
 * and passes them in so the host can stay stateless.
 */
const FloatingTabsHost = ({
  activeFloatingKeys,
  tabMeta,
  tabZ,
  onFocus,
  onDock,
  sidebarBounds,
  renderBody,
}) => {
  return activeFloatingKeys.map((ftk) => {
    const meta = tabMeta[ftk];
    if (!meta) return null;
    // Give each floating window a slight cascade offset the first time it
    // appears (before user drags it), so multiple detachments don't stack
    // exactly on top of each other.
    const idx = activeFloatingKeys.indexOf(ftk);
    return (
      <FloatingTabWindow
        key={ftk}
        tabKey={ftk}
        title={meta.label}
        icon={meta.icon}
        testId={meta.testId}
        zIndex={tabZ[ftk] || 40}
        onFocus={() => onFocus(ftk)}
        onDock={() => onDock(ftk)}
        sidebarBounds={sidebarBounds}
        initialOffset={idx * 30}
      >
        {renderBody(ftk)}
      </FloatingTabWindow>
    );
  });
};

export default FloatingTabsHost;
