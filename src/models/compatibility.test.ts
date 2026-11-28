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

import {
  APP_BASELINE_BYTES,
  canonicalSnapshot,
  computeCompatibility,
  computeCompatibilityDetail,
  getLastMomentRedBadge,
  residentReleasableBytes,
  type Compatibility,
} from "./compatibility";
import { contextCeilingForDevice, contextSpecForModel } from "./defaultModel";
import { MODEL_CATALOG } from "./manifest";
import { checkRamBudget, estimateContextBytes, KV_Q8_BYTES_PER_ELEMENT } from "../inference/ramBudget";
import { planContext, planModelLoad } from "../inference/memoryLadder";

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

// 0.1.108 (pasada de la 0.1.107): la fórmula no se toca; la superficie
// sí. La carga real, con un modelo residente, suma a su foto el
// crédito `releasableBytes` — la huella estimada completa del modelo
// que va a salir (LlamaEngine.loadNow) — y la foto de la tarjeta no
// lo traía: la insignia juzgaba al modelo ACTIVO cargándose encima de
// sí mismo y le pintaba «Currently in use» y «Needs a lot of memory»
// a la vez. El crédito de la tarjeta se calcula con la misma cuenta.
describe("0.1.108: el crédito liberable del residente en la tarjeta", () => {
  it("el crédito es la cuenta de la carga: el Qwen3 residente en su techo de la Tab libera sus 693,8 MiB", () => {
    const m = byId("qwen3-0.6b-q4km");
    // Residente cargado en su techo (2048 en la Tab) con KV fp16: el
    // crédito es byte a byte el coste que el censo fija para su carga.
    expect(residentReleasableBytes(m, 2048, false, TAB_RAM)).toBe(727_484_096);
    // Cargado degradado (menos contexto) libera menos; con KV q8, menos aún.
    expect(residentReleasableBytes(m, 1024, false, TAB_RAM)).toBeLessThan(727_484_096);
    expect(residentReleasableBytes(m, 2048, true, TAB_RAM)).toBeLessThan(727_484_096);
  });

  it("la foto de las fotos: sin crédito el activo sale amarillo; con su crédito, verde", () => {
    const m = byId("qwen3-0.6b-q4km");
    // La banda de la pasada: disponible por total ≈ 500 MiB (RSS de
    // 868 MiB con la app en uso y el modelo residente dentro), término
    // en vivo holgado para que mande la cuenta por total.
    const live = {
      totalRamBytes: TAB_RAM,
      rssBytes: 868 * MiB,
      availBytes: 2 * GB,
      lowMemThresholdBytes: 216 * MiB,
    };
    expect(computeCompatibility(m, TAB_RAM, live)).toBe("yellow");
    const credited = { ...live, releasableBytes: residentReleasableBytes(m, 2048, false, TAB_RAM) };
    expect(computeCompatibility(m, TAB_RAM, credited)).toBe("green");
  });

  it("el crédito no maquilla: la roja del 1.5B en la Tab se queda (la canónica es el suelo)", () => {
    const m = byId("qwen2.5-1.5b-instruct-q4km");
    const live = {
      totalRamBytes: TAB_RAM,
      rssBytes: 868 * MiB,
      availBytes: 2 * GB,
      lowMemThresholdBytes: 216 * MiB,
    };
    const credited = { ...live, releasableBytes: residentReleasableBytes(m, 4096, false, TAB_RAM) };
    expect(computeCompatibility(m, TAB_RAM, credited)).toBe("red");
  });
});

