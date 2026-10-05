/**
 * NidoMascot — la mascota oficial de NIDO con roles consistentes.
 *
 * La mascota es identidad de producto, no decoración: cada aparición tiene
 * un rol definido. Esto evita el uso arbitrario ("pegar la mascota en todas
 * las pantallas") y mantiene el tono adulto, calmado y profesional de NIDO.
 *
 * Roles:
 * - brand:      marca pequeña en headers (identidad, no mensaje).
 * - welcome:    bienvenida / onboarding / primer contacto.
 * - guide:      orientación en empty states (qué aparecerá, siguiente paso).
 * - waiting:    espera / procesando (momentos de pausa del agente).
 * - success:    confirmación sutil de un logro (sin celebración infantil).
 * - recovery:   problema / recuperación / "reintentar" (tono honesto, calmado).
 * - connection: momentos NIDO↔NIDO (pairing, negociación, pack sharing).
 *
 * Asset oficial: assets/mascot-nido.png (aprobado por el dueño 2026-10-04).
 * Sin emoji, sin placeholders. Decorativa para accesibilidad: el texto
 * adyacente siempre lleva el mensaje.
 */

import React from "react";
import { Image } from "react-native";

export type MascotRole =
  | "brand"
  | "welcome"
  | "guide"
  | "waiting"
  | "success"
  | "recovery"
  | "connection";

/** Tamaño por defecto de cada rol (se puede override con `size`). */
const ROLE_SIZE: Record<MascotRole, number> = {
  brand: 28,
  welcome: 120,
  guide: 96,
  waiting: 72,
  success: 120,
  recovery: 56,
  connection: 96,
};

interface Props {
  role?: MascotRole;
  /** Override del tamaño por defecto del rol. */
  size?: number;
}

export function NidoMascot({ role = "guide", size }: Props) {
  const s = size ?? ROLE_SIZE[role];
  return (
    <Image
      source={require("../../../../assets/mascot-nido.png")}
      style={{ width: s, height: s, borderRadius: Math.round(s * 0.18) }}
      resizeMode="contain"
      accessible={false}
      accessibilityIgnoresInvertColors
    />
  );
}
