/**
 * MemoryChip — shows what NIDO remembered
 *
 * Calm Agent UI (2026-10-05). Transparency of memory.
 * Appears above agent messages when personalization was used.
 * "I remember you prefer..." — visible proof that memory works.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { calmSpacing, calmRadii, calmType } from "../../theme/calm";

export interface MemoryChipProps {
  text: string;
}

export function MemoryChip({ text }: MemoryChipProps) {
  const { colors } = useTheme();

  const styles = StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: colors.bg.subtle,
      borderRadius: calmRadii.pill,
      paddingHorizontal: calmSpacing.cozy,
      paddingVertical: calmSpacing.tight,
      marginBottom: calmSpacing.tight,
      marginLeft: calmSpacing.comfortable,
    },
    icon: {
      ...calmType.tiny,
      color: colors.text.secondary,
      marginRight: calmSpacing.tight,
    },
    text: {
      ...calmType.caption,
      color: colors.text.secondary,
      fontStyle: "italic",
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>◉</Text>
      <Text style={styles.text} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}
