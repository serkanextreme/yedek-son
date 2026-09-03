import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ClipboardPaste, Trash2 } from "lucide-react";

// İş koluna sağ tık → "Yapıştır" küçük menüsü. Pano dolu iken açılır; kopyalanan
// görevi bu iş koluna (categoryId; null = KOLSUZ) çoğaltır. "Panoyu Temizle"
// ile pano boşaltılır.
export const TaskPasteMenu = ({ x, y, title, targetName, onPaste, onClear, onClose }) => {
  const ref = useRef();
  const [pos, setPos] = useState({ left: x, top: y, ready: false });

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top, ready: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      className="fixed z-[110] glass-panel border border-sertex-cyan/40 rounded-md py-1 shadow-lg min-w-[220px]"
      data-testid="task-paste-menu"
    >
      <div className="px-3 py-1.5 border-b border-sertex-cyan/20">
        <div className="hud-text text-sertex-textMuted/80 text-[10px]">YAPIŞTIRILACAK</div>
        <div className="hud-text text-sertex-cyan truncate">{title}</div>
        <div className="hud-text text-sertex-textMuted/70 text-[10px] mt-0.5 truncate">→ {targetName}</div>
      </div>
      <button
        onClick={() => { onPaste(); onClose(); }}
        data-testid="task-paste-confirm"
        className="w-full text-left px-3 py-2 hud-text flex items-center gap-2 text-sertex-cyan hover:bg-sertex-cyan/10 transition-colors"
      >
        <ClipboardPaste className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Yapıştır</span>
      </button>
      <button
        onClick={() => { onClear(); onClose(); }}
        data-testid="task-paste-clear"
        className="w-full text-left px-3 py-2 hud-text flex items-center gap-2 text-rose-300 hover:bg-rose-500/15 transition-colors border-t border-sertex-cyan/15"
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Panoyu Temizle</span>
      </button>
    </motion.div>,
    document.body,
  );
};