// Tanda too-heavy (pasada del dueño sobre la 0.1.115, Tab A9+): la
// insignia pintaba «Too heavy for this device» en TODOS los modelos,
// incluido el activo corriendo a 15,6 tok/s. El diagnóstico
// (DIAGNOSTICO-TOO-HEAVY.md) cobró la causa: la foto canónica da
// verde a los tres pequeños en la Tab; el rojo lo impone la foto viva
// de un momento ocupado (RSS ≥ ~936 MiB deja el disponible por total
// bajo el plan más barato del catálogo), y el crédito liberable que
// la carga real aplica al sustituir al residente solo llegaba a la
// tarjeta del propio residente. La cura, en el cálculo: el detalle
// dice de qué foto viene un rojo (aparato o momento), el suelo de la
// activa sin crédito probado es su canónica, y el registro guarda la
// foto del último rojo de momento. La fórmula de memoria no cambia:
// ni la reserva de 2 GiB ni ningún umbral se toca.
describe("tanda too-heavy: el rojo dice su foto y el crédito es el de la carga", () => {
  // La foto ocupada del diagnóstico: la app y el e5 residentes, el
  // dueño viniendo de generar. Sin crédito, ni el peldaño de
  // emergencia del modelo más barato cabe por la cuenta por total.
  const busy = { totalRamBytes: TAB_RAM, rssBytes: 950 * MiB, availBytes: 450 * MiB, lowMemThresholdBytes: 300 * MiB };
  // La foto de la pasada de la 0.1.108: manda la cuenta por total.
  const pasada = { totalRamBytes: TAB_RAM, rssBytes: 868 * MiB, availBytes: 2 * GB, lowMemThresholdBytes: 216 * MiB };
  const creditOfResident = () => residentReleasableBytes(byId("qwen3-0.6b-q4km"), 2048, false, TAB_RAM);

  it("sin crédito, la foto ocupada pinta rojo DE MOMENTO a los pequeños (su canónica es verde)", () => {
    for (const id of ["qwen2.5-0.5b-instruct-q4km", "qwen2.5-0.5b-instruct-q5km", "qwen3-0.6b-q4km"]) {
      const d = computeCompatibilityDetail(byId(id), TAB_RAM, busy);
      expect(d.color, id).toBe("red");
      expect(d.redSource, id).toBe("moment");
      // El color de la firma histórica no cambia: solo nace su fuente.
      expect(computeCompatibility(byId(id), TAB_RAM, busy), id).toBe("red");
    }
  });

  it("el rojo de aparato se dice de aparato: el 7B en la Tab, con foto viva y sin ella", () => {
    const m = byId("qwen2.5-7b-instruct-q4km");
    expect(computeCompatibilityDetail(m, TAB_RAM).redSource).toBe("device");
    expect(computeCompatibilityDetail(m, TAB_RAM, busy).redSource).toBe("device");
    expect(computeCompatibilityDetail(m, TAB_RAM, { ...busy, releasableBytes: creditOfResident() }).redSource).toBe(
      "device",
    );
  });

  it("con el crédito del residente en la foto, la ocupada ya no pinta rojo a los pequeños: amarillo", () => {
    const credited = { ...busy, releasableBytes: creditOfResident() };
    for (const id of ["qwen2.5-0.5b-instruct-q4km", "qwen2.5-0.5b-instruct-q5km", "qwen3-0.6b-q4km"]) {
      const d = computeCompatibilityDetail(byId(id), TAB_RAM, credited);
      expect(d.color, id).toBe("yellow");
      expect(d.redSource, id).toBeUndefined();
    }
  });

  it("con el crédito en la foto de la pasada, los pequeños vuelven a su verde canónico", () => {
    const credited = { ...pasada, releasableBytes: creditOfResident() };
    for (const id of ["qwen2.5-0.5b-instruct-q4km", "qwen2.5-0.5b-instruct-q5km", "qwen3-0.6b-q4km"]) {
      expect(computeCompatibilityDetail(byId(id), TAB_RAM, credited).color, id).toBe("green");
    }
  });

  it("el suelo de la activa: sin crédito probado manda su canónica; con crédito en la foto, la viva juzga", () => {
    const m = byId("qwen3-0.6b-q4km");
    // Sin crédito en la foto, la degradación por foto viva de la
    // activa no se aplica: su suelo es el verde canónico, en la foto
    // ocupada (sin suelo sería rojo de momento) y en la de la pasada
    // (sin suelo sería amarillo).
    expect(computeCompatibilityDetail(m, TAB_RAM, busy, { canonicalFloor: true }).color).toBe("green");
    expect(computeCompatibilityDetail(m, TAB_RAM, pasada, { canonicalFloor: true }).color).toBe("green");
    // Con el crédito dentro de la foto, la viva SÍ juzga (con el
    // crédito aplicado): la ocupada da amarillo, no el suelo.
    const credited = { ...busy, releasableBytes: creditOfResident() };
    expect(computeCompatibilityDetail(m, TAB_RAM, credited, { canonicalFloor: true }).color).toBe("yellow");
  });

  it("el registro guarda la foto del último rojo de momento, y un rojo de aparato no lo pisa", () => {
    computeCompatibilityDetail(byId("qwen3-0.6b-q4km"), TAB_RAM, busy);
    computeCompatibilityDetail(byId("qwen2.5-7b-instruct-q4km"), TAB_RAM, busy);
    expect(getLastMomentRedBadge()).toEqual({
      modelId: "qwen3-0.6b-q4km",
      rssBytes: 950 * MiB,
      availBytes: 450 * MiB,
      lowMemThresholdBytes: 300 * MiB,
      creditBytes: 0,
    });
  });
});

