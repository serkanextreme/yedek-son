package com.sertex.app;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

/**
 * Faz 9 CP4.22 — override the default Capacitor WebView configuration
 * so that Android correctly renders our desktop-optimised HUD layout.
 *
 * The stock Capacitor WebView on Android ignores the viewport meta tag
 * when `useWideViewPort=false` (default). That means our JS-side
 * `initNativeShell()` rewrite of `initial-scale=0.312` never takes
 * effect — the WebView just lays out the page at the physical device
 * width (~400px), clipping the left half of every panel off-screen.
 *
 * Enabling the two flags below matches how Chrome renders desktop
 * websites on a phone: read the meta tag, honour the wide width, then
 * scale-to-fit so the entire content is visible.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The bridge's WebView is available after super.onCreate().
        try {
            WebSettings settings = this.bridge.getWebView().getSettings();
            // Read <meta name="viewport"> and honour the declared width
            // instead of falling back to the device's actual pixel width.
            settings.setUseWideViewPort(true);
            // Scale the content down to fit the WebView's visible area
            // when the declared viewport is wider than the device.
            settings.setLoadWithOverviewMode(true);
            // Let the user pinch-zoom in for small text — hide the tiny
            // native +/- controls that Android historically overlaid on
            // zoomable pages (the CSS/JS side already offers zoom UX).
            settings.setBuiltInZoomControls(true);
            settings.setDisplayZoomControls(false);
        } catch (Exception ignored) {
            // If the WebView is not yet attached (very rare), let the
            // JS layer handle scaling on its own via viewport meta.
        }
    }
}
