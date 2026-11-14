/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";

let mockTotalRam = 0;
let mockRss = 0;
let mockCores: number | null = null;
let mockAvail: { availBytes: number; thresholdBytes: number; lowMemory: boolean } | null | "throws" = null;
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockTotalRam,
  getMemoryInfo: () => ({ rssBytes: mockRss, totalPssBytes: mockRss }),
  getProcessorCount: () => mockCores,
  getAvailableMemory: () => {
    if (mockAvail === "throws") throw new Error("old native build");
    return mockAvail;
  },
}));

import {
  estimateKvCacheBytes,
  estimateContextBytes,
  checkRamBudget,
  readRamSnapshot,
  defaultThreadsForCores,
  batchForRam,
  readProcessorCount,
  toGb,
  KV_Q8_BYTES_PER_ELEMENT,
} from "./ramBudget";
import { EMERGENCY_CONTEXT, planContext } from "./memoryLadder";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

// Bundled default model profile: Qwen2.5-1.5B-Instruct Q4_K_M.
const DEFAULT_MODEL = { fileSizeBytes: 986_048_768, nCtx: 4096 };

describe("estimateKvCacheBytes", () => {
  it("computes the exact transformer KV-cache formula (K+V, fp16)", () => {
    // 2 * 28 layers * 4096 ctx * 2 kv heads * 128 headDim * 2 bytes
    expect(estimateKvCacheBytes(28, 4096, 2, 128)).toBe(117_440_512);
  });

  it("scales linearly with context length", () => {
    expect(estimateKvCacheBytes(28, 512, 2, 128)).toBe(estimateKvCacheBytes(28, 4096, 2, 128) / 8);
  });

  // Estudio de modelos (2026-10-12): el pre-flight solo es exacto con el
  // arch declarado en el catálogo. Estos son los costos KV reales a
  // 4096 que las entradas corregidas declaran hoy (la matemática vive
  // aquí porque ramBudget arrastra módulos nativos que el test de
  // catálogo no puede importar).
  it("los arch del catálogo dan los KV reales: Phi 1.5 GiB, 7B 224 MiB, Gemma 420 MiB", () => {
    expect(estimateKvCacheBytes(32, 4096, 32, 96)).toBe(1_610_612_736); // Phi-3.5 MHA
    expect(estimateKvCacheBytes(28, 4096, 4, 128)).toBe(234_881_024); // Qwen2.5-7B
    expect(estimateKvCacheBytes(42, 4096, 2, 320)).toBe(440_401_920); // Gemma 4 (cota superior)
    // Y el perfil por defecto sin arch (112 MiB) es el error que se corrigió.
    expect(estimateKvCacheBytes(28, 4096, 2, 128)).toBe(117_440_512);
  });
});

describe("estimateContextBytes", () => {
  it("sums weights + KV cache + compute buffers for the default model", () => {
    const e = estimateContextBytes(DEFAULT_MODEL);
    expect(e.weightsBytes).toBe(986_048_768);
    expect(e.kvCacheBytes).toBe(117_440_512);
    expect(e.computeBytes).toBe(256 * MiB);
    // Defecto 2026-11-08: los logits se cobran por fila de salida (1 por
    // defecto), no por lote completo: 1 × 152064 × 4B.
    expect(e.logitsBytes).toBe(1 * 152064 * 4);
    expect(e.totalBytes).toBe(e.weightsBytes + e.kvCacheBytes + e.computeBytes + e.logitsBytes);
    // ~1.28 GiB ~= 1.40x the 0.92 GiB file — documents why the old flat
    // 1.15x factor under-estimated the real working set.
    expect(e.totalBytes / 986_048_768).toBeGreaterThan(1.3);
  });

  it("degrades gracefully when the file size is unknown (0)", () => {
    const e = estimateContextBytes({ fileSizeBytes: 0, nCtx: 512 });
    expect(e.weightsBytes).toBe(0);
    expect(e.totalBytes).toBe(e.kvCacheBytes + e.computeBytes + e.logitsBytes);
    expect(e.totalBytes).toBeGreaterThan(0);
  });

  it("scales the compute allowance with nCtx (embedding-size context)", () => {
    const e = estimateContextBytes({ fileSizeBytes: 36_806_944, nCtx: 512 });
    expect(e.computeBytes).toBe(32 * MiB);
  });

  it("is deterministic", () => {
    expect(estimateContextBytes(DEFAULT_MODEL)).toEqual(estimateContextBytes(DEFAULT_MODEL));
  });
});

