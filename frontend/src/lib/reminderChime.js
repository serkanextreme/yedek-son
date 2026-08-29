// Sertex — arka planda güvenilir JARVIS-vari hatırlatma sesi.
//
// Neden ayrı bir modül? Eski `playReminderBeep` her seferinde YENİ bir
// AudioContext açıyordu; tarayıcı sekmesi arka plandayken yeni context
// "suspended" başlıyor ve autoplay politikası nedeniyle ses çalmıyordu.
//
// Çözüm: TEK bir kalıcı (shared) AudioContext tut. İlk kullanıcı hareketiyle
// (click/keydown/touch) `resume()` edilir ve bir daha kapatılmaz. Kullanıcı
// arka plana geçmeden önce zaten uygulamayla etkileşmiş olur → context
// "running" durumda kalır ve sekme arka plandayken bile ses çalar.

let sharedCtx = null;
let unlockBound = false;

const getCtx = () => {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    try {
      sharedCtx = new AC();
    } catch {
      return null;
    }
  }
  return sharedCtx;
};

const resumeCtx = () => {
  const ctx = getCtx();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
};

const bindUnlock = () => {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  ["click", "keydown", "touchstart", "pointerdown"].forEach((ev) =>
    window.addEventListener(ev, resumeCtx, { passive: true })
  );
  // Sekme tekrar öne gelince de resume dene (bazı tarayıcılar hidden'da askıya alır).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeCtx();
  });
};

// Uygulama açılışında bir kez çağrılır (SertexMain). Unlock dinleyicilerini
// bağlar ve context'i erkenden hazırlar.
export const initReminderAudio = () => {
  bindUnlock();
  getCtx();
};

// JARVIS-vari kısa yükselen arpej + shimmer. `{ cancel }` döner (mevcut
// TasksPanel beep API'siyle uyumlu). Shared context KAPATILMAZ.
export const playReminderChime = (volume = 0.3) => {
  bindUnlock();
  const ctx = getCtx();
  if (!ctx) return { cancel: () => {} };
  try {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    /* ok */
  }
  let stopped = false;
  const nodes = [];
  try {
    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume));
    master.connect(ctx.destination);

    const t0 = ctx.currentTime + 0.02;
    // Yükselen üçlü (C5-E5-G5) + üstte parlak C6 shimmer — sıcak, sci-fi his.
    const notes = [
      { f: 523.25, at: 0.0, dur: 0.16, type: "triangle", peak: 1.0 },
      { f: 659.25, at: 0.1, dur: 0.16, type: "triangle", peak: 1.0 },
      { f: 783.99, at: 0.2, dur: 0.28, type: "triangle", peak: 1.0 },
      { f: 1046.5, at: 0.26, dur: 0.5, type: "sine", peak: 0.45 },
    ];
    notes.forEach(({ f, at, dur, type, peak }) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
      nodes.push(osc);
    });
  } catch {
    /* Web Audio kullanılamıyor — sessizce geç */
  }
  return {
    cancel: () => {
      if (stopped) return;
      stopped = true;
      nodes.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* ok */
        }
      });
    },
  };
};
