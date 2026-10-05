import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager } from "react-native";
import { impact } from "../services/haptics";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { typography } from "./theme/typography";
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
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => {
    impact();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={toggle}>
        {isIconName(icon) ? (
          <NidoIcon name={icon} size={20} />
        ) : (
          <Text style={styles.headerIcon}>{icon}</Text>
        )}
        <Text style={styles.headerTitle}>{title.toUpperCase()}</Text>
        <NidoIcon name={open ? "chev-up" : "chev-down"} size={12} color={colors.text.dim} />
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const getStyles = (colors: Colors) => StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.cardElevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: colors.bg.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  headerIcon: { fontSize: 16 },
  headerTitle: {
    ...typography.mono.xs,
    fontSize: 11,
    color: colors.text.heading,
    fontWeight: "800",
    letterSpacing: 0.5,
    flex: 1,
  },
  chevron: { color: colors.text.dim, fontSize: 10 },
  body: {
    paddingVertical: spacing.xs,
  },
});
