// Faz 9 CP8 — Mobile-first responsive helpers.
//
// Sertex'in desktop HUD layout'u 1280px+ için tasarlandı. 1024'ün altında
// (tablet + phone) yeni bir yaklaşım gerekiyor:
//   * HUD paneller (TopLeft/TopRight/BottomLeft) → gizle (kalabalık)
//   * Sidebar/NeuralLink → slide-in drawer
//   * Alt bottom-navigation bar → hızlı erişim (Sohbet/Görevler/Ayarlar)
//   * Merkezi HUD küre → arka plan efekti (küçülür, opacity düşer)
//   * Modal'lar → tam ekran (max-w bypass)
//
// Bu hook `matchMedia` API'sini kullanır; resize/orientation değişikliklerine
// gerçek zamanlı tepki verir. Native (Capacitor) build'de aynı hook çalışır
// çünkü WebView zaten viewport'u telefon boyutuna göre ayarlar.
import { useEffect, useState } from "react";

const _MOBILE_QUERY = "(max-width: 1023.98px)";
const _TABLET_QUERY = "(min-width: 640px) and (max-width: 1023.98px)";
const _PHONE_QUERY = "(max-width: 639.98px)";

const _getMatch = (q) => {
  try {
    return typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(q).matches
      : false;
  } catch {
    return false;
  }
};

const _useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => _getMatch(query));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    // Some browsers still ship the legacy `addListener` API.
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);
  return matches;
};

/** True when viewport is < 1024px (tablet or phone). */
export const useIsMobile = () => _useMediaQuery(_MOBILE_QUERY);

/** True when viewport is 640-1023px (tablet-sized). */
export const useIsTablet = () => _useMediaQuery(_TABLET_QUERY);

/** True when viewport is < 640px (phone-sized). */
export const useIsPhone = () => _useMediaQuery(_PHONE_QUERY);
