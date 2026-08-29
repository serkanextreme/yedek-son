import { useEffect, useState, useRef } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { Check, Pause, MoreVertical, Clock, AlertTriangle, Bell, GripVertical, Anchor } from "lucide-react";
import { Highlight } from "./tasks/Highlight";

const subIsOverdue = (s) => {
  if (s.done || s.status === "done" || s.status === "paused") return false;
  if (s.status === "overdue") return true;
  if (!s.due_date) return false;
  return new Date(s.due_date) < new Date();
};

const subtaskStyle = (s) => {
  if (s.done || s.status === "done") {
    return { border: "border-emerald-400/60", bg: "bg-emerald-500/10", accent: "text-emerald-300" };
  }
  if (s.status === "paused") {
    return { border: "border-yellow-400/60", bg: "bg-yellow-500/10", accent: "text-yellow-300" };
  }
  if (subIsOverdue(s)) {
    return { border: "border-rose-500/60", bg: "bg-rose-500/10", accent: "text-rose-300" };
  }
  return { border: "border-sertex-cyan/30", bg: "", accent: "text-sertex-cyan" };
};

// ============ SUBTASK CONTEXT MENU ============
export const SUBTASK_SIZE_KEY_PREFIX = "sertex_subtask_size_";

export const SubtaskRow = ({ sub, idx, taskId, displayNumber, onToggle, onOpenMenu, onLongPressStart, onLongPressEnd, highlight = "" }) => {
  const controls = useDragControls();
  const sStyle = subtaskStyle(sub);
  const sOverdue = subIsOverdue(sub);
  const isDone = sub.done || sub.status === "done";
  const rowRef = useRef(null);
  const persistTimer = useRef(null);

  const [savedSize] = useState(() => {
    try {
      const raw = localStorage.getItem(SUBTASK_SIZE_KEY_PREFIX + sub.id);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.width || parsed.height)) return parsed;
      }
    } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
    return null;
  });

  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const inlineW = el.style.width;
      const inlineH = el.style.height;
      if (!inlineW && !inlineH) return;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(SUBTASK_SIZE_KEY_PREFIX + sub.id, JSON.stringify(size));
        } catch (e) { console.warn("[TasksPanel.jsx] hata bastırıldı:", e); }
      }, 250);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [sub.id]);

  return (
    <Reorder.Item
      ref={rowRef}
      value={sub}
      dragListener={false}
      dragControls={controls}
      layout
      style={{
        resize: "both",
        overflow: "auto",
        minHeight: 32,
        minWidth: 180,
        maxWidth: "100%",
        ...(savedSize?.width ? { width: savedSize.width } : {}),
        ...(savedSize?.height ? { height: savedSize.height } : {}),
      }}
      className={`subtask-resizable flex items-start gap-1.5 group/sub rounded px-1 py-0.5 border ${sStyle.border} ${sStyle.bg} transition-colors`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenMenu(idx, e.clientX, e.clientY);
      }}
      onTouchStart={(e) => onLongPressStart(idx, e)}
      onTouchEnd={onLongPressEnd}
      onTouchMove={onLongPressEnd}
      data-testid={`subtask-row-${taskId}-${idx}`}
    >
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          controls.start(e);
        }}
        data-testid={`subtask-drag-${taskId}-${idx}`}
        title="Sürükle sırala"
        aria-label="Sürükle sırala"
        className="opacity-30 group-hover/sub:opacity-100 focus:opacity-100 shrink-0 mt-0.5 h-4 w-3 flex items-center justify-center text-sertex-cyan/70 hover:text-sertex-cyan cursor-grab active:cursor-grabbing transition-opacity"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button
        onClick={() => onToggle(idx, !isDone)}
        data-testid={`subtask-check-${taskId}-${idx}`}
        className={`mt-0.5 h-4 w-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
          isDone
            ? "border-emerald-400 bg-emerald-500/40"
            : sOverdue
            ? "border-rose-400 hover:bg-rose-500/10"
            : sub.status === "paused"
            ? "border-yellow-400 hover:bg-yellow-500/10"
            : "border-sertex-cyan/40 hover:border-sertex-cyan hover:bg-sertex-cyan/10"
        }`}
      >
        {isDone && <Check className="h-2.5 w-2.5 text-white" />}
      </button>
      <div className="flex-1 min-w-0">
        {(sub.status === "paused" || sOverdue) && (
          <div className={`hud-text flex items-center gap-1 ${sStyle.accent}`}>
            {sub.status === "paused" ? (
              <><Pause className="h-2.5 w-2.5" /> BEKLEMEDE</>
            ) : (
              <><AlertTriangle className="h-2.5 w-2.5" /> SÜRESİ GEÇTİ</>
            )}
          </div>
        )}
        <span
          className={`text-xs font-mono ${
            isDone ? "text-sertex-textMuted line-through" : "text-sertex-text"
          }`}
        >
          {displayNumber != null && (
            <span
              className={`inline-flex items-center mr-1 tabular-nums font-semibold ${
                isDone
                  ? "text-sertex-textMuted"
                  : sOverdue
                  ? "text-rose-300"
                  : sub.status === "paused"
                  ? "text-yellow-300"
                  : sub.number_pinned
                  ? "text-amber-300"
                  : "text-sertex-cyan"
              }`}
              data-testid={`subtask-number-${taskId}-${idx}`}
              title={sub.number_pinned ? "Sıra numarası sabit" : undefined}
            >
              {isDone ? "✓" : `${displayNumber}.`}
              {sub.number_pinned && !isDone && (
                <Anchor className="h-2.5 w-2.5 ml-0.5 text-amber-300" data-testid={`subtask-number-pinned-${taskId}-${idx}`} />
              )}
            </span>
          )}
          <Highlight text={sub.text} query={highlight} />
        </span>
        {sub.due_date && (
          <div className={`hud-text flex items-center gap-1 mt-0.5 ${sOverdue ? "text-rose-300" : sub.reminder_fired ? "text-sertex-textMuted" : "text-sertex-cyan"}`}>
            <Clock className="h-2.5 w-2.5" />
            {new Date(sub.due_date).toLocaleString("tr-TR", {
              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
            })}
            {!isDone && (
              sub.reminder_fired ? (
                <span title="Hatırlatma verildi" className="ml-1 opacity-70">🔔 ✓</span>
              ) : (
                <Bell className="h-2.5 w-2.5 ml-1 opacity-70" title="Zamanı gelince hatırlatılacak" />
              )
            )}
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onOpenMenu(idx, rect.left - 200, rect.bottom + 4);
        }}
        data-testid={`subtask-menu-${taskId}-${idx}`}
        title="Alt görev menüsü"
        aria-label="Alt görev menüsü"
        className="opacity-0 group-hover/sub:opacity-100 focus:opacity-100 shrink-0 h-5 w-5 flex items-center justify-center border border-sertex-cyan/25 hover:border-sertex-cyan hover:bg-sertex-cyan/15 rounded text-sertex-cyan transition-all"
      >
        <MoreVertical className="h-3 w-3" />
      </button>
    </Reorder.Item>
  );
};


// GÖREV — tamamlanma süresi (oluşturma → bitiş) insan-okunur Türkçe etiket.
