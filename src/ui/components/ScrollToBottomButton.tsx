/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ScrollToBottomButton — 0.1.108 (pedido del dueño, 2026-11-16):
 * «algo para irte en los chats hasta el final sin tener que hacer
 * scroll». Botón flotante que la pantalla de chat pinta sobre la
 * lista, abajo a la derecha, SOLO cuando el usuario está desplazado
 * hacia arriba lejos del final (la cuenta vive en
 * src/ui/ChatScreen.pure.ts, la misma que decide el auto-seguimiento).
 * Un toque y la pantalla baja al último mensaje. Cuando no toca, no
 * pinta nada: ni ocupa sitio ni compite con la conversación.
 */
import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { Pressable } from "./Pressable";
import { useTheme } from "../theme";
import { NidoIcon } from "./icons/NidoIcon";
import { spacing, radii } from "../theme/spacing";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";

interface Props {
  /** ¿Toca enseñar el botón? (el usuario está lejos del final). */
  visible: boolean;
  /** Un toque: la pantalla baja al último mensaje. */
  onPress: () => void;
  /** Etiqueta accesible, ya traducida por la pantalla (es/en/pt). */
  accessibilityLabel: string;
}

export function ScrollToBottomButton({ visible, onPress, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        btn: {
          position: "absolute",
          right: spacing.md,
          bottom: spacing.md,
          width: 44,
          height: 44,
          borderRadius: radii.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.bg.cardElevated,
          borderWidth: 1,
          borderColor: colors.border.default,
        },
      }),
    [colors],
  );

  if (!visible) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.btn}
      onPress={() => {
        impact(ImpactFeedbackStyle.Light);
        onPress();
      }}
    >
      <NidoIcon name="chev-down" size={20} color={colors.text.primary} />
    </Pressable>
  );
}
