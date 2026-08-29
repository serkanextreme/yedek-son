// SERTEX mobile design tokens — mirrors the web dark space / neon-cyan HUD
// brand (see /app/design_guidelines.json). Never pure white / pure black.

export const colors = {
  bgBase: "#02040A",
  surface: "#050914",
  surfaceAlt: "#070D1C",
  panel: "rgba(5, 9, 20, 0.65)",
  border: "rgba(0, 240, 255, 0.16)",
  borderStrong: "rgba(0, 240, 255, 0.38)",
  primary: "#00F0FF",
  secondary: "#0066FF",
  glow: "rgba(0, 240, 255, 0.45)",
  warning: "#FFB800",
  danger: "#FF003C",
  success: "#4ADE80",
  textPrimary: "#E2F1FF",
  textSecondary: "#8AB4F8",
  textMuted: "#4B72A8",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

// Monospace family for HUD / metric text — matches the web JetBrains-Mono vibe.
import { Platform } from "react-native";
export const monoFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});
