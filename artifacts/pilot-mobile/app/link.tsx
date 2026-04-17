import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
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

export default function LinkScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const { linkAccount, remoteEnabled } = useAppData();

  const [militaryNumber, setMilitaryNumber] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const r = await linkAccount(militaryNumber, code);
    setSubmitting(false);
    if (!r.ok) {
      const map: Record<string, string> = {
        not_found: t("link_error_not_found"),
        bad_code: t("link_error_bad_code"),
        revoked: t("link_error_revoked"),
      };
      setError(map[r.error ?? ""] ?? t("link_error_generic"));
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        ).catch(() => {});
      }
      // Send the freshly-linked pilot to the reminders screen so they can
      // opt in to push notifications and pick their per-currency thresholds
      // before landing on the home tab. They can skip with the back button.
      try {
        router.replace("/reminders" as never);
      } catch {
        // Navigation is best-effort; if it fails the user still lands in tabs.
      }
    }
  };

  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 24;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAwareScrollView
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: topPad }]}
      >
        <View style={[styles.brand, { backgroundColor: colors.primary }]}>
          <Feather name="shield" size={28} color={colors.primaryForeground} />
        </View>
        <Text
          style={[
            styles.title,
            { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
          ]}
        >
          {t("link_title")}
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
          {t("link_subtitle")}
        </Text>

        {!remoteEnabled ? (
          <View
            style={[
              styles.warning,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
          >
            <Feather name="cloud-off" size={14} color={colors.warning} />
            <Text style={[styles.warningText, { color: colors.foreground }]}>
              {t("link_offline_warning")}
            </Text>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]}>
            {t("link_militaryNumber")}
          </Text>
          <TextInput
            value={militaryNumber}
            onChangeText={setMilitaryNumber}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="P001"
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

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]}>
            {t("link_code")}
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="123456"
            placeholderTextColor={colors.mutedForeground}
            maxLength={8}
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
          <Text style={[styles.error, { color: colors.destructive, textAlign: isRTL ? "right" : "left" }]}>
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={handleSubmit}
          disabled={submitting || !militaryNumber || !code}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: pressed || submitting || !militaryNumber || !code ? 0.7 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
              {t("link_submit")}
            </Text>
          )}
        </Pressable>

        {!remoteEnabled ? (
          <Text style={[styles.hint, { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" }]}>
            {t("link_demo_hint")}
          </Text>
        ) : null}

        {/* Contact card — visible before linking so a pilot who doesn't
            have their military number / link code knows who to ask. */}
        <View
          style={[
            styles.creditsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.creditsTitle,
              { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" },
            ]}
          >
            {t("settings_credits")}
          </Text>
          <Text
            style={[
              styles.creditsName,
              { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
            ]}
          >
            ABEDALQADER GHUNMAT
          </Text>
          <Text
            style={[
              styles.creditsRole,
              { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" },
            ]}
          >
            {t("credits_developer")}
          </Text>
          <Pressable
            onPress={() => Linking.openURL("tel:+9620775008345").catch(() => {})}
            style={[
              styles.creditsRow,
              { borderColor: colors.border, flexDirection: isRTL ? "row-reverse" : "row" },
            ]}
          >
            <Feather name="phone" size={14} color={colors.primary} />
            <Text style={[styles.creditsValue, { color: colors.foreground }]}>
              +962 77 500 8345
            </Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL("mailto:ghneimatabed1@icloud.com").catch(() => {})}
            style={[
              styles.creditsRow,
              { borderColor: colors.border, flexDirection: isRTL ? "row-reverse" : "row" },
            ]}
          >
            <Feather name="mail" size={14} color={colors.primary} />
            <Text style={[styles.creditsValue, { color: colors.foreground }]}>
              ghneimatabed1@icloud.com
            </Text>
          </Pressable>
          <Text
            style={[
              styles.creditsBlurb,
              { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" },
            ]}
          >
            {t("credits_blurb")}
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 22,
    paddingBottom: 60,
    gap: 14,
  },
  brand: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 6,
  },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  warningText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  field: {
    gap: 6,
    marginTop: 4,
  },
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
  error: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
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
  hint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  creditsCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  creditsTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  creditsName: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  creditsRole: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  creditsRow: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  creditsValue: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  creditsBlurb: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
    marginTop: 6,
  },
});
