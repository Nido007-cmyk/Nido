/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { getAvailableMemory, getDeviceTotalRamBytes, getMemoryInfo, getProcessorCount } from "ram-monitor";

/**
 * NIDO's RAM pre-flight for native model loads — pure and unit-testable.
 *
 * Idea adopted from BOAR's `estimateFit` (fail with a clear message instead
 * of an OOM crash), but the estimate itself is ours, derived from the
 * transformer/llama.cpp memory model rather than the upstream project's flat 1.15x factor:
 *
 *   working set = weights (mmap'd, hot) + KV cache (computed) + compute buffers
 *
 * - Weights: with `use_mlock: false` llama.cpp mmaps the GGUF and pages
 *   weights in on demand — but generation touches every layer on every
 *   token, so the resident hot set converges to the full file size for a
 *   dense model. Counting the full file is the conservative, correct term.
 * - KV cache: exact formula — 2 (K and V) x nLayer x nCtx x nKvHeads x
 *   headDim x 2 bytes (llama.cpp keeps the KV cache in fp16 by default).
 *   For the bundled default (Qwen2.5-1.5B, n_ctx 4096): 112 MiB.
 * - Compute buffers: llama.cpp's per-context graph/compute allocation,
 *   roughly proportional to context length. 256 MiB at n_ctx 4096 is a
 *   deliberately conservative allowance (over- rather than under-estimates).
 *
 * Sanity check against the old 1.15x heuristic for the default model
 * (0.92 GiB file, n_ctx 4096): 0.92 + 0.11 + 0.26 = 1.28 GiB ~= 1.40x file
 * size. The old factor *under*-estimated by ~20% — the dangerous direction
 * for a pre-flight, which is why it was replaced.
 *
 * Validation against our own device benchmark (internal device benchmark, 2026-09):
 * Qwen2.5-1.5B measured ~1.6 GB steady-state process RSS on a physical
 * phone. This module estimates ~1.28 GiB for the model's own working set;
 * the gap is the app's baseline RSS, which the pre-flight subtracts live
 * from the ram-monitor reading rather than estimating. Same order of
 * magnitude, erring to the conservative side.
 *
 * What this deliberately does NOT do:
 * - It is a pre-flight, not a guarantee: the OS may still kill under
 *   sudden pressure. It turns "cryptic native crash" into "clear message".
 * - Concurrent loads (ChatScreen starts the LLM and the embedding engine
 *   together) each check against the same baseline RSS; the joint total is
 *   not reserved atomically. The estimates are conservative enough that
 *   this only matters on devices that were already marginal.
 */

export interface RamSnapshot {
  totalRamBytes: number;
  rssBytes: number;
  /**
   * 2026-11-06: lo que el sistema tiene libre AHORA (availMem) y el nivel en
   * que Android empieza a cerrar apps (threshold). Opcional: builds nativos
   * anteriores no lo leen y entonces manda solo la cuenta por la RAM total.
   */
  availBytes?: number;
  lowMemThresholdBytes?: number;
  /** Memoria que se libera antes de cargar (el modelo que se va a sustituir). */
  releasableBytes?: number;
  /**
   * 0.1.85 (defecto 2026-11-08, tercera vuelta): la lectura en vivo NO
   * llegó — el build nativo no la trae o falló al leerla — y la foto
   * decide solo por la RAM total. Lo marca readRamSnapshot, el único
   * que sabe que la lectura faltó; los veredictos no cambian (la
   * cuenta sin término en vivo es la histórica), pero un rechazo con
   * esta marca queda registrado con su causa distinguible en el
   * instrumento en vez de pasar por «memoria insuficiente» a secas.
   */
  liveReadMissing?: boolean;
}

/**
 * Margen sobre el nivel en que Android cierra apps: cargar un modelo no
 * llega de golpe y el resto del teléfono sigue pidiendo memoria mientras.
 */
export const LIVE_MARGIN_BYTES = 256 * 1024 * 1024;

