/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.117 (UI nueva): el rojo de emergencia sobre el que va texto blanco
 * (botón SOS del chat y cabecera de la pestaña Emergencia).
 *
 * Daylight usa crimson.500 (#B42318, 6.57:1 con blanco) y Night usa
 * crimson.600 (#D93D2E, 4.51:1): crimson.500 de Night (#E5574A) con blanco
 * da 3.62:1 y no llega a AA para texto normal. uiNueva0117.contrast.test.ts
 * lo comprueba.
 */
import type { Colors } from "./colors";

export const ON_EMERGENCY_RED = "#FFFFFF";

export function emergencyRed(colors: Colors): string {
  return colors.id === "nightgarden" ? colors.crimson[600] : colors.crimson[500];
}

/** Texto carmesí sobre una superficie (número grande de la tarjeta de llamada). */
export function emergencyRedText(colors: Colors): string {
  return colors.id === "nightgarden" ? colors.crimson[400] : colors.crimson[600];
}
