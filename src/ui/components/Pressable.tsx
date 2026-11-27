/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.118 (prueba del dueño en la Tab A9+): «cuando tocas una opción no
 * se ve el click y no sabes cuál estás aplastando». El Pressable de React
 * Native no da ninguna respuesta visual por sí solo, y ninguna de las
 * ~230 pulsaciones de la app la añadía.
 *
 * Este Pressable es el de React Native con respuesta al toque por defecto:
 * - onda (ripple) de Android dentro del botón, recortada a su forma;
 * - y el botón se atenúa mientras el dedo está encima.
 *
 * Quien ya pinta su propio estado pulsado (style como función) o su propia
 * onda (android_ripple) se respeta tal cual. Un botón desactivado no
 * responde. Mismas props y misma ref que el original.
 */
import React, { forwardRef } from "react";
import {
  Pressable as RNPressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";

/** Opacidad mientras se pulsa: se nota con claridad sin esconder el texto. */
export const PRESSED_OPACITY = 0.6;
/** Onda neutra: se ve sobre fondos claros y oscuros. */
export const RIPPLE_COLOR = "rgba(127,127,127,0.28)";

export function pressedStyle(
  style: PressableProps["style"],
  state: PressableStateCallbackType,
  disabled: boolean,
): StyleProp<ViewStyle> {
  if (typeof style === "function") return style(state);
  if (!state.pressed || disabled) return style as StyleProp<ViewStyle>;
  return [style as StyleProp<ViewStyle>, { opacity: PRESSED_OPACITY }];
}

/** La onda que se pasa a Android: la propia si la hay; ninguna si está desactivado. */
export function rippleFor(
  ripple: PressableProps["android_ripple"],
  disabled: boolean,
): PressableProps["android_ripple"] {
  if (ripple !== undefined) return ripple;
  return disabled ? undefined : { color: RIPPLE_COLOR, foreground: true };
}

export const Pressable = forwardRef<View, PressableProps>(function NidoPressable(props, ref) {
  const { style, android_ripple, disabled, ...rest } = props;
  const isDisabled = disabled === true;
  return (
    <RNPressable
      ref={ref}
      disabled={disabled}
      android_ripple={rippleFor(android_ripple, isDisabled)}
      style={(state) => pressedStyle(style, state, isDisabled)}
      {...rest}
    />
  );
});
