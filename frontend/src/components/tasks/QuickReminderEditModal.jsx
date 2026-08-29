// Sertex — hızlı tekrarlı hatırlatma düzenleme modalı.
//
// Görev kartındaki tekrarlı hatırlatma rozetine tıklayınca açılır. Tüm görevi
// düzenlemeden, sadece hatırlatmayı (ilk zaman + kaç defa + aralık) değiştirir
// veya kaldırır. Mevcut, doğrulanmış onSetReminder/onClearReminder yollarını
// kullanır (yeni API bağlama yok → regresyon riski düşük).
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bell, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { RecurringReminderFields } from "./RecurringReminderFields";
import { recurringValueFromTask, resolveRecurringReminder, defaultRecurringValue } from "../../lib/reminderUtils";

export const QuickReminderEditModal = ({ task, onClose, onSetReminder, onClearReminder }) => {
  const [value, setValue] = useState(() => recurringValueFromTask(task));

  const stop = (e) => e.stopPropagation();

  const save = () => {
    if (!value.enabled) {
      onClearReminder();
      toast.success("Hatırlatıcı kaldırıldı");
      onClose();
      return;
    }
    const rr = resolveRecurringReminder(value);
    if (rr.error) {
      toast.error(rr.error);
      return;
    }
    onSetReminder(rr.reminder_at, {
      intervalMin: rr.reminder_interval_min,
      repeatLeft: rr.reminder_repeat_left,
      repeatTotal: rr.reminder_repeat_total,
    });
    toast.success("Hatırlatıcı güncellendi");
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
        data-testid="quick-reminder-overlay"
      >
        <motion.div
          initial={{ scale: 0.94, y: 16, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.94, y: 16, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          onClick={stop}
          className="relative w-full max-w-sm glass-panel border border-sertex-cyan/40 rounded-lg shadow-[0_0_32px_rgba(34,211,238,0.25)] overflow-hidden"
          data-testid="quick-reminder-modal"
        >
          <div className="px-4 py-3 border-b border-sertex-cyan/25 flex items-center justify-between bg-sertex-cyan/5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-sertex-cyan" />
              <div className="display-text text-sertex-cyan tracking-[0.15em] text-sm">
                HATIRLATICIYI DÜZENLE
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-sertex-textMuted hover:text-sertex-text transition-colors"
              data-testid="quick-reminder-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-4 py-3 space-y-3">
            <div className="text-sm font-mono text-sertex-text line-clamp-2">{task.title}</div>
            <RecurringReminderFields value={value} onChange={setValue} testPrefix="quick-reminder" />
          </div>

          <div className="px-4 py-3 border-t border-sertex-cyan/20 flex items-center justify-between gap-2">
            <button
              onClick={() => setValue(defaultRecurringValue())}
              data-testid="quick-reminder-reset"
              className="px-3 py-1.5 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 hud-text transition-colors flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" /> Sıfırla
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                data-testid="quick-reminder-cancel"
                className="px-3 py-1.5 rounded border border-sertex-textMuted/30 text-sertex-textMuted hover:text-sertex-text hud-text transition-colors"
              >
                Vazgeç
              </button>
              <button
                onClick={save}
                data-testid="quick-reminder-save"
                className="px-3 py-1.5 rounded border border-sertex-cyan/50 text-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors"
              >
                Kaydet
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default QuickReminderEditModal;
