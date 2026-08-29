// Hybrid STT: native Web Speech API (Chrome) with Whisper fallback (Firefox / Mobile)
import { sttApi } from "./api";

// ---------- Native Web Speech (Chrome, Edge, Safari 14+) ----------
export const getSpeechRecognition = () => {
  const SR =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;
  if (!SR) return null;
  return new SR();
};

export const isNativeSTTSupported = () => {
  return !!getSpeechRecognition();
};

export const createRecognizer = (lang = "tr-TR") => {
  const rec = getSpeechRecognition();
  if (!rec) return null;
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  return rec;
};

// ---------- Whisper fallback via MediaRecorder ----------
// Returns { start, stop } — stop resolves to transcribed text.
// If `onSilence` callback is provided, VAD (voice activity detection) will fire it
// once the user has spoken and then gone silent for `silenceMs` milliseconds.
export const createWhisperRecorder = async ({
  language = "tr",
  onError,
  onSilence,
  silenceMs = 1500,
  minSpeechMs = 400,
  maxDurationMs = 20000,
} = {}) => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Mikrofon erişimi bu tarayıcıda desteklenmiyor");
  }
  if (typeof window === "undefined" || !window.MediaRecorder) {
    throw new Error("MediaRecorder bu tarayıcıda desteklenmiyor");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Pick a supported MIME type — browser-dependent
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/wav",
  ];
  let mimeType = "";
  for (const c of candidates) {
    if (window.MediaRecorder.isTypeSupported?.(c)) {
      mimeType = c;
      break;
    }
  }

  const recorder = mimeType
    ? new window.MediaRecorder(stream, { mimeType })
    : new window.MediaRecorder(stream);

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onerror = (e) => {
    if (onError) onError(e);
  };

  // ---- VAD (Voice Activity Detection) via WebAudio AnalyserNode ----
  let audioCtx = null;
  let vadRaf = null;
  let vadStarted = false;
  const startVAD = () => {
    if (!onSilence) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const startedAt = Date.now();
      let speechStartAt = 0;      // when user first started speaking
      let lastLoudAt = 0;         // last time we heard voice
      const THRESHOLD = 18;       // RMS threshold (0..~50 for typical speech)
      vadStarted = true;

      const tick = () => {
        if (!vadStarted) return;
        analyser.getByteTimeDomainData(buf);
        // Compute RMS (root mean square) deviation from center (128)
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const d = buf[i] - 128;
          sum += d * d;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();

        if (rms > THRESHOLD) {
          if (!speechStartAt) speechStartAt = now;
          lastLoudAt = now;
        }

        const totalElapsed = now - startedAt;
        const spokeEnoughToJudge = speechStartAt && now - speechStartAt > minSpeechMs;
        const silenceElapsed = lastLoudAt ? now - lastLoudAt : 0;

        // Trigger auto-stop when: user has spoken AND then gone silent for `silenceMs`
        if (spokeEnoughToJudge && silenceElapsed > silenceMs) {
          vadStarted = false;
          onSilence("silence");
          return;
        }
        // Safety: hard cap recording duration
        if (totalElapsed > maxDurationMs) {
          vadStarted = false;
          onSilence("timeout");
          return;
        }
        vadRaf = requestAnimationFrame(tick);
      };
      vadRaf = requestAnimationFrame(tick);
    } catch (e) {
      // VAD is best-effort — silently ignore errors
    }
  };
  const stopVAD = () => {
    vadStarted = false;
    if (vadRaf) {
      cancelAnimationFrame(vadRaf);
      vadRaf = null;
    }
    if (audioCtx) {
      try {
        if (audioCtx.state !== "closed") audioCtx.close();
      } catch (e) { console.warn("[speech.js] hata bastırıldı:", e); }
      audioCtx = null;
    }
  };

  return {
    stream,
    recorder,
    start: () => {
      if (recorder.state === "inactive") {
        recorder.start(100); // 100ms timeslice
        startVAD();
      }
    },
    stop: () =>
      new Promise((resolve, reject) => {
        stopVAD();
        if (recorder.state === "inactive") {
          resolve("");
          return;
        }
        recorder.onstop = async () => {
          try {
            stream.getTracks().forEach((t) => t.stop());
            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            if (blob.size < 1000) {
              resolve(""); // too small — user probably didn't say anything
              return;
            }
            const text = await sttApi.whisper(blob, language);
            resolve(text);
          } catch (err) {
            reject(err);
          }
        };
        recorder.stop();
      }),
    cancel: () => {
      stopVAD();
      try {
        if (recorder.state !== "inactive") recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        // ignore
      }
    },
  };
};
