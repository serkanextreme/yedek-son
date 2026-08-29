import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Check, Pause, Play, Trash2, Clock, AlertTriangle, X, ChevronRight, GripVertical, Pencil, ArrowUpRight, Anchor } from "lucide-react";
import { toast } from "sonner";

export const SubtaskMenu = ({ x, y, sub, displayNumber, onAction, onClose }) => {
  const menuRef = useRef();
  const [dateSub, setDateSub] = useState(false);
  const [editSub, setEditSub] = useState(false);
  const [numberSub, setNumberSub] = useState(false);
  const [pinInput, setPinInput] = useState(
    sub.number_pinned && sub.pinned_number != null ? String(sub.pinned_number) : "",
  );
  const [editText, setEditText] = useState(sub.text || "");
  const [customTime, setCustomTime] = useState(
    sub.due_date ? new Date(sub.due_date).toISOString().slice(0, 16) : ""
  );
  // Menü görünmez render edilip ölçülür → viewport'a sığdırılır (ekran altına taşmaz).
  const [pos, setPos] = useState({ left: x, top: y, ready: false });

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const availH = vh - 2 * pad;
    const effH = Math.min(rect.height, availH);
    let left = x;
    let top = y;
    if (left + rect.width > vw - pad) left = vw - rect.width - pad;
    if (left < pad) left = pad;
    if (top + effH > vh - pad) top = vh - effH - pad;
    if (top < pad) top = pad;
    if (left !== pos.left || top !== pos.top || !pos.ready) {
      setPos({ left, top, ready: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, dateSub, editSub, numberSub, sub?.id]);

  useEffect(() => {
    const onMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const isDone = sub.done || sub.status === "done";
  const items = [
    { icon: Pencil, label: "Düzenle", color: "text-sertex-cyan hover:bg-sertex-cyan/10", action: "edit", hasSubmenu: true },
    !isDone && { icon: Check, label: "Tamamlandı", color: "text-emerald-300 hover:bg-emerald-500/15", action: "done" },
    sub.status !== "paused" && { icon: Pause, label: "Beklemeye al", color: "text-yellow-300 hover:bg-yellow-500/15", action: "paused" },
    sub.status !== "overdue" && { icon: AlertTriangle, label: "Tarihi geçti", color: "text-rose-300 hover:bg-rose-500/15", action: "overdue" },
    (isDone || sub.status !== "pending") && { icon: Play, label: "Aktif yap", color: "text-sertex-cyan hover:bg-sertex-cyan/10", action: "pending" },
    { icon: Clock, label: sub.due_date ? "Tarihi düzenle" : "Tarih/saat ekle", color: "text-sertex-cyan hover:bg-sertex-cyan/10", action: "date", hasSubmenu: true },
    sub.due_date && { icon: X, label: "Tarihi temizle", color: "text-sertex-textMuted hover:bg-sertex-cyan/10", action: "date-clear" },
    { icon: GripVertical, label: "Boyutu sıfırla", color: "text-sertex-cyan hover:bg-sertex-cyan/10", action: "reset-size" },
    { icon: ArrowUpRight, label: "Göreve dönüştür", color: "text-violet-300 hover:bg-violet-500/15", action: "promote" },
    { icon: Anchor, label: sub.number_pinned && sub.pinned_number != null ? `Sıra numarası sabit: ${sub.pinned_number}` : "Sıra numarasını sabitle", color: "text-amber-300 hover:bg-amber-500/15", action: "pin-number", hasSubmenu: true },
    { icon: Trash2, label: "Sil", color: "text-rose-300 hover:bg-rose-500/15", action: "delete" },
  ].filter(Boolean);

  return createPortal(
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed z-[100] glass-panel border border-sertex-cyan/40 rounded-md py-1 shadow-lg min-w-[210px]"
      style={{
        left: pos.left,
        top: pos.top,
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        visibility: pos.ready ? "visible" : "hidden",
      }}
      data-testid="subtask-context-menu"
    >
      {editSub ? (
        <div className="p-2 space-y-2">
          <div className="hud-text text-sertex-cyan flex items-center gap-1"><Pencil className="h-3 w-3" /> ALT GÖREVİ DÜZENLE</div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            data-testid="sub-ctx-edit-input"
            autoFocus
            rows={2}
            className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none resize-y min-w-[220px]"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setEditSub(false)}
              className="flex-1 py-1 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
            >
              ← Geri
            </button>
            <button
              onClick={() => {
                const t = editText.trim();
                if (!t) { toast.error("Metin boş olamaz"); return; }
                onAction("edit-set", { text: t });
                onClose();
              }}
              data-testid="sub-ctx-edit-set"
              className="flex-1 py-1 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded hud-text"
            >
              KAYDET
            </button>
          </div>
        </div>
      ) : numberSub ? (
        <div className="p-2 space-y-2 min-w-[220px]">
          <div className="hud-text text-amber-300 flex items-center gap-1"><Anchor className="h-3 w-3" /> SIRA NUMARASI</div>
          {sub.number_pinned && sub.pinned_number != null ? (
            <>
              <div className="hud-text text-sertex-textMuted">
                Şu an sabit: <span className="text-amber-300 font-semibold">{sub.pinned_number}</span>
              </div>
              <button
                onClick={() => { onAction("unpin-number"); onClose(); }}
                data-testid="sub-ctx-unpin-number"
                className="w-full py-1.5 border border-rose-400/40 text-rose-300 hover:bg-rose-500/15 rounded hud-text"
              >
                SABİTLEMEYİ KALDIR
              </button>
            </>
          ) : (
            <>
              {displayNumber != null && (
                <button
                  onClick={() => { onAction("pin-number", { number: displayNumber }); onClose(); }}
                  data-testid="sub-ctx-pin-number-auto"
                  className="w-full py-1.5 bg-amber-500/15 border border-amber-400 text-amber-300 hover:bg-amber-500/25 rounded hud-text"
                >
                  OTOMATİK (MEVCUT: {displayNumber})
                </button>
              )}
              <div className="hud-text text-sertex-textMuted pt-1">VEYA ELLE GİR</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="No"
                  data-testid="sub-ctx-pin-number-input"
                  className="w-20 bg-sertex-surface/60 border border-amber-400/30 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-amber-400 outline-none"
                />
                <button
                  onClick={() => {
                    const n = parseInt(pinInput, 10);
                    if (!n || n < 1) { toast.error("Geçerli bir numara girin"); return; }
                    onAction("pin-number", { number: n });
                    onClose();
                  }}
                  data-testid="sub-ctx-pin-number-set"
                  className="flex-1 py-1 bg-amber-500/15 border border-amber-400 text-amber-300 hover:bg-amber-500/25 rounded hud-text"
                >
                  SABİTLE
                </button>
              </div>
            </>
          )}
          <button
            onClick={() => setNumberSub(false)}
            className="w-full py-1 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
          >
            ← Geri
          </button>
        </div>
      ) : !dateSub ? (
        items.map((it, i) => (
          <button
            key={i}
            onClick={() => {
              if (it.action === "date") { setDateSub(true); return; }
              if (it.action === "edit") { setEditSub(true); return; }
              if (it.action === "pin-number") { setNumberSub(true); return; }
              onAction(it.action);
              onClose();
            }}
            data-testid={`sub-ctx-${it.action}`}
            className={`w-full text-left px-3 py-1.5 hud-text flex items-center gap-2 transition-colors ${it.color}`}
          >
            <it.icon className="h-3 w-3 shrink-0" />
            <span className="flex-1">{it.label}</span>
            {it.hasSubmenu && <ChevronRight className="h-3 w-3 opacity-60" />}
          </button>
        ))
      ) : (
        <div className="p-2 space-y-2">
          <div className="hud-text text-sertex-cyan flex items-center gap-1"><Clock className="h-3 w-3" /> ALT GÖREV TARİHİ</div>
          <input
            type="datetime-local"
            value={customTime}
            onChange={(e) => setCustomTime(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            data-testid="sub-ctx-date-input"
            autoFocus
            className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setDateSub(false)}
              className="flex-1 py-1 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan rounded hud-text"
            >
              ← Geri
            </button>
            <button
              onClick={() => {
                if (!customTime) { toast.error("Bir zaman seçin"); return; }
                onAction("date-set", { iso: new Date(customTime).toISOString() });
                onClose();
              }}
              data-testid="sub-ctx-date-set"
              className="flex-1 py-1 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded hud-text"
            >
              KAYDET
            </button>
          </div>
        </div>
      )}
    </motion.div>,
    document.body
  );
};

// ============ SUBTASK ROW (drag-and-drop reorderable) ============
