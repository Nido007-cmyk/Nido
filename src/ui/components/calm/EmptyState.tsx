/**
 * EmptyState — Calm Agent designed empty state.
 *
 * Spec §17: Every important surface needs a designed empty state.
 * Not just "No data". Explain what will appear and the next step.
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { useTheme } from "../../theme";
import type { Colors } from "../../theme/colors";
import { typography } from "../../theme/typography";
import { spacing, radii } from "../../theme/spacing";

interface Props {
  /** Main heading, e.g. "Nothing here yet" */
  title: string;
  /** Explanation of what will appear here */
  description: string;
  /** Optional next step action */
  actionLabel?: string;
  onAction?: () => void;
  /** Show mascot (default true for warmth) */
  showMascot?: boolean;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  showMascot = true,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      {showMascot && (
        <Image
          source={require("../../../assets/mascot-nido.png")}
          style={styles.mascot}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      )}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const getStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
      paddingVertical: spacing.xl * 1.5,
    },
    mascot: {
      width: 96,
      height: 96,
      marginBottom: spacing.md,
      opacity: 0.95,
    },
    title: {
      ...typography.ui.body,
      fontWeight: "600",
      color: colors.text.primary,
      textAlign: "center",
      marginBottom: spacing.sm,
    },
    description: {
      ...typography.ui.subtext,
      color: colors.text.secondary,
      textAlign: "center",
      marginBottom: spacing.lg,
    },
    actionButton: {
      backgroundColor: colors.bg.subtle,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
    },
    actionText: {
      ...typography.ui.body,
      color: colors.text.primary,
      fontWeight: "500",
    },
  });
