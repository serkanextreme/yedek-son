import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Faz 9 CP4.19 — Capacitor bootstrap for the Sertex Android app.
 *
 * The mobile shell wraps the existing React build (see /app/frontend/build)
 * and talks to the same backend as the production web app (sertex-ai.com).
 * Nothing changes for existing web users — Capacitor only adds a native
 * Android host that reuses the SPA verbatim.
 *
 * NOTE on server URL: iOS/Android WebViews block plain HTTP by default
 * (App Transport Security / cleartext traffic). Because the backend runs
 * over HTTPS on the production domain, we can safely embed the assets
 * locally and let the fetch calls fly to the remote origin as-is.
 */
const config: CapacitorConfig = {
  appId: 'com.sertex.app',
  appName: 'Sertex',
  webDir: 'build',
  // The bundled index.html lives inside the APK; the app then makes API
  // calls to REACT_APP_BACKEND_URL, which is baked into the JS bundle at
  // build time. That means switching between preview / production is a
  // matter of running the build with a different env, no config change
  // needed here.
  server: {
    androidScheme: 'https',
    // Allow cleartext only in the (unlikely) event that we point the app
    // at localhost during development; production builds always hit HTTPS.
    cleartext: false,
  },
  android: {
    // Use the modern WebView flavor + allow mixed content so the SSE
    // stream (long-lived HTTPS) survives Android's aggressive throttling
    // when the app is put in the background.
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0b1220',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      // Sertex ships as a dark HUD; the status bar must match to avoid
      // the ugly light strip at the top on Android 12+.
      style: 'DARK',
      backgroundColor: '#0b1220',
    },
  },
};

export default config;
