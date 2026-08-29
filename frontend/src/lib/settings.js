import { useEffect, useState } from "react";

const STORAGE_KEY = "sertex_settings_v1";

export const DEFAULT_COLORS = {
  idle: "#0088FF",     // mavi - beklemede
  speaking: "#00FF88", // yeşil - cevap verirken
  error: "#FF3355",    // kırmızı - hata
  listening: "#00AAFF",
  thinking: "#3399FF",
};

// Görsellik / performans seviyesi (cihaza özel, localStorage).
// "auto" = cihaz gücüne göre otomatik; high = mevcut tam kalite.
export const DEFAULT_QUALITY = "auto"; // "auto" | "high" | "normal" | "low"

// Cihaz gücünü sez (CPU çekirdek + RAM + mobil + WebGL renderer) → önerilen seviye.
let _deviceTier = null;
export const detectDeviceTier = () => {
  if (_deviceTier) return _deviceTier;
  let tier = "normal";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) {
      tier = "low";
    } else {
      let renderer = "";
      try {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : "";
      } catch (e) { renderer = ""; }
      if (/swiftshader|software|llvmpipe/i.test(renderer)) {
        tier = "low"; // yazılım (GPU'suz) render
      } else {
        const cores = navigator.hardwareConcurrency || 4;
        const mem = navigator.deviceMemory || 4; // GB (yalnız Chrome)
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
        let score = 0;
        score += cores >= 8 ? 2 : cores >= 4 ? 1 : 0;
        score += mem >= 8 ? 2 : mem >= 4 ? 1 : 0;
        if (isMobile) score -= 1;
        tier = score >= 3 ? "high" : score >= 1 ? "normal" : "low";
      }
    }
  } catch (e) {
    tier = "normal";
  }
  _deviceTier = tier;
  return tier;
};

// Kullanıcı seçimini efektif seviyeye çevir ("auto" → algılanan seviye).
export const resolveQuality = (q) => {
  if (q === "high" || q === "normal" || q === "low") return q;
  return detectDeviceTier();
};

const applyQualityAttr = (q) => {
  try {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-quality", resolveQuality(q));
      document.documentElement.setAttribute("data-quality-mode", q || DEFAULT_QUALITY);
    }
  } catch (e) { /* yut */ }
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { colors: DEFAULT_COLORS, quality: DEFAULT_QUALITY };
    const parsed = JSON.parse(raw);
    return {
      colors: { ...DEFAULT_COLORS, ...(parsed.colors || {}) },
      quality: parsed.quality || DEFAULT_QUALITY,
    };
  } catch (e) {
    return { colors: DEFAULT_COLORS, quality: DEFAULT_QUALITY };
  }
};

let listeners = [];
let current = loadSettings();
applyQualityAttr(current.quality);

const notify = () => listeners.forEach((l) => l(current));

export const useSettings = () => {
  const [state, setState] = useState(current);
  useEffect(() => {
    const l = (s) => setState(s);
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  return state;
};

export const setColor = (key, value) => {
  current = {
    ...current,
    colors: { ...current.colors, [key]: value },
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (e) { console.warn("[settings.js] hata bastırıldı:", e); }
  notify();
};

export const resetColors = () => {
  current = { ...current, colors: { ...DEFAULT_COLORS } };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (e) { console.warn("[settings.js] hata bastırıldı:", e); }
  notify();
};

export const setQuality = (q) => {
  const val = ["auto", "high", "normal", "low"].includes(q) ? q : "auto";
  current = { ...current, quality: val };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (e) { console.warn("[settings.js] hata bastırıldı:", e); }
  applyQualityAttr(val);
  notify();
};
