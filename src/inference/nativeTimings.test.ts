/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { fromNativeTimings, generatedTokens, sealedWriteRate } from "./nativeTimings";

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
  it("0.1.123 (E-2): la tasa guardada es la vara sellada, (tokens − 1) / tiempo de generación", () => {
    // 64 tokens en 4,2 s desde el primero: 63 / 4,2 = 15 tok/s.
    expect(sealedWriteRate(64, 4200)).toBeCloseTo(15, 6);
    // Con 2 tokens hay UN tramo: 1 / t, no 2 / t (lo que daba la del motor).
    expect(sealedWriteRate(2, 500)).toBeCloseTo(2, 6);
    expect(sealedWriteRate(1, 500)).toBeNull();
    expect(sealedWriteRate(10, 0)).toBeNull();
    expect(sealedWriteRate(Number.NaN, 100)).toBeNull();
  });
  it("0.1.123 (E-2): la CUENTA de tokens es la del motor cuando la da; si no, la de la app", () => {
    expect(generatedTokens(fromNativeTimings(RAW), 50)).toBe(64);
    expect(generatedTokens(fromNativeTimings({ ...RAW, predicted_n: 0 }), 50)).toBe(50);
    expect(generatedTokens(null, 50)).toBe(50);
  });
});