export interface ContextSpec {
  /** On-disk GGUF size in bytes (0 when unknown — estimate degrades gracefully). */
  fileSizeBytes: number;
  /** Context length the engine will be initialized with. */
  nCtx: number;
  /** Transformer architecture, for the KV-cache term. Defaults to the
   *  bundled default model's profile (Qwen2.5-1.5B: 28 layers, GQA 2 KV
   *  heads, head dim 128). Override when the manifest knows better. */
  nLayer?: number;
  nKvHeads?: number;
  headDim?: number;
  /** Output rows the engine materializes logits for per decode call.
   *  Defaults to 1: the standard completion path requests logits only on
   *  the last position (see estimateLogitsBytes). */
  nLogitRows?: number;
  nVocab?: number;
  /**
   * Bytes per KV-cache element for the profile being evaluated.
   * Defaults to 2 (fp16, llama.cpp's default). The kv-q8 profile loads
   * with cache_type_k/v = q8_0: ONE byte per element, half the KV term.
   * The pre-flight must charge the profile it is actually about to try
   * (defect 2026-11-08 calibration): charging fp16 while loading q8_0
   * over-charges every rung of the ladder on small devices.
   */
  kvBytesPerElement?: number;
  /**
   * Micro-batch the load will run with (batchForRam's pick for this
   * device class). The compute term's dominant piece is proportional
   * to n_ubatch (see estimateComputeBytes); when the caller knows the
   * batch, the term charges it instead of the flat 4096/256 allowance.
   * Unknown (undefined) keeps the historic flat allowance untouched.
   */
  nUbatch?: number;
}

export interface RamEstimate {
  weightsBytes: number;
  kvCacheBytes: number;
  computeBytes: number;
  /** Logits output buffer (output rows × n_vocab × 4B; 1 row by default). */
  logitsBytes: number;
  totalBytes: number;
}

export interface BudgetVerdict extends RamEstimate {
  /** False when loading would likely OOM — the caller should refuse with a clear message. */
  fits: boolean;
  availableBytes: number;
  totalRamBytes: number;
}

const MiB = 1024 * 1024;
const GiB = 1024 * 1024 * 1024;

/** llama.cpp's default KV-cache element type is fp16. */
const KV_BYTES_PER_ELEMENT = 2;

/** Architecture used when the caller does not declare one (Qwen2.5-1.5B). */
const DEFAULT_ARCH = { nLayer: 28, nKvHeads: 2, headDim: 128 };

/** q8_0 KV cache (the kv-q8 load profile): one byte per element. */
export const KV_Q8_BYTES_PER_ELEMENT = 1;

/**
 * Conservative allowance for llama.cpp's per-context compute/graph buffers
 * at n_ctx 4096, scaled linearly with context length. Deliberately an
 * over-estimate: for a pre-flight, firing early is annoying, firing late is
 * a crash.
 *
 * What the flat allowance is made of (llmInitParamsForProfile's own
 * comment in LlamaEngine.ts): the decode logits buffer is
 * n_ubatch × n_vocab × 4 B — ~149 MiB at n_ubatch 256 with Qwen2.5's
 * 152064 vocabulary — and the rest (~107 MiB) is the graph/KV compute
 * workspace. When the caller declares the n_ubatch the load will
 * actually use (batchForRam already picks 128 on ≤3.5 GiB devices and
 * 192 on ≤4.5 GiB), the term charges that buffer at its real size
 * instead of the 256 default (calibration 2026-11-08): charging the
 * 256-class buffer on a device that will run 128 double-counts memory
 * the load will never allocate.
 *
 * Anchor choice, settled against Grok's patch set the same day: his
 * version scaled the ~149 MiB alone (149 × nUbatch/256), i.e. only
 * the decode-logits buffer. But this estimator already charges the
 * output-row logits as a SEPARATE term, so anchoring on 149 MiB
 * would drop the ~107 MiB of graph workspace from the cost entirely
 * and under-estimate — the dangerous direction for a pre-flight.
 * This formula anchors on the full 256 MiB constant and moves only
 * its batch-proportional component; at n_ubatch 256 it reproduces
 * the historic constant exactly.
 */
const COMPUTE_BUFFER_BYTES_AT_4K_CTX = 256 * MiB;
const COMPUTE_UBATCH_REF = 256;
const COMPUTE_VOCAB_REF = 152064;
const COMPUTE_FIXED_BYTES =
  COMPUTE_BUFFER_BYTES_AT_4K_CTX - COMPUTE_UBATCH_REF * COMPUTE_VOCAB_REF * 4;

