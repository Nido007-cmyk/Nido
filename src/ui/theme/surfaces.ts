/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * surfaces.ts — piezas de estilo compartidas por las pantallas (rediseño
 * 2026-10-10). Una sola definición de página, barra superior, tarjeta,
 * etiqueta de sección, fila y botones, para que todas las pantallas se vean
 * igual que el chat: fondo de página cálido, tarjetas claras de esquinas
 * redondeadas, botones en píldora y un solo color de acento.
 *
 * Cada pantalla sigue teniendo su StyleSheet; aquí solo vive lo común.
 */
import type { TextStyle, ViewStyle } from "react-native";
import type { Colors } from "./colors";
import type { Typography } from "./typography";

/** Alto mínimo de cualquier control táctil (guía de accesibilidad de Android). */
export const MIN_TOUCH = 48;

export interface Surfaces {
  page: ViewStyle;
  topBar: ViewStyle;
  topBarTitle: TextStyle;
  topBarAction: ViewStyle;
  topBarActionText: TextStyle;
  sectionLabel: TextStyle;
  card: ViewStyle;
  inset: ViewStyle;
  body: TextStyle;
  caption: TextStyle;
  primaryButton: ViewStyle;
  primaryButtonText: TextStyle;
  secondaryButton: ViewStyle;
  secondaryButtonText: TextStyle;
  dangerButton: ViewStyle;
  dangerButtonText: TextStyle;
  note: ViewStyle;
  noteText: TextStyle;
  warning: ViewStyle;
  warningText: TextStyle;
  input: ViewStyle & TextStyle;
}

export function makeSurfaces(colors: Colors, typography: Typography): Surfaces {
  const button: ViewStyle = {
    minHeight: MIN_TOUCH,
    borderRadius: 9999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  };
  const buttonText: TextStyle = {
    ...typography.ui.body,
    fontWeight: "600",
  };
  return {
    page: { flex: 1, backgroundColor: colors.bg.black },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
      backgroundColor: colors.bg.black,
    },
    topBarTitle: {
      ...typography.ui.title,
      color: colors.text.heading,
      fontWeight: "700",
      flexShrink: 1,
    },
    topBarAction: {
      minHeight: 40,
      paddingHorizontal: 16,
      borderRadius: 9999,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.emerald.bgSubtle,
    },
    topBarActionText: {
      ...typography.ui.caption,
      color: colors.emerald[600],
      fontWeight: "700",
    },
    sectionLabel: {
      ...typography.ui.micro,
      color: colors.text.dim,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },
    card: {
      backgroundColor: colors.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border.default,
      padding: 16,
      gap: 8,
    },
    inset: {
      backgroundColor: colors.bg.cardElevated,
      borderRadius: 12,
      padding: 12,
    },
    body: {
      ...typography.ui.body,
      color: colors.text.secondary,
    },
    caption: {
      ...typography.ui.caption,
      color: colors.text.secondary,
    },
    primaryButton: {
      ...button,
      backgroundColor: colors.emerald[500],
      borderColor: colors.emerald[500],
    },
    primaryButtonText: { ...buttonText, color: colors.text.inverse },
    secondaryButton: {
      ...button,
      backgroundColor: colors.bg.card,
      borderColor: colors.border.elevated,
    },
    secondaryButtonText: { ...buttonText, color: colors.text.primary },
    dangerButton: {
      ...button,
      backgroundColor: "transparent",
      borderColor: colors.crimson[500],
    },
    dangerButtonText: { ...buttonText, color: colors.crimson[500] },
    note: {
      backgroundColor: colors.emerald.bgSubtle,
      borderRadius: 14,
      padding: 12,
    },
    noteText: {
      ...typography.ui.caption,
      color: colors.emerald[600],
    },
    warning: {
      backgroundColor: colors.amber.bgSubtle,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.amber.border,
      padding: 12,
    },
    warningText: {
      ...typography.ui.caption,
      color: colors.amber[600],
    },
    input: {
      ...typography.ui.body,
      minHeight: MIN_TOUCH,
      backgroundColor: colors.bg.input,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border.default,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: colors.text.primary,
    },
  };
}
