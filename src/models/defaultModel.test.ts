/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockTotalRam = 0;
let mockShouldThrow = false;
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => {
    if (mockShouldThrow) throw new Error("no native module");
    return mockTotalRam;
  },
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import { MODEL_CATALOG, pinnedSourceUrl } from "./manifest";
import {
  defaultLlmForRam,
  defaultLlmForDevice,
  contextCeilingForDevice,
  contextSpecForModel,
  contextSpecForFilename,
  PREFERRED_LLM_ID,
  LIGHT_LLM_ID,
} from "./defaultModel";
import { estimateContextBytes, SYSTEM_HEADROOM_BYTES } from "../inference/ramBudget";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

beforeEach(() => {
  mockTotalRam = 0;
  mockShouldThrow = false;
});

describe("contextCeilingForDevice (optimización 2026-11-08, plan n.º 7)", () => {
  it("en ≤4 GiB el techo declarado 3072 (el del Qwen3) nace en 2048", () => {
    expect(contextCeilingForDevice(3072, 3.54 * GiB)).toBe(2048);
    expect(contextCeilingForDevice(3072, 4 * GiB)).toBe(2048);
  });

  it("fuera de la clase o con otro techo declarado, manda lo declarado", () => {
    expect(contextCeilingForDevice(3072, 6 * GiB)).toBe(3072);
    expect(contextCeilingForDevice(4096, 3.54 * GiB)).toBe(4096);
    expect(contextCeilingForDevice(2048, 3.54 * GiB)).toBe(2048);
  });

  it("a ciegas manda lo declarado, y sin declarado el 4096 de siempre", () => {
    expect(contextCeilingForDevice(3072, null)).toBe(3072);
    expect(contextCeilingForDevice(3072, 0)).toBe(3072);
    expect(contextCeilingForDevice(undefined, 3.54 * GiB)).toBe(4096);
  });
});

describe("0.5B catalog entry", () => {
  it("exists with verified bytes, pinning and license", () => {
    const m = MODEL_CATALOG.find((e) => e.id === LIGHT_LLM_ID)!;
    expect(m).toBeDefined();
    expect(m.kind).toBe("llm");
    expect(m.sizeBytes).toBe(397808192);
    expect(m.sha256).toBe("6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653");
    expect(m.revision).toBe("41ba88dbac95fed2528c92514c131d73eb5a174b");
    expect(m.license).toBe("Apache-2.0");
    expect(m.required).toBe(false);
    expect(m.filename).toBe("models/qwen2.5-0.5b-instruct-q4km.gguf");
    // Pinned source contract: the mutable /resolve/main/ pointer is replaced.
    expect(pinnedSourceUrl(m)).toContain(`/resolve/${m.revision}/`);
    expect(pinnedSourceUrl(m)).not.toContain("/resolve/main/");
  });

  it("declares its RAM profile and default context", () => {
    const m = MODEL_CATALOG.find((e) => e.id === LIGHT_LLM_ID)!;
    expect(m.arch).toEqual({ nLayer: 24, nKvHeads: 2, headDim: 64 });
    // T-contexto-2026-10-06: 4096 (antes 2048) — el system prompt del
    // agent-loop (~2k tokens) desbordaba n_ctx=2048 ("Context is full").
    expect(m.defaultNCtx).toBe(4096);
    expect(m.capabilities?.usesChatTemplate).toBe(true);
    expect(m.capabilities?.roles).toContain("fast");
  });

  it("1.5B keeps its declared arch (same numbers the pre-flight assumed)", () => {
    const m = MODEL_CATALOG.find((e) => e.id === PREFERRED_LLM_ID)!;
    expect(m.arch).toEqual({ nLayer: 28, nKvHeads: 2, headDim: 128 });
    expect(m.required).toBe(true);
  });
});

