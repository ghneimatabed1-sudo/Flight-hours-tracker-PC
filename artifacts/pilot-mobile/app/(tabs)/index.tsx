import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Stat } from "@/components/Stat";
import { useColors } from "@/hooks/useColors";
import { computeTotals, formatHours } from "@/lib/calculations";
import { useAppData } from "@/lib/data";
import { useI18n } from "@/lib/i18n";

function formatSyncTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useI18n();
  const { snapshot, refresh, refreshing, remoteEnabled } = useAppData();

  const totals = useMemo(
    () => (snapshot ? computeTotals(snapshot.profile, snapshot.sorties) : null),
    [snapshot]
  );

  if (!snapshot || !totals) return null;

  const profile = snapshot.profile;

  const onRefresh = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    void refresh();
  };

  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 12;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: topPad }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <View>
        <Text
          style={[
            styles.greeting,
            { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" },
          ]}
        >
          {t("home_greeting")}
        </Text>
        <Text
          style={[
            styles.name,
            { color: colors.foreground, textAlign: isRTL ? "right" : "left" },
          ]}
        >
          {profile.rank} {isRTL && profile.arabicName ? profile.arabicName : profile.name}
        </Text>
        <Text
          style={[
            styles.unit,
            { color: colors.mutedForeground, textAlign: isRTL ? "right" : "left" },
          ]}
        >
          {profile.squadron || profile.unit}
        </Text>
      </View>

      <View style={styles.row}>
        <Stat
          label={t("home_total_hours")}
          value={formatHours(totals.grandTotal)}
          hint={`Day ${formatHours(totals.totalDay)}  ·  Night ${formatHours(totals.totalNight)}`}
          emphasis
          isRTL={isRTL}
        />
      </View>

      <View style={[styles.row, styles.gap]}>
        <Stat
          label={t("home_nvg_total")}
          value={formatHours(totals.totalNvg)}
          isRTL={isRTL}
        />
        <Stat
          label={t("home_captain")}
          value={formatHours(totals.totalCaptain)}
          isRTL={isRTL}
        />
      </View>

      <View style={[styles.row, styles.gap]}>
        <Stat
          label={t("home_month_hours")}
          value={formatHours(totals.monthTotal)}
          hint={`${totals.sortiesThisMonth} ${t("home_sortie_count")}`}
          isRTL={isRTL}
        />
        <Stat
          label="Sim"
          value={formatHours(totals.totalSim)}
          isRTL={isRTL}
        />
      </View>

      <View
        style={[
          styles.syncRow,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            flexDirection: isRTL ? "row-reverse" : "row",
          },
        ]}
      >
        <View
          style={[
            styles.syncLeft,
            { flexDirection: isRTL ? "row-reverse" : "row" },
          ]}
        >
          <Feather
            name={remoteEnabled ? "cloud" : "cloud-off"}
            size={16}
            color={remoteEnabled ? colors.success : colors.mutedForeground}
          />
          <View>
            <Text style={[styles.syncLabel, { color: colors.foreground }]}>
              {remoteEnabled ? t("home_last_sync") : t("home_offline")}
            </Text>
            <Text style={[styles.syncValue, { color: colors.mutedForeground }]}>
              {formatSyncTime(snapshot.fetchedAt)}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          style={({ pressed }) => [
            styles.refreshBtn,
            {
              backgroundColor: colors.primary,
              opacity: pressed || refreshing ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="refresh-cw" size={14} color={colors.primaryForeground} />
          <Text style={[styles.refreshText, { color: colors.primaryForeground }]}>
            {t("home_refresh")}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 120,
    gap: 14,
  },
  greeting: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  name: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  unit: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  gap: {
    marginTop: 0,
  },
  syncRow: {
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  syncLeft: {
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  syncLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  syncValue: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
