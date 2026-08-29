import { useState, useEffect } from "react";

const HW_CORES = navigator.hardwareConcurrency || 4;
const DEVICE_MEM_GB = navigator.deviceMemory || null;

/**
 * Real browser + hardware stats we CAN measure:
 *  - CPU cores (static)
 *  - Device memory GB (Chrome, rounded)
 *  - JS heap usage (Chrome, real)
 *  - FPS (via requestAnimationFrame, real)
 *  - Main thread lag % (real - shows how busy the JS thread is)
 *  - Backend network latency (real ping)
 *  - Battery level & charging (real if supported)
 *  - Network type (4g/wifi/etc, real)
 *  - Online status (real)
 */
export const useSystemStats = () => {
  const [stats, setStats] = useState({
    cores: HW_CORES,
    deviceMemGB: DEVICE_MEM_GB,
    ramPct: null,
    ramUsedMB: null,
    ramLimitMB: null,
    fps: 60,
    loadPct: 0,
    latency: null,
    online: navigator.onLine,
    network: navigator.connection?.effectiveType || null,
    battery: null,
    charging: null,
    platform: navigator.platform || "",
    userAgent: (navigator.userAgentData?.platform) || navigator.platform || "",
  });

  // FPS tracking
  useEffect(() => {
    let last = performance.now();
    let fpsAcc = 0;
    let samples = 0;
    let raf;
    const tick = (now) => {
      const dt = now - last;
      last = now;
      if (dt > 0 && dt < 500) {
        fpsAcc += 1000 / dt;
        samples++;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const flush = setInterval(() => {
      const avgFps = samples > 0 ? Math.round(fpsAcc / samples) : 60;
      fpsAcc = 0;
      samples = 0;
      setStats((s) => ({ ...s, fps: Math.min(240, avgFps) }));
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(flush);
    };
  }, []);

  // Main thread lag → approximates CPU busyness for THIS tab
  useEffect(() => {
    let lastCheck = performance.now();
    const targetMs = 100;
    const iv = setInterval(() => {
      const now = performance.now();
      const drift = Math.max(0, now - lastCheck - targetMs);
      lastCheck = now;
      const loadPct = Math.min(100, Math.round((drift / 60) * 100));
      setStats((s) => ({ ...s, loadPct }));
    }, targetMs);
    return () => clearInterval(iv);
  }, []);

  // JS heap memory (Chrome only)
  useEffect(() => {
    const readMem = () => {
      if (performance.memory) {
        const used = performance.memory.usedJSHeapSize;
        const limit = performance.memory.jsHeapSizeLimit;
        setStats((s) => ({
          ...s,
          ramPct: Math.round((used / limit) * 100),
          ramUsedMB: Math.round(used / 1024 / 1024),
          ramLimitMB: Math.round(limit / 1024 / 1024),
        }));
      }
    };
    readMem();
    const iv = setInterval(readMem, 2000);
    return () => clearInterval(iv);
  }, []);

  // Backend ping
  useEffect(() => {
    const BACKEND = process.env.REACT_APP_BACKEND_URL;
    const ping = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch(`${BACKEND}/api/`, { cache: "no-store" });
        await r.text();
        const t1 = performance.now();
        setStats((s) => ({ ...s, latency: Math.round(t1 - t0), online: true }));
      } catch (e) {
        setStats((s) => ({ ...s, latency: null, online: false }));
      }
    };
    ping();
    const iv = setInterval(ping, 4000);
    return () => clearInterval(iv);
  }, []);

  // Online/offline
  useEffect(() => {
    const on = () => setStats((s) => ({ ...s, online: true }));
    const off = () => setStats((s) => ({ ...s, online: false }));
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Battery
  useEffect(() => {
    if (!navigator.getBattery) return;
    let b;
    let update;
    navigator.getBattery().then((battery) => {
      b = battery;
      update = () =>
        setStats((s) => ({
          ...s,
          battery: Math.round(b.level * 100),
          charging: b.charging,
        }));
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    }).catch(() => {});
    return () => {
      if (b && update) {
        try {
          b.removeEventListener("levelchange", update);
          b.removeEventListener("chargingchange", update);
        } catch (e) { console.warn("[systemStats.js] hata bastırıldı:", e); }
      }
    };
  }, []);

  // Network type
  useEffect(() => {
    if (!navigator.connection) return;
    const update = () =>
      setStats((s) => ({ ...s, network: navigator.connection.effectiveType }));
    update();
    navigator.connection.addEventListener("change", update);
    return () => navigator.connection.removeEventListener("change", update);
  }, []);

  return stats;
};

// Helper: FPS → percentage (60 fps = 100%)
export const fpsToPct = (fps) => Math.min(100, Math.round((fps / 60) * 100));

// Helper: prettify platform
export const prettyPlatform = (p) => {
  const s = (p || "").toLowerCase();
  if (s.includes("win")) return "Windows";
  if (s.includes("mac")) return "macOS";
  if (s.includes("linux")) return "Linux";
  if (s.includes("android")) return "Android";
  if (s.includes("iphone") || s.includes("ipad") || s.includes("ios")) return "iOS";
  return p || "?";
};