function estimateComputeBytes(nCtx: number, nUbatch?: number, nVocab?: number): number {
  const ctx = Math.max(nCtx, 0);
  if (nUbatch === undefined || !Number.isFinite(nUbatch) || nUbatch <= 0) {
    return Math.ceil((COMPUTE_BUFFER_BYTES_AT_4K_CTX * ctx) / 4096);
  }
  const perCtx = COMPUTE_FIXED_BYTES + nUbatch * (nVocab ?? COMPUTE_VOCAB_REF) * 4;
  return Math.ceil((perCtx * ctx) / 4096);
}

/**
 * Logits term. The 2026-10-09 fix charged n_batch × n_vocab × 4B (~297 MiB
 * at n_batch 512, vocab 152064) on the premise that llama.cpp allocates
 * full-vocab logits for every position in the batch. That premise is false
 * for the path NIDO runs: llama.rn's standard completion decodes through
 * llama_batch_get_one, which — in the vendored source's own words
 * (cpp/rn-completion.cpp) — "only requests logits/embeddings on the LAST
 * position"; the all-positions variant exists only for continuous-latent
 * TTS, which NIDO does not use. Device evidence agrees: on the owner's
 * 3.3 GB tablet, Qwen3-0.6B sessions peaked at 743-760 MB for the WHOLE
 * process while this estimator charged 1.003 GiB for the model alone at
 * the ladder floor — the phantom term (0.290 GiB) exceeds the entire gap,
 * and stacked with the 0.1.78 live-availMem term it made every model
 * un-loadable on that tablet (defect 2026-11-08). Charge the rows the
 * engine actually produces: one output row per decode by default.
 */
function estimateLogitsBytes(nRows: number, nVocab: number): number {
  return Math.max(nRows, 0) * Math.max(nVocab, 0) * 4;
}

/**
 * Headroom reserved for the Android system and background apps — a policy
 * constant, not a measurement. Intentionally strict on small devices: an
 * OOM kill loses the user's session with no recovery path, so the check
 * errs toward refusing a load that would leave the system gasping.
 *
 * Exported so the RAM-based default-model selection (src/models/defaultModel.ts)
 * uses the same policy number as the load-time pre-flight instead of
 * hardcoding its own copy.
 */
export const SYSTEM_HEADROOM_BYTES = 2 * GiB;

/** Exact KV-cache footprint for one llama.cpp context. */
export function estimateKvCacheBytes(
  nLayer: number,
  nCtx: number,
  nKvHeads: number,
  headDim: number,
  bytesPerElement: number = KV_BYTES_PER_ELEMENT
): number {
  return 2 * nLayer * nCtx * nKvHeads * headDim * bytesPerElement;
}

export function estimateContextBytes(spec: ContextSpec): RamEstimate {
  const nLayer = spec.nLayer ?? DEFAULT_ARCH.nLayer;
  const nKvHeads = spec.nKvHeads ?? DEFAULT_ARCH.nKvHeads;
  const headDim = spec.headDim ?? DEFAULT_ARCH.headDim;
  const weightsBytes = Math.max(spec.fileSizeBytes, 0);
  const kvCacheBytes = estimateKvCacheBytes(
    nLayer,
    spec.nCtx,
    nKvHeads,
    headDim,
    spec.kvBytesPerElement ?? KV_BYTES_PER_ELEMENT
  );
  const computeBytes = estimateComputeBytes(spec.nCtx, spec.nUbatch, spec.nVocab);
  // Logits: one output row by default (last position only — see
  // estimateLogitsBytes). Vocab default: Qwen2.5 152064.
  const logitsBytes = estimateLogitsBytes(spec.nLogitRows ?? 1, spec.nVocab ?? 152064);
  return {
    weightsBytes,
    kvCacheBytes,
    computeBytes,
    logitsBytes,
    totalBytes: weightsBytes + kvCacheBytes + computeBytes + logitsBytes,
  };
}

