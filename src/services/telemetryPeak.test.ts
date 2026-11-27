/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
// 0.1.118: «Pico de la sesión» usa el pico que guarda el kernel (VmHWM)
// cuando el build lo trae, no solo lo que pillaba el muestreo.
import { describe, expect, it, vi } from "vitest";

const mem = { rssBytes: 200, totalPssBytes: 180, peakRssBytes: 900 as number | undefined };
vi.mock("ram-monitor", () => ({ getMemoryInfo: () => ({ ...mem }) }));

describe("pico de RSS de la sesión", () => {
  it("toma el pico del kernel aunque el RSS de ahora sea menor", async () => {
    const { getAppPeakRssBytes } = await import("./telemetry");
    expect(getAppPeakRssBytes()).toBe(900);
    mem.peakRssBytes = 500; // nunca baja: es un máximo
    expect(getAppPeakRssBytes()).toBe(900);
  });

  it("sin VmHWM (build anterior) se queda con lo muestreado", async () => {
    vi.resetModules();
    mem.peakRssBytes = undefined;
    const { getAppPeakRssBytes, startAppMemoryTracking } = await import("./telemetry");
    vi.useFakeTimers();
    startAppMemoryTracking(1000);
    expect(getAppPeakRssBytes()).toBe(200);
    vi.useRealTimers();
  });
});
