/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { formatRouterMs, isRouterOutcome, percentOf, summarizeRouterSamples, type RouterSample } from "./routerStats.pure";

const s = (classifyMs: number, outcome: RouterSample["outcome"]): RouterSample => ({ ts: 0, classifyMs, outcome });

describe("summarizeRouterSamples", () => {
  it("sin muestras: todo vacío", () => {
    expect(summarizeRouterSamples([])).toEqual({
      count: 0, p50Ms: null, p95Ms: null, maxMs: null,
      outcomes: { router: 0, model: 0, notUnderstood: 0, chat: 0 },
    });
  });

  it("mediana, p95 y máximo por rango más cercano; cuenta desenlaces", () => {
    const samples = Array.from({ length: 20 }, (_, i) => s(i + 1, i < 10 ? "router" : i < 15 ? "chat" : i < 19 ? "model" : "notUnderstood"));
    const r = summarizeRouterSamples(samples);
    expect(r.count).toBe(20);
    expect(r.p50Ms).toBe(10);
    expect(r.p95Ms).toBe(19);
    expect(r.maxMs).toBe(20);
    expect(r.outcomes).toEqual({ router: 10, chat: 5, model: 4, notUnderstood: 1 });
  });

  it("descarta tiempos imposibles (negativos, NaN, infinitos)", () => {
    const r = summarizeRouterSamples([s(-1, "router"), s(Number.NaN, "chat"), s(Infinity, "chat"), s(2, "model")]);
    expect(r.count).toBe(1);
    expect(r.outcomes.model).toBe(1);
    expect(r.outcomes.chat).toBe(0);
  });

  it("el orden de entrada no importa", () => {
    expect(summarizeRouterSamples([s(5, "chat"), s(1, "chat"), s(3, "chat")]).p50Ms).toBe(3);
  });
});

describe("formato sin Intl", () => {
  it("ms con coma decimal en es/pt y punto en en", () => {
    expect(formatRouterMs(0.042, true)).toBe("0,042 ms");
    expect(formatRouterMs(1.234, false)).toBe("1.23 ms");
    expect(formatRouterMs(12.6, true)).toBe("13 ms");
    expect(formatRouterMs(null, true)).toBe("—");
  });

  it("porcentajes enteros", () => {
    expect(percentOf(1, 3)).toBe("33%");
    expect(percentOf(0, 0)).toBe("—");
  });

  it("solo los cuatro desenlaces conocidos", () => {
    expect(isRouterOutcome("router")).toBe(true);
    expect(isRouterOutcome("texto del usuario")).toBe(false);
  });
});
