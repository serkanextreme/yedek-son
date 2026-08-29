/**
 * Alarm sound library for Sertex overdue-task alerts.
 *
 * Provides:
 *   - 5 built-in Web-Audio-API generated alarm sounds (no external assets required)
 *   - Support for a user-uploaded custom sound (stored as data-URL in localStorage)
 *   - A single `playAlarm()` entry point that reads the current selection + volume
 *     from settings and plays the correct sound.
 *   - Preview helpers for the Settings panel (`playPreset`, `playCustomFromDataUrl`).
 */

const SETTINGS_KEY = "sertex_alarm_settings_v1";
const CUSTOM_KEY = "sertex_alarm_custom_v1"; // { name, dataUrl }

const DEFAULT_SETTINGS = {
  selected: "two_tone", // preset key OR "custom"
  volume: 0.6, // 0..1
  enabled: true,
};

// ---------- Storage ----------
export const loadAlarmSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveAlarmSettings = (partial) => {
  const cur = loadAlarmSettings();
  const next = { ...cur, ...partial };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch (e) { console.warn("[alarmSounds.js] hata bastırıldı:", e); }
  return next;
};

export const loadCustomAlarm = () => {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveCustomAlarm = (name, dataUrl) => {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ name, dataUrl }));
  } catch (e) {
    // Likely quota exceeded — signal to caller
    throw new Error("Ses dosyası çok büyük veya depolama dolu");
  }
};

export const removeCustomAlarm = () => {
  try {
    localStorage.removeItem(CUSTOM_KEY);
  } catch (e) { console.warn("[alarmSounds.js] hata bastırıldı:", e); }
};

// ---------- Web-Audio preset generators ----------
// Each preset returns a Promise that resolves when playback finishes.

// Track live preset AudioContexts so stopAlarm() can silence any in-flight preset too.
const activePresetContexts = new Set();

const withCtx = (fn) => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return Promise.resolve();
  const ctx = new AC();
  activePresetContexts.add(ctx);
  return fn(ctx).finally(() => {
    setTimeout(() => {
      try {
        if (ctx.state !== "closed") ctx.close();
      } catch (e) { console.warn("[alarmSounds.js] hata bastırıldı:", e); }
      activePresetContexts.delete(ctx);
    }, 300);
  });
};

const beep = (ctx, master, { freq, start, dur, type = "sine", peak = 0.4 }) => {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(master);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.start(start);
  osc.stop(start + dur + 0.02);
};

const sweep = (ctx, master, { fromFreq, toFreq, start, dur, type = "sawtooth", peak = 0.25 }) => {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, start);
  osc.frequency.exponentialRampToValueAtTime(toFreq, start + dur);
  osc.connect(g);
  g.connect(master);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.start(start);
  osc.stop(start + dur + 0.02);
};

/** Two-tone doorbell-style beep (current default). */
const preset_two_tone = (volume) =>
  withCtx((ctx) => {
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    beep(ctx, master, { freq: 880, start: t0, dur: 0.2 });
    beep(ctx, master, { freq: 660, start: t0 + 0.22, dur: 0.25 });
    return new Promise((res) => setTimeout(res, 600));
  });

/** Classic rapid alarm — 5 short beeps at 1kHz. */
const preset_classic = (volume) =>
  withCtx((ctx) => {
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 5; i++) {
      beep(ctx, master, { freq: 1000, start: t0 + i * 0.16, dur: 0.09, peak: 0.5 });
    }
    return new Promise((res) => setTimeout(res, 950));
  });

/** Sci-Fi swept siren — rising & falling saw wave. */
const preset_scifi = (volume) =>
  withCtx((ctx) => {
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    sweep(ctx, master, { fromFreq: 220, toFreq: 1500, start: t0, dur: 0.5, type: "sawtooth", peak: 0.3 });
    sweep(ctx, master, { fromFreq: 1500, toFreq: 220, start: t0 + 0.5, dur: 0.5, type: "sawtooth", peak: 0.3 });
    return new Promise((res) => setTimeout(res, 1200));
  });