describe("checkRamBudget", () => {
  it("fits on a roomy device", () => {
    const v = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB });
    expect(v).not.toBeNull();
    expect(v!.fits).toBe(true);
    // 12 - 1 (rss) - 2 (headroom) = 9 GiB available
    expect(v!.availableBytes).toBe(9 * GiB);
    expect(v!.totalRamBytes).toBe(12 * GiB);
  });

  it("refuses on a tight device where the model would not fit", () => {
    // 3 GiB device, 800 MiB already resident: 3 - 0.78 - 2 = ~0.22 GiB free < ~1.28 GiB need
    const v = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 3 * GiB, rssBytes: 800 * MiB });
    expect(v).not.toBeNull();
    expect(v!.fits).toBe(false);
  });

  it("accounts for an already-high RSS (e.g. another resident context)", () => {
    const roomy = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 8 * GiB, rssBytes: 1 * GiB });
    const crowded = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 8 * GiB, rssBytes: 5 * GiB });
    expect(roomy!.fits).toBe(true);
    expect(crowded!.fits).toBe(false);
  });

  it("returns null when blind (no usable total-RAM readout) so callers skip the check", () => {
    expect(checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 0, rssBytes: 0 })).toBeNull();
    expect(checkRamBudget(DEFAULT_MODEL, { totalRamBytes: -1, rssBytes: 0 })).toBeNull();
  });

  it("blocks a 7B-class model on a busy 8 GiB device but allows it on 12 GiB", () => {
    const big = { fileSizeBytes: 4_683_074_240, nCtx: 4096 };
    // 8 GiB device with 2 GiB resident: 8 - 2 - 2 = 4 GiB free < ~4.72 GiB need
    const on8 = checkRamBudget(big, { totalRamBytes: 8 * GiB, rssBytes: 2 * GiB });
    const on12 = checkRamBudget(big, { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB });
    expect(on8!.fits).toBe(false);
    expect(on12!.fits).toBe(true);
  });

  it("a small embedding context fits almost anywhere", () => {
    // FIX 2026-10-09: los embeddings usan vocab pequeño; pasar nVocab explícito
    // para no aplicar el default de 152k (Qwen2.5).
    const emb = { fileSizeBytes: 36_806_944, nCtx: 512, nVocab: 32000 };
    const v = checkRamBudget(emb, { totalRamBytes: 4 * GiB, rssBytes: 1 * GiB });
    expect(v!.fits).toBe(true);
    expect(v!.totalBytes).toBeLessThan(200 * MiB);
  });
});

describe("checkRamBudget con la memoria libre en vivo (prueba física 2026-11-06)", () => {
  it("la tableta de 3,3 GB con otras apps abiertas: manda lo libre de verdad, no la cuenta por la RAM total", () => {
    // Por la RAM total: 3,3 − 0,4 − 2 = 0,9 GiB. En vivo: 1,0 libres − 0,2 de umbral − 0,25 de margen = 0,55.
    const v = checkRamBudget(DEFAULT_MODEL, {
      totalRamBytes: 3.3 * GiB,
      rssBytes: 0.4 * GiB,
      availBytes: 1.0 * GiB,
      lowMemThresholdBytes: 0.2 * GiB,
    })!;
    expect(v.availableBytes).toBeCloseTo(0.55 * GiB, -6);
  });

  it("si lo libre en vivo sobra, manda la cuenta de siempre (nunca da más que ella)", () => {
    const v = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB, availBytes: 10 * GiB, lowMemThresholdBytes: 0.5 * GiB })!;
    expect(v.availableBytes).toBe(9 * GiB);
  });

  it("lo que se va a liberar (el modelo que se sustituye) cuenta como libre", () => {
    const base = { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB, availBytes: 2 * GiB, lowMemThresholdBytes: 0 };
    const without = checkRamBudget(DEFAULT_MODEL, base)!.availableBytes;
    const withRelease = checkRamBudget(DEFAULT_MODEL, { ...base, releasableBytes: 1 * GiB })!.availableBytes;
    expect(withRelease - without).toBe(1 * GiB);
  });

  it("nunca negativo", () => {
    const v = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 4 * GiB, rssBytes: 0, availBytes: 0.1 * GiB, lowMemThresholdBytes: 0.3 * GiB })!;
    expect(v.availableBytes).toBe(0);
    expect(v.fits).toBe(false);
  });
});

