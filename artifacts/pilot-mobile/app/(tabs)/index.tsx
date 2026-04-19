import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
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

import { CurrencyTile } from "@/components/CurrencyTile";
import { Stat } from "@/components/Stat";
import { useColors } from "@/hooks/useColors";
import { computeCurrencies, computeTotals, formatHours } from "@/lib/calculations";
import { useAppData } from "@/lib/data";
import { useI18n } from "@/lib/i18n";

function formatSyncTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // DD-MM HH:mm — matches the squadron-wide DD-MM-YYYY family.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function timeOfDayKey(hour: number): "home_greet_morning" | "home_greet_afternoon" | "home_greet_evening" {
  if (hour < 12) return "home_greet_morning";
  if (hour < 18) return "home_greet_afternoon";
  return "home_greet_evening";
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useI18n();
  const { snapshot, refresh, refreshing, remoteEnabled } = useAppData();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const totals = useMemo(
    () => (snapshot ? computeTotals(snapshot.profile, snapshot.sorties) : null),
    [snapshot]
  );

  const currencyStrip = useMemo(() => {
    if (!snapshot) return [];
    return computeCurrencies(snapshot.profile).filter((c) => c.key !== "sim");
  }, [snapshot]);

  if (!snapshot || !totals) return null;

  const profile = snapshot.profile;

  const onRefresh = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    void refresh();
  };

  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 16;

  const greetKey = timeOfDayKey(now.getHours());
  const greeting = t(greetKey);
  // DD-MM-YYYY squadron standard. Month label = MM-YYYY.
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthLabel = `${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  const todayDate = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  const localTime = now.toLocaleTimeString(isRTL ? "ar-JO" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const align = isRTL ? "right" : "left";
  const rowDir = isRTL ? "row-reverse" : "row";

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
      {/* ── Mission strip ───────────────────────── */}
      <View style={[styles.strip, { borderColor: colors.border, flexDirection: rowDir }]}>
        <View style={[styles.stripDot, { backgroundColor: colors.success }]} />
        <Text style={[styles.stripStencil, { color: colors.mutedForeground }]}>{todayDate}</Text>
        <Text style={[styles.stripDivider, { color: colors.border }]}>│</Text>
        <Text style={[styles.stripStencil, { color: colors.mutedForeground }]}>{t("home_local").toUpperCase()}</Text>
        <Text style={[styles.stripValue, { color: colors.foreground }]}>{localTime}</Text>
        <View style={{ flex: 1 }} />
        <Feather
          name={remoteEnabled ? "wifi" : "wifi-off"}
          size={12}
          color={remoteEnabled ? colors.success : colors.mutedForeground}
        />
      </View>

      {/* ── Greeting ───────────────────────────── */}
      <View>
        <Text style={[styles.greeting, { color: colors.mutedForeground, textAlign: align }]}>
          {greeting}
        </Text>
        <Text style={[styles.name, { color: colors.foreground, textAlign: align }]}>
          {profile.rank} {isRTL && profile.arabicName ? profile.arabicName : profile.name}
        </Text>
        {profile.flightName ? (
          <Text style={[styles.unit, { color: colors.primary, textAlign: align, fontFamily: "monospace" }]}>
            "{profile.flightName}"
          </Text>
        ) : null}
        <Text style={[styles.unit, { color: colors.mutedForeground, textAlign: align }]}>
          {profile.squadron || profile.unit}
        </Text>
      </View>

      {/* ── Currency strip ─────────────────────── */}
      {currencyStrip.length > 0 ? (
        <View style={[styles.currencyStrip, { flexDirection: rowDir }]}>
          {currencyStrip.map((item) => (
            <CurrencyTile key={item.key} item={item} />
          ))}
        </View>
      ) : null}

      {/* ── Hero card ──────────────────────────── */}
      <View
        style={[
          styles.hero,
          { backgroundColor: colors.card, borderColor: colors.primary + "55" },
        ]}
      >
        <View style={[styles.tickTL, { borderColor: colors.primary }]} />
        <View style={[styles.tickTR, { borderColor: colors.primary }]} />
        <View style={[styles.tickBL, { borderColor: colors.primary }]} />
        <View style={[styles.tickBR, { borderColor: colors.primary }]} />

        <Text style={[styles.heroLabel, { color: colors.mutedForeground, textAlign: align }]}>
          {`// ${monthLabel} · ${t("home_total_hours")}`}
        </Text>

        <View style={[styles.heroRow, { flexDirection: rowDir }]}>
          <Text style={[styles.heroValue, { color: colors.primary }]}>
            {formatHours(totals.grandTotal)}
          </Text>
          <Text style={[styles.heroUnit, { color: colors.mutedForeground }]}>{t("home_hrs").toUpperCase()}</Text>
        </View>

        <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />

        <View style={[styles.heroChips, { flexDirection: rowDir }]}>
          <HeroChip label={t("home_day").toUpperCase()} value={formatHours(totals.totalDay)} />
          <HeroChip label={t("home_night").toUpperCase()} value={formatHours(totals.totalNight)} />
          <HeroChip label={t("home_nvg").toUpperCase()} value={formatHours(totals.totalNvg)} accent={colors.primary} />
        </View>
      </View>

      {/* ── Quick stats ───────────────────────── */}
      <View style={[styles.row, styles.gap]}>
        <Stat
          label={t("home_month_hours")}
          value={formatHours(totals.monthTotal)}
          hint={`${totals.sortiesThisMonth} ${t("home_sortie_count")}`}
          emphasis
          isRTL={isRTL}
        />
        <Stat
          label={t("home_captain")}
          value={formatHours(totals.totalCaptain)}
          isRTL={isRTL}
        />
      </View>

      <View style={[styles.row, styles.gap]}>
        <Stat label={t("home_sim").toUpperCase()} value={formatHours(totals.totalSim)} isRTL={isRTL} />
        <Stat label={t("home_nvg").toUpperCase()} value={formatHours(totals.totalNvg)} isRTL={isRTL} />
      </View>

      {/* ── Half-year breakdown table (matches old APK summary page) ──── */}
      <View style={[styles.table, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.tableTitle, { color: colors.foreground, textAlign: align }]}>
          {t("home_breakdown_title")}
        </Text>
        <Text style={[styles.tableHint, { color: colors.mutedForeground, textAlign: align }]}>
          {`${t("home_breakdown_hint")} · ${new Date().getFullYear()}`}
        </Text>

        <View style={[styles.tblHead, { borderColor: colors.border, flexDirection: rowDir }]}>
          <Text style={[styles.tblCellLabel, { color: colors.mutedForeground }]}>{""}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_day")}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_night")}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_nvg")}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_sim")}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_total")}</Text>
        </View>

        <BreakdownRow
          label={`${t("home_h1")} · ${t("home_h1_hint")}`}
          sub={`${totals.h1.sorties} ${t("home_col_sorties")}`}
          cells={[totals.h1.day, totals.h1.night, totals.h1.nvg, totals.h1.sim, totals.h1.total]}
          rowDir={rowDir}
        />
        <BreakdownRow
          label={`${t("home_h2")} · ${t("home_h2_hint")}`}
          sub={`${totals.h2.sorties} ${t("home_col_sorties")}`}
          cells={[totals.h2.day, totals.h2.night, totals.h2.nvg, totals.h2.sim, totals.h2.total]}
          rowDir={rowDir}
        />
        <BreakdownRow
          label={t("home_year")}
          sub={`${totals.h1.sorties + totals.h2.sorties} ${t("home_col_sorties")}`}
          cells={[
            totals.h1.day + totals.h2.day,
            totals.h1.night + totals.h2.night,
            totals.h1.nvg + totals.h2.nvg,
            totals.h1.sim + totals.h2.sim,
            totals.yearHours,
          ]}
          emphasis
          rowDir={rowDir}
        />
      </View>

      {/* ── Career totals (career = opening balance + every logged sortie) ──── */}
      <View style={[styles.table, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.tableTitle, { color: colors.foreground, textAlign: align }]}>
          {t("home_career_title")}
        </Text>
        <Text style={[styles.tableHint, { color: colors.mutedForeground, textAlign: align }]}>
          {`${t("home_career_hint")} · ${totals.totalSorties} ${t("home_col_sorties")}`}
        </Text>

        <View style={[styles.tblHead, { borderColor: colors.border, flexDirection: rowDir }]}>
          <Text style={[styles.tblCellLabel, { color: colors.mutedForeground }]}>{""}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_day")}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_night")}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_nvg")}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_sim")}</Text>
          <Text style={[styles.tblCell, styles.tblCellHead, { color: colors.mutedForeground }]}>{t("home_col_pic")}</Text>
        </View>

        <BreakdownRow
          label={t("home_total_hours")}
          sub=""
          cells={[totals.totalDay, totals.totalNight, totals.totalNvg, totals.totalSim, totals.totalCaptain]}
          emphasis
          rowDir={rowDir}
        />
        <View style={[styles.tblGrandRow, { borderColor: colors.border, flexDirection: rowDir }]}>
          <Text style={[styles.tblCellLabel, { color: colors.foreground }]}>
            {`${t("home_total_hours")}  (D+N)`}
          </Text>
          <Text style={[styles.tblGrandValue, { color: colors.primary }]}>
            {formatHours(totals.grandTotal)}
          </Text>
        </View>
        <View style={[styles.tblGrandRow, { borderColor: colors.border, flexDirection: rowDir }]}>
          <Text style={[styles.tblCellLabel, { color: colors.foreground }]}>
            {t("home_second_pilot")}
          </Text>
          <Text style={[styles.tblGrandValue, { color: colors.foreground }]}>
            {formatHours(totals.totalSecondPilot)}
          </Text>
        </View>
      </View>

      {/* ── Sync card ─────────────────────────── */}
      <View
        style={[
          styles.syncRow,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            flexDirection: rowDir,
          },
        ]}
      >
        <View style={[styles.syncLeft, { flexDirection: rowDir }]}>
          <View
            style={[
              styles.syncIconWrap,
              { backgroundColor: (remoteEnabled ? colors.success : colors.mutedForeground) + "1f" },
            ]}
          >
            <Feather
              name={remoteEnabled ? "cloud" : "cloud-off"}
              size={16}
              color={remoteEnabled ? colors.success : colors.mutedForeground}
            />
          </View>
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