/** Bell chime — decaying triangle wave with harmonics. */
const preset_bell = (volume) =>
  withCtx((ctx) => {
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    // Fundamental + harmonic for bell-like timbre
    beep(ctx, master, { freq: 784, start: t0, dur: 1.2, type: "triangle", peak: 0.45 });
    beep(ctx, master, { freq: 1568, start: t0, dur: 0.9, type: "sine", peak: 0.2 });
    beep(ctx, master, { freq: 2352, start: t0, dur: 0.6, type: "sine", peak: 0.1 });
    return new Promise((res) => setTimeout(res, 1400));
  });

/** Digital alert — square wave, harsh 3-tone. */
const preset_digital = (volume) =>
  withCtx((ctx) => {
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    beep(ctx, master, { freq: 1200, start: t0, dur: 0.12, type: "square", peak: 0.28 });
    beep(ctx, master, { freq: 1200, start: t0 + 0.18, dur: 0.12, type: "square", peak: 0.28 });
    beep(ctx, master, { freq: 1800, start: t0 + 0.36, dur: 0.28, type: "square", peak: 0.32 });
    return new Promise((res) => setTimeout(res, 800));
  });

export const PRESETS = [
  { key: "two_tone", label: "İkili Bip", desc: "Klasik iki tonlu bildirim" },
  { key: "classic", label: "Klasik Alarm", desc: "Hızlı ardışık bipler" },
  { key: "scifi", label: "Sci-Fi Siren", desc: "Yükselip alçalan siren" },
  { key: "bell", label: "Çan", desc: "Yumuşak çan sesi" },
  { key: "digital", label: "Dijital", desc: "Sert dijital uyarı" },
];

const PRESET_PLAYERS = {
  two_tone: preset_two_tone,
  classic: preset_classic,
  scifi: preset_scifi,
  bell: preset_bell,
  digital: preset_digital,
};

// ---------- Playback ----------
let activeHtmlAudio = null;

/** Play a preset sound directly (used by Settings preview + `playAlarm`). */
export const playPreset = (key, volume = 0.6) => {
  const fn = PRESET_PLAYERS[key] || preset_two_tone;
  return fn(Math.max(0, Math.min(1, volume)));
};

/** Play the custom uploaded sound from its stored data-URL. */
export const playCustomFromDataUrl = (dataUrl, volume = 0.6) => {
  if (!dataUrl) return Promise.resolve();
  try {
    if (activeHtmlAudio) {
      try { activeHtmlAudio.pause(); } catch (e) { console.warn("[alarmSounds.js] hata bastırıldı:", e); }
      activeHtmlAudio = null;
    }
    const a = new Audio(dataUrl);
    a.volume = Math.max(0, Math.min(1, volume));
    activeHtmlAudio = a;
    return a.play().catch(() => {});
  } catch {
    return Promise.resolve();
  }
};

/** Stop any currently-playing alarm audio — both HTMLAudio (custom) and WebAudio (presets). */
export const stopAlarm = () => {
  if (activeHtmlAudio) {
    try { activeHtmlAudio.pause(); } catch (e) { console.warn("[alarmSounds.js] hata bastırıldı:", e); }
    try { activeHtmlAudio.currentTime = 0; } catch (e) { console.warn("[alarmSounds.js] hata bastırıldı:", e); }
    activeHtmlAudio = null;
  }
  activePresetContexts.forEach((ctx) => {
    try {
      if (ctx.state !== "closed") ctx.close();
    } catch (e) { console.warn("[alarmSounds.js] hata bastırıldı:", e); }
  });
  activePresetContexts.clear();
};

/**
 * Play the currently-configured alarm sound. Called by OverdueAlertModal.
 * Reads settings from localStorage each call so changes take effect immediately.
 */
export const playAlarm = () => {
  const settings = loadAlarmSettings();
  if (!settings.enabled) return Promise.resolve();
  const vol = typeof settings.volume === "number" ? settings.volume : 0.6;
  if (settings.selected === "custom") {
    const custom = loadCustomAlarm();
    if (custom?.dataUrl) return playCustomFromDataUrl(custom.dataUrl, vol);
    // Fallback if user removed custom sound
    return playPreset("two_tone", vol);
  }
  return playPreset(settings.selected || "two_tone", vol);
};

/** Read an uploaded File and convert to a data-URL string. */
export const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
