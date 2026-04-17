import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useAppData } from "@/lib/data";
import { useI18n, type Lang } from "@/lib/i18n";

interface RowProps {
  label: string;
  value: string;
  isRTL: boolean;
}

function Row({ label, value, isRTL }: RowProps) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          flexDirection: isRTL ? "row-reverse" : "row",
        },
      ]}
    >
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.rowValue,
          {
            color: colors.foreground,
            textAlign: isRTL ? "left" : "right",
          },
        ]}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, isRTL, lang, setLang } = useI18n();
  const { snapshot, unlink } = useAppData();

  if (!snapshot) return null;

  const profile = snapshot.profile;
  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 12;

  const confirmUnlink = () => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm(t("settings_logout_confirm"))) {
        void unlink();
      }
      return;
    }
    Alert.alert(t("settings_logout"), t("settings_logout_confirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("confirm"), style: "destructive", onPress: () => void unlink() },
    ]);
  };

  const langOptions: { key: Lang; label: string }[] = [
    { key: "en", label: "English" },
    { key: "ar", label: "العربية" },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: topPad }]}
    >
      <Text
        style={[
          styles.title,
          { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
        ]}
      >
        {t("tab_settings")}
      </Text>

      <Text
        style={[
          styles.section,
          { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" },
        ]}
      >
        {t("settings_profile")}
      </Text>
      <View style={styles.list}>
        <Row label="Name" value={profile.name} isRTL={isRTL} />
        {profile.arabicName ? (
          <Row label="الاسم" value={profile.arabicName} isRTL={isRTL} />
        ) : null}
        <Row label={t("settings_rank")} value={profile.rank} isRTL={isRTL} />
        <Row
          label={t("settings_military_number")}
          value={profile.militaryNumber}
          isRTL={isRTL}
        />
        <Row label={t("settings_unit")} value={profile.unit} isRTL={isRTL} />
        <Row
          label={t("settings_squadron")}
          value={profile.squadron}
          isRTL={isRTL}
        />
      </View>

      <Text
        style={[
          styles.section,
          { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" },
        ]}
      >
        {t("settings_language")}
      </Text>
      <View
        style={[
          styles.langRow,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {langOptions.map((opt) => {
          const active = lang === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setLang(opt.key)}
              style={({ pressed }) => [
                styles.langBtn,
                {
                  backgroundColor: active ? colors.primary : "transparent",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.langText,
                  {
                    color: active ? colors.primaryForeground : colors.foreground,
                  },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text
        style={[
          styles.section,
          { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" },
        ]}
      >
        {t("settings_about")}
      </Text>
      <Text
        style={[
          styles.about,
          {
            color: colors.mutedForeground,
            textAlign: isRTL ? "right" : "left",
          },
        ]}
      >
        {t("settings_about_text")}
      </Text>

      <Pressable
        onPress={confirmUnlink}
        style={({ pressed }) => [
          styles.logout,
          {
            backgroundColor: colors.card,
            borderColor: colors.destructive,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Feather name="log-out" size={16} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>
          {t("settings_logout")}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 120,
    gap: 10,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  section: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 4,
  },
  list: {
    gap: 8,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  rowValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  langRow: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  langBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  langText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  about: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    marginTop: 4,
  },
  logout: {
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoutText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
