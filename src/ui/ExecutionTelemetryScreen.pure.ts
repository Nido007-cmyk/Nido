/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import type { ExecutionTelemetryRecord } from "../services/executionTelemetry";
import type { Colors } from "./theme/colors";

/**
 * Color de la etiqueta de resultado (texto mono de 9 px) de la
 * pantalla de telemetría. Vive en un módulo puro — el patrón .pure
 * de la casa — para que su fixture corra sin React Native.
 *
 * H-A11-1 (la regla de S-03 se extiende a esta pantalla, juicio de
 * FV-1 sobre el hallazgo de ADV11): la rama «cancelled» usaba
 * text.accentAmber en los dos temas; en Daylight ese ámbar mide
 * 3,12 sobre cardElevated, por debajo de AA para texto menudo.
 * La cura es el modismo exacto de S-03: en Daylight, amber.600
 * (4,92 sobre la misma superficie); accentAmber queda para iconos
 * y titulares, y en Night se conserva. Medida y fixture:
 * ExecutionTelemetryScreen.outcomeColor.test.ts.
 */
export function outcomeColor(colors: Colors, outcome: ExecutionTelemetryRecord["outcome"]): string {
  if (outcome === "failure") return colors.crimson[400];
  if (outcome === "cancelled") return colors.id === "daylight" ? colors.amber[600] : colors.text.accentAmber;
  return colors.text.accentEmerald;
}
