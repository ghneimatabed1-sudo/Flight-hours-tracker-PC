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
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: emphasis ? colors.primary : colors.card,
          borderColor: emphasis ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: emphasis ? colors.primaryForeground : colors.mutedForeground,
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
            color: emphasis ? colors.primaryForeground : colors.foreground,
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
              color: emphasis ? colors.primaryForeground : colors.mutedForeground,
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
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  value: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
