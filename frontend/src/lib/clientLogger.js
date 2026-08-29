// Frontend Error Radar — sessiz istemci hata yakalayıcı.
// window.onerror + unhandledrejection dinler, hataları backend'e
// (`POST /api/client-log`) gönderir. Kullanıcıya HİÇBİR ŞEY göstermez,
// UX'i etkilemez. Throttle + dedupe ile spam ve döngü engellenir.
import { API } from "./api";

const ENDPOINT = `${API}/client-log`;
const TOKEN_KEY = "sertex_token_v1";
const DEDUPE_WINDOW_MS = 30_000; // aynı hata 30 sn içinde 1 kez
const MAX_PER_MINUTE = 20;

let installed = false;
const seen = new Map(); // dedupe key -> son gönderim zamanı
let windowStart = Date.now();
let sentInWindow = 0;

// Bot / crawler istekleri (Facebook, Google, Bing indeksleyicileri, headless
// tarayıcılar) gerçek kullanıcı değildir; WebGL vb. eksikliğinden hata üretip
// radarı kirletirler. Bu istemcilerde logger hiç kurulmaz.
const BOT_RE = /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|webindexer|bingpreview|headless|lighthouse|pingdom|gtmetrix|prerender|phantom/i;
const isBotClient = () => {
  try {
    return typeof navigator !== "undefined" && BOT_RE.test(navigator.userAgent || "");
  } catch {
    return false;
  }
};

const tokenSafe = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const shouldSend = (key) => {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= MAX_PER_MINUTE) return false;
  const last = seen.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  seen.set(key, now);
  sentInWindow += 1;
  // Basit bellek koruması — harita büyürse temizle.
  if (seen.size > 200) seen.clear();
  return true;
};

const post = (payload) => {
  try {
    const token = tokenSafe();
    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* logger asla hata fırlatmaz — sessizce yut */
    });
  } catch {
    /* asla throw etme */
  }
};

const report = (level, message, extra = {}) => {
  const msg = String(message || "").slice(0, 2000);
  if (!msg) return;
  const key = `${level}:${msg}:${extra.source || ""}:${extra.lineno || ""}`;
  if (!shouldSend(key)) return;
  post({
    level,
    message: msg,
    stack: extra.stack ? String(extra.stack).slice(0, 8000) : null,
    source: extra.source ? String(extra.source).slice(0, 1000) : null,
    lineno: extra.lineno ?? null,
    colno: extra.colno ?? null,
    url: (typeof location !== "undefined" ? location.href : "").slice(0, 1000),
    user_agent: (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 600),
    ts_client: new Date().toISOString(),
  });
};

export function initClientLogger() {
  if (installed || typeof window === "undefined" || isBotClient()) return;
  installed = true;

  window.addEventListener("error", (event) => {
    if (event?.error) {
      report("error", event.message || event.error.message, {
        stack: event.error.stack,
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    } else if (event?.message) {
      report("error", event.message, {
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const msg = reason?.message || String(reason || "Unhandled promise rejection");
    report("error", msg, { stack: reason?.stack });
  });
}

export default initClientLogger;