describe("contextSpecForModel", () => {
  it("uses the 0.5B arch + defaultNCtx", () => {
    const m = MODEL_CATALOG.find((e) => e.id === LIGHT_LLM_ID)!;
    const spec = contextSpecForModel(m);
    expect(spec).toMatchObject({
      fileSizeBytes: 397808192,
      nCtx: 4096,
      nLayer: 24,
      nKvHeads: 2,
      headDim: 64,
    });
    // Defecto 2026-11-08: los logits se cobran por fila de salida
    // (~0,6 MiB), no por lote completo. Working set: 379.4 MiB weights
    // + ~48 MiB KV + 256 MiB compute + ~0,6 MiB logits.
    const est = estimateContextBytes(spec);
    expect(est.totalBytes).toBeLessThan(0.75 * GiB);
    expect(est.totalBytes).toBeGreaterThan(0.6 * GiB);
  });

  it("1.5B estimate is unchanged vs the old DEFAULT_ARCH assumption", () => {
    const m = MODEL_CATALOG.find((e) => e.id === PREFERRED_LLM_ID)!;
    const est = estimateContextBytes(contextSpecForModel(m));
    // Defecto 2026-11-08: logits por fila de salida (~0,6 MiB).
    // 940.4 + 112 + 256 + 0,6 MiB ≈ 1309 MiB
    expect(est.totalBytes).toBeGreaterThan(1295 * MiB);
    expect(est.totalBytes).toBeLessThan(1320 * MiB);
  });
});

describe("contextSpecForFilename", () => {
  it("resolves the catalog arch for a known file", () => {
    const spec = contextSpecForFilename("models/qwen2.5-0.5b-instruct-q4km.gguf", 397808192, 2048);
    expect(spec.nLayer).toBe(24);
    expect(spec.headDim).toBe(64);
  });

  it("leaves arch undefined for unknown files (pre-flight fallback)", () => {
    const spec = contextSpecForFilename("models/some-custom.gguf", 123, 4096);
    expect(spec.nLayer).toBeUndefined();
    expect(spec.fileSizeBytes).toBe(123);
  });
});

describe("defaultLlmForRam", () => {
  // Umbral exacto de la función (0.1.86): la función juzga cada aparato
  // con el spec real de ese aparato (lote por clase), así que el umbral
  // se encuentra por bisección, no por suma: a 3,5 GiB el lote es 128 y
  // el 1.5B se estima en ~1234,7 MiB, por debajo de la clase de 4 GiB.
  const bisectsToFlip = (): number => {
    let lo = 1, hi = 8 * GiB;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (defaultLlmForRam(mid).id === PREFERRED_LLM_ID) hi = mid; else lo = mid;
    }
    return hi;
  };
  const threshold = bisectsToFlip();

  it("picks the 0.5B on a 4GB-class device (Tab A9+ reports ~3.7 GiB)", () => {
    expect(defaultLlmForRam(3.7 * GiB).id).toBe(LIGHT_LLM_ID);
  });

  it("picks the 1.5B on 6GB+ devices", () => {
    expect(defaultLlmForRam(6 * GiB).id).toBe(PREFERRED_LLM_ID);
    expect(defaultLlmForRam(8 * GiB).id).toBe(PREFERRED_LLM_ID);
    expect(defaultLlmForRam(12 * GiB).id).toBe(PREFERRED_LLM_ID);
  });

  it("flips exactly at the formula threshold", () => {
    expect(defaultLlmForRam(Math.ceil(threshold)).id).toBe(PREFERRED_LLM_ID);
    expect(defaultLlmForRam(Math.ceil(threshold) - 1).id).toBe(LIGHT_LLM_ID);
  });

  it("a ciegas (total <= 0) preselecciona el LIGERO, no el grande (F3-05)", () => {
    // Hasta la 0.1.98 la ceguera conservaba el «histórico»: el modelo
    // pesado ofrecido sin una sola medición detrás. El ligero es el
    // que cabe en todas partes, y el asistente sigue ofreciendo los
    // dos; el usuario puede subir con los ojos abiertos.
    expect(defaultLlmForRam(0).id).toBe(LIGHT_LLM_ID);
    expect(defaultLlmForRam(-1).id).toBe(LIGHT_LLM_ID);
  });
});

describe("defaultLlmForDevice", () => {
  it("selects by the native total-RAM readout", () => {
    mockTotalRam = 3.7 * GiB;
    expect(defaultLlmForDevice().id).toBe(LIGHT_LLM_ID);
    mockTotalRam = 8 * GiB;
    expect(defaultLlmForDevice().id).toBe(PREFERRED_LLM_ID);
  });

  it("sin lectura nativa también manda el ligero (F3-05)", () => {
    mockShouldThrow = true;
    expect(defaultLlmForDevice().id).toBe(LIGHT_LLM_ID);
  });
});
