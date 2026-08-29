/**
 * Wake-word listener for Sertex.
 * Runs a continuous background SpeechRecognition that fires `onWake` the
 * moment the user says "sertex" (or a close variant that STT engines
 * commonly mishear it as).
 *
 * Requires the native Web Speech API (Chrome / Edge / Safari 14+).
 * Firefox / older mobile browsers are NOT supported — see isWakeWordSupported().
 */
import { toast } from "sonner";

// Common STT mishearings of "sertex" in tr-TR / en-US models.
const DEFAULT_VARIANTS = [
  "sertex",
  "sertek",
  "sertex'e",
  "sertext",
  "sertexi",
  "sarteks",
  "sertes",
  "sertekş",
  "certex",
  "certeks",
  "cerdex",
];

export const isWakeWordSupported = () => {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
};

/**
 * @param {object} opts
 * @param {string} [opts.lang]           - 'tr-TR' or 'en-US'
 * @param {string[]} [opts.variants]     - accepted wake-word spellings (lowercase)
 * @param {(tail:string)=>void} opts.onWake - fired when wake word detected. `tail` is
 *                                            any text that followed the wake word in
 *                                            the same utterance (may be empty).
 * @param {(err:any)=>void} [opts.onError]
 */
export const createWakeWordListener = ({
  lang = "tr-TR",
  variants = DEFAULT_VARIANTS,
  onWake,
  onError,
} = {}) => {
  const SR =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;
  if (!SR) return null;

  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let running = false;
  let paused = false; // set true while a command is being captured
  let restartFailures = 0;
  const MAX_FAILURES = 5;

  const findWake = (text) => {
    const lower = (text || "").toLowerCase();
    // Detect based on word boundary so "sertexcelentte" doesn't trigger
    for (const v of variants) {
      const re = new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const m = lower.match(re);
      if (m && m.index !== undefined) {
        const tail = text.slice(m.index + m[0].length).trim();
        return { found: true, tail };
      }
    }
    return { found: false, tail: "" };
  };

  rec.onresult = (e) => {
    if (paused) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r.isFinal) continue; // wait for final results to avoid false positives
      const transcript = r[0].transcript || "";
      const { found, tail } = findWake(transcript);
      if (found) {
        paused = true;
        try { rec.stop(); } catch (err) { console.warn("[wakeWord.js] hata bastırıldı:", err); }
        onWake?.(tail);
        return;
      }
    }
  };

  rec.onerror = (e) => {
    // Silent recoverable errors — auto-restart
    if (e.error === "no-speech" || e.error === "aborted" || e.error === "network") {
      // handled via onend restart
      return;
    }
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      running = false;
      onError?.(e);
    }
  };

  rec.onend = () => {
    // Chrome kills continuous recognition after ~60s of silence — always restart
    // unless we've intentionally paused (waiting for command capture) or stopped.
    if (running && !paused) {
      setTimeout(() => {
        try {
          rec.start();
          restartFailures = 0;
        } catch (err) {
          restartFailures++;
          if (restartFailures >= MAX_FAILURES) {
            // Silently stop after too many failures to avoid tight loop
            running = false;
            onError?.(err);
          }
        }
      }, 250);
    }
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      paused = false;
      try { rec.start(); } catch (err) { console.warn("[wakeWord.js] hata bastırıldı:", err); }
    },
    stop: () => {
      running = false;
      paused = false;
      try { rec.stop(); } catch (err) { console.warn("[wakeWord.js] hata bastırıldı:", err); }
    },
    // Called after a command capture finishes → resume background listening
    resume: () => {
      if (!running) return; // stop() was called meanwhile
      paused = false;
      setTimeout(() => {
        try { rec.start(); } catch (err) { console.warn("[wakeWord.js] hata bastırıldı:", err); }
      }, 400);
    },
    isRunning: () => running,
  };
};

// ---- localStorage settings ----
const KEY = "sertex_wake_settings_v1";
const DEFAULT_SETTINGS = { enabled: false };

export const loadWakeSettings = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveWakeSettings = (patch) => {
  const next = { ...loadWakeSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) { console.warn("[wakeWord.js] hata bastırıldı:", e); }
  return next;
};
