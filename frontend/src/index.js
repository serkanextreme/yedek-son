import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import ErrorBoundary from "@/components/ErrorBoundary";
import { initNativeShell } from "@/lib/nativeShell";
import { initClientLogger } from "@/lib/clientLogger";
// Görünüm tercihlerini (vurgu rengi + yazı boyutu + arayüz) açılışta uygula.
import "@/lib/appearance";

// Faz 9 CP4.19 — kicks off Capacitor plugins (splash-hide, status bar)
// when running inside the Android/iOS shell. Silent no-op on the web.
initNativeShell();

// Frontend Error Radar — sessiz tarayıcı hata yakalayıcıyı başlat.
initClientLogger();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Remove the boot loader (index.html) once React is about to mount
const rootEl = document.getElementById("root");
const boot = document.getElementById("sertex-boot");
if (boot && boot.parentNode) {
  try { boot.parentNode.removeChild(boot); } catch (e) { console.warn("[index.js] hata bastırıldı:", e); }
}

const root = ReactDOM.createRoot(rootEl);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
