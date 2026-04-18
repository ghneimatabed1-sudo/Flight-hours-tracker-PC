import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Redirect, Stack, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useAppData } from "@/lib/data";
import { useI18n } from "@/lib/i18n";

// Cold-launch / post-sign-out unlock screen. Only reachable when a password
// is set and the session is locked.
export default function LockScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const { verifyPassword, hasPassword } = useAppData();

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const handleSubmit = async () => {
    if (submitting || !password) return;
    setSubmitting(true);
    setError(null);
    const r = await verifyPassword(password);
    setSubmitting(false);
    if (r.ok) {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        ).catch(() => {});
      }
      setPassword("");
      try {
        router.replace("/(tabs)" as never);
      } catch {
        // Navigation is best-effort.
      }
    } else {
      setAttempts((n) => n + 1);
      setError(t("lock_error_wrong"));
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error
        ).catch(() => {});
      }
    }
  };

  // Safety: if somehow no password is set, bounce the user out to setup.
  if (!hasPassword) return <Redirect href={"/setup-lock" as never} />;

  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 48;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <KeyboardAwareScrollView
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: topPad }]}
      >
        <View style={[styles.brand, { backgroundColor: colors.primary }]}>
          <Feather name="lock" size={28} color={colors.primaryForeground} />
        </View>
        <Text
          style={[
            styles.title,
            { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
          ]}
        >
          {t("lock_title")}
        </Text>
        <Text
          style={[
            styles.subtitle,
            {
              color: colors.mutedForeground,
              textAlign: isRTL ? "right" : "left",
            },
          ]}
        >
          {t("lock_subtitle")}
        </Text>

        <View style={styles.field}>
          <Text
            style={[
              styles.label,
              {
                color: colors.mutedForeground,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
          >
            {t("lock_password")}
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleSubmit}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
          />
        </View>

        {error ? (
          <Text
            style={[
              styles.error,
              {
                color: colors.destructive,
                textAlign: isRTL ? "right" : "left",
              },
            ]}
          >
            {error}
            {attempts >= 3 ? `\n${t("lock_hint_forgot")}` : ""}
          </Text>
        ) : null}

        <Pressable
          onPress={handleSubmit}
          disabled={submitting || !password}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: pressed || submitting || !password ? 0.7 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text
              style={[styles.buttonText, { color: colors.primaryForeground }]}
            >
              {t("lock_submit")}
            </Text>
          )}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingBottom: 60, gap: 14 },
  brand: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 6,
  },
  field: { gap: 6, marginTop: 4 },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  input: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  error: { fontSize: 13, fontFamily: "Inter_500Medium" },
  button: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
  },
});
