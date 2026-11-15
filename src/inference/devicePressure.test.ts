/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockBattery: { levelPct: number; charging: boolean; powerSave: boolean } | null = null;
let mockThermal: number | null = null;
let mockShouldThrow = false;
vi.mock("ram-monitor", () => ({
  getBatteryStatus: () => {
    if (mockShouldThrow) throw new Error("no native module");
    return mockBattery;
  },
  getThermalStatus: () => {
    if (mockShouldThrow) throw new Error("no native module");
    return mockThermal;
  },
}));

import {
  pressureCaps,
  refreshDevicePressure,
  currentDevicePressure,
} from "./devicePressure";

const CALM = { batteryLevelPct: 80, charging: false, powerSave: false, thermalStatus: 0 };

describe("pressureCaps (optimización 2026-11-08, fase 3)", () => {
  it("sin presión no hay topes", () => {
    expect(pressureCaps(CALM)).toEqual({ threadCap: null, ubatchCap: null });
  });

  it("batería por debajo del 20 % sin cargar → 3 hilos y n_ubatch ≤128", () => {
    expect(pressureCaps({ ...CALM, batteryLevelPct: 19 })).toEqual({ threadCap: 3, ubatchCap: 128 });
    expect(pressureCaps({ ...CALM, batteryLevelPct: 20 })).toEqual({ threadCap: null, ubatchCap: null });
  });

  it("cargando, la batería baja no presiona", () => {
    expect(pressureCaps({ ...CALM, batteryLevelPct: 5, charging: true })).toEqual({ threadCap: null, ubatchCap: null });
  });

  it("el modo de ahorro presiona aunque la batería vaya alta", () => {
    expect(pressureCaps({ ...CALM, powerSave: true })).toEqual({ threadCap: 3, ubatchCap: 128 });
  });

  it("calor severo (≥3 en la escala oficial de PowerManager) → 2 hilos; por debajo, nada", () => {
    // La escala oficial: 3 = SEVERE, 4 = CRITICAL, 5 = EMERGENCY,
    // 6 = SHUTDOWN. Hasta la 0.1.98 el umbral estaba en 5 (EMERGENCY)
    // y el severo y el crítico reales quedaban sin topes (F3-03).
    expect(pressureCaps({ ...CALM, thermalStatus: 3 })).toEqual({ threadCap: 2, ubatchCap: 128 });
    expect(pressureCaps({ ...CALM, thermalStatus: 4 })).toEqual({ threadCap: 2, ubatchCap: 128 });
    expect(pressureCaps({ ...CALM, thermalStatus: 5 })).toEqual({ threadCap: 2, ubatchCap: 128 });
    expect(pressureCaps({ ...CALM, thermalStatus: 6 })).toEqual({ threadCap: 2, ubatchCap: 128 });
    expect(pressureCaps({ ...CALM, thermalStatus: 2 })).toEqual({ threadCap: null, ubatchCap: null });
  });

  it("las dos presiones a la vez: manda la más estricta, no se suman", () => {
    expect(pressureCaps({ ...CALM, powerSave: true, thermalStatus: 6 })).toEqual({ threadCap: 2, ubatchCap: 128 });
  });

  it("sin lecturas (null o -1) no hay topes", () => {
    expect(pressureCaps({ batteryLevelPct: null, charging: false, powerSave: false, thermalStatus: null }))
      .toEqual({ threadCap: null, ubatchCap: null });
    expect(pressureCaps({ batteryLevelPct: -1, charging: false, powerSave: false, thermalStatus: -1 }))
      .toEqual({ threadCap: null, ubatchCap: null });
  });
});

describe("refreshDevicePressure + currentDevicePressure", () => {
  beforeEach(() => {
    mockBattery = null;
    mockThermal = null;
    mockShouldThrow = false;
    refreshDevicePressure();
  });

  it("la foto cacheada sigue a la sonda", () => {
    expect(currentDevicePressure()).toEqual({ threadCap: null, ubatchCap: null });
    mockBattery = { levelPct: 10, charging: false, powerSave: false };
    refreshDevicePressure();
    expect(currentDevicePressure()).toEqual({ threadCap: 3, ubatchCap: 128 });
  });

  it("una lectura que lanza conserva la foto anterior y no propaga", () => {
    mockBattery = { levelPct: 10, charging: false, powerSave: false };
    refreshDevicePressure();
    mockShouldThrow = true;
    expect(() => refreshDevicePressure()).not.toThrow();
    expect(currentDevicePressure()).toEqual({ threadCap: 3, ubatchCap: 128 });
  });
});
