/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 2026-11-06 (prueba física, tableta de 3,3 GB): «Funciona bien en este
// dispositivo» salía en un modelo que el pre-flight rechazaba al cargar.
// La etiqueta verde ahora promete solo lo que el pre-flight acepta.
//
// 0.1.86: la etiqueta ES el veredicto de la vía de carga (planContext
// sobre la foto canónica del aparato, con el spec real de la carga). La
// tabla de abajo es el censo del 2026-11-09 convertido en regresión
// permanente: cada par modelo×aparato lleva el color que la vía real da.
// Los tres pares que el censo marcó PESIMISTAS con la fórmula vieja
// (Qwen3-0.6B en la Tab; LFM2.5 y Gemma 4 en 8 GiB) cambian de color a
// propósito, y el par del 1.5B en la Tab sube de amarilla a roja: con la
// foto canónica (sin término en vivo) ni su peldaño de emergencia con
// KV q8 (1000,4 MiB) cabe en los 1001 MiB disponibles por total.
import { describe, expect, it, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 0,
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import { APP_BASELINE_BYTES, canonicalSnapshot, computeCompatibility, type Compatibility } from "./compatibility";
import { contextCeilingForDevice, contextSpecForModel } from "./defaultModel";
import { MODEL_CATALOG } from "./manifest";
import { checkRamBudget, estimateContextBytes, KV_Q8_BYTES_PER_ELEMENT } from "../inference/ramBudget";
import { planContext } from "../inference/memoryLadder";

const GB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;
const LLMS = MODEL_CATALOG.filter((m) => m.kind === "llm");
const byId = (id: string) => {
  const m = LLMS.find((x) => x.id === id);
  if (!m) throw new Error(`no ${id} in the catalog`);
  return m;
};

/** La Tab A9+ del dueño: su RAM total real, la de las fotos del defecto. */
const TAB_RAM = 3416 * MiB;
const BIG_RAM = 8 * GB;

/** El censo del 2026-11-09 con la definición nueva: [en la Tab, en 8 GiB]. */
const CENSUS: Record<string, [Compatibility, Compatibility]> = {
  "phi-3.5-mini-instruct-q4km": ["red", "green"],
  "qwen2.5-1.5b-instruct-q4km": ["red", "green"],
  "qwen2.5-0.5b-instruct-q4km": ["green", "green"],
  "qwen2.5-0.5b-instruct-q5km": ["green", "green"],
  "qwen3-0.6b-q4km": ["green", "green"],
  "qwen2.5-7b-instruct-q4km": ["red", "green"],
  "lfm2.5-8b-a1b-q4km": ["red", "green"],
  "gemma-4-e4b-it-q4_0": ["red", "green"],
};

describe("etiqueta de compatibilidad", () => {
  it("la tabla del censo, entera, como regresión: Tab A9+ (3416 MiB) y 8 GiB", () => {
    expect(Object.keys(CENSUS).sort()).toEqual(LLMS.map((m) => m.id).sort());
    for (const m of LLMS) {
      const [tab, big] = CENSUS[m.id];
      expect(computeCompatibility(m, TAB_RAM), `${m.id} en la Tab`).toBe(tab);
      expect(computeCompatibility(m, BIG_RAM), `${m.id} en 8 GiB`).toBe(big);
    }
  });

  it("el cambio asentado del censo: el Qwen3-0.6B sale verde en la tableta del dueño", () => {
    // Con la fórmula vieja era amarilla (estimado 906,9 MiB a contexto
    // 3072 sin techo ni lote). Con el spec real (techo 2048, lote 128)
    // cuesta 693,8 MiB y la escalera lo admite en su techo sobre la foto
    // canónica: verde, como la vía de carga.
    expect(computeCompatibility(byId("qwen3-0.6b-q4km"), 3.3 * GB)).toBe("green");
    expect(computeCompatibility(byId("qwen3-0.6b-q4km"), TAB_RAM)).toBe("green");
  });

  it("invariante reforzado: verde ⇒ planContext cabe EN EL TECHO sobre la foto canónica (fp16, safety 1)", () => {
    for (const ram of [2, 3, 3.3, 3416 * MiB / GB, 4, 6, 8, 12, 16]) {
      const ramBytes = ram * GB;
      for (const m of LLMS) {
        if (computeCompatibility(m, ramBytes) !== "green") continue;
        const ceiling = contextCeilingForDevice(m.defaultNCtx, ramBytes);
        const { nCtx: _c, ...specBase } = contextSpecForModel(m, ramBytes);
        const plan = planContext(specBase, canonicalSnapshot(ramBytes), { ceiling, safety: 1 });
        expect(plan?.verdict.fits, `${m.id} con ${ram} GB: el plan debe caber`).toBe(true);
        expect(plan?.nCtx, `${m.id} con ${ram} GB: y en su techo`).toBe(ceiling);
        // Y la forma histórica del invariante, con el spec real:
        const verdict = checkRamBudget(contextSpecForModel(m, ramBytes), {
          totalRamBytes: ramBytes,
          rssBytes: APP_BASELINE_BYTES,
        });
        expect(verdict?.fits, `${m.id} con ${ram} GB: el pre-flight lo acepta`).toBe(true);
      }
    }
  });

  it("invariante: roja ⇒ no cabe en ningún peldaño, ni en emergencia con KV q8 y su presupuesto", () => {
    for (const ram of [2, 3, 3.3, 3416 * MiB / GB, 4, 6, 8]) {
      const ramBytes = ram * GB;
      for (const m of LLMS) {
        if (computeCompatibility(m, ramBytes) !== "red") continue;
        const ceiling = contextCeilingForDevice(m.defaultNCtx, ramBytes);
        const { nCtx: _c, ...specBase } = contextSpecForModel(m, ramBytes);
        const snap = canonicalSnapshot(ramBytes);
        expect(planContext(specBase, snap, { ceiling, safety: 1 })?.verdict.fits, `${m.id} con ${ram} GB fp16`).toBe(false);
        expect(
          planContext({ ...specBase, kvBytesPerElement: KV_Q8_BYTES_PER_ELEMENT }, snap, { ceiling, safety: 1 })?.verdict
            .fits,
          `${m.id} con ${ram} GB q8`,
        ).toBe(false);
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

  it("con foto en vivo la insignia es la PEOR de las dos fotos (F3-14): verde en vacío, roja con el teléfono ocupado", () => {
    const m = byId("qwen3-0.6b-q4km");
    expect(computeCompatibility(m, TAB_RAM)).toBe("green");
    // La misma tableta con el proceso hinchado y casi nada libre: ni
    // el peldaño de emergencia con su cuenta amable admite el modelo
    // (la vía misma rendiría el 90 % de 100 MiB). La insignia lo dice
    // en vez de prometer el verde de la foto canónica.
    const busy = { totalRamBytes: TAB_RAM, rssBytes: 1.2 * GB, availBytes: 100 * MiB, lowMemThresholdBytes: 216 * MiB };
    expect(computeCompatibility(m, TAB_RAM, busy)).toBe("red");
    // Con hueco real, la foto viva no degrada nada.
    const roomy = { totalRamBytes: TAB_RAM, rssBytes: APP_BASELINE_BYTES, availBytes: 2 * GB, lowMemThresholdBytes: 216 * MiB };
    expect(computeCompatibility(m, TAB_RAM, roomy)).toBe("green");
    // Una foto de OTRO aparato (o sin término en vivo) no es foto de
    // este momento: se ignora y manda la canónica.
    const foreign = { totalRamBytes: BIG_RAM, rssBytes: 3 * GB, availBytes: 10 * MiB, lowMemThresholdBytes: 216 * MiB };
    expect(computeCompatibility(m, TAB_RAM, foreign)).toBe("green");
    const noLive = { totalRamBytes: TAB_RAM, rssBytes: 3 * GB };
    expect(computeCompatibility(m, TAB_RAM, noLive)).toBe("green");
  });

  it("el estimado que la etiqueta cobra es el de la carga: Qwen3 en la Tab, 693,8 MiB a su techo", () => {
    const spec = contextSpecForModel(byId("qwen3-0.6b-q4km"), TAB_RAM);
    expect(spec.nCtx).toBe(2048);
    expect(spec.nUbatch).toBe(128);
    expect(estimateContextBytes(spec).totalBytes).toBe(727_484_096);
  });
});