describe("amarillo con cifras (0.1.119)", () => {
  const TAB = 3416 * MiB;
  const q3 = LLMS.find((m) => m.id === "qwen3-0.6b-q4km")!;
  it("con poca memoria libre, el amarillo dice el contexto con el que carga y su techo", () => {
    const snap = { totalRamBytes: TAB, rssBytes: 220 * MiB, availBytes: 1100 * MiB, lowMemThresholdBytes: 216 * MiB };
    const d = computeCompatibilityDetail(q3, TAB, snap);
    expect(d.color).toBe("yellow");
    expect(d.yellow?.source).toBe("moment");
    // 0.1.123 (auditoría E-1): la carga real, con este hueco, cae en el
    // peldaño de emergencia en fp16 y por eso prueba la KV q8, que sí
    // cabe a 2048: carga 2048 comprimido. La insignia anterior decía
    // «1024» (su propia copia del plan) y mentía; ahora dice lo de la carga.
    expect(d.yellow!.ceiling).toBe(2048);
    expect(d.yellow!.nCtx).toBe(2048);
    expect(d.yellow!.kvCompressed).toBe(true);
  });

  it("0.1.123 (E-1): la insignia y la carga comparten EL plan (planModelLoad), con el mismo factor del CrashGuard", () => {
    const snaps = [
      { totalRamBytes: TAB, rssBytes: 220 * MiB, availBytes: 1100 * MiB, lowMemThresholdBytes: 216 * MiB },
      { totalRamBytes: TAB, rssBytes: 220 * MiB, availBytes: 2400 * MiB, lowMemThresholdBytes: 216 * MiB },
      { totalRamBytes: 6 * GB, rssBytes: 400 * MiB, availBytes: 1500 * MiB, lowMemThresholdBytes: 300 * MiB },
      { totalRamBytes: 8 * GB, rssBytes: 400 * MiB, availBytes: 900 * MiB, lowMemThresholdBytes: 300 * MiB },
    ];
    for (const m of LLMS) {
      for (const snap of snaps) {
        for (const crashSafety of [1, 0.8, 0.65, 0.5]) {
          const d = computeCompatibilityDetail(m, snap.totalRamBytes, snap, { crashSafety });
          // Lo que haría la carga: el plan compartido sobre la foto más severa.
          const ceiling = contextCeilingForDevice(m.defaultNCtx, snap.totalRamBytes);
          const { nCtx: _n, ...specBase } = contextSpecForModel(m, snap.totalRamBytes);
          const live = planModelLoad(specBase, snap, { ceiling, safety: crashSafety });
          if (!live) continue;
          if (!live.plan.verdict.fits) {
            expect(d.color, `${m.id} @${snap.totalRamBytes} s=${crashSafety}`).toBe("red");
          } else if (d.color === "yellow" && d.yellow?.source === "moment") {
            expect(d.yellow.nCtx).toBe(live.plan.nCtx);
            expect(d.yellow.kvCompressed).toBe(live.pinnedProfile === "kv-q8");
          }
        }
      }
    }
  });

  it("0.1.123 (E-1): tras choques (factor del CrashGuard < 1) la insignia anuncia menos contexto, como la carga", () => {
    const snap = { totalRamBytes: 8 * GB, rssBytes: 400 * MiB, availBytes: 6000 * MiB, lowMemThresholdBytes: 300 * MiB };
    const big = LLMS.slice().sort((a, b) => b.sizeBytes - a.sizeBytes);
    let sawDrop = false;
    for (const m of big) {
      const clean = computeCompatibilityDetail(m, 8 * GB, snap, { crashSafety: 1 });
      const after = computeCompatibilityDetail(m, 8 * GB, snap, { crashSafety: 0.5 });
      const ctx = (d: typeof clean) => (d.color === "green" ? Infinity : d.color === "yellow" ? d.yellow!.nCtx : d.color === "red" ? 0 : NaN);
      expect(ctx(after)).toBeLessThanOrEqual(ctx(clean));
      if (ctx(after) < ctx(clean)) sawDrop = true;
    }
    expect(sawDrop).toBe(true);
    // Un factor inválido se trata como 1 (aparato sin choques).
    const m = big[big.length - 1];
    expect(computeCompatibilityDetail(m, 8 * GB, snap, { crashSafety: 7 })).toEqual(computeCompatibilityDetail(m, 8 * GB, snap));
  });
  it("verde y rojo no llevan cifras de amarillo", () => {
    const d = computeCompatibilityDetail(q3, TAB);
    expect(d.color).toBe("green");
    expect(d.yellow).toBeUndefined();
  });
});

