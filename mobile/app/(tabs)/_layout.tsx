import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";

import { AnnouncementBanner } from "@/src/components/AnnouncementBanner";
import { useAuth } from "@/src/auth/AuthContext";
import {
  NotificationsProvider,
  useNotifications,
} from "@/src/notifications/NotificationsContext";
import { colors } from "@/src/theme/colors";

function TabsInner() {
  const { unread } = useNotifications();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgBase }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 1,
          },
          tabBarLabelStyle: { fontSize: 10, letterSpacing: 0.5 },
          sceneStyle: { backgroundColor: colors.bgBase },
        }}
      >
      <Tabs.Screen
        name="tasks"
        options={{
          title: "GÖREVLER",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkbox-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: "TAKIM",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "BİLDİRİM",
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: "#FFFFFF", fontSize: 10 },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "PROFİL",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={color} />
          ),
        }}
      />
      </Tabs>
      <AnnouncementBanner />
    </View>
  );
}

export default function TabsLayout() {
  const { token, bootstrapping } = useAuth();

  if (!bootstrapping && !token) {
    return <Redirect href="/login" />;
  }

  return (
    <NotificationsProvider>
      <TabsInner />
    </NotificationsProvider>
  );
}
