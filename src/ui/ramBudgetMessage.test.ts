/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 2026-11-06 (prueba física): el rechazo por memoria salía en inglés
// técnico en una app en español. Ahora sale en el idioma de la app.
import { describe, expect, it, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 0,
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import es from "../i18n/locales/es.json";
import { RamBudgetError } from "../inference/ramBudget";
import { loadErrorText, ramBudgetReason } from "./ramBudgetMessage";

const GB = 1024 * 1024 * 1024;

/** Un t() mínimo sobre es.json, con interpolación {{x}}. */
const t = ((key: string, vars: Record<string, unknown> = {}) => {
  let node: unknown = es;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  return String(node ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k]));
}) as never;

describe("mensaje de memoria insuficiente", () => {
  it("en español, con las cifras y el consejo; sin inglés técnico", () => {
    const e = new RamBudgetError("needs roughly 1.0GB of RAM", 1.0 * GB, 0.9 * GB, 3.3 * GB, 3072, 2048, 0.8);
    const text = ramBudgetReason(t, e, "es")!;
    expect(text).toContain("1,0 GB");
    expect(text).toContain("0,9 GB");
    expect(text).toContain("3,3 GB");
    expect(text).toContain("80 %");
    expect(text).toContain("Qwen2.5-0.5B");
    expect(text).not.toMatch(/needs roughly|RAM, but/);
  });

  it("sin cierre previo no habla de él", () => {
    const e = new RamBudgetError("x", GB, 0.5 * GB, 3 * GB, null, null, null);
    expect(ramBudgetReason(t, e)).not.toContain("cierre");
  });

  it("otros errores pasan tal cual", () => {
    expect(ramBudgetReason(t, new Error("otro"))).toBeNull();
    expect(loadErrorText(t, new Error("otro"))).toBe("otro");
  });
});
