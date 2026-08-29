// Frontend Error Radar (mobil) — sessiz istemci hata yakalayıcı.
// ErrorUtils global handler + yakalanmamış promise reddini dinler ve hataları
// backend'e (POST /api/client-log) gönderir. Kullanıcıya HİÇBİR ŞEY göstermez,
// UX'i etkilemez. Web'deki clientLogger.js ile birebir davranış: throttle +
// dedupe ile spam/döngü engellenir. Logger asla throw etmez.
import { Platform } from "react-native";

import { AUTH_TOKEN_KEY } from "@/src/auth/storage-keys";
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const ENDPOINT = `${BASE}/api/client-log`;
const DEDUPE_WINDOW_MS = 30_000; // aynı hata 30 sn içinde 1 kez
const MAX_PER_MINUTE = 20;
const UA = `SertexMobile ${Platform.OS} ${String(Platform.Version)}`;

let installed = false;
const seen = new Map<string, number>();
let windowStart = Date.now();
let sentInWindow = 0;

type Extra = {
  stack?: string | null;
  source?: string | null;
  lineno?: number | null;
  colno?: number | null;
  level?: string;
};

const shouldSend = (key: string) => {
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
  if (seen.size > 200) seen.clear(); // basit bellek koruması
  return true;
};

const post = async (payload: Record<string, unknown>) => {
  if (!BASE) return;
  try {
    let token = "";
    try {
      token = (await storage.secureGet<string>(AUTH_TOKEN_KEY, "")) || "";
    } catch {
      token = "";
    }
    await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      /* logger asla hata fırlatmaz — sessizce yut */
    });
  } catch {
    /* asla throw etme */
  }
};

const report = (level: string, message: unknown, extra: Extra = {}) => {
  const msg = String(message || "").slice(0, 2000);
  if (!msg) return;
  const key = `${level}:${msg}:${extra.source || ""}:${extra.lineno || ""}`;
  if (!shouldSend(key)) return;
  void post({
    level,
    message: msg,
    stack: extra.stack ? String(extra.stack).slice(0, 8000) : null,
    source: extra.source ? String(extra.source).slice(0, 1000) : "mobile",
    lineno: extra.lineno ?? null,
    colno: extra.colno ?? null,
    url: null,
    user_agent: UA.slice(0, 600),
    ts_client: new Date().toISOString(),
  });
};

// Ekranlar / API istemcisi elle hata bildirebilir (5xx, try/catch içi vb.).
export function captureError(message: unknown, extra: Extra = {}) {
  report(extra.level || "error", message, extra);
}

export function initClientLogger() {
  if (installed) return;
  installed = true;

  // 1) Global JS hata yakalayıcı (fatal + non-fatal). Önceki handler'ı korur
  //    ki dev'de RN kırmızı-ekran uyarısı çalışmaya devam etsin.
  try {
    const g = global as unknown as {
      ErrorUtils?: {
        getGlobalHandler?: () => ((e: Error, isFatal?: boolean) => void) | undefined;
        setGlobalHandler?: (h: (e: Error, isFatal?: boolean) => void) => void;
      };
    };
    const eu = g.ErrorUtils;
    if (eu && typeof eu.setGlobalHandler === "function") {
      const prev = eu.getGlobalHandler?.();
      eu.setGlobalHandler((error: Error, isFatal?: boolean) => {
        try {
          report("error", error?.message || String(error), {
            stack: error?.stack,
            source: isFatal ? "fatal" : "global",
          });
        } catch {
          /* yut */
        }
        if (typeof prev === "function") prev(error, isFatal);
      });
    }
  } catch {
    /* yut */
  }

  // 2) Yakalanmamış promise reddi (RN çekirdeğinin de kullandığı iz sürücü).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require("promise/setimmediate/rejection-tracking");
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id: number, error: Error) => {
        report("error", error?.message || String(error), {
          stack: error?.stack,
          source: "unhandledrejection",
        });
      },
      onHandled: () => {},
    });
  } catch {
    /* yut */
  }
}

export default initClientLogger;
