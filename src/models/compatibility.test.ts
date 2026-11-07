/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 2026-11-06 (prueba física, tableta de 3,3 GB): «Funciona bien en este
// dispositivo» salía en un modelo que el pre-flight rechazaba al cargar.
// La etiqueta verde ahora promete solo lo que el pre-flight acepta.
import { describe, expect, it, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 0,
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import { APP_BASELINE_BYTES, computeCompatibility } from "./compatibility";
import { contextSpecForModel } from "./defaultModel";
import { MODEL_CATALOG } from "./manifest";
import { checkRamBudget } from "../inference/ramBudget";

const GB = 1024 * 1024 * 1024;
const LLMS = MODEL_CATALOG.filter((m) => m.kind === "llm");
const byId = (id: string) => {
  const m = LLMS.find((x) => x.id === id);
  if (!m) throw new Error(`no ${id} in the catalog`);
  return m;
};

describe("etiqueta de compatibilidad", () => {
  it("la tableta de la prueba (3,3 GB): Qwen3-0.6B ya no sale en verde", () => {
    expect(computeCompatibility(byId("qwen3-0.6b-q4km"), 3.3 * GB)).not.toBe("green");
  });

  it("invariante: si sale en verde, el pre-flight lo acepta con lo que ocupa la app", () => {
    for (const ram of [2, 3, 3.3, 4, 6, 8, 12, 16]) {
      for (const m of LLMS) {
        if (computeCompatibility(m, ram * GB) !== "green") continue;
        const verdict = checkRamBudget(contextSpecForModel(m), { totalRamBytes: ram * GB, rssBytes: APP_BASELINE_BYTES });
        expect(verdict?.fits, `${m.id} con ${ram} GB`).toBe(true);
      }
    }
  });

  it("los modelos grandes no salen en verde en aparatos pequeños, y sí en uno de 16 GB", () => {
    expect(computeCompatibility(byId("qwen2.5-7b-instruct-q4km"), 4 * GB)).toBe("red");
    expect(computeCompatibility(byId("qwen2.5-0.5b-instruct-q4km"), 16 * GB)).toBe("green");
  });

  it("sin lectura de RAM: «unknown»", () => {
    expect(computeCompatibility(byId("qwen2.5-0.5b-instruct-q4km"), 0)).toBe("unknown");
  });
});