function HeroChip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const colors = useColors();
  return (
    <View style={styles.chip}>
      <Text style={[styles.chipLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.chipValue, { color: accent ?? colors.foreground }]}>{value}</Text>
    </View>
  );
}

function BreakdownRow({
  label,
  sub,
  cells,
  emphasis,
  rowDir,
}: {
  label: string;
  sub: string;
  cells: number[];
  emphasis?: boolean;
  rowDir: "row" | "row-reverse";
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.tblRow,
        {
          borderColor: colors.border,
          flexDirection: rowDir,
          backgroundColor: emphasis ? colors.primary + "14" : "transparent",
        },
      ]}
    >
      <View style={styles.tblLabelCell}>
        <Text style={[styles.tblLabel, { color: colors.foreground, fontWeight: emphasis ? "700" : "600" }]}>
          {label}
        </Text>
        {sub ? (
          <Text style={[styles.tblSub, { color: colors.mutedForeground }]}>{sub}</Text>
        ) : null}
      </View>
      {cells.map((v, i) => (
        <Text
          key={i}
          style={[
            styles.tblCell,
            styles.tblCellValue,
            {
              color: emphasis && i === cells.length - 1 ? colors.primary : colors.foreground,
              fontWeight: emphasis ? "700" : "500",
            },
          ]}
        >
          {formatHours(v)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 120,
    gap: 16,
  },

  // mission strip
  strip: {
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  stripDot: { width: 7, height: 7, borderRadius: 999 },
  stripStencil: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.6,
  },
  stripValue: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.4,
  },
  stripDivider: { fontSize: 12 },

  // greeting
  greeting: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  name: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
    letterSpacing: -0.4,
  },
  unit: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
    letterSpacing: 0.4,
  },

  // hero
  hero: {
    padding: 22,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    gap: 14,
  },
  heroLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.8,
  },
  heroRow: {
    alignItems: "baseline",
    gap: 8,
  },
  heroValue: {
    fontSize: 64,
    fontFamily: "Inter_700Bold",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
    lineHeight: 68,
  },
  heroUnit: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    letterSpacing: 2,
  },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  heroChips: {
    justifyContent: "space-between",
    gap: 12,
  },
  chip: { flex: 1, gap: 4 },
  chipLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.4,
  },
  chipValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  tickTL: { position: "absolute", top: 8, left: 8, width: 12, height: 12, borderTopWidth: 1, borderLeftWidth: 1, opacity: 0.7 },
  tickTR: { position: "absolute", top: 8, right: 8, width: 12, height: 12, borderTopWidth: 1, borderRightWidth: 1, opacity: 0.7 },
  tickBL: { position: "absolute", bottom: 8, left: 8, width: 12, height: 12, borderBottomWidth: 1, borderLeftWidth: 1, opacity: 0.7 },
  tickBR: { position: "absolute", bottom: 8, right: 8, width: 12, height: 12, borderBottomWidth: 1, borderRightWidth: 1, opacity: 0.7 },

  // currency strip
  currencyStrip: {
    gap: 6,
    alignItems: "stretch",
  },

  // grids
  row: { flexDirection: "row", gap: 12 },
  gap: { marginTop: 0 },

  // breakdown table
  table: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 4,
  },
  tableTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  tableHint: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  tblHead: {
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tblRow: {
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
  },
  tblLabelCell: {
    flex: 1.6,
    paddingHorizontal: 4,
  },
  tblLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  tblSub: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 2,
  },
  tblCell: {
    flex: 1,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  tblCellHead: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  tblCellValue: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  tblCellLabel: {
    flex: 1.6,
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    paddingHorizontal: 4,
  },
  tblGrandRow: {
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tblGrandValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    paddingHorizontal: 4,
  },

  // sync
  syncRow: {
    marginTop: 4,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  syncIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  syncLeft: { alignItems: "center", gap: 10, flex: 1 },
  syncLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  syncValue: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  refreshText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