describe("defecto 2026-11-08: ningún modelo cargaba en la tableta de 3,3 GiB", () => {
  // Cifras del manifiesto real y de la telemetría del dueño: Qwen3-0.6B
  // corrió con SUCCESS el 31/10/2026 con el proceso entero picando en
  // 743-760 MB; el estimador viejo le cobraba 1,003 GiB solo al modelo en
  // el piso (2048) por el término de logits de lote completo (0,290 GiB).
  const QWEN3 = { fileSizeBytes: 396_705_472, nLayer: 28, nKvHeads: 8, headDim: 128 };
  const QWEN25_05B = { fileSizeBytes: 397_808_192, nLayer: 24, nKvHeads: 2, headDim: 64 };
  // La tableta como la modela esta misma suite: total 3,3 GiB.
  const TABLET_CLOSED = { totalRamBytes: 3.3 * GiB, rssBytes: 0.35 * GiB, availBytes: 1.8 * GiB, lowMemThresholdBytes: 0.35 * GiB };
  const TABLET_BUSY = { totalRamBytes: 3.3 * GiB, rssBytes: 0.4 * GiB, availBytes: 1.0 * GiB, lowMemThresholdBytes: 0.2 * GiB };

  it("la estimación del Qwen3-0.6B ya no supera el pico real medido del proceso entero", () => {
    const floor = estimateContextBytes({ ...QWEN3, nCtx: 2048 });
    expect(floor.totalBytes).toBeLessThan(760 * 1024 * 1024);
    expect(floor.logitsBytes).toBe(152064 * 4);
  });

  it("con las demás apps cerradas, el Qwen3-0.6B cabe a su contexto por defecto (3072)", () => {
    const v = checkRamBudget({ ...QWEN3, nCtx: 3072 }, TABLET_CLOSED)!;
    expect(v.availableBytes).toBeCloseTo(0.95 * GiB, -6);
    expect(v.fits).toBe(true);
  });

  it("la escalera lo admite al piso con un peldaño de CrashGuard (0,8) y el 0.5B con dos (0,65)", () => {
    const planQwen3 = planContext(QWEN3, TABLET_CLOSED, { ceiling: 3072, safety: 0.8 })!;
    // 0.1.84: en esta clase (≤4 GiB) la escalera baja un peldaño más:
    // a 2048 el Qwen3 cuesta 0,714 GiB y el presupuesto frenado es
    // 0,76, así que sigue parando en 2048 — el peldaño de emergencia
    // solo manda cuando ni el suelo cabe (ver la foto apretada).
    expect(planQwen3.verdict.fits).toBe(true);
    expect(planQwen3.nCtx).toBe(2048);
    const plan05 = planContext(QWEN25_05B, TABLET_CLOSED, { ceiling: 4096, safety: 0.65 })!;
    expect(plan05.verdict.fits).toBe(true);
  });

  it("la protección del 06/11 se mantiene en su forma: el Qwen3-0.6B no entra a un contexto normal con la tableta ocupada", () => {
    // TABLET_BUSY: disponible 0,55 GiB. A 2048 (el suelo histórico)
    // cuesta 0,677 GiB: fuera por mucho. La escalera de la 0.1.84 en
    // esta clase prueba 1024 antes de rechazar: cuesta 0,524 GiB en
    // fp16 y el plan lo admite SOLO en ese peldaño de emergencia
    // (respuestas cortas), nunca a un contexto normal ocupado.
    const plan = planContext(QWEN3, TABLET_BUSY, { ceiling: 3072, safety: 1 })!;
    expect(plan.verdict.availableBytes).toBeCloseTo(0.55 * GiB, -6);
    expect(plan.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(plan.verdict.fits).toBe(true);
  });

  it("el embedding e5 ya no paga logits de vocabulario: estima su peso real, no 0,458 GiB", () => {
    const e = estimateContextBytes({ fileSizeBytes: 132_441_664, nCtx: 512 });
    expect(e.totalBytes).toBeLessThan(0.2 * GiB);
  });
});

describe("defecto 2026-11-08, segunda vuelta: calibración y crédito simétrico (0.1.84)", () => {
  // Fotos del aparato REAL del dueño (Tab A9+): el módulo nativo lee
  // totalMem ≈ 3,54 GiB (no los 3,3 modelados); los picos medidos del
  // proceso entero con el Qwen3-0.6B fueron 743–760 MB. En esta clase
  // (≤4,5 GiB) batchForRam da n_ubatch 192 y el residente típico carga
  // con el perfil kv-q8 (el primero de LLM_MEMORY_PROFILES).
  const QWEN25_05B_Q4 = { fileSizeBytes: 397_808_192, nLayer: 24, nKvHeads: 2, headDim: 64 };
  const QWEN25_05B_Q5 = { fileSizeBytes: 420_086_336, nLayer: 24, nKvHeads: 2, headDim: 64 };
  const REAL_COLD = { totalRamBytes: 3.54 * GiB, rssBytes: 0.35 * GiB, availBytes: 1.8 * GiB, lowMemThresholdBytes: 0.35 * GiB };

  it("la KV del perfil kv-q8 se cobra a 1 byte por elemento: la mitad exacta", () => {
    expect(estimateKvCacheBytes(24, 4096, 2, 64, 1)).toBe(estimateKvCacheBytes(24, 4096, 2, 64) / 2);
    const fp16 = estimateContextBytes({ ...QWEN25_05B_Q4, nCtx: 4096 });
    const q8 = estimateContextBytes({ ...QWEN25_05B_Q4, nCtx: 4096, kvBytesPerElement: 1 });
    expect(fp16.kvCacheBytes - q8.kvCacheBytes).toBe(fp16.kvCacheBytes / 2);
    expect(q8.totalBytes).toBeLessThan(fp16.totalBytes);
  });

  it("el cómputo cobra el n_ubatch declarado: a 192 son ~219 MiB a 4096, no los 256 planos", () => {
    const flat = estimateContextBytes({ ...QWEN25_05B_Q4, nCtx: 4096 });
    expect(flat.computeBytes).toBe(256 * MiB);
    const b192 = estimateContextBytes({ ...QWEN25_05B_Q4, nCtx: 4096, nUbatch: 192 });
    // 112.721.920 fijos + 192 × 152.064 × 4 = 229.507.072 B (~218,9 MiB).
    expect(b192.computeBytes).toBe(229_507_072);
    const b128 = estimateContextBytes({ ...QWEN25_05B_Q4, nCtx: 4096, nUbatch: 128 });
    expect(b128.computeBytes).toBe(190_578_688);
    // A 256 declarado, el término coincide con el plano histórico.
    expect(estimateContextBytes({ ...QWEN25_05B_Q4, nCtx: 4096, nUbatch: 256 }).computeBytes).toBe(256 * MiB);
    // Sin declarar (o basura), cero cambio de conducta.
    expect(estimateContextBytes({ ...QWEN25_05B_Q4, nCtx: 4096, nUbatch: 0 }).computeBytes).toBe(256 * MiB);
  });

  it("aparato real, carga en frío: el 0.5B Q4 cabe a su contexto por defecto (4096)", () => {
    const v = checkRamBudget({ ...QWEN25_05B_Q4, nCtx: 4096, nUbatch: 192 }, REAL_COLD)!;
    // byTotal: 3,54 − 0,35 − 2 = 1,19 GiB manda sobre el término en vivo (1,20).
    expect(v.availableBytes).toBeCloseTo(1.19 * GiB, -6);
    expect(v.fits).toBe(true);
    const plan = planContext({ ...QWEN25_05B_Q4, nUbatch: 192 }, REAL_COLD, { ceiling: 4096, safety: 1 })!;
    expect(plan.nCtx).toBe(4096);
    expect(plan.verdict.fits).toBe(true);
  });

  it("aparato real, cambio Q4→Q5 con freno 0,65: el crédito simétrico deja pasar al Q5", () => {
    // El Q4 residente (kv-q8, 4096, ubatch 192) libera ~0,608 GiB al
    // salir. La foto del cambio: RSS 0,95 GiB con el Q4 dentro, libre
    // en vivo 1,1 GiB. Sin crédito en byTotal ese término daría
    // 0,59 GiB y el disponible lo mandaría el término en vivo (0,50);
    // con el crédito en los DOS términos el byTotal sube a 1,198 GiB
    // y el disponible pasa a ser min(1,198, 1,108) = 1.189.960.256 B
    // (~1,108 GiB): con el freno 0,65 (presupuesto ~0,720 GiB) el Q5
    // entra a 4096 sin bajar un peldaño; sin crédito su presupuesto
    // sería 0,325 GiB y no cabría.
    const releasable = estimateContextBytes({ ...QWEN25_05B_Q4, nCtx: 4096, kvBytesPerElement: 1, nUbatch: 192 }).totalBytes;
    const switching = { ...REAL_COLD, rssBytes: 0.95 * GiB, availBytes: 1.1 * GiB, releasableBytes: releasable };
    const sinCredito = checkRamBudget({ ...QWEN25_05B_Q5, nCtx: 2048, nUbatch: 192 }, { ...switching, releasableBytes: 0 })!;
    expect(sinCredito.availableBytes).toBeCloseTo(0.5 * GiB, -6);
    const plan = planContext({ ...QWEN25_05B_Q5, nUbatch: 192 }, switching, { ceiling: 4096, safety: 0.65 })!;
    expect(plan.verdict.availableBytes).toBe(1_189_960_256);
    expect(plan.nCtx).toBe(4096);
    expect(plan.verdict.fits).toBe(true);
  });

  it("el crédito nunca infla el RSS por encima de lo residente (suelo en cero)", () => {
    const v = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 12 * GiB, rssBytes: 0.2 * GiB, releasableBytes: 5 * GiB })!;
    expect(v.availableBytes).toBe(10 * GiB);
  });
});

