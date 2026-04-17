import React, { useMemo } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CurrencyRow } from "@/components/CurrencyRow";
import { useColors } from "@/hooks/useColors";
import { computeCurrencies } from "@/lib/calculations";
import { useAppData } from "@/lib/data";
import { useI18n } from "@/lib/i18n";

export default function CurrencyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useI18n();
  const { snapshot, refresh, refreshing } = useAppData();

  const items = useMemo(
    () => (snapshot ? computeCurrencies(snapshot.profile) : []),
    [snapshot]
  );

  if (!snapshot) return null;

  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 12;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: topPad }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.primary}
        />
      }
    >
      <Text
        style={[
          styles.title,
          { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
        ]}
      >
        {t("currency_title")}
      </Text>
      <View style={styles.list}>
        {items.map((item) => (
          <CurrencyRow key={item.key} item={item} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 120,
    gap: 12,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  list: {
    gap: 10,
  },
});
