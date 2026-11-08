/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import * as RamMonitor from "ram-monitor";

/**
 * Presión del aparato (optimización 2026-11-08, fase 3 del paquete):
 * cuando la batería está baja, el modo de ahorro está activo o el
 * aparato va caliente, la carga del modelo trabaja con topes más
 * bajos — menos hilos y un búfer de cómputo menor — para no exprimir
 * un aparato que ya va justo. Sin sonda (build nativo anterior, el
 * sistema no reporta, la lectura falla) no hay topes: la conducta de
 * siempre, cero cambio a ciegas.
 *
 * La política es pura y se testea sin nativo; la lectura vive aquí
 * con una caché corta: la carga consulta la foto cacheada y el chat
 * la refresca al montar y al volver la app a primer plano.
 */

export interface DevicePressureInput {
  /** Nivel de batería 0-100; null o -1 = sin lectura. */
  batteryLevelPct: number | null;
  /** Cargando o lleno: la presión de batería no aplica. */
  charging: boolean;
  /** Modo de ahorro de batería activo. */
  powerSave: boolean;
  /** Escala térmica de PowerManager 0-6; null o -1 = sin lectura. */
  thermalStatus: number | null;
}

export interface DevicePressureCaps {
  /** Tope de hilos de inferencia; null = sin tope. */
  threadCap: number | null;
  /** Tope de n_ubatch; null = sin tope. */
  ubatchCap: number | null;
}

const NO_CAPS: DevicePressureCaps = { threadCap: null, ubatchCap: null };

/** Nivel térmico SEVERE en la escala de PowerManager (0-6). */
export const THERMAL_SEVERE = 5;

/**
 * Política pura: batería <20 % sin cargar o modo de ahorro → 3 hilos
 * y n_ubatch ≤128; calor severo (≥5) → 2 hilos y n_ubatch ≤128. Las
 * dos presiones a la vez no se suman: manda la más estricta.
 */
export function pressureCaps(input: DevicePressureInput): DevicePressureCaps {
  let caps: DevicePressureCaps = NO_CAPS;
  const lowBattery =
    !input.charging &&
    input.batteryLevelPct !== null &&
    input.batteryLevelPct >= 0 &&
    input.batteryLevelPct < 20;
  if (lowBattery || input.powerSave) {
    caps = { threadCap: 3, ubatchCap: 128 };
  }
  if (input.thermalStatus !== null && input.thermalStatus >= THERMAL_SEVERE) {
    caps = {
      threadCap: Math.min(caps.threadCap ?? Number.POSITIVE_INFINITY, 2),
      ubatchCap: Math.min(caps.ubatchCap ?? Number.POSITIVE_INFINITY, 128),
    };
  }
  return caps;
}

let cached: DevicePressureCaps = NO_CAPS;

/**
 * Refresca la foto de presión desde el módulo nativo. Nunca lanza:
 * una lectura fallida conserva la foto anterior (al arrancar, la de
 * «sin topes»).
 */
export function refreshDevicePressure(): void {
  try {
    const battery = RamMonitor.getBatteryStatus?.() ?? null;
    const thermal = RamMonitor.getThermalStatus?.() ?? null;
    cached = pressureCaps({
      batteryLevelPct: battery ? battery.levelPct : null,
      charging: battery?.charging ?? false,
      powerSave: battery?.powerSave ?? false,
      thermalStatus: thermal,
    });
  } catch {
    /* sin sonda: se conserva la foto anterior */
  }
}

/** Foto cacheada de los topes por presión (sin topes hasta refrescar). */
export function currentDevicePressure(): DevicePressureCaps {
  return cached;
}
