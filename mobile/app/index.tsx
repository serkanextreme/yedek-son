// Auth gate — the app entry route. Decides where a cold start lands based on
// the persisted session.

import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/auth/AuthContext";
import { colors } from "@/src/theme/colors";

export default function Index() {
  const { token, bootstrapping } = useAuth();

  if (bootstrapping) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Redirect href={token ? "/tasks" : "/login"} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgBase,
  },
});
