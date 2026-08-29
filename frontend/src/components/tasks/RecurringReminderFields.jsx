// Tekrarlı hatırlatıcı kontrolleri — oluşturma formu + düzenle modalı ORTAK
// bileşeni. Kontrollü (controlled): `value` (reminderUtils.defaultRecurringValue
// şekli) + `onChange`. Değeri backend'e çevirmek için
// reminderUtils.resolveRecurringReminder kullanılır.
import React from "react";
import { Bell, RefreshCw, Clock } from "lucide-react";
import { REMINDER_UNITS } from "../../lib/reminderUtils";

export const RecurringReminderFields = ({ value, onChange, testPrefix = "reminder" }) => {
  const v = value;
  const set = (patch) => onChange({ ...v, ...patch });

  const inputCls =
    "bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none";

  const UnitSelect = ({ unit, onUnit, testId }) => (
    <select
      value={unit}
      onChange={(e) => onUnit(e.target.value)}
      data-testid={testId}
      className={`${inputCls} py-1`}
    >
      {REMINDER_UNITS.map((u) => (
        <option key={u.value} value={u.value}>
          {u.label}
        </option>
      ))}
    </select>
  );

  return (
    <div
      className="border border-sertex-cyan/20 rounded-md p-2.5 space-y-2.5"
      data-testid={`${testPrefix}-recurring-block`}
    >
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={v.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          data-testid={`${testPrefix}-recurring-enabled`}
          className="accent-sertex-cyan h-3.5 w-3.5"
        />
        <span className="hud-text text-sertex-cyan flex items-center gap-1">
          <Bell className="h-3 w-3" /> HATIRLATICI (TEKRARLI)
        </span>
      </label>

      {v.enabled && (
        <div className="space-y-2.5 pl-0.5">
          {/* İlk hatırlatma zamanı — belirli / göreli */}
          <div className="space-y-1.5">
            <div className="hud-text text-sertex-textMuted flex items-center gap-1">
              <Clock className="h-3 w-3" /> İLK HATIRLATMA
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => set({ startMode: "at" })}
                data-testid={`${testPrefix}-mode-at`}
                className={`flex-1 py-1 rounded-md hud-text border transition-colors ${
                  v.startMode === "at"
                    ? "bg-sertex-cyan/20 border-sertex-cyan text-sertex-cyan"
                    : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
                }`}
              >
                Belirli zaman
              </button>
              <button
                type="button"
                onClick={() => set({ startMode: "in" })}
                data-testid={`${testPrefix}-mode-in`}
                className={`flex-1 py-1 rounded-md hud-text border transition-colors ${
                  v.startMode === "in"
                    ? "bg-sertex-cyan/20 border-sertex-cyan text-sertex-cyan"
                    : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
                }`}
              >
                Sonra başla
              </button>
            </div>
            {v.startMode === "at" ? (
              <input
                type="datetime-local"
                value={v.at}
                onChange={(e) => set({ at: e.target.value })}
                data-testid={`${testPrefix}-at-input`}
                className={`w-full ${inputCls}`}
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={v.inAmount}
                  onChange={(e) => set({ inAmount: e.target.value })}
                  data-testid={`${testPrefix}-in-amount`}
                  className={`w-20 ${inputCls}`}
                />
                <UnitSelect
                  unit={v.inUnit}
                  onUnit={(u) => set({ inUnit: u })}
                  testId={`${testPrefix}-in-unit`}
                />
                <span className="hud-text text-sertex-textMuted">sonra</span>
              </div>
            )}
          </div>

          {/* Kaç defa */}
          <div className="space-y-1.5">
            <div className="hud-text text-sertex-textMuted flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> KAÇ DEFA
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={999}
                value={v.count}
                onChange={(e) =>
                  set({ count: Math.max(1, Math.min(999, parseInt(e.target.value || "1", 10))) })
                }
                data-testid={`${testPrefix}-count`}
                className={`w-20 ${inputCls}`}
              />
              <span className="hud-text text-sertex-textMuted/80">
                {Number(v.count) > 1 ? "defa hatırlat" : "defa (tekrarsız)"}
              </span>
            </div>
          </div>

          {/* Aralık — yalnızca tekrar > 1 iken */}
          {Number(v.count) > 1 && (
            <div className="space-y-1.5">
              <div className="hud-text text-sertex-textMuted">ARALIK</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={v.intervalAmount}
                  onChange={(e) => set({ intervalAmount: e.target.value })}
                  data-testid={`${testPrefix}-interval-amount`}
                  className={`w-20 ${inputCls}`}
                />
                <UnitSelect
                  unit={v.intervalUnit}
                  onUnit={(u) => set({ intervalUnit: u })}
                  testId={`${testPrefix}-interval-unit`}
                />
                <span className="hud-text text-sertex-textMuted">arayla</span>
              </div>
            </div>
          )}

          <div className="hud-text text-sertex-textMuted/70 leading-relaxed">
            Görev tamamlanınca hatırlatmalar otomatik durur.
          </div>
        </div>
      )}
    </div>
  );
};

export default RecurringReminderFields;
