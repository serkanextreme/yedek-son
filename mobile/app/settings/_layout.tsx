import { Stack } from "expo-router";

import { colors } from "@/src/theme/colors";

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgBase },
        animation: "slide_from_right",
      }}
    />
  );
}