/**
 * Pure budget check against a RAM snapshot. Returns null when the snapshot
 * carries no usable readout (totalRamBytes <= 0) — the caller must then skip
 * the check (fail open when blind) rather than block loading on missing data.
 *
 * `opts.emergencyLive` (0.1.85, vía del peldaño de emergencia — ver
 * planContext en memoryLadder.ts): SOLO para juzgar el peldaño de
 * emergencia, el término en vivo usa el availMem CRUDO (más el crédito
 * liberable), sin restar el threshold del sistema ni LIVE_MARGIN_BYTES.
 * Motivo (foto del dueño, 2026-11-08 19:54): en el último peldaño las
 * dos restas apiladas — 472 MiB sobre 842 libres — rechazaban un modelo
 * cuyo proceso entero medido ronda 600 MB con 842 MiB libres reales;
 * el threshold es una marca de agua sobre el propio availMem, no un
 * consumo, y el margen es conservadurismo sin calibrar. En el suelo,
 * la red que queda es la de siempre: la descarga por presión del
 * sistema (fase 5) y el CrashGuard si la carga muere. Sin esta opción
 * la fórmula es byte a byte la de la 0.1.84.
 */
export function checkRamBudget(
  spec: ContextSpec,
  snapshot: RamSnapshot,
  opts?: { emergencyLive?: boolean },
): BudgetVerdict | null {
  if (snapshot.totalRamBytes <= 0) return null;
  const estimate = estimateContextBytes(spec);
  // Crédito simétrico (defecto 2026-11-08, segunda vuelta): lo que el
  // modelo saliente libera ANTES de cargar el entrante cuenta en los
  // DOS términos. Hasta aquí releasableBytes solo entraba en el término
  // en vivo, y byTotal — el que manda en aparatos justos — seguía
  // restando el RSS completo con el saliente residente, contra lo que
  // el comentario F2-2026-10-06 de LlamaEngine.loadNow ya anunciaba
  // («se resta la huella estimada del modelo actual del RSS»). El
  // crédito solo lo construye ese camino (carga con un residente
  // distinto); una carga en frío no lo trae y no cambia nada.
  const releasable = Math.max(snapshot.releasableBytes ?? 0, 0);
  const byTotal =
    snapshot.totalRamBytes - Math.max(snapshot.rssBytes - releasable, 0) - SYSTEM_HEADROOM_BYTES;
  // 2026-11-06 (prueba física, tableta de 3,3 GB): la cuenta por la RAM
  // total dejó cargar un modelo que agotó la memoria con otras apps
  // abiertas. Con la lectura en vivo, manda la menor de las dos.
  const live =
    snapshot.availBytes !== undefined && snapshot.availBytes > 0
      ? opts?.emergencyLive
        ? snapshot.availBytes + releasable
        : snapshot.availBytes + releasable - (snapshot.lowMemThresholdBytes ?? 0) - LIVE_MARGIN_BYTES
      : Number.POSITIVE_INFINITY;
  const availableBytes = Math.max(Math.min(byTotal, live), 0);
  return {
    ...estimate,
    fits: estimate.totalBytes <= availableBytes,
    availableBytes,
    totalRamBytes: snapshot.totalRamBytes,
  };
}

/**
 * Reads the live RAM snapshot from the native ram-monitor module.
 * Best-effort: returns null when the native readouts are unavailable.
 */
export function readRamSnapshot(): RamSnapshot | null {
  try {
    const totalRamBytes = getDeviceTotalRamBytes();
    if (totalRamBytes <= 0) return null;
    let live: ReturnType<typeof getAvailableMemory> = null;
    try {
      // Aparte: un build o un doble de pruebas sin la lectura en vivo no
      // debe dejar el pre-flight ciego.
      live = getAvailableMemory();
    } catch {
      live = null;
    }
    return {
      totalRamBytes,
      rssBytes: getMemoryInfo().rssBytes,
      ...(live
        ? { availBytes: live.availBytes, lowMemThresholdBytes: live.thresholdBytes }
        : { liveReadMissing: true }),
    };
  } catch {
    return null;
  }
}