describe("batchForRam (optimización 2026-11-08, fase 2)", () => {
  it("la escalera por clase: ≤3,5 GiB → 256/128; ≤4,5 GiB → 384/192; resto → 512/256", () => {
    expect(batchForRam(3.3 * GiB)).toEqual({ nBatch: 256, nUbatch: 128 });
    expect(batchForRam(3.5 * GiB)).toEqual({ nBatch: 256, nUbatch: 128 });
    expect(batchForRam(4 * GiB)).toEqual({ nBatch: 384, nUbatch: 192 });
    expect(batchForRam(4.5 * GiB)).toEqual({ nBatch: 384, nUbatch: 192 });
    expect(batchForRam(8 * GiB)).toEqual({ nBatch: 512, nUbatch: 256 });
    expect(batchForRam(12 * GiB)).toEqual({ nBatch: 512, nUbatch: 256 });
  });

  it("a ciegas manda el lote de siempre: null, cero y basura no cambian nada", () => {
    expect(batchForRam(null)).toEqual({ nBatch: 512, nUbatch: 256 });
    expect(batchForRam(0)).toEqual({ nBatch: 512, nUbatch: 256 });
    expect(batchForRam(Number.NaN)).toEqual({ nBatch: 512, nUbatch: 256 });
  });

  it("la presión (fase 3) baja el techo de n_ubatch en cualquier clase, sin subirlo jamás", () => {
    expect(batchForRam(12 * GiB, 128)).toEqual({ nBatch: 512, nUbatch: 128 });
    expect(batchForRam(4 * GiB, 128)).toEqual({ nBatch: 384, nUbatch: 128 });
    expect(batchForRam(3.3 * GiB, 256)).toEqual({ nBatch: 256, nUbatch: 128 });
    expect(batchForRam(12 * GiB, null)).toEqual({ nBatch: 512, nUbatch: 256 });
  });
});

