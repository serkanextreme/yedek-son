// Faz 9 CP8 — Mobile bottom navigation bar.
//
// 4 fixed tabs at the bottom edge on tablet/phone. Tapping a tab either
// opens the corresponding sidebar section (Sohbet/Görevler/Notlar) or
// launches the Settings modal directly. The bar respects safe-area-inset
// so it doesn't sit on top of the phone's gesture bar.
//
// This is a native-feeling shortcut layer — the full Sidebar (with sub-tabs
// like Hafıza, Dosyalar etc.) remains reachable via the ⚙️ Sistem button
// so power users still have the desktop-style depth.
import React from "react";
import { MessageSquare, ListTodo, Settings, StickyNote } from "lucide-react";

const _BTN_CLS = (active) =>
  "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors " +
  (active
    ? "text-sertex-cyan neon-glow"
    : "text-sertex-textMuted hover:text-sertex-cyan/70");

const _iconCls = "h-4 w-4";
const _lblCls = "hud-text text-[9px] leading-none";

export default function MobileBottomNav({ activeSection, onOpenSection, onOpenSettings }) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[45] bg-sertex-bg/95 backdrop-blur-md border-t border-sertex-cyan/25 flex items-stretch"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      data-testid="mobile-bottom-nav"
    >
      <button
        type="button"
        onClick={() => onOpenSection("history")}
        className={_BTN_CLS(activeSection === "history")}
        data-testid="mobile-nav-history"
      >
        <MessageSquare className={_iconCls} />
        <span className={_lblCls}>SOHBET</span>
      </button>
      <button
        type="button"
        onClick={() => onOpenSection("tasks")}
        className={_BTN_CLS(activeSection === "tasks")}
        data-testid="mobile-nav-tasks"
      >
        <ListTodo className={_iconCls} />
        <span className={_lblCls}>GÖREVLER</span>
      </button>
      <button
        type="button"
        onClick={() => onOpenSection("notes")}
        className={_BTN_CLS(activeSection === "notes")}
        data-testid="mobile-nav-notes"
      >
        <StickyNote className={_iconCls} />
        <span className={_lblCls}>NOTLAR</span>
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        className={_BTN_CLS(false)}
        data-testid="mobile-nav-settings"
      >
        <Settings className={_iconCls} />
        <span className={_lblCls}>AYARLAR</span>
      </button>
    </nav>
  );
}