/**
 * P-03 (auditoría de rendimiento 2026-11-01): hilos de generación
 * según los núcleos reales del aparato. Hasta aquí el default era la
 * constante 4 sin mirar el aparato: en uno de 4 núcleos, 4 hilos
 * nativos se disputan el procesador con Hermes, la UI y el sistema;
 * en uno ancho, sus núcleos sobraban. La política es pura y de
 * suelo/techo duros (2 y 6), porque `availableProcessors()` puede
 * sobrecontar en aparatos virtualizados o muy viejos y porque en
 * big.LITTLE más hilos que núcleos útiles solo añade contención.
 *
 * Sin sonda (null, o una lectura rota) manda el 4 de siempre: cero
 * cambio de conducta en builds sin la función nativa. La clase 7–8
 * nace con 4 — la de la Tab A9+ (SD 695: 2×A78 + 6×A55) — y solo la
 * curva de tok/s medida en el aparato podrá subirla a 5–6 después;
 * esta función no la promete.
 */
export function defaultThreadsForCores(cores: number | null): number {
  if (cores === null || !Number.isFinite(cores) || cores <= 0) return 4;
  if (cores <= 4) return 2;
  if (cores <= 6) return 3;
  if (cores <= 8) return 4;
  return 6;
}

/**
 * Escalera de lote por RAM (optimización 2026-11-08, fase 2 del
 * paquete): el búfer de cómputo de llama.cpp se dimensiona con
 * n_ubatch (ver el comentario de llmInitParamsForProfile en
 * LlamaEngine.ts: a 256 son ~149 MiB con el vocabulario de Qwen2.5;
 * a 128, la mitad). En aparatos de poca RAM ese búfer compite con
 * los pesos y la KV por el mismo disponible del pre-flight, así que
 * la clase pequeña nace con el lote reducido y la mediana con uno
 * intermedio; la clase ancha conserva el de siempre. Bajo presión
 * del aparato (batería o temperatura, fase 3) el techo puede bajar
 * más, hasta 128: presión manda sobre la clase.
 *
 * Pura y con los bordes exactos testeados: ≤3,5 GiB → 256/128;
 * ≤4,5 GiB → 384/192; resto → 512/256. Sin lectura (null o basura),
 * el lote de siempre: cero cambio de conducta a ciegas.
 */
export function batchForRam(
  totalRamBytes: number | null,
  pressureUbatchCap?: number | null,
): { nBatch: number; nUbatch: number } {
  let batch = { nBatch: 512, nUbatch: 256 };
  if (totalRamBytes !== null && Number.isFinite(totalRamBytes) && totalRamBytes > 0) {
    if (totalRamBytes <= 3.5 * GiB) batch = { nBatch: 256, nUbatch: 128 };
    else if (totalRamBytes <= 4.5 * GiB) batch = { nBatch: 384, nUbatch: 192 };
  }
  if (pressureUbatchCap !== null && pressureUbatchCap !== undefined && pressureUbatchCap > 0) {
    const nUbatch = Math.min(batch.nUbatch, pressureUbatchCap);
    batch = { nBatch: Math.max(batch.nBatch, nUbatch), nUbatch };
  }
  return batch;
}

/** Lee los núcleos vía ram-monitor; null si la sonda no está o falla. */
export function readProcessorCount(): number | null {
  try {
    return getProcessorCount();
  } catch {
    return null;
  }
}

/** "1.3" style GiB formatting for user-facing diagnostics. */
/**
 * El pre-flight rechazó cargar un modelo por memoria. El mensaje en inglés
 * queda para los registros; la pantalla lo cuenta en el idioma de la app
 * con estas cifras (formatRamBudgetError en src/ui/ramBudgetMessage.ts).
 */
export class RamBudgetError extends Error {
  readonly code = "ram_budget";
  constructor(
    message: string,
    readonly needBytes: number,
    readonly freeBytes: number,
    readonly totalBytes: number,
    /** Contexto: de cuánto a cuánto se bajó para intentar que cupiera (o null). */
    readonly steppedFrom: number | null,
    readonly steppedTo: number | null,
    /** Presupuesto reducido tras un cierre por memoria (0–1), o null. */
    readonly crashSafety: number | null,
  ) {
    super(message);
    this.name = "RamBudgetError";
  }
}

export function isRamBudgetError(e: unknown): e is RamBudgetError {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "ram_budget";
}

export function toGb(bytes: number): string {
  return (bytes / GiB).toFixed(1);
}