describe("toGb", () => {
  it("formats GiB with one decimal", () => {
    expect(toGb(1.28 * GiB)).toBe("1.3");
    expect(toGb(12 * GiB)).toBe("12.0");
  });
});

describe("readRamSnapshot", () => {
  it("returns the native readout when available", () => {
    mockTotalRam = 8 * GiB;
    mockRss = 1 * GiB;
    // 0.1.85: el mock por defecto no trae lectura en vivo (mockAvail
    // null), así que la foto nace MARCADA como tal: es así como el
    // fallo de lectura dejó de ser mudo (ver «lectura real de
    // memoria» más abajo). La forma de la foto no cambia aparte de
    // la marca.
    expect(readRamSnapshot()).toEqual({ totalRamBytes: 8 * GiB, rssBytes: 1 * GiB, liveReadMissing: true });
  });

  it("incluye la memoria libre en vivo cuando el build la lee", () => {
    mockTotalRam = 8 * GiB;
    mockRss = 1 * GiB;
    mockAvail = { availBytes: 3 * GiB, thresholdBytes: 0.25 * GiB, lowMemory: false };
    expect(readRamSnapshot()).toEqual({ totalRamBytes: 8 * GiB, rssBytes: 1 * GiB, availBytes: 3 * GiB, lowMemThresholdBytes: 0.25 * GiB, lowMemory: false });
    mockAvail = null;
  });

  it("la señal lowMemory del sistema viaja en la foto (F3-12): la vía de emergencia la consume", () => {
    mockTotalRam = 8 * GiB;
    mockRss = 1 * GiB;
    mockAvail = { availBytes: 3 * GiB, thresholdBytes: 0.25 * GiB, lowMemory: true };
    expect(readRamSnapshot()!.lowMemory).toBe(true);
    mockAvail = null;
  });

  it("RSS 0 deja de inflar en silencio: entra la estimación base marcada (F3-12)", () => {
    // getMemoryInfo puede devolver rssBytes 0 (lectura vacía): la
    // cuenta por total restaba entonces SOLO el colchón del sistema
    // y trataba el proceso como si no pesara. Ahora la foto sustituye
    // la estimación base de la casa (512 MiB, la del snapshot
    // canónico) y lo declara con la marca rssFallback.
    mockTotalRam = 8 * GiB;
    mockRss = 0;
    mockAvail = null;
    const snap = readRamSnapshot()!;
    expect(snap.rssBytes).toBe(512 * MiB);
    expect(snap.rssFallback).toBe(true);
    mockRss = 1 * GiB;
  });

  it("un build nativo sin la lectura en vivo no deja el pre-flight ciego", () => {
    mockTotalRam = 8 * GiB;
    mockRss = 1 * GiB;
    mockAvail = "throws";
    expect(readRamSnapshot()).toEqual({ totalRamBytes: 8 * GiB, rssBytes: 1 * GiB, liveReadMissing: true });
    mockAvail = null;
  });

  it("returns null when blind (fail open, never block on missing data)", () => {
    mockTotalRam = 0;
    mockRss = 0;
    expect(readRamSnapshot()).toBeNull();
  });
});

