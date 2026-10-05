/**
 * NIDO internal icon system v1 — <NidoIcon> component.
 *
 * Renders one frozen icon (see iconRegistry.ts) as 1–2 tinted PNG layers:
 * the ink (primary-structure) layer always, plus the gold accent layer for
 * the 13 two-tone icons. Colors come from the theme's `icon.ink` /
 * `icon.gold` tokens so Daylight and Night Garden stay exact and automatic.
 *
 * Accessibility contract:
 * - Meaningful icon (inside or next to an interactive control, or carrying
 *   state): pass `accessibilityLabel` (an i18n string, never hardcoded).
 *   The icon becomes an accessible image with role "image".
 * - Decorative icon: omit the label. It is hidden from assistive tech and
 *   the interactive parent keeps its own label (existing pattern).
 *
 * Do NOT restyle, rescale non-uniformly, or recolor outside the theme
 * tokens — the frozen designs must be reproduced, not reinterpreted.
 */
import React from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import {
  iconGoldSource,
  iconInkSource,
  type IconName,
} from "./iconRegistry";

export type { IconName };
export { isIconName } from "./iconRegistry";

export type NidoIconProps = {
  /** Frozen icon name (40 total). */
  name: IconName;
  /** Render size in dp; the asset keeps its 1:1 aspect ratio. Default 24. */
  size?: number;
  /** Ink override. Default: theme.icon.ink. */
  color?: string;
  /** Gold-layer override (two-tone icons only). Default: theme.icon.gold. */
  goldColor?: string;
  /** Extra container styling (e.g. margins). Do not set width/height here. */
  style?: StyleProp<ViewStyle>;
  /** i18n label for meaningful icons; omit for decorative ones. */
  accessibilityLabel?: string;
  testID?: string;
};

export function NidoIcon({
  name,
  size = 24,
  color,
  goldColor,
  style,
  accessibilityLabel,
  testID,
}: NidoIconProps): React.JSX.Element {
  const { colors } = useTheme();
  const ink = color ?? colors.nidoIcon.ink;
  const goldSource = iconGoldSource(name);
  const gold = goldSource ? (goldColor ?? colors.nidoIcon.gold) : undefined;
  const meaningful = accessibilityLabel !== undefined;
  const dims = { width: size, height: size };

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible={meaningful}
      accessibilityRole={meaningful ? "image" : undefined}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {goldSource ? (
        <Image
          source={goldSource}
          style={[dims, { position: "absolute", left: 0, top: 0 }]}
          tintColor={gold}
          resizeMode="contain"
        />
      ) : null}
      <Image
        source={iconInkSource(name)}
        style={dims}
        tintColor={ink}
        resizeMode="contain"
      />
    </View>
  );
}
