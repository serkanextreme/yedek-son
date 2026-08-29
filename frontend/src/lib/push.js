// Web Push (VAPID) istemci yardımcıları — service worker kaydı, izin, abonelik.
import { api } from "./api";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported() {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'
export async function getPushState() {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? "subscribed" : "unsubscribed";
  } catch {
    return "unsubscribed";
  }
}

export async function enablePush() {
  if (!isPushSupported()) throw new Error("unsupported");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("denied");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { data } = await api.get("/push/vapid-public-key");
  const key = data && data.publicKey;
  if (!key) throw new Error("no-vapid");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await api.post("/push/subscribe", sub.toJSON());
  return "subscribed";
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return "unsubscribed";
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    return "unsubscribed";
  } catch {
    return "unsubscribed";
  }
}

export async function sendTestPush() {
  const { data } = await api.post("/push/test");
  return data && typeof data.sent === "number" ? data.sent : 0;
}