describe("defaultThreadsForCores (P-03)", () => {
  it("sin sonda manda el 4 de siempre: cero cambio de conducta", () => {
    expect(defaultThreadsForCores(null)).toBe(4);
  });

  it("una lectura rota (0, negativa, NaN) cuenta como sin sonda", () => {
    expect(defaultThreadsForCores(0)).toBe(4);
    expect(defaultThreadsForCores(-2)).toBe(4);
    expect(defaultThreadsForCores(Number.NaN)).toBe(4);
  });

  it("≤4 núcleos → 2: los hilos nativos no se disputan el aparato con la UI", () => {
    expect(defaultThreadsForCores(1)).toBe(2);
    expect(defaultThreadsForCores(2)).toBe(2);
    expect(defaultThreadsForCores(4)).toBe(2);
  });

  it("5–6 núcleos → 3: la mitad, redondeando a la baja", () => {
    expect(defaultThreadsForCores(5)).toBe(3);
    expect(defaultThreadsForCores(6)).toBe(3);
  });

  it("7–8 núcleos → 4 al nacer (la clase de la Tab A9+); subir a 5–6 es de la curva, no de esta tabla", () => {
    expect(defaultThreadsForCores(7)).toBe(4);
    expect(defaultThreadsForCores(8)).toBe(4);
  });

  it(">8 núcleos → techo 6: big.LITTLE no convierte núcleos de sobra en contención", () => {
    expect(defaultThreadsForCores(9)).toBe(6);
    expect(defaultThreadsForCores(12)).toBe(6);
    expect(defaultThreadsForCores(16)).toBe(6);
  });

  it("la sonda se lee del módulo y su ausencia llega como null", () => {
    mockCores = 8;
    expect(readProcessorCount()).toBe(8);
    mockCores = null;
    expect(readProcessorCount()).toBeNull();
  });
});

