/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { fromNativeTimings, writeRate } from "./nativeTimings";

const RAW = {
  cache_n: 120,
  prompt_n: 380,
  prompt_ms: 4000,
  prompt_per_token_ms: 10.5,
  prompt_per_second: 95,
  predicted_n: 64,
  predicted_ms: 4100,
  predicted_per_token_ms: 64,
  predicted_per_second: 15.6,
};

describe("tiempos nativos del motor (0.1.121)", () => {
  it("lee lectura, escritura y caché", () => {
    expect(fromNativeTimings(RAW)).toEqual({ promptN: 380, promptPerSec: 95, cacheN: 120, predictedN: 64, predictedPerSec: 15.6 });
  });
  it("sin tiempos o con un campo roto no inventa nada", () => {
    expect(fromNativeTimings(undefined)).toBeNull();
    expect(fromNativeTimings({ ...RAW, predicted_per_second: Number.NaN })).toBeNull();
    expect(fromNativeTimings({ ...RAW, prompt_n: -1 })).toBeNull();
  });
  it("sin cache_n cuenta cero reutilizados", () => {
    const { cache_n: _c, ...noCache } = RAW;
    expect(fromNativeTimings(noCache)?.cacheN).toBe(0);
  });
  it("la tasa guardada es la del motor si escribió dos tokens o más; si no, la de la app", () => {
    const t = fromNativeTimings(RAW);
    expect(writeRate(t, 14)).toBe(15.6);
    expect(writeRate(fromNativeTimings({ ...RAW, predicted_n: 1 }), 14)).toBe(14);
    expect(writeRate(null, null)).toBeNull();
  });
});
