/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.56 — bottom tab bar: Chat · Emergency · Library · NIDO · Settings.
 * Every main section is one tap away (before, most lived behind the drawer).
 * The Emergency icon is always red: it has to be findable in a hurry.
 */
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeContext";
import type { Colors } from "../theme/colors";
import type { Typography } from "../theme/typography";
import { NidoIcon } from "../components/icons/NidoIcon";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { MAIN_TABS, TAB_ICON, TAB_LABEL_KEY, type MainTab } from "./tabs";

export function BottomTabBar({ active, onSelect }: { active: MainTab; onSelect: (tab: MainTab) => void }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();

  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {MAIN_TABS.map((tab) => {
        const selected = tab === active;
        const emergency = tab === "emergency";
        const ink = emergency ? colors.crimson[500] : selected ? colors.emerald[600] : colors.text.secondary;
        return (
          <Pressable
            key={tab}
            testID={`tab-${tab}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t(TAB_LABEL_KEY[tab])}
            onPress={() => {
              if (selected) return;
              impact(ImpactFeedbackStyle.Light);
              onSelect(tab);
            }}
            style={styles.item}
          >
            <View style={[styles.pill, selected && (emergency ? styles.pillEmergency : styles.pillSelected)]}>
              <NidoIcon name={TAB_ICON[tab]} size={20} color={ink} />
            </View>
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {t(TAB_LABEL_KEY[tab])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border.default,
      backgroundColor: colors.bg.surface,
      paddingTop: 6,
      paddingBottom: 6,
    },
    item: {
      flex: 1,
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
    },
    pill: {
      width: 52,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    pillSelected: { backgroundColor: colors.emerald.bgSubtle },
    pillEmergency: { backgroundColor: colors.crimson.bgSubtle },
    label: {
      ...typography.ui.micro,
      fontWeight: "500",
      color: colors.text.secondary,
    },
    labelSelected: {
      fontWeight: "700",
      color: colors.text.primary,
    },
  });