describe("defecto 2026-11-08, tercera vuelta (0.1.85): la foto exacta de las 19:54", () => {
  // La foto REAL que el instrumento de la 0.1.84 registró en la Tab A9+
  // del dueño (2026-11-08 19:54): total 3416 MiB — la RAM total REAL,
  // no los 3,54 GiB que la suite de la 0.1.84 modelaba —, la app en
  // uso 367 MiB, libre 842 MiB, límite del sistema 216 MiB, contexto
  // elegido 1024 / pedido 4096, freno del CrashGuard 0,65. Con total
  // 3416 MiB (3,336 GiB) batchForRam da el lote 256/128: el coste que
  // el instrumento vio sale exacto con n_ubatch 128.
  const PHOTO = {
    totalRamBytes: 3416 * MiB,
    rssBytes: 367 * MiB,
    availBytes: 842 * MiB,
    lowMemThresholdBytes: 216 * MiB,
  };
  const Q05_REAL = { fileSizeBytes: 397_808_192, nLayer: 24, nKvHeads: 2, headDim: 64, nUbatch: 128 };

  it("batchForRam con la RAM total REAL de la foto (3416 MiB) da el lote 256/128", () => {
    expect(batchForRam(PHOTO.totalRamBytes)).toEqual({ nBatch: 256, nUbatch: 128 });
  });

  it("el coste fp16 a 1024 es el que el instrumento registró: 458.644.032 B (437,4 MiB)", () => {
    const e = estimateContextBytes({ ...Q05_REAL, nCtx: 1024 });
    expect(e.totalBytes).toBe(458_644_032);
    const q8 = estimateContextBytes({ ...Q05_REAL, nCtx: 1024, kvBytesPerElement: KV_Q8_BYTES_PER_ELEMENT });
    expect(q8.totalBytes).toBe(452_352_576);
  });

  it("con la cuenta de siempre la foto NO cabe: disponible 370 y ni el plan q8 entra, ni sin freno", () => {
    const v = checkRamBudget({ ...Q05_REAL, nCtx: 1024 }, PHOTO)!;
    expect(v.availableBytes).toBe(370 * MiB);
    expect(v.fits).toBe(false);
    const plan = planContext(Q05_REAL, PHOTO, { ceiling: 4096, safety: 1 })!;
    // Sin la vía de emergencia este plan sería el suelo con fits=false:
    // lo fija la regresión gemela de abajo (planContext ya aplica la
    // vía; aquí manda el veredicto directo de checkRamBudget).
    expect(plan.nCtx).toBe(EMERGENCY_CONTEXT);
    const q8Direct = checkRamBudget(
      { ...Q05_REAL, nCtx: 1024, kvBytesPerElement: KV_Q8_BYTES_PER_ELEMENT },
      PHOTO,
    )!;
    expect(q8Direct.totalBytes).toBe(452_352_576);
    expect(q8Direct.fits).toBe(false); // 431,4 MiB > 370 disponibles
  });

  it("con la vía de emergencia la foto CABE a 1024 con el freno 0,65 puesto (492,6 ≥ 437,4 ya con la reserva del 10 %)", () => {
    const plan = planContext(Q05_REAL, PHOTO, { ceiling: 4096, safety: 0.65 })!;
    expect(plan.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(plan.verdict.fits).toBe(true);
    expect(plan.verdict.totalBytes).toBe(458_644_032);
    // El disponible REPORTADO sigue siendo el de la cuenta normal
    // (370): la vía cambia el presupuesto de paso, no la foto que el
    // instrumento registra. El disponible de la vía (842) se fija en
    // el caso de checkRamBudget con emergencyLive, abajo.
    expect(plan.verdict.availableBytes).toBe(370 * MiB);
  });

  it("gemela sin freno (safety 1): la foto también cabe por la vía", () => {
    const plan = planContext(Q05_REAL, PHOTO, { ceiling: 4096, safety: 1 })!;
    expect(plan.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(plan.verdict.fits).toBe(true);
  });

  it("la vía NO se filtra a los peldaños normales: un aparato con hueco sigue eligiendo el mayor que cabe con la cuenta de siempre", () => {
    // Foto holgada: el 4096 cabe por la cuenta normal (disponible 1001
    // por total) y la escalera ni mira la emergencia.
    const roomy = { totalRamBytes: 3416 * MiB, rssBytes: 367 * MiB, availBytes: 3 * GiB, lowMemThresholdBytes: 216 * MiB };
    const plan = planContext(Q05_REAL, roomy, { ceiling: 4096, safety: 1 })!;
    expect(plan.nCtx).toBe(4096);
    expect(plan.verdict.availableBytes).toBe(1001 * MiB);
  });

  it("checkRamBudget con emergencyLive deja de usar el availMem crudo: entra la reserva del 10 % (F3-02)", () => {
    // Hasta la 0.1.98 la vía cruzaba el watermark del sistema con
    // margen exactamente cero frente a una FOTO que envejece durante
    // los segundos de la carga. Ahora la vía rinde el 90 % de la
    // lectura — y la foto del dueño sigue cabiendo holgada, porque lo
    // que la salvaba era el hueco entre las dos cuentas (842 frente a
    // 370), no el último 10 %.
    const raw = checkRamBudget({ ...Q05_REAL, nCtx: 1024 }, PHOTO, { emergencyLive: true })!;
    expect(raw.availableBytes).toBe(842 * MiB * 0.9);
    const normal = checkRamBudget({ ...Q05_REAL, nCtx: 1024 }, PHOTO)!;
    expect(normal.availableBytes).toBe(370 * MiB);
    // El crédito liberable se suma entero: la reserva cae sobre la
    // lectura, no sobre lo que la propia carga libera al bajar de
    // contexto (cambio de modelo).
    const swap = checkRamBudget({ ...Q05_REAL, nCtx: 1024 }, { ...PHOTO, releasableBytes: 100 * MiB }, { emergencyLive: true })!;
    expect(swap.availableBytes).toBe(842 * MiB * 0.9 + 100 * MiB);
  });

  it("checkRamBudget con emergencyLive y el sistema YA en lowMemory resta además el threshold (F3-12)", () => {
    // lowMemory = Android ya está cerrando aplicaciones: juzgar ese
    // estado con la cuenta amable de la vía fue una de las puertas
    // por las que el proceso moría a mitad de la carga de emergencia.
    const hot = { ...PHOTO, lowMemory: true };
    const via = checkRamBudget({ ...Q05_REAL, nCtx: 1024 }, hot, { emergencyLive: true })!;
    expect(via.availableBytes).toBe(842 * MiB * 0.9 - 216 * MiB);
    // La vía normal no cambia: allí la señal ya va codificada en la
    // propia cuenta (el sumidero threshold solo suma cuando el
    // disponible cae por debajo).
    expect(checkRamBudget({ ...Q05_REAL, nCtx: 1024 }, hot)!.availableBytes).toBe(370 * MiB);
    // Y sin la bandera, la vía resta solo la reserva.
    expect(checkRamBudget({ ...Q05_REAL, nCtx: 1024 }, PHOTO, { emergencyLive: true })!.availableBytes).toBe(842 * MiB * 0.9);
  });
});

describe("lectura real de memoria (0.1.85): la foto es fresca en cada intento y el fallo de lectura se marca", () => {
  it("dos lecturas nativas distintas consecutivas producen dos fotos y dos decisiones distintas (sin caché ni supuesto)", () => {
    mockTotalRam = 3416 * MiB;
    mockRss = 367 * MiB;
    // Intento 1: la foto de las 19:54 — por la cuenta directa no cabe.
    mockAvail = { availBytes: 842 * MiB, thresholdBytes: 216 * MiB, lowMemory: false };
    const snap1 = readRamSnapshot()!;
    expect(snap1.availBytes).toBe(842 * MiB);
    const v1 = checkRamBudget({ fileSizeBytes: 397_808_192, nCtx: 1024, nLayer: 24, nKvHeads: 2, headDim: 64, nUbatch: 128 }, snap1)!;
    expect(v1.availableBytes).toBe(370 * MiB);
    expect(v1.fits).toBe(false);
    // Intento 2: el sistema liberó memoria (la foto posterior de
    // Device care: ~1,7 GB libres) — la decisión sigue a ESTA foto.
    mockAvail = { availBytes: 1700 * MiB, thresholdBytes: 216 * MiB, lowMemory: false };
    const snap2 = readRamSnapshot()!;
    expect(snap2.availBytes).toBe(1700 * MiB);
    const v2 = checkRamBudget({ fileSizeBytes: 397_808_192, nCtx: 1024, nLayer: 24, nKvHeads: 2, headDim: 64, nUbatch: 128 }, snap2)!;
    expect(v2.availableBytes).toBe(1001 * MiB); // manda byTotal
    expect(v2.fits).toBe(true);
    mockAvail = null;
  });

  it("si la lectura en vivo no llega, la foto lo marca (liveReadMissing) y no inventa cifras", () => {
    mockTotalRam = 8 * GiB;
    mockRss = 1 * GiB;
    mockAvail = "throws";
    const snap = readRamSnapshot()!;
    expect(snap.liveReadMissing).toBe(true);
    expect(snap.availBytes).toBeUndefined();
    mockAvail = "throws";
    const stillThrows = readRamSnapshot()!;
    expect(stillThrows.liveReadMissing).toBe(true);
    mockAvail = { availBytes: 1700 * MiB, thresholdBytes: 216 * MiB, lowMemory: false };
    const healed = readRamSnapshot()!;
    expect(healed.liveReadMissing).toBeUndefined();
    expect(healed.availBytes).toBe(1700 * MiB);
    mockAvail = null;
  });
});
