import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  isRTL?: boolean;
}

export function Stat({ label, value, hint, emphasis, isRTL }: StatProps) {
  const colors = useColors();
  const textColor = emphasis ? colors.primary : colors.foreground;
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: emphasis ? colors.primary + "55" : colors.border,
        },
      ]}
    >
      {/* Tactical corner ticks */}
      <View
        style={[
          styles.tickTL,
          { borderColor: emphasis ? colors.primary : colors.border },
        ]}
      />
      <View
        style={[
          styles.tickBR,
          { borderColor: emphasis ? colors.primary : colors.border },
        ]}
      />

      <Text
        style={[
          styles.label,
          {
            color: colors.mutedForeground,
            textAlign: isRTL ? "right" : "left",
          },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.value,
          {
            color: textColor,
            textAlign: isRTL ? "right" : "left",
          },
        ]}
      >
        {value}
      </Text>
      {hint ? (
        <Text
          style={[
            styles.hint,
            {
              color: colors.mutedForeground,
              textAlign: isRTL ? "right" : "left",
            },
          ]}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 140,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    overflow: "hidden",
    position: "relative",
  },
  tickTL: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 10,
    height: 10,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    opacity: 0.55,
  },
  tickBR: {
    position: "absolute",
    bottom: 6,
    right: 6,
    width: 10,
    height: 10,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    opacity: 0.55,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  value: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    letterSpacing: 0.2,
  },
});
