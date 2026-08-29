/**
 * Faz 9 CP7 — FCM Push Notifications integration for the Capacitor Android
 * build. On the plain web build this file's public API resolves to no-ops
 * (native check gates everything).
 *
 * Flow:
 *   1. On auth (or app open with existing token) → request permission
 *   2. Register device with FCM → obtain the push token
 *   3. POST /api/fcm/register-token to persist the token server-side
 *   4. Set up listeners for received / tapped notifications
 *   5. On tap → deep-link inside the app (dispatch a CustomEvent that
 *      SertexMain listens for and routes accordingly)
 *
 * Callers use `initPushNotifications(userId)` from an authenticated context.
 */
import { isNative } from "./nativeShell";
import { api } from "./api";

// Faz 9 CP7 — track whether we've already registered listeners in this
// session so a re-login doesn't stack duplicates.
let _pushInitialised = false;
let _currentToken = null;

const _log = (...args) => console.log("[sertex-push]", ...args);
const _warn = (...args) => console.warn("[sertex-push]", ...args);

/**
 * Ask for permission + get FCM token + register with backend.
 * Safe to call multiple times — idempotent.
 */
export const initPushNotifications = async () => {
  if (!isNative()) {
    _log("web platform — push disabled (SSE covers foreground)");
    return { ok: false, reason: "not-native" };
  }
  if (_pushInitialised) {
    _log("already initialised — skipping");
    return { ok: true, reason: "already", token: _currentToken };
  }
  let PushNotifications;
  try {
    ({ PushNotifications } = await import("@capacitor/push-notifications"));
  } catch (e) {
    _warn("plugin import failed:", e?.message || e);
    return { ok: false, reason: "plugin-missing" };
  }

  try {
    // Ask for OS-level permission (Android 13+ prompts, older Android grants).
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") {
      _warn("permission denied by user");
      return { ok: false, reason: "denied" };
    }

    // The `registration` event fires asynchronously with the FCM token.
    await PushNotifications.addListener("registration", async (result) => {
      const token = result.value;
      _currentToken = token;
      _log("got FCM token:", token.slice(0, 12) + "…");
      try {
        await api.post("/fcm/register-token", {
          token,
          platform: "android",
          device_id: (window.navigator?.userAgent || "unknown").slice(0, 120),
        });
        _log("token registered with backend");
      } catch (err) {
        _warn("backend register failed:", err?.response?.data || err?.message);
      }
    });

    await PushNotifications.addListener("registrationError", (err) => {
      _warn("registration error:", err);
    });

    // Foreground push → surface a browser CustomEvent so SertexMain /
    // NotificationBell can render a toast. We DON'T show a system tray
    // notification when the user is looking at the app — SSE already
    // handles that path.
    await PushNotifications.addListener("pushNotificationReceived", (notif) => {
      _log("foreground push received:", notif?.title);
      try {
        window.dispatchEvent(new CustomEvent("sertex:push-foreground", {
          detail: notif,
        }));
      } catch { /* noop */ }
    });

    // User tapped a notification while app was backgrounded/killed.
    // The `data` payload includes `kind` + entity id, which we translate
    // into an in-app route event.
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const data = action?.notification?.data || {};
      _log("push tapped, data:", data);
      try {
        if (data.kind === "announcement") {
          window.dispatchEvent(new CustomEvent("sertex:open-settings-tab", { detail: "announcements" }));
        } else if (data.kind === "task" && data.task_id) {
          window.dispatchEvent(new CustomEvent("sertex:open-task", { detail: data.task_id }));
        } else if (data.kind === "otp" && data.task_id) {
          window.dispatchEvent(new CustomEvent("sertex:open-unlock-otp", { detail: data.task_id }));
        }
      } catch { /* noop */ }
    });

    await PushNotifications.register();
    _pushInitialised = true;
    _log("initialised (waiting for registration event)");
    return { ok: true };
  } catch (e) {
    _warn("init failed:", e?.message || e);
    return { ok: false, reason: "init-error", error: e?.message };
  }
};

/**
 * Called during logout — best effort. If we know our current token, tell
 * the backend to drop it so this device stops receiving pushes.
 */
export const teardownPushNotifications = async () => {
  if (!isNative() || !_currentToken) return;
  try {
    await api.post("/fcm/unregister-token", { token: _currentToken });
    _log("token unregistered on backend");
  } catch (e) {
    _warn("unregister failed:", e?.message || e);
  }
  _currentToken = null;
};

export const getCurrentPushToken = () => _currentToken;
