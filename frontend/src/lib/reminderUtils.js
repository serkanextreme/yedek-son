// Tekrarlı hatırlatıcı yardımcıları — oluşturma formu, düzenle modalı ve
// sağ-tık menüsünde ORTAK kullanılır ("her yerde olsun" isteği).
//
// Model alanları:
//   reminder_at            → ilk hatırlatma zamanı (ISO)
//   reminder_interval_min  → tekrarlar arası aralık (dakika)
//   reminder_repeat_total  → toplam kaç defa hatırlatılacağı
//   reminder_repeat_left   → kalan tekrar (scheduler her tetiklemede azaltır)
// Görev "done" olduğunda scheduler tekrarları otomatik durdurur.

export const REMINDER_UNITS = [
  { value: "min", label: "dakika" },
  { value: "hour", label: "saat" },
  { value: "day", label: "gün" },
];

export const unitToMinutes = (amount, unit) => {
  const a = Math.max(1, parseInt(amount, 10) || 1);
  if (unit === "day") return a * 1440;
  if (unit === "hour") return a * 60;
  return a;
};

export const minutesToUnit = (min) => {
  if (min == null || min <= 0) return { amount: 30, unit: "min" };
  if (min % 1440 === 0) return { amount: min / 1440, unit: "day" };
  if (min % 60 === 0) return { amount: min / 60, unit: "hour" };
  return { amount: min, unit: "min" };
};

// Kısa Türkçe aralık etiketi — görev kartı rozeti için. Örn: 15 → "15 dk",
// 60 → "1 saat", 2880 → "2 gün".
export const formatIntervalShort = (min) => {
  const { amount, unit } = minutesToUnit(min);
  const label = unit === "day" ? "gün" : unit === "hour" ? "saat" : "dk";
  return `${amount} ${label}`;
};

// Toplam dakikayı okunur Türkçe süreye çevirir: 165 → "2 saat 45 dk",
// 2880 → "2 gün". Özel süre erteleme mesajlarında kullanılır.
export const formatDurationTr = (mins) => {
  let x = Math.round(mins);
  const d = Math.floor(x / 1440);
  x -= d * 1440;
  const h = Math.floor(x / 60);
  const m = x - h * 60;
  const parts = [];
  if (d) parts.push(`${d} gün`);
  if (h) parts.push(`${h} saat`);
  if (m) parts.push(`${m} dk`);
  return parts.join(" ") || "0 dk";
};

export const defaultRecurringValue = () => ({
  enabled: false,
  startMode: "at", // "at" = belirli zaman · "in" = şimdiye göreli
  at: "",
  inAmount: 30,
  inUnit: "min",
  count: 1,
  intervalAmount: 30,
  intervalUnit: "min",
});

// Bir ISO datetime'ı datetime-local input için yerel saat string'ine çevirir.
const toLocalInput = (iso) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

// Mevcut bir görevden form değerini üretir (düzenle modalı için).
export const recurringValueFromTask = (task) => {
  const base = defaultRecurringValue();
  if (!task || !task.reminder_at) return base;
  const count = task.reminder_repeat_total || task.reminder_repeat_left || 1;
  const iv = minutesToUnit(task.reminder_interval_min);
  return {
    ...base,
    enabled: true,
    startMode: "at",
    at: toLocalInput(task.reminder_at),
    count,
    intervalAmount: iv.amount,
    intervalUnit: iv.unit,
  };
};

// Form değerini backend payload'ına çözer. `enabled=false` → temizle.
// Hata durumunda `{ error }` döner (çağıran toast gösterir).
export const resolveRecurringReminder = (v) => {
  if (!v || !v.enabled) {
    return {
      cleared: true,
      reminder_at: null,
      reminder_interval_min: null,
      reminder_repeat_left: null,
      reminder_repeat_total: null,
    };
  }
  let reminderAt;
  if (v.startMode === "in") {
    reminderAt = new Date(
      Date.now() + unitToMinutes(v.inAmount, v.inUnit) * 60000
    ).toISOString();
  } else {
    if (!v.at) return { error: "İlk hatırlatma zamanını seçin" };
    reminderAt = new Date(v.at).toISOString();
  }
  const count = Math.max(1, Math.min(999, parseInt(v.count, 10) || 1));
  const intervalMin = count > 1 ? unitToMinutes(v.intervalAmount, v.intervalUnit) : null;
  return {
    reminder_at: reminderAt,
    reminder_interval_min: intervalMin,
    reminder_repeat_total: count,
    reminder_repeat_left: count,
  };
};
