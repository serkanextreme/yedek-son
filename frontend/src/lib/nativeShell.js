/**
 * Faz 9 CP4.19 — Native shell integration for the Android/iOS Capacitor build.
 *
 * When the app is running inside the Capacitor WebView we:
 *   • Hide the splash screen the moment React finishes hydration (fast UX).
 *   • Force the status bar to match Sertex's dark HUD theme so we don't see
 *     a white strip at the top of the phone.
 *   • Log the platform for debugging (`console.log('platform', ...)`).
 *
 * On the plain web build these imports are no-ops — Capacitor detects the
 * absence of the native bridge and every plugin call resolves silently.
 */
import { Capacitor } from "@capacitor/core";

export const isNative = () => {
  try {
    return Capacitor.isNativePlatform && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export const initNativeShell = async () => {
  if (!isNative()) return;

  // Faz 9 CP4.22 — the desktop HUD is optimised for 1280px+ canvases.
  // Inside the phone WebView we dynamically shrink the viewport with a
  // matching `initial-scale` so the whole layout auto-fits (WebView will
  // then handle touch coordinates correctly — CSS transforms would not).
  // The user can still pinch-zoom (minimum-scale=0.25, maximum-scale=3).
  //
  // Combined with MainActivity.java's `useWideViewPort=true` +
  // `loadWithOverviewMode=true`, this reliably renders the desktop
  // layout scaled to fit the phone screen.
  try {
    const targetDesktopWidth = 1280;
    const actualWidth = window.innerWidth || document.documentElement.clientWidth || 400;
    const scale = Math.min(1, Math.max(0.28, actualWidth / targetDesktopWidth));
    const content = `width=${targetDesktopWidth}, initial-scale=${scale.toFixed(3)}, minimum-scale=0.25, maximum-scale=3, user-scalable=yes, viewport-fit=cover`;
    // Remove the old meta and inject a fresh one — Android WebView
    // won't always re-layout on setAttribute alone, but always does when
    // the element is replaced (removed + inserted).
    const old = document.querySelector('meta[name="viewport"]');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const fresh = document.createElement("meta");
    fresh.setAttribute("name", "viewport");
    fresh.setAttribute("content", content);
    document.head.appendChild(fresh);
    console.log("[sertex-native] viewport rewritten:", content);
  } catch (e) {
    console.debug("[sertex-native] viewport rescale skipped:", e);
  }

  // Lazy-load the plugins so the web bundle never ships their code paths.
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch (e) {
    console.debug("[sertex-native] splash hide skipped:", e);
  }

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0b1220" });
  } catch (e) {
    console.debug("[sertex-native] status bar skipped:", e);
  }

  try {
    const platform = Capacitor.getPlatform();
    // Tag the root element so CSS can key off `body[data-native="android"]`
    // for platform-specific safe-area padding without touching every panel.
    document.body.setAttribute("data-native", platform);
    console.log("[sertex-native] running on", platform);
  } catch { /* noop */ }

  // Faz 9 CP4.21 — global haptic feedback on button taps. Instead of
  // sprinkling `Haptics.impact()` calls into every onClick handler, we
  // attach a single capturing listener that fires a short vibration
  // whenever the user taps an actual interactive element. Cheap
  // (< 3ms per tap), silent-fail (any exception is swallowed), and only
  // active inside the native shell.
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const isTappable = (el) => {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "button" || tag === "a") return true;
      if (el.getAttribute && el.getAttribute("role") === "button") return true;
      // Any explicitly cursor-pointer element the user styled as tappable.
      if (el.dataset && el.dataset.tapHaptic === "true") return true;
      return false;
    };
    document.addEventListener(
      "click",
      (ev) => {
        try {
          // Walk up the tree a few levels — Framer Motion, Radix, etc.
          // often wrap the button in a div and stop the event on the
          // inner element (svg / span). We look up to 4 ancestors.
          let node = ev.target;
          for (let hop = 0; hop < 4 && node; hop++) {
            if (isTappable(node)) {
              Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
              return;
            }
            node = node.parentElement;
          }
        } catch { /* noop */ }
      },
      { passive: true, capture: true }
    );
    console.log("[sertex-native] haptic feedback armed");
  } catch (e) {
    console.debug("[sertex-native] haptics skipped:", e);
  }
};
