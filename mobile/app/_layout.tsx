import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/src/auth/AuthContext";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { initClientLogger } from "@/src/lib/clientLogger";
import { colors } from "@/src/theme/colors";

// Disable logbox overlays so the preview shows the app cleanly.
LogBox.ignoreAllLogs(true);

// Frontend Hata Radarı — yakalanmamış hataları sessizce backend'e gönder.
initClientLogger();

// Keep the native splash visible from cold start until icon fonts register.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgBase }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bgBase },
              animation: "fade",
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="task/[id]" />
            <Stack.Screen name="categories" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="archive" />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
