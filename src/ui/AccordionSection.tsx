/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager } from "react-native";
import { impact } from "../services/haptics";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { spacing, radii } from "./theme/spacing";
import { NidoIcon, isIconName, type IconName } from "./components/icons/NidoIcon";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  /**
   * Frozen icon name (preferred) or a legacy glyph. The only legacy glyphs
   * still in use are the explicitly kept ones (🎭 tone, ⚡ telemetry);
   * everything else must be an IconName.
   */
  icon: IconName | string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Collapsible section for the Settings screen — styled with field terminal elevation */
export function AccordionSection({ icon, title, defaultOpen = false, children }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => {
    impact();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        style={styles.header}
        onPress={toggle}
      >
        <View style={styles.iconBox}>
          {isIconName(icon) ? (
            <NidoIcon name={icon} size={20} />
          ) : (
            <Text style={styles.headerIcon}>{icon}</Text>
          )}
        </View>
        <Text style={styles.headerTitle}>{title}</Text>
        <NidoIcon name={open ? "chev-up" : "chev-down"} size={14} color={colors.text.dim} />
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: 16,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.emerald.bgSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIcon: { fontSize: 16 },
  headerTitle: {
    ...typography.ui.body,
    color: colors.text.primary,
    fontWeight: "600",
    flex: 1,
  },
  chevron: { color: colors.text.dim, fontSize: 10 },
  body: {
    paddingBottom: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
});
