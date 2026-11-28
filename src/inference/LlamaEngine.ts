/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import * as FileSystem from "expo-file-system/legacy";
import { initLlama, LlamaContext, type CompletionResponseFormat } from "llama.rn";
import * as RamMonitor from "ram-monitor";
import { batchForRam, checkRamBudget, defaultThreadsForCores, estimateContextBytes, KV_ACCEL_BYTES_PER_ELEMENT, KV_Q8_BYTES_PER_ELEMENT, RamBudgetError, readProcessorCount, readRamSnapshot, stateCacheBudgetMb, toGb } from "./ramBudget";
import {
  accelLayerBudget,
  evaluateAccelGate,
  pickAccelDevice,
  selectHexagonDevice,
  type BackendDeviceLike,
} from "./accelGate";
import {
  BENCH_CONFIGS,
  buildBenchReport,
  type ModelBenchReport,
  type RawBenchResult,
} from "./modelBench";
import { isFeatureEnabled } from "../config/featureFlags";
import {
  crossNativeSessionRecord,
  holdBackgroundIndexingForSession,
  parseNativeSessionRecord,
  resetBackgroundIndexingHold,
  NATIVE_SESSION_FILENAME,
  type NativeSessionRecord,
} from "../diagnostics/nativeSession";
import type { CrashReportLike } from "../diagnostics/crashReport";
import { lastReembedProgress } from "../rag/reembed";
import {
  confirmCrashGuardRecord,
  EMERGENCY_CONTEXT,
  parseCrashGuardRecord,
  planContext,
  settleCrashGuardRecord,
  type CrashGuardRecord,
  type LadderPlan,
} from "./memoryLadder";
import { assertTrustedModelFileByName } from "../models/modelTrust";
import { htpAcceleratesQuant, MODEL_CATALOG, openClAcceleratesQuant, type CatalogModel } from "../models/manifest";
import { contextCeilingForDevice } from "../models/defaultModel";
import { currentDevicePressure } from "./devicePressure";
import { withStage } from "../utils/stageError";
import { fromNativeTimings, writeRate, type NativeTimings } from "./nativeTimings";
import { recordInferenceEvent, recordRamRejection, type TelemetryStopReason } from "./telemetry";
import { findRepetitionLoop, trimRepetitionLoop } from "./repetitionGuard";
import { nativeGateBegin, nativeGateEnd, withNativeLoadGate } from "./nativeGate";
import { trimToCompleteSentences } from "./completeSentences";
import { parseGemmaReasoning } from "./gemmaReasoning";
import type { ModelSamplingDefaults } from "../routing/types";
import { generationHitLimit, type NativeStopSignals } from "./generationCut";
import { estimateTokens } from "../agent/loop/contextBudget";
import {
  PROMPT_CACHE_DIRNAME,
  filesToPrune,
  probeMessages,
  promptCacheFileName,
  publicSliceFromFormatted,
  type PromptCacheOutcome,
} from "./promptDiskCache";
import { APP_VERSION } from "../security/backup";
import { PROVEN_LOADS_FILE, parseProvenLoads, recordProvenLoad, type ProvenLoads } from "./provenLoads";
import LLAMA_RN_PACKAGE from "llama.rn/package.json";

export interface ChatMessageInput {
  role: string;
  content: string;
}

export interface GenerateOptions {
  /** Legacy hand-built prompt string (assemblePrompt, src/rag/pure.ts). Exactly one of `prompt`/`messages` must be given. */
  prompt?: string;
  /**
   * Role-separated messages (assembleChatMessages, src/rag/pure.ts) for a
   * model that needs its own real chat/instruction template — passed
   * straight through to llama.rn's completion() with jinja enabled, which
   * applies the loaded GGUF's own embedded chat_template rather than any
   * template string this app would have to guess/hardcode. Only used for
   * models explicitly flagged `ModelCapabilities.usesChatTemplate`
   * (src/routing/types.ts) — everyone else keeps using `prompt`, unchanged.
   */
  messages?: ChatMessageInput[];
  nPredict?: number;
  temperature?: number;
  /**
   * P1.2-2026-10-08: sampling tunables passed straight to llama.cpp via
   * llama.rn's completion params (top_k/top_p/min_p/penalty_repeat all
   * exist on NativeCompletionParams). Unset = the model's load-time values
   * (see loadTimeSampling): llama.rn keeps each sampling param from the
   * previous completion unless it is sent, so these four always travel.
   */
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  /**
   * P1.2-2026-10-08: named sampling preset. Fills in any of
   * temperature/topK/topP/minP/repeatPenalty the caller left unset;
   * explicit values always win over the preset. Prefer this over raw
   * temperature so sampling policy stays in one auditable table.
   */
  samplingPreset?: SamplingPresetName;
  /**
   * P1.1-2026-10-08: constrained decoding. `response_format` maps to
   * llama.cpp's native json_schema grammar masking (schema-valid output
   * by construction); `grammar` passes a raw GBNF grammar and overrides
   * response_format when both are set (native behavior).
   *
   * HONESTY NOTE: whether the vendored llama.rn/llama.cpp build actually
   * enforces the grammar can only be verified on-device (one ADR reported
   * a build with the grammar path disabled). Treat this as a hint that
   * makes valid output *likely*; code validators (P1.5) remain the
   * enforcement layer. Never rely on schema-validity alone for
   * correctness — validate values in code.
   */
  responseFormat?: CompletionResponseFormat;
  grammar?: string;
  /**
   * Qwen3 lane (2026-10-12): thinking switch for the messages/jinja path,
   * passed to llama.rn as `enable_thinking`. Unset = the loaded model's
   * catalog flag decides (ModelCapabilities.noThink → false; any other
   * model → the param is not sent at all, byte-identical legacy call).
   * Explicit true/false always wins over the catalog flag. Ignored on
   * the legacy prompt path (no template, nothing to switch).
   */
  enableThinking?: boolean;
  onToken?: (piece: string) => void;
  stop?: string[];
  /**
   * P2.4-2026-10-08: optional telemetry context. When present (or even
   * absent), generate() records an InferenceTelemetryEvent via
   * recordInferenceEvent() — on-device only, fire-and-forget, never
   * blocks or throws. taskType labels the caller ("agent-loop",
   * "research-generate", ...).
   */
  telemetryContext?: { taskType?: string };
  /**
   * 0.1.122: tramo público del prompt del sistema (texto fijo de la app,
   * prefijo exacto de messages[0].content). Solo con él el motor usa la
   * caché del prompt en disco (promptDiskCache.ts). Sin él, nada cambia.
   */
  publicPrefix?: string;
  /**
   * Safety-net budget, not a performance target — no per-generation timeout
   * existed anywhere in the app before this (see docs/ADAPTIVE_ROUTING.md
   * §14). Left unset for regular single-pass chat (already indirectly
   * bounded by nPredict); set for orchestrator.ts's multi-stage Deep
   * Research calls, where a stuck stage would otherwise compound silently
   * across several sequential model calls with no ceiling at all.
   */
  timeoutMs?: number;
  /** Called once, right before the timeout triggers stop() — lets the caller distinguish a timeout from a natural finish or a user-initiated stop. */
  onTimeout?: () => void;
  /**
   * T-10 (0.1.99, M-20): señal de aborto del llamador. Si aborta
   * durante la generación, el motor pide stop() — la misma parada que
   * la del usuario, con su recorte a frase completa — y la promesa se
   * asienta con el texto parcial. Si ya viene abortada, la generación
   * se para en cuanto arranca la completion.
   */
  signal?: AbortSignal;
  /**
   * T-10 (0.1.99, m-31): semilla de muestreo explícita. Sin ella, los
   * presets structured y factual fijan DETERMINISTIC_SEED (salidas
   * reproducibles donde importa el formato); chat no manda ninguna,
   * como hasta la 0.1.98.
   */
  seed?: number;
}

/**
 * P1.2-2026-10-08: per-task sampling presets. The main loop used to run
 * everything at a flat temperature 0.7 — factual/tool turns are more
 * reliable near-greedy, and small models ramble/repeat at high temp.
 * min_p is pinned to 0 everywhere (llama.cpp's default 0.05 discards the
 * exact tokens needed to break out of repetition loops — MiniCPM docs).
 * A mild repeat penalty applies only to open chat, never to structured
 * paths where it could distort machine-readable output.
 */
export type SamplingPresetName = "structured" | "factual" | "chat";

/** T-10 (0.1.99, m-31): semilla fija de los presets reproducibles. */
export const DETERMINISTIC_SEED = 1234567;

export interface SamplingPreset {
  temperature: number;
  minP?: number;
  repeatPenalty?: number;
}

export const SAMPLING_PRESETS: Record<SamplingPresetName, SamplingPreset> = {
  /** Tool calls, JSON, classifications — near-greedy, validity first. */
  structured: { temperature: 0.1, minP: 0 },
  /**
   * Memory lookups, factual answers — low temp, still some flexibility.
   * 0.1.34: también penalización leve de repetición. Es prosa, no un
   * formato que se parsee, y a 0.3 el 0.5B entró en bucle en la Tab A9+
   * («las aluminosas, las aluminosas…») con fuentes en otro idioma.
   */
  factual: { temperature: 0.3, minP: 0, repeatPenalty: 1.1 },
  /** Open conversation — the old 0.7 default, plus repetition control. */
  chat: { temperature: 0.7, minP: 0, repeatPenalty: 1.1 },
};

/**
 * Resolve sampling into concrete params. Pure — unit tested.
 * Precedence, highest first: explicit caller values → per-task preset
 * → the GGUF's own declared sampling (general.sampling.*, M-36) →
 * the catalog's transcription of the manufacturer's recipe
 * (ModelCapabilities.sampling, estudio de modelos 2026-10-12) →
 * built-in defaults.
 *
 * M-36 (auditoría 2026-11-13, F2-M1): hasta la 0.1.98 el catálogo
 * pisaba lo que el propio fichero declara de sí mismo y la temperatura
 * del fichero ni se leía — #257 quedó cumplido solo como fallback y
 * nunca para la temperatura. La doctrina de la casa es que lo que el
 * modelo declara de sí mismo manda sobre la transcripción manual: el
 * catálogo queda como red cuando el GGUF calla.
 */
export function resolveSampling(opts: {
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  samplingPreset?: SamplingPresetName;
  modelDefaults?: ModelSamplingDefaults;
  fileDefaults?: FileSamplingDefaults;
}): { temperature: number; topK?: number; topP?: number; minP?: number; repeatPenalty?: number } {
  const preset = opts.samplingPreset ? SAMPLING_PRESETS[opts.samplingPreset] : undefined;
  const model = opts.modelDefaults;
  const file = opts.fileDefaults;
  return {
    temperature: opts.temperature ?? preset?.temperature ?? file?.temperature ?? model?.temperature ?? 0.7,
    topK: opts.topK ?? file?.topK ?? model?.topK,
    topP: opts.topP ?? file?.topP ?? model?.topP,
    minP: opts.minP ?? preset?.minP ?? file?.minP,
    repeatPenalty: opts.repeatPenalty ?? preset?.repeatPenalty ?? file?.repeatPenalty ?? model?.repeatPenalty,
  };
}

/**
 * 2026-11-13: los valores de muestreo que llama.cpp pone al cargar un
 * modelo, para que «sin fijar» signifique eso y no «lo de la respuesta
 * anterior».
 *
 * llama.rn arma cada completion sobre ctx->params.sampling, que es el
 * estado del contexto: cada parámetro que la petición no trae conserva el
 * valor de la completion anterior (cpp/jsi/JSIParams.cpp,
 * parseCompletionParams; igual en rc.7, rc.9, rc.10, rc.11 y rc.12,
 * re-leído en la tanda T-22 y en la etapa 2 de la 0.1.122). Una llamada sin
 * preset detrás de una con preset heredaba su min_p 0 y su
 * penalty_repeat 1.1. Por eso NIDO manda siempre los cuatro que gestiona,
 * y lo que el llamante no fija vale lo de la carga.
 *
 * La carga la hace common_init_sampler_from_model de llama.cpp (b11960,
 * b12211 y b12292, common/common.cpp): toma las claves general.sampling.* del GGUF
 * con strtol/strtof, y si faltan o no empiezan por un número, deja los
 * valores por defecto de common_params_sampling (common/common.h), que
 * son los de LLAMA_CPP_SAMPLING_DEFAULTS. llama.rn no fija
 * user_sampling_config, así que siempre se aplica. Los metadatos llegan a
 * JS en context.model.metadata, como texto.
 */
export const LLAMA_CPP_SAMPLING_DEFAULTS = { topK: 40, topP: 0.95, minP: 0.05, repeatPenalty: 1.0 } as const;

export interface LoadTimeSampling {
  topK: number;
  topP: number;
  minP: number;
  repeatPenalty: number;
  /**
   * M-36: solo lo que el GGUF declara de sí mismo, ya validado por
   * rango (m-72). Vacío si el fichero no declara nada utilizable.
   */
  declared: FileSamplingDefaults;
}

/** Lo que un GGUF puede declarar de su propio muestreo (general.sampling.*). */
export interface FileSamplingDefaults {
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
}

/** strtol / strtof: el número del principio, o null si no empieza por uno. */
function leadingInt(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}
function leadingFloat(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}

export function loadTimeSampling(metadata: Record<string, unknown> | null | undefined): LoadTimeSampling {
  const m = metadata ?? {};
  const d = LLAMA_CPP_SAMPLING_DEFAULTS;
  // m-72 (auditoría 2026-11-13, F2-m1): los valores del fichero se
  // validan por rango ANTES de que nada llegue al nativo. Un valor
  // imposible (top_p 7.5, penalty_repeat 0, top_k negativo) cuenta como
  // NO declarado: cae al relleno de llama.cpp y nunca viaja tal cual a
  // una completion. Los bordes con significado sí pasan: top_k 0
  // desactiva el filtro en llama.cpp y temperatura 0 es greedy.
  const topK = leadingInt(m["general.sampling.top_k"]);
  const topP = leadingFloat(m["general.sampling.top_p"]);
  const minP = leadingFloat(m["general.sampling.min_p"]);
  const repeatPenalty = leadingFloat(m["general.sampling.penalty_repeat"]);
  const temp = leadingFloat(m["general.sampling.temp"]);
  const declared: FileSamplingDefaults = {};
  if (topK !== null && topK >= 0) declared.topK = topK;
  if (topP !== null && topP > 0 && topP <= 1) declared.topP = topP;
  if (minP !== null && minP >= 0 && minP <= 1) declared.minP = minP;
  if (repeatPenalty !== null && repeatPenalty > 0 && repeatPenalty <= 10) declared.repeatPenalty = repeatPenalty;
  if (temp !== null && temp >= 0 && temp <= 10) declared.temperature = temp;
  return {
    topK: declared.topK ?? d.topK,
    topP: declared.topP ?? d.topP,
    minP: declared.minP ?? d.minP,
    repeatPenalty: declared.repeatPenalty ?? d.repeatPenalty,
    declared,
  };
}

/**
 * assemblePrompt (src/rag/pure.ts) hand-builds a plain-text prompt with our
 * own "User:"/"Assistant:"/"Question:" role labels rather than using
 * llama.rn's chat-template API (which would auto-derive stop tokens from
 * the GGUF's own Jinja template) — so nothing tells the model where a turn
 * actually ends. Left unset, a model that's done answering (especially on
 * a short/trivial prompt with little else to say) just keeps predicting
 * tokens and starts hallucinating a fake continuation of the conversation,
 * inventing new "User:" turns rather than stopping. These match our own
 * template's role markers so generation halts the moment it tries to do that.
 */
const DEFAULT_STOP_SEQUENCES = [
  "\nUser:",
  "\n\nUser:",
  "\nQuestion:",
  "\n\nQuestion:",
  // P-34 (auditoría 2026-11-13, F2-p4): los marcadores con los que un
  // modelo que sigue el turno en inglés se inventa la respuesta o la
  // siguiente pregunta; anclados al salto de línea como los demás.
  "\nAssistant:",
  "\nAnswer:",
];

export interface LoadedModelInfo {
  filename: string;
  nCtx: number;
  nThreads: number;
  /** RAM-2026-10-11: qué perfil de memoria aceptó llama.cpp (diagnóstico). */
  memoryProfile?: LlmMemoryProfile;
  /** VEL-5 (0.1.110): el dispositivo acelerador que ejecutó la carga
   *  cuando el perfil aceptado fue «accel» (su deviceName de
   *  getBackendDevicesInfo); ausente en toda carga CPU. */
  accelDevice?: string;
  /** Qwen3 lane: el modelo cargado pide enable_thinking=false (catálogo). */
  noThink?: boolean;
  /** Estudio de modelos: receta de muestreo del fabricante (catálogo). */
  sampling?: ModelSamplingDefaults;
  /** Estudio de modelos: quitar la cadena <think> del texto final. */
  stripReasoning?: boolean;
  /** Bounty tanda 3: nota de la escalera/CrashGuard si el plan degradó. */
  contextNote?: string;
  /** 0.1.121: lo que tardó initLlama en cargar este modelo (ms). */
  loadMs?: number;
}

/**
 * RAM-2026-10-11: perfiles de memoria para el contexto del LLM, del más
 * ahorrador al original. Se prueban en orden y se queda el primero que
 * llama.cpp acepta, así un dispositivo o build donde una opción no esté
 * soportada sigue cargando exactamente como antes.
 *
 * - n_ubatch 256 (antes 512 por defecto): el búfer de cómputo de llama.cpp
 *   se reserva para el peor caso de n_ubatch tokens con logits completos
 *   (n_ubatch × n_vocab × 4 B). Con Qwen2.5 (vocab 152064) son ~297 MiB a
 *   512 y ~149 MiB a 256. En CPU de móvil la velocidad de lectura del
 *   prompt casi no cambia entre 256 y 512.
 * - n_batch 512 (antes 2048 por defecto en llama.cpp): lote lógico; debe
 *   ser ≥ n_ubatch. Solo trocea prompts largos.
 * - KV cache q8_0 (antes f16): ~47 % menos de memoria de contexto con
 *   pérdida de calidad casi nula en las mediciones de llama.cpp. La V
 *   cuantizada exige flash attention; con flash_attn_type en "auto" (por
 *   defecto) llama.cpp la activa en CPU si el modelo la soporta, y si no,
 *   falla la creación del contexto y se pasa al siguiente perfil.
 *
 * VEL-5 (0.1.110, acto 2): el perfil «accel» nace AL FRENTE de la
 * cascada, pero solo entra en la lista de una carga cuando la puerta
 * de accelGate.ts abrió para esa carga (GPU Adreno 700+ presente,
 * sin presión, con presupuesto de capas por RAM). Su matriz es la
 * que la física de llama.cpp manda en acelerador — la misma que
 * PocketPal aplica y que nuestra propia nota de arriba anticipa:
 * flash attention 'off' (OpenCL/Hexagon no cargan otra), K q8_0 y
 * V **f16** (la V cuantizada sin flash attention no crea contexto:
 * con FA apagada, la V va sin cuantizar). Si la creación acelerada
 * falla, la cascada sigue a los perfiles CPU de siempre, intactos.
 */
export type LlmMemoryProfile = "accel" | "kv-q8" | "small-batch" | "default";
export const LLM_N_BATCH = 512;
export const LLM_N_UBATCH = 256;

/** La elección acelerada de una carga: dispositivo y capas juzgadas. */
export interface AccelInitPick {
  device: string;
  nGpuLayers: number;
}

export function llmInitParamsForProfile(
  profile: LlmMemoryProfile,
  base: { model: string; n_ctx: number; n_threads: number; state_cache_budget_mb?: number },
  batch: { nBatch: number; nUbatch: number } = { nBatch: LLM_N_BATCH, nUbatch: LLM_N_UBATCH },
  accel?: AccelInitPick,
): Record<string, unknown> {
  const common = {
    model: base.model,
    use_mlock: false, // avoid pinning full weights in RAM; rely on mmap streaming
    n_ctx: base.n_ctx,
    n_threads: base.n_threads,
    n_gpu_layers: 0, // CPU-only for broad device compatibility; adjust per-device
    // 0.1.121: sin efecto en modelos de atención pura; en los híbridos o
    // de ventana, el tope que el pre-flight ya contó.
    ...(base.state_cache_budget_mb !== undefined ? { state_cache_budget_mb: base.state_cache_budget_mb } : {}),
  };
  if (profile === "default") return common;
  // Optimización 2026-11-08 (fase 2): el lote ya no es la constante
  // para todos — lo elige batchForRam según la RAM total del aparato
  // (y el techo de presión de la fase 3). Sin lectura de RAM, el
  // llamador pasa el lote de siempre y esta función se comporta
  // exactamente como antes.
  const smallBatch = { ...common, n_batch: batch.nBatch, n_ubatch: batch.nUbatch };
  if (profile === "small-batch") return smallBatch;
  if (profile === "accel") {
    // Sin elección juzgada no hay perfil acelerado que construir: el
    // motor solo pone «accel» en la lista cuando la puerta abrió con
    // su pick. Si aun así llegara aquí sin pick, la forma devuelta es
    // la de kv-q8 — nunca un acelerado inventado sin dispositivo.
    if (!accel) return { ...smallBatch, cache_type_k: "q8_0", cache_type_v: "q8_0" };
    return {
      ...smallBatch,
      devices: [accel.device],
      n_gpu_layers: accel.nGpuLayers,
      flash_attn_type: "off",
      cache_type_k: "q8_0",
      cache_type_v: "f16",
    };
  }
  return { ...smallBatch, cache_type_k: "q8_0", cache_type_v: "q8_0" };
}

/** La cascada CPU de siempre, en su orden histórico exacto. */
export const LLM_CPU_MEMORY_PROFILES: readonly LlmMemoryProfile[] = ["kv-q8", "small-batch", "default"];

/** La cascada entera con la puerta abierta: «accel» al frente. */
export const LLM_MEMORY_PROFILES: readonly LlmMemoryProfile[] = ["accel", ...LLM_CPU_MEMORY_PROFILES];

/**
 * m-73 (auditoría 2026-11-13, F2-m2): ¿el error de initLlama nombra el
 * FICHERO o el formato? Esos no los cura otro perfil de memoria — los
 * tres perfiles parsean el mismo fichero — y reintentar solo lo
 * parsearía tres veces y enterraría la causa real bajo el último
 * mensaje. Los errores de memoria/contexto no llevan estas palabras y
 * sí siguen la cascada.
 */
const MODEL_FILE_FATAL = /gguf|magic|failed to load model|corrupt|unsupported (model|architecture)|unknown (model )?(architecture|format)|invalid (model|gguf|file format)/i;

export function isModelFileFatalError(e: unknown): boolean {
  const msg = (e as { message?: unknown } | null)?.message;
  return typeof msg === "string" && MODEL_FILE_FATAL.test(msg);
}

/**
 * M2 (crash nativo): los cierres del proceso según Android, tal como
 * el módulo los entrega (sin ordenar: la selección del cierre que
 * mató al proceso del registro vive en la función pura del cruce),
 * o null si el build nativo no lo soporta o aún no hubo cierres. Se
 * lee por el namespace con guarda de tipo: builds anteriores del
 * módulo ram-monitor no exponen getCrashReport, y su ausencia
 * significa «sin cruce», nunca un error.
 */
function recentExitsInfo(): CrashReportLike["exits"] | null {
  try {
    const fn = (RamMonitor as { getCrashReport?: unknown }).getCrashReport;
    if (typeof fn !== "function") return null;
    const report = (fn as () => CrashReportLike | null)();
    if (!report || !Array.isArray(report.exits) || report.exits.length === 0) return null;
    return report.exits;
  } catch {
    return null;
  }
}

/**
 * P-15: cota dura de generaciones en línea (la que corre + las que
 * esperan) y plazo máximo de espera en la cola antes de arrancar.
 */
export const MAX_GENERATIONS_IN_LINE = 8;
export const MAX_GENERATION_WAIT_MS = 15 * 60_000;

/**
 * Tanda too-heavy (pasada del dueño sobre la 0.1.115): la medición de
 * velocidad no tenía plazo en ninguna capa — ni en la pantalla, ni
 * en el motor, ni alrededor del bench() nativo — y «Measuring…» se
 * quedaba eterno si la cola del motor estaba ocupada por una tarea
 * que no se asienta o si el bench nativo no resolvía. La medición
 * honesta en esta clase de aparato ronda el minuto (dos pasadas a
 * ~15 tok/s); el plazo es ~3× eso. Al vencer, la promesa rechaza con
 * BenchTimeoutError y la pantalla enseña su «la medición falló» de
 * siempre: la medición siempre sale, con informe o con error.
 */
export const BENCH_TIMEOUT_MS = 180_000;

export class BenchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Speed measurement timed out after ${timeoutMs} ms`);
    this.name = "BenchTimeoutError";
  }
}

/**
 * El contexto residente no expone bench() (builds sin la función):
 * un hecho distinto del «no hay modelo cargado», y con su propio
 * error para que la pantalla no lo disfrace del mensaje del sin
 * modelo, como hacía el null compartido.
 */
export class BenchUnavailableError extends Error {
  constructor() {
    super("This build cannot measure speed: the loaded context has no bench()");
    this.name = "BenchUnavailableError";
  }
}

/**
 * M-41 (auditoría 2026-11-13, F2-M6): el resumen de backend dice lo que
 * EJECUTÓ, no lo que había. Los dispositivos de getBackendDevicesInfo
 * van etiquetados como VISTOS: que el aparato tenga una GPU OpenCL no
 * significa que la inferencia la usara.
 *
 * VEL-5 (0.1.110): la ejecución ya no es CPU por ley — cuando la carga
 * aceptó el perfil «accel», lo ejecutado es el acelerador y el resumen
 * lo nombra («ejecución GPU (Adreno 750)»), porque la ley de M-41 es
 * decir lo que corrió, no una frase fija. En toda carga CPU el
 * ejecutado sigue siendo «ejecución CPU», como hecho del perfil que
 * cargó (n_gpu_layers: 0). El llamador compone la etiqueta desde
 * modelInfo; aquí solo se recibe.
 *
 * P-32 (F2-p1): la composición respeta un tope de 200 caracteres SIN
 * cortar una entrada por la mitad — el corte a ciegas de antes podía
 * dejar un nombre de dispositivo partido y sin sentido. Los
 * dispositivos que no caben se cuentan («+N más»), no se truncan.
 * Puro — testeado.
 */
export function composeBackendSummary(
  lib: string | null,
  deviceLabels: string[],
  executed: string = "ejecución CPU",
): string {
  const MAX = 200;
  const head = lib ? `lib ${lib} · ${executed}` : executed;
  if (deviceLabels.length === 0) return head.length <= MAX ? head : head.slice(0, MAX);
  let vistos = "";
  let used = 0;
  for (const label of deviceLabels) {
    const next = vistos ? `${vistos}, ${label}` : label;
    if (`${head} · vistos: ${next}`.length > MAX) break;
    vistos = next;
    used++;
  }
  const omitted = deviceLabels.length - used;
  if (used === 0) return `${head} · vistos: +${deviceLabels.length} más`;
  let out = `${head} · vistos: ${vistos}`;
  if (omitted > 0) {
    const suffix = ` · +${omitted} más`;
    if (out.length + suffix.length <= MAX) out += suffix;
  }
  return out;
}

/**
 * VEL-5 (0.1.110): plazo de la sonda de dispositivos en el camino de
 * carga. La enumeración de backends es una llamada local que responde
 * en milisegundos en un aparato sano; el plazo solo existe para que
 * una sonda atascada nunca sea la razón de que un modelo no cargue.
 */
const ACCEL_PROBE_TIMEOUT_MS = 1000;

/**
 * Thin wrapper around llama.rn. Loads a GGUF model with mmap so weights
 * stream from disk rather than being fully resident, keeping peak RAM under
 * the model's working-set size (weights touched + KV cache), not the full
 * file size. No network access anywhere in this module.
 */
export class LlamaEngine {
  private context: LlamaContext | null = null;
  private modelInfo: LoadedModelInfo | null = null;
  /** Los valores de muestreo de la carga del modelo actual (loadTimeSampling). */
  private loadSampling: LoadTimeSampling = { ...LLAMA_CPP_SAMPLING_DEFAULTS, declared: {} };
  // load()/unload() run one at a time. Concurrent loads (e.g. switching
  // models and closing Settings quickly) used to both release, both create a
  // context, and the one overwritten in this.context was never released,
  // leaking a whole model's memory.
  private queue: Promise<void> = Promise.resolve();
  // Completions currently running. Releasing a context while one runs
  // leaves its promise unsettled forever (the chat stays "generating"),
  // so unload stops them and waits for all first. F3-2026-10-06: es un
  // conjunto, no una sola — generate() ahora va por la cola pero stop()
  // puede interrumpir desde fuera.
  private inFlight: Set<Promise<unknown>> = new Set();
  // Bounty tanda 3 (CrashGuard): el registro persistido, leído una vez
  // y cacheado; null = aún no leído. Ver memoryLadder.ts.
  private crashGuard: CrashGuardRecord | null = null;
  // M2+M3 (crash nativo): el registro de sesión nativa, leído una vez
  // y cacheado; null = aún no leído o inexistente. El cruce con los
  // cierres registrados corre una sola vez por proceso (en el primer
  // asentamiento del CrashGuard). Ver diagnostics/nativeSession.ts.
  private nativeSession: NativeSessionRecord | null = null;
  private nativeSessionCrossDone = false;
  // Las operaciones sobre el registro van ENCADENADAS: una
  // generación rápida puede asentarse antes de que la escritura de
  // su arranque aterrice, y el orden arranque→cierre debe sobrevivir
  // a eso (si la muerte llega a mitad, el cierre nunca se encadena).
  // La época invalida las operaciones en vuelo tras un borrado total.
  private nativeSessionChain: Promise<void> = Promise.resolve();
  private nativeSessionEpoch = 0;
  // El sustituto de la variante nativa (getBackendDevicesInfo) se pide
  // una vez por proceso, fuera del camino caliente.
  private backendSummaryPromise: Promise<void> | null = null;
  private backendSummary: string | null = null;
  /**
   * Bounty tanda 8: ¿consumió la última generación todo su
   * presupuesto de tokens? Lo lee ChatScreen al cerrar la respuesta
   * para aplicar la regla de la frase completa sobre el texto
   * transmitido; las generaciones van en serie (generationChain),
   * así que al asentarse una, el dato es de esa.
   */
  private lastCut = false;
  get lastGenerationWasCut(): boolean {
    return this.lastCut;
  }
  /**
   * m-78 (auditoría 2026-11-13, F2-m7): ¿la guarda de repetición marcó
   * bucle durante la ÚLTIMA generación? Solo entonces el texto asentado
   * se recorta con trimRepetitionLoop — y solo entonces ChatScreen
   * aplica la misma regla sobre lo transmitido.
   */
  private lastLoopCut = false;
  get lastGenerationLoopCut(): boolean {
    return this.lastLoopCut;
  }
  /**
   * 0.1.121: los tiempos que midió el motor en la ÚLTIMA generación
   * (lectura del prompt, escritura, tokens de caché). null si el nativo
   * no los dio o venían rotos (nativeTimings.ts).
   */
  private lastNativeTimings: NativeTimings | null = null;
  /**
   * 0.1.121: tokens del prompt del sistema ya contados para este
   * contexto (n_keep). Se cuenta una vez por texto y contexto: el prompt
   * del sistema casi no cambia entre turnos.
   */
  private nKeepCache: { context: unknown; text: string; tokens: number } | null = null;
  /**
   * 0.1.122: el contexto recién creado que aún no ha generado nada. Solo
   * sobre él se carga o se guarda la caché del prompt en disco: guardar
   * después de una conversación escribiría también su memoria.
   */
  private freshContext: unknown = null;
  private lastPromptCacheOutcome: PromptCacheOutcome | null = null;
  /** 0.1.122: qué hizo la caché del prompt en el último arranque en frío. */
  get lastPromptCache(): PromptCacheOutcome | null {
    return this.lastPromptCacheOutcome;
  }

  /**
   * 0.1.122: carga el estado público guardado o, si no existe, lo crea
   * procesando SOLO el texto público y lo guarda antes de que el
   * contexto vea el mensaje real. Nunca lanza: cualquier fallo deja el
   * turno exactamente como sin caché.
   */
  private async applyPromptDiskCache(
    messages: ChatMessageInput[],
    publicPrefix: string,
    enableThinking: boolean | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const ctx = this.context as unknown as {
      getFormattedChat?: (m: unknown[], t?: string | null, p?: Record<string, unknown>) => Promise<unknown>;
      loadSession?: (path: string) => Promise<{ tokens_loaded?: number }>;
      saveSession?: (path: string, o?: { tokenSize: number }) => Promise<number>;
      tokenize?: (t: string) => Promise<{ tokens: unknown[] }>;
      completion?: (p: Record<string, unknown>, cb?: (d: { token: string }) => void) => Promise<unknown>;
    } | null;
    const fresh = ctx !== null && this.freshContext === this.context;
    this.freshContext = null;
    const outcome = (o: PromptCacheOutcome) => {
      this.lastPromptCacheOutcome = o;
    };
    if (!fresh) return;
    const first = messages[0];
    if (!first || first.role !== "system" || typeof first.content !== "string" || !first.content.startsWith(publicPrefix)) {
      return outcome({ kind: "skipped", reason: "no-prefix" });
    }
    if (
      !ctx ||
      typeof ctx.getFormattedChat !== "function" ||
      typeof ctx.loadSession !== "function" ||
      typeof ctx.saveSession !== "function" ||
      typeof ctx.tokenize !== "function" ||
      typeof ctx.completion !== "function" ||
      !FileSystem.cacheDirectory ||
      !this.modelInfo
    ) {
      return outcome({ kind: "skipped", reason: "unsupported" });
    }
    const fmtParams: Record<string, unknown> = { jinja: true, ...(enableThinking !== undefined ? { enable_thinking: enableThinking } : {}) };
    const promptOf = (r: unknown): string =>
      typeof r === "string" ? r : typeof (r as { prompt?: unknown })?.prompt === "string" ? (r as { prompt: string }).prompt : "";
    let slice: string | null;
    try {
      // Solo texto público entra aquí: el tramo fijo y el marcador.
      slice = publicSliceFromFormatted(promptOf(await ctx.getFormattedChat(probeMessages(publicPrefix), null, fmtParams)), publicPrefix);
      if (!slice) return outcome({ kind: "skipped", reason: "template" });
      // Si el prompt real no empieza igual, la caché nunca encajaría.
      const real = promptOf(await ctx.getFormattedChat(messages, null, fmtParams));
      if (!real.startsWith(slice)) return outcome({ kind: "skipped", reason: "mismatch" });
    } catch {
      return outcome({ kind: "skipped", reason: "template" });
    }
    const dir = `${FileSystem.cacheDirectory}${PROMPT_CACHE_DIRNAME}/`;
    const name = promptCacheFileName({
      modelFile: this.modelInfo.filename,
      nCtx: this.modelInfo.nCtx,
      profile: String(this.modelInfo.memoryProfile ?? "cpu"),
      engineVersion: String((LLAMA_RN_PACKAGE as { version?: string }).version ?? "?"),
      appVersion: APP_VERSION,
      publicSlice: slice,
    });
    const path = `${dir}${name}`;
    const info = await FileSystem.getInfoAsync(path).catch(() => ({ exists: false }));
    if (info.exists) {
      try {
        const r = await ctx.loadSession(path);
        return outcome({ kind: "loaded", tokens: Number(r?.tokens_loaded) || 0 });
      } catch {
        await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
        return outcome({ kind: "failed", stage: "load" });
      }
    }
    if (signal?.aborted) return outcome({ kind: "skipped", reason: "aborted" });
    try {
      const tokens = (await ctx.tokenize(slice))?.tokens?.length ?? 0;
      if (tokens <= 0) return outcome({ kind: "skipped", reason: "template" });
      // El contexto procesa SOLO el texto público (y escribe un token).
      await ctx.completion({ prompt: slice, n_predict: 1, temperature: 0 }, () => {});
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      // Escritura a un temporal y luego se mueve: un cierre a medias no
      // deja un fichero roto con el nombre bueno.
      const tmp = `${path}.tmp`;
      const saved = await ctx.saveSession(tmp, { tokenSize: tokens });
      await FileSystem.moveAsync({ from: tmp, to: path });
      await this.prunePromptCache(dir);
      return outcome({ kind: "saved", tokens: Number(saved) || tokens });
    } catch {
      await FileSystem.deleteAsync(`${path}.tmp`, { idempotent: true }).catch(() => {});
      return outcome({ kind: "failed", stage: "save" });
    }
  }

  /** 0.1.122: deja solo los ficheros más recientes de la caché del prompt. */
  private async prunePromptCache(dir: string): Promise<void> {
    try {
      const names = await FileSystem.readDirectoryAsync(dir);
      const files: { name: string; mtime: number }[] = [];
      for (const name of names) {
        if (!name.endsWith(".bin")) {
          // Temporales huérfanos de un guardado interrumpido.
          if (name.endsWith(".tmp")) await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => {});
          continue;
        }
        const i = (await FileSystem.getInfoAsync(`${dir}${name}`)) as { exists: boolean; modificationTime?: number };
        if (i.exists) files.push({ name, mtime: i.modificationTime ?? 0 });
      }
      for (const name of filesToPrune(files)) {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => {});
      }
    } catch {
      // La poda es higiene: si falla, el próximo guardado lo reintenta.
    }
  }

  /**
   * n_keep = los tokens del prompt del sistema (más el margen de la
   * plantilla). Si el contexto se llena durante la generación, llama.cpp
   * desplaza el contexto descartando tokens DESPUÉS de n_keep; con 0
   * (el valor por defecto) el prompt de seguridad sería lo primero en
   * perderse. Sin tokenizador o sin mensaje de sistema: undefined y la
   * llamada nativa queda como antes.
   */
  private async systemKeepTokens(messages: ChatMessageInput[] | undefined): Promise<number | undefined> {
    const first = messages?.[0];
    if (!first || first.role !== "system" || typeof first.content !== "string" || first.content.length === 0) return undefined;
    const ctx = this.context as { tokenize?: (t: string) => Promise<{ tokens: unknown[] }> } | null;
    if (!ctx || typeof ctx.tokenize !== "function") return undefined;
    if (this.nKeepCache && this.nKeepCache.context === ctx && this.nKeepCache.text === first.content) {
      return keepTokensFor(this.nKeepCache.tokens, this.modelInfo?.nCtx);
    }
    try {
      const r = await ctx.tokenize(first.content);
      const tokens = Array.isArray(r?.tokens) ? r.tokens.length : 0;
      if (tokens <= 0) return undefined;
      this.nKeepCache = { context: ctx, text: first.content, tokens };
      return keepTokensFor(tokens, this.modelInfo?.nCtx);
    } catch {
      return undefined;
    }
  }
  get lastGenerationTimings(): NativeTimings | null {
    return this.lastNativeTimings;
  }
  /**
   * M-39: contador de paradas pedidas con stop(). generateOnce toma una
   * foto al arrancar: si el contador se movió al asentarse, ESTA
   * generación fue parada desde fuera (usuario o timeout ya tiene su
   * propia marca) y su texto pasa por la regla de la frase completa
   * aunque el veredicto nativo diga «interrupted».
   */
  private stopCounter = 0;
  /**
   * m-79 (F2-m8): el contexto quedó sospechoso tras una completion
   * fallida. La siguiente generación lo recrea antes de usarlo en vez
   * de generar sobre un estado nativo que ya demostró estar roto.
   */
  private contextSuspect = false;

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  // ---- CrashGuard (bounty tanda 3; la lógica pura vive en
  // memoryLadder.ts). Todo a prueba de fallos: si el fichero no se
  // puede leer o escribir, el motor sigue exactamente como antes.

  private crashGuardPath(): string {
    return `${FileSystem.documentDirectory}nido-crash-guard.json`;
  }

  private async crashGuardRead(): Promise<CrashGuardRecord> {
    if (this.crashGuard) return this.crashGuard;
    let record: CrashGuardRecord = { crashes: 0, pending: null };
    try {
      const raw = await FileSystem.readAsStringAsync(this.crashGuardPath());
      record = parseCrashGuardRecord(raw);
    } catch {
      // Sin fichero (primera vez) o ilegible: registro vacío.
    }
    this.crashGuard = record;
    return record;
  }

  private async crashGuardWrite(record: CrashGuardRecord): Promise<void> {
    this.crashGuard = record;
    try {
      await FileSystem.writeAsStringAsync(this.crashGuardPath(), JSON.stringify(record));
    } catch {
      // La memoria en proceso manda; el siguiente arranque reintenta.
    }
  }

  /**
   * Al abrir una carga: asienta el registro (un pendiente con el
   * proceso muerto cuenta como choque; con un modelo vivo, ese
   * pendiente es el modelo cargado y se confirma) y devuelve el
   * factor de seguridad que manda en el plan de esta carga.
   */
  private async crashGuardSettle(): Promise<number> {
    let before = await this.crashGuardRead();
    // M3 (crash nativo) + C-02: el cruce corre primero, una vez por
    // proceso. Si la última muerte fue con una generación en vuelo —
    // CRASH_NATIVE o LOW_MEMORY — el choque se cuenta aquí y el
    // pendiente de aquella carga se consume en el mismo gesto: la
    // muerte se cuenta una vez, y el factor resultante es el que
    // planifica esta carga.
    const adjusted = await this.nativeSessionCross(before);
    if (adjusted) {
      before = adjusted;
      await this.crashGuardWrite(adjusted);
    }
    const { record, safety } = settleCrashGuardRecord(before, { modelAlive: this.context !== null });
    if (record !== before) await this.crashGuardWrite(record);
    return safety;
  }

  /** Deja el intento en vuelo persistido ANTES de crear el contexto. */
  private async crashGuardMarkPending(model: string, nCtx: number): Promise<void> {
    const record = await this.crashGuardRead();
    await this.crashGuardWrite({ crashes: record.crashes, pending: { model, nCtx, at: Date.now() } });
  }

  /**
   * Borrado total (Clear All Data): olvida el registro en memoria.
   * El wipe borra `nido-crash-guard.json` del disco, pero este
   * singleton conserva su copia en proceso y la siguiente carga la
   * reescribiría tal cual, resucitando estado del mundo borrado
   * (el mismo motivo por el que el wipe restablece los interruptores
   * en memoria). Tras esta llamada, la próxima lectura parte del
   * registro vacío: el fichero ya no existe.
   */
  resetCrashGuardMemory(): void {
    this.crashGuard = null;
  }

  /**
   * Una generación que termina bien confirma la carga: contador a
   * cero y sin pendiente. Sin escritura cuando no hay nada que limpiar.
   */
  private crashGuardConfirm(): void {
    const record = this.crashGuard;
    if (!record || (record.crashes === 0 && record.pending === null)) return;
    void this.crashGuardWrite(confirmCrashGuardRecord(record));
  }

  // ---- 0.1.122: cargas probadas en este aparato (provenLoads.ts). Solo
  // informan a la tarjeta del modelo; nunca cambian qué se deja cargar.

  private provenLoads: ProvenLoads | null = null;

  private provenLoadsPath(): string {
    return `${FileSystem.documentDirectory}${PROVEN_LOADS_FILE}`;
  }

  /** Mayor contexto con el que cada modelo respondió en este aparato. Nunca lanza. */
  async provenContexts(): Promise<ProvenLoads> {
    if (this.provenLoads) return this.provenLoads;
    let loads: ProvenLoads = {};
    try {
      loads = parseProvenLoads(await FileSystem.readAsStringAsync(this.provenLoadsPath()));
    } catch {
      // Sin fichero (primera vez) o ilegible: nada probado aún.
    }
    this.provenLoads = loads;
    return loads;
  }

  private async recordProvenLoadNow(): Promise<void> {
    const info = this.modelInfo;
    if (!info) return;
    const before = await this.provenContexts();
    const after = recordProvenLoad(before, info.filename, info.nCtx);
    if (after === before) return;
    this.provenLoads = after;
    try {
      await FileSystem.writeAsStringAsync(this.provenLoadsPath(), JSON.stringify(after));
    } catch {
      // La copia en memoria manda; la siguiente respuesta reintenta.
    }
  }

  /** Borrado total: olvida la copia en memoria (el wipe borra el fichero). */
  resetProvenLoadsMemory(): void {
    this.provenLoads = null;
  }

  // ---- Registro de sesión nativa (M2+M3 del diagnóstico del crash;
  // la lógica pura vive en diagnostics/nativeSession.ts). Todo a
  // prueba de fallos, como el CrashGuard: si el fichero no se puede
  // leer o escribir, el motor sigue exactamente como antes.

  private nativeSessionPath(): string {
    return `${FileSystem.documentDirectory}${NATIVE_SESSION_FILENAME}`;
  }

  private async nativeSessionRead(): Promise<NativeSessionRecord | null> {
    if (this.nativeSession) return this.nativeSession;
    try {
      const raw = await FileSystem.readAsStringAsync(this.nativeSessionPath());
      this.nativeSession = parseNativeSessionRecord(raw);
    } catch {
      // Sin fichero (nadie ha generado aún) o ilegible: sin registro.
      this.nativeSession = null;
    }
    return this.nativeSession;
  }

  private async nativeSessionWrite(record: NativeSessionRecord): Promise<void> {
    // H-10 (W4): la caché se asigna DESPUÉS de que la escritura
    // aterrice. Asignarla antes dejaba memoria y disco contando
    // historias distintas durante todo el proceso si la escritura
    // rechazaba (disco lleno): la caché afirmaba un registro que el
    // disco no tenía, y la siguiente operación partía de esa mentira.
    // Si rechaza, la caché conserva el registro anterior — el mismo
    // que el disco tiene — y la operación siguiente reintenta desde
    // ese suelo. El fail-soft se mantiene: ningún error de este
    // fichero puede romper la generación.
    try {
      await FileSystem.writeAsStringAsync(this.nativeSessionPath(), JSON.stringify(record));
      this.nativeSession = record;
    } catch {
      // La memoria conserva el registro de disco; el siguiente arranque reintenta.
    }
  }

  /**
   * M2: al empezar una generación, el registro se sobrescribe con los
   * metadatos de ESTA generación y la bandera puesta. Es un disparo
   * sin espera (generate no aguarda al disco) y el contenido es solo
   * de sesión: modelo, contexto, perfil, estado del re-indexado y el
   * resumen de dispositivos — nunca el prompt ni la respuesta. El
   * veredicto y el cierre ya cruzado del registro anterior se
   * conservan: son la historia que la tarjeta enseña.
   */
  /** Encadena una operación sobre el registro (ver nativeSessionChain). */
  private nativeSessionOp(op: () => Promise<void>): void {
    const epoch = this.nativeSessionEpoch;
    this.nativeSessionChain = this.nativeSessionChain
      .then(() => (epoch === this.nativeSessionEpoch ? op() : undefined))
      .catch(() => {});
  }

  private nativeSessionMarkStart(): void {
    const info = this.modelInfo;
    if (!info) return;
    this.nativeSessionOp(async () => {
      const prev = await this.nativeSessionRead();
      const reembed = lastReembedProgress();
      const record: NativeSessionRecord = {
        at: Date.now(),
        model: info.filename,
        nCtx: info.nCtx,
        nThreads: info.nThreads,
        memoryProfile: info.memoryProfile ?? null,
        reembed: { running: reembed.running, done: reembed.done, total: reembed.total },
        generating: true,
        backend: this.backendSummary,
        crossedExitAt: prev?.crossedExitAt ?? null,
        verdict: prev?.verdict ?? null,
      };
      await this.nativeSessionWrite(record);
      // El resumen de dispositivos llega tarde la primera vez, y su
      // espera NO puede vivir dentro de esta op (H-10, W3): alargaba
      // la cola que la caída de la bandera de ESTA generación espera
      // detrás, ensanchando la ventana en que una muerte posterior
      // se leería como «murió generando» sin serlo. La op de arranque
      // es una sola escritura; se asegura de que el resumen se esté
      // pidiendo y el adjunto viaja en su propia op, detrás de lo que
      // ya estuviera encolado (la guarda de identidad la hace segura:
      // solo escribe si la caché sigue siendo este registro y el
      // campo sigue vacío, así nunca resucita una bandera caída ni
      // pisa una generación más nueva).
      void this.refreshBackendSummary().then(() => {
        const summary = this.backendSummary;
        if (!summary) return;
        this.nativeSessionOp(async () => {
          const current = this.nativeSession;
          if (!current || current.at !== record.at || current.backend !== null) return;
          await this.nativeSessionWrite({ ...current, backend: summary });
        });
      });
    });
  }

  /**
   * La generación se asentó: la bandera cae. Si el proceso muere
   * generando, esta limpieza nunca corre y la bandera queda puesta
   * en disco — esa es exactamente la señal que el cruce lee.
   */
  private nativeSessionMarkEnd(): void {
    this.nativeSessionOp(async () => {
      const record = this.nativeSession;
      if (!record || !record.generating) return;
      await this.nativeSessionWrite({ ...record, generating: false });
    });
  }

  /**
   * La variante nativa cargada y lo que la sesión ejecutó, una vez por
   * proceso, en segundo plano: «lib <variante> · ejecución <la que
   * corrió> · vistos: <dispositivos>».
   *
   * La variante sale de context.androidLib, que llama.rn rellena al cargar
   * con la librería que eligió (RNLlamaJSI.cpp, g_android_loaded_library;
   * existe al menos desde rc.7). La librería se carga una vez por proceso,
   * así que basta con leerla una vez.
   *
   * M-41: la ejecución se declara desde lo que el motor fijó — el
   * perfil que la carga aceptó (CPU con n_gpu_layers: 0, o «accel»
   * con su dispositivo) — no desde los dispositivos que la sonda ve:
   * ver composeBackendSummary. P-32: un intento que no
   * produce resumen NO se cachea (antes, un primer fallo dejaba el
   * diagnóstico vacío para todo el proceso); y la parte que puede fallar
   * (la sonda de dispositivos) ya no puede vaciar el resumen entero,
   * porque lo ejecutado se sabe sin ella.
   */
  /**
   * La lista real de dispositivos de llama.rn, leída sin lanzar
   * nunca: build sin la sonda, sonda que falla o respuesta que no es
   * una lista → lista vacía (sin dispositivos que juzgar ni que
   * enseñar). La comparten la puerta de aceleración de la carga y el
   * resumen de diagnóstico.
   */
  private async probeBackendDevices(): Promise<BackendDeviceLike[]> {
    try {
      const mod = (await import("llama.rn")) as { getBackendDevicesInfo?: unknown };
      if (typeof mod.getBackendDevicesInfo !== "function") return [];
      const devices = await (
        mod.getBackendDevicesInfo as () => Promise<BackendDeviceLike[]>
      )();
      return Array.isArray(devices) ? devices : [];
    } catch {
      return [];
    }
  }

  /**
   * La lectura de la puerta, con plazo: una enumeración nativa
   * atascada no puede colgar la carga de un modelo. Si la lista no
   * llega dentro del plazo, la puerta juzga sin lista — cerrada — y
   * la carga sigue en CPU, la conducta de siempre. La lectura de
   * fondo continúa y su resultado tardío simplemente no se usa.
   */
  private async probeBackendDevicesForGate(): Promise<BackendDeviceLike[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<BackendDeviceLike[]>((resolve) => {
      timer = setTimeout(() => resolve([]), ACCEL_PROBE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.probeBackendDevices(), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * VEL-5 (0.1.110, acto 3): ¿este teléfono ofrece un NPU Hexagon?
   * Devuelve su deviceName o null. Es la sonda de VISIBILIDAD de la
   * opción de Ajustes: sin HTP la opción ni se ve ni se intenta. La
   * presión no entra aquí — cerrar por calor o batería es juicio de
   * cada carga (evaluateAccelGate), no de si la opción existe. Con
   * el mismo plazo de la puerta: una enumeración atascada responde
   * «sin NPU», nunca cuelga la pantalla.
   */
  async probeNpuDevice(): Promise<string | null> {
    const devices = await this.probeBackendDevicesForGate();
    return selectHexagonDevice(devices)?.deviceName ?? null;
  }

  private refreshBackendSummary(): Promise<void> {
    if (!this.backendSummaryPromise) {
      const attempt = (async () => {
        try {
          const lib = (this.context as unknown as { androidLib?: unknown } | null)?.androidLib;
          // Best-effort: lo ejecutado se declara sin los dispositivos
          // si la sonda no responde (la lista sale vacía, no un error).
          const devices = await this.probeBackendDevices();
          const labels = devices.map((d) => `${d.backend}/${d.type}/${d.deviceName}`);
          // M-41/VEL-5: lo ejecutado sale de la carga en curso — el
          // perfil que llama.cpp aceptó y, si fue «accel», en qué
          // dispositivo. El resumen se compone una vez por proceso
          // (como la variante, que también se lee una vez): declara
          // la ejecución de la carga que lo pidió primero.
          const info = this.modelInfo;
          const executed =
            info?.memoryProfile === "accel" && info.accelDevice
              ? info.accelDevice.startsWith("HTP")
                ? `ejecución NPU (${info.accelDevice})`
                : `ejecución GPU (${info.accelDevice})`
              : "ejecución CPU";
          this.backendSummary = composeBackendSummary(
            typeof lib === "string" && lib ? lib : null,
            labels,
            executed,
          );
        } catch {
          // Ni siquiera la composición: el resumen queda vacío y el
          // intento no se cachea (P-32), para reintentar en la siguiente.
        }
      })();
      this.backendSummaryPromise = attempt;
      void attempt.then(() => {
        if (!this.backendSummary && this.backendSummaryPromise === attempt) {
          this.backendSummaryPromise = null;
        }
      });
    }
    return this.backendSummaryPromise;
  }

  /**
   * M2+M3 + C-02: el cruce del registro con los cierres registrados,
   * una vez por proceso, al abrir la primera carga (antes de asentar
   * el CrashGuard, para que el factor de ESTA carga ya lo recoja).
   * Devuelve el registro del CrashGuard ajustado cuando la muerte se
   * cuenta aquí — con el pendiente consumido, para que el
   * asentamiento normal no la cuente una segunda vez — o null si el
   * cruce no contó nada.
   */
  private async nativeSessionCross(crashRecord: CrashGuardRecord): Promise<CrashGuardRecord | null> {
    if (this.nativeSessionCrossDone) return null;
    this.nativeSessionCrossDone = true;
    const record = await this.nativeSessionRead();
    if (!record) return null;
    const cross = crossNativeSessionRecord(record, recentExitsInfo());
    if (cross.record !== record) await this.nativeSessionWrite(cross.record);
    if (cross.holdBackground) holdBackgroundIndexingForSession();
    if (!cross.countedNativeCrash && !cross.countedLowMemoryDeath) return null;
    return { crashes: Math.min(crashRecord.crashes + 1, 10), pending: null };
  }

  /**
   * Borrado total (Clear All Data): olvida el registro en memoria y
   * la degradación de la sesión. El wipe borra el fichero del disco
   * (inventario de appReset.ts), pero este singleton conserva su
   * copia y la siguiente generación la reescribiría tal cual,
   * resucitando estado del mundo borrado — el mismo motivo que
   * resetCrashGuardMemory.
   */
  resetNativeSessionMemory(): void {
    this.nativeSession = null;
    this.nativeSessionCrossDone = false;
    this.nativeSessionEpoch++;
    resetBackgroundIndexingHold();
  }

  load(modelFilename: string, opts?: { nCtx?: number; nThreads?: number }): Promise<void> {
    // Fase 2 (reapertura del defecto, 2026-11-08): la carga corre tras
    // la puerta de carga — un initLlama a la vez en todo el proceso.
    // Antes el LLM y el motor de embeddings arrancaban en Promise.all
    // y sus pre-flight leían la misma foto de RAM sin verse el uno al
    // otro. La cola interna sigue serializando las cargas de ESTE
    // motor; la puerta ordena las de los DOS motores.
    return withNativeLoadGate(() => this.enqueue(() => this.loadNow(modelFilename, opts)));
  }

  private async loadNow(modelFilename: string, opts?: { nCtx?: number; nThreads?: number }) {
    // Per-model default context: smaller models declare a smaller defaultNCtx
    // in the catalog (context is the second biggest RAM term after weights).
    // An explicit opt always wins.
    const catalogEntry: CatalogModel | undefined = MODEL_CATALOG.find(
      (m) => m.filename === modelFilename
    );
    // Bounty tanda 3: el contexto pedido es el TECHO. Sin opción
    // explícita, la escalera de memoria (memoryLadder.ts) puede bajar
    // peldaños en el pre-flight hasta que el plan quepa; con opción
    // explícita manda ella, como siempre. El CrashGuard asienta su
    // registro al abrir la carga y su factor entra en el plan.
    const explicitCtx = opts?.nCtx !== undefined;
    // Optimización 2026-11-08 (plan n.º 7): sin opción explícita, el
    // techo puede nacer ya reducido en aparatos de ≤4 GiB para los
    // modelos cuyo contexto declarado es 3072 (contextCeilingForDevice
    // en defaultModel.ts). La foto con la que se decide es LA MISMA
    // que el pre-flight usa abajo (liveSnapshot): una sola lectura,
    // nunca dos fotos distintas en la misma carga. Con opción
    // explícita manda ella, como siempre, y sin lectura manda el
    // techo declarado.
    const requestedCtx = opts?.nCtx ?? catalogEntry?.defaultNCtx ?? 4096;
    let nCtx = requestedCtx;
    // P-03: sin opción explícita, los hilos salen de los núcleos
    // reales del aparato (política en ramBudget.ts); la opción
    // explícita sigue mandando, como manda con nCtx. Optimización
    // 2026-11-08 (fase 3): la presión del aparato (batería baja, modo
    // de ahorro, calor) puede bajar ese número con su tope; la foto
    // de presión la refresca la pantalla y aquí solo se consulta.
    const pressure = currentDevicePressure();
    const baseThreads = opts?.nThreads ?? defaultThreadsForCores(readProcessorCount());
    const nThreads =
      opts?.nThreads !== undefined || pressure.threadCap === null
        ? baseThreads
        : Math.min(baseThreads, pressure.threadCap);
    const crashSafety = await this.crashGuardSettle();

    // ChatScreen re-mounts (and calls load() again) every time Settings is
    // closed, even if the user didn't touch the model — re-initializing the
    // native llama.cpp context is expensive (seconds, for a multi-GB model),
    // so skip it entirely when nothing actually changed.
    if (
      this.context &&
      this.modelInfo?.filename === modelFilename &&
      this.modelInfo.nCtx === nCtx &&
      this.modelInfo.nThreads === nThreads
    ) {
      return;
    }

    const modelPath = `${FileSystem.documentDirectory}${modelFilename}`;
    // Integrity gate (NIDO): a model file is trusted for inference ONLY if
    // it is a curated catalog asset whose bytes are proven to be the
    // verified bytes (journal + size + SHA-256 + mtime binding — see
    // src/models/modelTrust.ts). A file merely existing at the expected
    // path is NEVER enough to reach initLlama. This runs before the
    // exists-check below so even the "not found" case reports honestly.
    await withStage("trust-check", () => assertTrustedModelFileByName(modelFilename));
    const info = await FileSystem.getInfoAsync(modelPath);
    if (!info.exists) {
      throw new Error(
        `Model not found at ${modelPath}. Run the setup wizard to install it first.`
      );
    }
    const fileSizeBytes = (info as { size?: number }).size ?? 0;

    // F2-2026-10-06: pre-flight ANTES de liberar el modelo actual. Si el
    // chequeo de RAM falla, el motor conserva el modelo en uso en vez de
    // quedar sin ninguno. Se resta la huella estimada del modelo actual
    // del RSS para evitar falsos negativos ("no cabe" cuando sí cabría
    // tras liberar).
    // Con la lectura en vivo (availMem), lo que ocupa el modelo que se va a
    // sustituir todavía no está libre, pero lo estará antes de cargar.
    const liveSnapshot = readRamSnapshot();
    const loaded = this.context && this.modelInfo ? MODEL_CATALOG.find((m) => m.filename === this.modelInfo?.filename) : undefined;
    // Calibración 2026-11-08 (defecto, segunda vuelta): el lote que la
    // carga REAL va a usar sale de la misma foto (batchForRam por RAM
    // total + techo de presión) y entra en el spec: el término de
    // cómputo del estimador cobra ese n_ubatch, no el plano de la
    // clase 256. Una sola foto, un solo lote: el de abajo en el bucle
    // de perfiles es este mismo objeto.
    const loadBatch = batchForRam(liveSnapshot?.totalRamBytes ?? null, pressure.ubatchCap);
    const snapshot =
      liveSnapshot && loaded && this.modelInfo
        ? {
            ...liveSnapshot,
            releasableBytes: estimateContextBytes({
              fileSizeBytes: loaded.sizeBytes,
              nCtx: this.modelInfo.nCtx,
              nLayer: loaded.arch?.nLayer,
              nKvHeads: loaded.arch?.nKvHeads,
              headDim: loaded.arch?.headDim,
              kvBytesPerElement:
                this.modelInfo.memoryProfile === "kv-q8"
                  ? KV_Q8_BYTES_PER_ELEMENT
                  : this.modelInfo.memoryProfile === "accel"
                    ? KV_ACCEL_BYTES_PER_ELEMENT
                    : undefined,
              nUbatch: loadBatch.nUbatch,
            }).totalBytes,
          }
        : liveSnapshot;
    if (!explicitCtx) {
      nCtx = contextCeilingForDevice(catalogEntry?.defaultNCtx, snapshot?.totalRamBytes ?? null);
      // La comparación de «ya cargado» de arriba usó el techo
      // declarado; si la política de clase lo rebaja y el modelo
      // residente ya vive en ese contexto rebajado, la carga es un
      // atajo también (nada que rehacer).
      if (
        this.context &&
        this.modelInfo?.filename === modelFilename &&
        this.modelInfo.nCtx === nCtx &&
        this.modelInfo.nThreads === nThreads
      ) {
        return;
      }
    }
    // 0.1.121: tope de la caché de estados entre turnos (modelos
    // híbridos o de ventana; ver stateCacheBudgetMb).
    const stateCacheMb = stateCacheBudgetMb(liveSnapshot?.totalRamBytes ?? snapshot?.totalRamBytes ?? null);
    const specBase = {
      fileSizeBytes,
      nLayer: catalogEntry?.arch?.nLayer,
      nKvHeads: catalogEntry?.arch?.nKvHeads,
      headDim: catalogEntry?.arch?.headDim,
      nUbatch: loadBatch.nUbatch,
    };
    const spec = { ...specBase, nCtx };
    let verdict = snapshot ? checkRamBudget(spec, snapshot) : null;
    // La escalera solo actúa sin opción explícita y con lectura de
    // RAM: elige el peldaño mayor que cabe bajo el techo pedido, con
    // el presupuesto reducido por el CrashGuard si hubo un choque.
    let contextNote = "";
    // Calibración 2026-11-08: el PRIMER perfil que la carga intenta es
    // kv-q8 (LLM_MEMORY_PROFILES[0]) y su KV cuesta la mitad. Si con
    // ese coste el modelo solo cabe en el peldaño de emergencia, el
    // plan manda con la KV de q8 — y la carga de abajo queda fijada a
    // ese perfil y ese contexto (profundizar en perfiles mayores sería
    // cargar con otra KV que el pre-flight no cobró). En cualquier
    // otro peldaño manda el plan fp16 de siempre: conservador, porque
    // los perfiles de reserva cargan con KV fp16 y el plan debe valer
    // para el que acabe aceptando llama.cpp.
    let pinnedProfile: LlmMemoryProfile | null = null;
    if (!explicitCtx && snapshot) {
      const ladderCeiling = nCtx;
      const plan = planContext(specBase, snapshot, { ceiling: ladderCeiling, safety: crashSafety });
      if (plan) {
        nCtx = plan.nCtx;
        verdict = plan.verdict;
        contextNote = plan.note;
      }
      if (plan && plan.nCtx === EMERGENCY_CONTEXT) {
        const q8Plan: LadderPlan | null = planContext(
          { ...specBase, kvBytesPerElement: KV_Q8_BYTES_PER_ELEMENT },
          snapshot,
          // 0.1.86: the second call keeps the ceiling the ladder plan
          // was judged under (ladderCeiling), not the emergency
          // nCtx (1024) the fp16 plan landed on — inside planContext
          // the emergency rung only exists below the ceiling, so
          // handing it 1024 judged the q8 plan of the emergency rung
          // against the NORMAL budget and could reject a load the
          // design accepts (census §4.1 C).
          { ceiling: ladderCeiling, safety: crashSafety },
        );
        if (q8Plan && q8Plan.verdict.fits) {
          nCtx = q8Plan.nCtx;
          verdict = q8Plan.verdict;
          contextNote = q8Plan.note;
          pinnedProfile = "kv-q8";
        }
      }
    }
    if (verdict && !verdict.fits) {
      // Fase 2 (reapertura del defecto, 2026-11-08): el rechazo queda
      // registrado con sus cifras antes de lanzar. Hasta aquí no
      // dejaba rastro y el único diagnóstico posible era modelar el
      // aparato; con el registro, la propia app dice qué vio.
      recordRamRejection({
        modelId: modelFilename,
        totalRamBytes: snapshot!.totalRamBytes,
        rssBytes: snapshot!.rssBytes,
        availBytes: snapshot!.availBytes ?? null,
        thresholdBytes: snapshot!.lowMemThresholdBytes ?? null,
        availableBytes: verdict.availableBytes,
        neededBytes: verdict.totalBytes,
        nCtxChosen: nCtx,
        nCtxRequested: requestedCtx,
        crashSafety: crashSafety < 1 ? crashSafety : null,
        readFailure: snapshot!.liveReadMissing ? "live" : null,
      });
      throw new RamBudgetError(
        `"${modelFilename}" needs roughly ${toGb(verdict.totalBytes)}GB of RAM, but this ` +
          `device only has about ${toGb(verdict.availableBytes)}GB free (of ${toGb(verdict.totalRamBytes)}GB total). ` +
          `Try a smaller model from Settings > Tone & Model.` +
          (contextNote ? ` (${contextNote})` : ""),
        verdict.totalBytes,
        verdict.availableBytes,
        verdict.totalRamBytes,
        nCtx < requestedCtx ? requestedCtx : null,
        nCtx < requestedCtx ? nCtx : null,
        crashSafety < 1 ? crashSafety : null,
      );
    }

    // Segundo atajo tras planificar: el modelo ya cargado puede estar
    // justo en el peldaño elegido aunque el techo pedido sea otro
    // (cargó degradado en un arranque justo de RAM); recargarlo al
    // mismo contexto efectivo sería el coste que el primer atajo evita.
    if (
      this.context &&
      this.modelInfo?.filename === modelFilename &&
      this.modelInfo.nCtx === nCtx &&
      this.modelInfo.nThreads === nThreads
    ) {
      return;
    }

    // Release any previously loaded model (e.g. actually switching models
    // from Settings) so we don't leak the old context's native memory.
    await this.unloadNow();

    // CrashGuard: el intento queda persistido ANTES de crear el
    // contexto — si el proceso muere dentro de initLlama (la muerte
    // por memoria no deja traza en JS), el siguiente arranque lo
    // cuenta. Se confirma en la primera generación que termina bien.
    await this.crashGuardMarkPending(modelFilename, nCtx);

    // VEL-5 (0.1.110, actos 2 y 3): la puerta de aceleración se
    // juzga por carga, con la lista real de dispositivos de ESTA
    // carga y la foto de presión de ESTA carga (accelGate.ts). La
    // elección entera la juzga pickAccelDevice: la GPU automática
    // del acto 2, y con la opción de NPU encendida (acto 3,
    // experimental y apagada por defecto) el HTP cuando el modelo
    // declara un formato que el HTP descarga de verdad — con
    // Q4_K_M ni se intenta, se sabe por el dato del catálogo antes
    // de cargar. La elección nace saneada: se re-resuelve contra la
    // lista recién leída, así que un dispositivo que ya no está cae
    // a CPU en silencio. Sin plan fijado de emergencia — ese plan
    // cobró una KV concreta y la acelerada no es ella — y sin
    // presupuesto de capas no hay pick: la cascada es la CPU de
    // siempre, sin tocar.
    let accelPick: AccelInitPick | null = null;
    if (!pinnedProfile) {
      const devices = await this.probeBackendDevicesForGate();
      const gate = evaluateAccelGate(devices, pressure);
      const candidate = pickAccelDevice(gate, devices, {
        npuEnabled: isFeatureEnabled("inference.npuAccel"),
        npuQuantOk: htpAcceleratesQuant(catalogEntry?.quant),
        // 0.1.111 (auditoría §7b.4): la GPU también se condiciona por
        // formato, como el NPU desde el acto 3 — OpenCL solo
        // descarga de verdad los formatos de OPENCL_ACCELERATED_QUANTS.
        gpuQuantOk: openClAcceleratesQuant(catalogEntry?.quant),
      });
      if (candidate) {
        const layers = accelLayerBudget({ ...specBase, nCtx }, snapshot);
        if (layers > 0) accelPick = { device: candidate, nGpuLayers: layers };
      }
    }

    try {
      // RAM-2026-10-11: primer perfil que llama.cpp acepte (ver
      // LLM_MEMORY_PROFILES). El último es exactamente la llamada original.
      // Si el plan fijó kv-q8 (solo cupo en el peldaño de emergencia con
      // su KV), la lista es ese perfil solo: cargar con otro sería
      // gastar una KV que el pre-flight no aprobó. Con pick acelerado
      // la lista es la cascada entera («accel» al frente y la CPU
      // detrás, intacta); sin pick, solo la CPU de siempre.
      const profilesToTry = pinnedProfile
        ? [pinnedProfile]
        : accelPick
          ? LLM_MEMORY_PROFILES
          : LLM_CPU_MEMORY_PROFILES;
      let lastErr: unknown = null;
      let firstErr: unknown = null;
      let loadedProfile: LlmMemoryProfile | null = null;
      // 0.1.121: la duración de la carga (de todos los intentos de la
      // cascada hasta el que cargó), para la prueba de velocidad.
      const loadStartedAt = Date.now();
      for (const profile of profilesToTry) {
        try {
          this.context = await withStage("initLlama", () =>
            initLlama(
              llmInitParamsForProfile(
                profile,
                { model: modelPath, n_ctx: nCtx, n_threads: nThreads, state_cache_budget_mb: stateCacheMb },
                loadBatch,
                profile === "accel" && accelPick ? accelPick : undefined,
              ) as never,
            )
          );
          loadedProfile = profile;
          break;
        } catch (e) {
          if (firstErr === null) firstErr = e;
          lastErr = e;
          // m-73: un error que nombra el fichero/formato aborta la
          // cascada — los demás perfiles parsearían el mismo fichero.
          if (isModelFileFatalError(e)) break;
        }
      }
      if (!loadedProfile) {
        // m-73: el error que sale conserva la causa del PRIMER perfil
        // además de la del último — hasta la 0.1.98 solo sobrevivía la
        // última y la primera (a menudo la informativa) se perdía.
        throw firstErr !== null && firstErr !== lastErr
          ? new Error(
              `${(lastErr as { message?: string })?.message ?? String(lastErr)} ` +
                `(primer intento, perfil ${profilesToTry[0]}: ${(firstErr as { message?: string })?.message ?? String(firstErr)})`,
            )
          : lastErr;
      }
      // 0.1.122: contexto recién creado: aún no ha visto nada del usuario.
      this.freshContext = this.context;
      this.loadSampling = loadTimeSampling(
        (this.context as unknown as { model?: { metadata?: Record<string, unknown> } } | null)?.model?.metadata,
      );
      this.modelInfo = {
        filename: modelFilename,
        nCtx,
        nThreads,
        memoryProfile: loadedProfile,
        ...(loadedProfile === "accel" && accelPick ? { accelDevice: accelPick.device } : {}),
        ...(contextNote ? { contextNote } : {}),
        noThink: catalogEntry?.capabilities?.noThink,
        sampling: catalogEntry?.capabilities?.sampling,
        stripReasoning: catalogEntry?.capabilities?.stripReasoning,
        loadMs: Date.now() - loadStartedAt,
      };
    } catch (e: any) {
      // The native error here (from llama.rn/llama.cpp) is often terse
      // ("Failed to initialize context" with no further detail) — append
      // our own RAM estimate so the user (and future debugging) has an
      // actual hypothesis instead of a dead end, per diagnostics above.
      const nativeMessage = e?.message ?? String(e);
      const hint = verdict
        ? ` (this device has ~${toGb(verdict.totalRamBytes)}GB RAM, ~${toGb(verdict.availableBytes)}GB free; ` +
          `"${modelFilename}" needs roughly ${toGb(verdict.totalBytes)}GB — likely the cause if those are close)`
        : "";
      throw new Error(`Failed to load "${modelFilename}": ${nativeMessage}${hint}`);
    }
  }

  unload(): Promise<void> {
    return this.enqueue(() => this.unloadNow());
  }

  private async unloadNow() {
    // Justicia del conteo (0.1.85): la confirmación del CrashGuard de
    // abajo solo procede si esta descarga libera un modelo VIVO. Se
    // captura a la entrada, antes de esperar a las generaciones y de
    // anular el contexto. loadNow llama a unloadNow SIEMPRE, también
    // sin modelo residente y justo después de asentar el registro:
    // confirmar ahí borraría en la misma carga el conteo que el
    // asentamiento acaba de hacer (el pendiente de un proceso muerto
    // sumaría su choque y se perdonaría al instante, y un factor ya
    // degradado se curaría sin generar nada). Sin contexto vivo no
    // hay descarga que premiar: no se confirma nada.
    const hadLiveContext = this.context !== null;
    // M-6 (2026-10-31): invalidar primero a las generaciones que
    // esperan turno en la cadena; la descarga espera solo a las
    // que ya corren (inFlight), como siempre.
    this.generationEpoch++;
    // Stop takes effect between tokens, so a completion still processing its
    // prompt can run on for a while; wait for all rather than release under
    // them. F3-2026-10-06: espera al conjunto completo, no solo a la última.
    if (this.inFlight.size > 0) {
      // FIX-2026-10-07 (llama.rn rc.6): `stopCompletion()` ahora retorna
      // `undefined` en vez de una promesa (cambio de comportamiento en rc.6,
      // confirmado por el proyecto original). El `.catch()` directo crashearía con TypeError.
      // Se envuelve en Promise.resolve() para manejar ambos casos.
      await Promise.resolve(this.context?.stopCompletion()).catch(() => {});
      await Promise.allSettled([...this.inFlight]);
    }
    const context = this.context;
    this.context = null;
    this.modelInfo = null;
    this.loadSampling = { ...LLAMA_CPP_SAMPLING_DEFAULTS, declared: {} };
    await context?.release();
    // Justicia del conteo (0.1.85): la descarga ORDENADA confirma el
    // registro del CrashGuard, como el encabezado de memoryLadder.ts
    // siempre prometió («una carga que se confirma — el modelo
    // genera, o se descarga con orden — limpia el contador»). Hasta
    // aquí unloadNow no confirmaba y una recarga posterior asentaba
    // el pendiente sin modelo vivo: descargar y recargar por las
    // buenas (inactividad, presión de memoria, cambio de modelo)
    // castigaba como si hubiera habido un choque. unloadNow solo se
    // alcanza por caminos ordenados del proceso vivo (la cola de
    // carga, el pulso de inactividad, la presión del sistema, el
    // borrado total y el propio loadNow al cambiar de modelo): una
    // muerte nativa mata el proceso y nunca pasa por aquí, así que
    // su pendiente sigue contando en el siguiente asentamiento, como
    // está diseñado. La confirmación va AL FINAL: si el proceso
    // muere a mitad de la descarga, no se escribe y el pendiente
    // cuenta — la dirección segura. Y solo con contexto vivo a la
    // entrada (hadLiveContext): la llamada interna de loadNow sin
    // modelo residente no confirma nada, por lo asentado arriba.
    if (hadLiveContext) {
      this.crashGuardConfirm();
    }
  }

  getModelInfo(): LoadedModelInfo | null {
    return this.modelInfo;
  }

  get isLoaded(): boolean {
    return this.context !== null;
  }

  /**
   * VEL-5 (0.1.110, acto 3): mide el contexto residente con bench()
   * del upstream, en la forma de modelBench.ts (las dos
   * configuraciones prefijadas, pico de memoria muestreado a 1 s y
   * la foto de la carga pegada al resultado). Mide LO QUE HAY: el
   * modelo cargado tal como la conversación lo cargó, en el
   * dispositivo que ejecutó esa carga — por eso es la pieza que
   * podrá cobrar la ganancia del acelerador donde exista hardware
   * capaz, y por eso en un aparato sin puerta abierta mide la CPU
   * de siempre y la llama CPU. Sin contexto residente devuelve
   * null: no se inventa una medición sin modelo.
   *
   * Va por la cola del motor: bench() corre sobre el mismo
   * contexto que las generaciones, y un contexto de llama.cpp no
   * admite una medición y una generación a la vez.
   *
   * Tanda too-heavy (0.1.115): la medición tiene plazo propio
   * (BENCH_TIMEOUT_MS) cobrado DOS veces. Dentro de la tarea, la
   * carrera contra el plazo libera el hueco de la cola aunque el
   * bench nativo no se asiente nunca, y el resultado tardío que el
   * nativo entregue después se descarta (la carrera ya se asentó:
   * nadie lo lee como informe fresco). Fuera, la promesa que se
   * devuelve corre la misma carrera, para que ni siquiera una tarea
   * que nunca empieza (la cola ocupada por otra que no se asienta)
   * deje al llamante esperando. Y el contexto sin bench() ya no
   * devuelve el null del «sin modelo»: rechaza con
   * BenchUnavailableError, que es otro hecho y tiene otro mensaje.
   */
  benchLoadedModel(timeoutMs: number = BENCH_TIMEOUT_MS): Promise<ModelBenchReport | null> {
    const work = this.enqueue(() => this.runBenchMeasurement(timeoutMs));
    return new Promise<ModelBenchReport | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new BenchTimeoutError(timeoutMs)), timeoutMs);
      work.then(
        (report) => {
          clearTimeout(timer);
          resolve(report);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private async runBenchMeasurement(timeoutMs: number): Promise<ModelBenchReport | null> {
    const context = this.context;
    const info = this.modelInfo;
    if (!context || !info) return null;
    const bench = (context as unknown as { bench?: unknown }).bench;
    if (typeof bench !== "function") throw new BenchUnavailableError();
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let peakRssBytes: number | null = null;
    const sample = () => {
      const rss = readRamSnapshot()?.rssBytes;
      if (typeof rss === "number" && (peakRssBytes === null || rss > peakRssBytes)) {
        peakRssBytes = rss;
      }
    };
    sample();
    // El muestreo se apaga solo al vencer el plazo: si el bench
    // nativo no se asienta nunca, el intervalo no queda corriendo
    // detrás de una medición ya rendida por timeout.
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        return;
      }
      sample();
    }, 1000);
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const run = (async (): Promise<ModelBenchReport> => {
        // 0.1.121: cada repetición es su propia llamada (nr = 1): el
        // mismo trabajo que nr repeticiones agregadas en el nativo, pero
        // con cada velocidad a la vista para dar media y rango.
        const raw: RawBenchResult[][] = [];
        for (const cfg of BENCH_CONFIGS) {
          const reps: RawBenchResult[] = [];
          for (let r = 0; r < cfg.nr; r++) {
            reps.push(
              await (bench as (pp: number, tg: number, pl: number, nr: number) => Promise<RawBenchResult>).call(
                context,
                cfg.pp,
                cfg.tg,
                cfg.pl,
                1,
              ),
            );
          }
          raw.push(reps);
        }
        sample();
        return buildBenchReport({
          photo: info,
          raw,
          peakRssBytes,
          wallMs: Date.now() - startedAt,
        });
      })();
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutTimer = setTimeout(() => reject(new BenchTimeoutError(timeoutMs)), timeoutMs);
      });
      return await Promise.race([run, timeout]);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      clearInterval(timer);
    }
  }

  /**
   * Whether the loaded GGUF ships its own chat template (tokenizer.chat_template
   * metadata) that llama.cpp can parse as Jinja — i.e. whether generate({ messages })
   * will be formatted in the model's own instruction format.
   */
  hasEmbeddedChatTemplate(): boolean {
    // P-33 (auditoría 2026-11-13, F2-p3): en builds donde el contexto no
    // expone isJinjaSupported, llamarlo reventaba con TypeError — la
    // guarda `?.` solo cubría el contexto nulo. Misma guarda de tipo que
    // recentExitsInfo usa para getCrashReport: ausencia = «sin Jinja».
    try {
      const fn = (this.context as unknown as { isJinjaSupported?: unknown } | null)?.isJinjaSupported;
      return typeof fn === "function" ? (fn as () => boolean).call(this.context) : false;
    } catch {
      return false;
    }
  }

  /**
   * m-79 (F2-m8): recrea el contexto del modelo residente tras una
   * completion fallida. Descarga ordenada + la misma carga con los
   * mismos parámetros (contexto y hilos del modelo en uso). Efectos
   * declarados de reutilizar unloadNow/loadNow: la época de
   * generación avanza (las generaciones encoladas fallan con «model
   * not loaded» en vez de correr sobre un contexto que no es el que
   * esperaban) y la descarga confirma el CrashGuard como cualquier
   * descarga ordenada — el fallo fue de la completion, con el proceso
   * vivo, no una muerte de la carga. Si la recarga falla, su error es
   * la verdad actual y es el que ve el llamante.
   */
  private async recreateContext(): Promise<void> {
    const info = this.modelInfo;
    if (!info || !this.context) {
      this.contextSuspect = false;
      return;
    }
    await this.unloadNow();
    await this.loadNow(info.filename, { nCtx: info.nCtx, nThreads: info.nThreads });
    this.contextSuspect = false;
  }

  /**
   * Auditoría completa 2026-10-31 (M-6): cadena de generaciones. El
   * contexto de llama.cpp es UNO y su caché KV también: dos
   * generate() a la vez arrancaban dos completions sobre el mismo
   * contexto y los tokens podían contaminarse entre respuestas;
   * la disciplina quedaba delegada a cada llamante. Ahora el motor
   * serializa: cada generate() espera a que el anterior se asiente
   * antes de arrancar el suyo.
   *
   * La cadena NO es la cola de carga (enqueue): esa sigue libre
   * para que un unload() pueda ejecutar su unloadNow() y detener
   * la generación en vuelo (la razón de F3-2026-10-06). Una
   * generación encolada tras un unload arranca contra un contexto
   * ya liberado y falla con «model not loaded», sin colgarse.
   */
  private generationChain: Promise<unknown> = Promise.resolve();
  /**
   * Época de generación: unloadNow la avanza. Solo la consultan las
   * generaciones que ESPERAN turno en la cadena: si la época cambió
   * mientras esperaban, su contexto ya no existe y fallan con
   * «model not loaded» en vez de arrancar sobre lo que haya venido
   * después. La descarga no espera a las encoladas: las invalida.
   */
  private generationEpoch = 0;
  /** Generaciones en la cadena (corriendo o esperando), contadas al llamar. */
  private generationsInLine = 0;

  async generate(options: GenerateOptions): Promise<string> {
    // P-15 (auditoría 2026-11-13, B-p1): la cola tenía ni cota ni
    // plazo — un llamante desbocado (un bucle de reintentos, un agente
    // atascado) podía encolar generaciones para siempre, cada una con
    // su prompt en memoria y su promesa sin asentar. La cota es dura y
    // el rechazo es inmediato: los llamantes reales son secuenciales
    // (la propia cadena los serializa), así que 8 en línea ya es un
    // síntoma, no un uso. El plazo de espera va en la rama encolada.
    if (this.generationsInLine >= MAX_GENERATIONS_IN_LINE) {
      throw new Error(
        `LlamaEngine: demasiadas generaciones en línea (${this.generationsInLine}); la petición se rechaza sin encolar`,
      );
    }
    // M1 (crash nativo): la puerta se toma al llamar, de forma
    // síncrona y sin esperar a nadie — el indexado de fondo consulta
    // la puerta por chunk y cede en cuanto ve una generación en
    // vuelo o encolada. Se suelta en el finally, asentada la
    // generación; el contador de la puerta refleja generationsInLine.
    nativeGateBegin();
    // M2 (crash nativo): el registro de sesión se sobrescribe al
    // empezar, con la bandera de «generación en vuelo» puesta; es un
    // disparo sin espera fuera del camino de tokens.
    this.nativeSessionMarkStart();
    const isHead = this.generationsInLine === 0;
    this.generationsInLine++;
    const epoch = this.generationEpoch;
    const enqueuedAt = Date.now();
    // La cabeza llama directamente: su cuerpo corre síncrono hasta
    // encolar el arranque en la cola de carga, en el mismo orden de
    // llamada de siempre (un unload() posterior queda detrás de su
    // arranque y la detiene como antes). Las demás esperan a la
    // cadena y comprueban la época al llegar su turno.
    const run = isHead
      ? this.generateOnce(options)
      : this.generationChain.then(() => {
          // P-15: el plazo de ESPERA manda sobre una generación que aún
          // no arrancó — su contexto puede haber cambiado o el llamante
          // ya no necesitarla. Una vez arrancada manda su timeoutMs.
          if (Date.now() - enqueuedAt > MAX_GENERATION_WAIT_MS) {
            throw new Error(
              "LlamaEngine: la generación esperó demasiado en la cola y su plazo venció sin arrancar",
            );
          }
          if (epoch !== this.generationEpoch) {
            throw new Error("LlamaEngine: model not loaded");
          }
          return this.generateOnce(options);
        });
    this.generationChain = run.catch(() => {});
    try {
      const text = await run;
      // CrashGuard: la carga que genera queda confirmada.
      this.crashGuardConfirm();
      // 0.1.122: y queda anotada como probada en este aparato (solo informa).
      void this.recordProvenLoadNow();
      return text;
    } finally {
      this.generationsInLine--;
      // M2: la bandera del registro cae solo cuando la ÚLTIMA
      // generación en línea se asienta (una encolada ya escribió su
      // propio registro con la bandera puesta).
      if (this.generationsInLine === 0) this.nativeSessionMarkEnd();
      nativeGateEnd();
    }
  }

  /**
   * F3-2026-10-06: generate() está serializado respecto a load()/unload()
   * durante el *arranque* de la completion (la cola garantiza que no se
   * interleavea con un unload). La espera de la completion ocurre FUERA de
   * la cola: si generate() retuviera la cola mientras espera, un load()
   * posterior (encolado detrás) nunca podría ejecutar su unloadNow() para
   * detener la generación → deadlock. unloadNow() detiene y espera todas
   * las completions en vuelo vía el conjunto inFlight.
   * M-6 (2026-10-31): respecto a OTROS generate(), la serialización
   * la da generationChain (ver generate): nunca hay dos completions
   * vivas a la vez sobre el contexto.
   */
  private async generateOnce({
    prompt,
    messages,
    nPredict = 512,
    temperature,
    topK,
    topP,
    minP,
    repeatPenalty,
    samplingPreset,
    responseFormat,
    grammar,
    enableThinking,
    onToken,
    stop,
    timeoutMs,
    onTimeout,
    signal,
    seed,
    telemetryContext,
    publicPrefix,
  }: GenerateOptions): Promise<string> {
    // P2.4: telemetry measurement. All local, fire-and-forget, never throws.
    const tStart = Date.now();
    // M-39 (auditoría 2026-11-13, F2-M4): los veredictos de corte se
    // reinician al arrancar. Hasta la 0.1.98 lastCut solo se asignaba
    // en la rama de éxito: tras un error, el lector (ChatScreen) veía
    // el veredicto de la generación ANTERIOR como si fuera de esta.
    this.lastCut = false;
    this.lastLoopCut = false;
    // Foto del contador de paradas: si stop() se pide durante ESTA
    // generación, su texto se recorta aunque el nativo diga interrupted.
    const stopsAtStart = this.stopCounter;
    // T-10 (0.1.99, M-20): la señal del llamador para la generación
    // como un stop() del usuario (mismo contador, mismo recorte a
    // frase completa al asentarse). El listener se retira en el
    // finally exterior; una señal ya abortada antes de arrancar la
    // completion la trata startCompletion, que es quien la crea.
    let detachAbort: (() => void) | null = null;
    if (signal) {
      const onAbort = () => {
        void this.stop().catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
      detachAbort = () => signal.removeEventListener("abort", onAbort);
    }
    let firstTokenAt: number | null = null;
    let tokenCount = 0;
    let timedOut = false;
    // 0.1.34: guarda de bucle. Si el modelo repite el mismo trozo una y
    // otra vez («las aluminosas, las aluminosas…», visto en la Tab A9+),
    // se corta la generación (ahorra batería) y el texto final queda en
    // la primera aparición.
    // guardLoops gobierna el RECORTE del texto asentado: la salida
    // estructurada (JSON/gramática) nunca se recorta, para no tocar un
    // formato que se va a parsear. La detección y el corte de la
    // generación sí corren en todos los modos (m-26, T-10, 0.1.99).
    const guardLoops = responseFormat === undefined && grammar === undefined;
    let streamed = "";
    let loopCut = false;
    // M4 (crash nativo): la parada por bucle ya NO se pide con
    // stopCompletion() desde dentro del callback de token — esa
    // llamada es reentrante: toca la maquinaria nativa de la
    // completion mientras su propio callback está en la pila, y es
    // uno de los tres gatillos sospechosos del diagnóstico. La
    // guarda solo marca y programa la parada para el siguiente
    // macrotask, entre tokens y con la generación aún en vuelo.
    // El comportamiento observable no cambia: onToken deja de
    // reenviar en cuanto loopCut se marca (abajo) y el texto final
    // se recorta con trimRepetitionLoop igual que antes; lo único
    // que se mueve es QUIÉN y DESDE DÓNDE se llama a stopCompletion.
    let loopStopScheduled = false;
    // Se pone a true cuando esta generación se asienta: una parada
    // programada que dispare tarde no debe tocar la completion de
    // OTRA generación posterior sobre el mismo contexto.
    let generationSettled = false;
    const watchLoop = (piece: string) => {
      // m-26 (T-10, 0.1.99): la detección también vigila en modo
      // structured — un bucle ahí quemaba la generación entera sin que
      // nadie lo cortara (batería y un turno colgado hasta el timeout).
      // Lo que sigue reservado a la prosa es el recorte del texto
      // asentado (trimRepetitionLoop/trimToCompleteSentences, abajo).
      streamed += piece;
      if (loopCut || tokenCount % 8 !== 0) return;
      if (findRepetitionLoop(streamed)) {
        loopCut = true;
        if (!loopStopScheduled) {
          loopStopScheduled = true;
          setTimeout(() => {
            if (generationSettled) return;
            // Envuelto como en unloadNow: stopCompletion cambió su
            // retorno entre RCs (FIX-2026-10-07); Promise.resolve
            // admite promesa o undefined.
            void Promise.resolve(this.context?.stopCompletion()).catch(() => {});
          }, 0);
        }
      }
    };
    const wrappedOnToken = onToken
      ? (piece: string) => {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          tokenCount += 1;
          watchLoop(piece);
          if (!loopCut) onToken(piece);
        }
      : (piece: string) => {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          tokenCount += 1;
          watchLoop(piece);
        };
    const wrappedOnTimeout = () => {
      timedOut = true;
      onTimeout?.();
    };
    const promptChars =
      prompt !== undefined
        ? prompt.length
        : (messages ?? []).reduce((n, m) => n + (m.content?.length ?? 0), 0);
    let stopReason: TelemetryStopReason = "completed";
    let nativeTimings: NativeTimings | null = null;
    this.lastNativeTimings = null;
    // 0.1.55: «NIDO está respondiendo…» mientras dure la generación, para que
    // Android no cierre la app si el usuario sale (answerKeepAlive). Solo
    // para respuestas que se ven escribirse (onToken), no para trabajos
    // internos cortos. Se carga aparte: si el módulo nativo no está, la
    // generación sigue igual.
    let releaseKeepAlive: (() => void) | null = null;
    let keepAliveDone = false;
    if (onToken) {
      void import("../services/answerKeepAlive")
        .then((m) => {
          if (keepAliveDone) return;
          releaseKeepAlive = m.holdAnswerKeepAlive();
        })
        .catch(() => {});
    }
    try {
      const started = await this.enqueue(async () => {
        // m-79 (F2-m8): si la completion anterior falló, el contexto
        // nativo quedó sospechoso — se recrea ANTES de generar en vez
        // de reutilizarlo a ciegas. Dentro de la cola de carga, como el
        // propio arranque: el orden con load/unload no cambia.
        if (this.contextSuspect) await this.recreateContext();
        return this.startCompletion({ prompt, messages, nPredict, temperature, topK, topP, minP, repeatPenalty, samplingPreset, responseFormat, grammar, enableThinking, onToken: wrappedOnToken, stop, timeoutMs, onTimeout: wrappedOnTimeout, signal, seed, publicPrefix });
      });
      try {
        let result: { text?: string };
        try {
          result = await started.completion;
        } catch (e) {
          // m-79: la completion falló a media generación; el estado
          // nativo (KV a medias, sampler tocado) ya no es de fiar.
          this.contextSuspect = true;
          throw e;
        }
        const { text } = result;
        nativeTimings = fromNativeTimings((result as { timings?: unknown }).timings);
        this.lastNativeTimings = nativeTimings;
        const settled = text ?? started.getFull();
        // m-78 (F2-m7): el recorte de bucle sobre el texto asentado
        // SOLO si la guarda marcó bucle durante ESTA generación. Hasta
        // la 0.1.98 se aplicaba siempre que el texto final «pareciera»
        // repetido al final — también cuando el modelo había terminado
        // solo (EOS) y ese texto era su respuesta íntegra: se le
        // quitaba un trozo y se le añadía un «…» que no escribió.
        this.lastLoopCut = loopCut;
        const raw = guardLoops && loopCut ? trimRepetitionLoop(settled) : settled;
        // Bounty tanda 8 (frase cortada): si la generación consumió
        // todo su presupuesto de tokens, el texto devuelto se cierra
        // en su última frase completa y el hecho queda registrado
        // para quien enseña el texto en vivo (ChatScreen), que aplica
        // la misma regla sobre lo transmitido. La salida estructurada
        // (guardLoops=false) jamás se recorta.
        // 0.1.92: el hecho lo dice el motor (stopped_limit /
        // context_full), no la cuenta de llamadas de onToken, que
        // llama.rn retiene en saltos de línea y UTF-8 a medias y se
        // quedaba corta justo cuando había tope (generationCut.ts).
        this.lastCut = generationHitLimit(result as NativeStopSignals, tokenCount, nPredict);
        // M-39 (F2-M4): generationHitLimit devuelve false SIEMPRE para
        // una parada interrupted (usuario, timeout) — su veredicto es
        // «¿se consumió el presupuesto?», no «¿se cortó?». Hasta la
        // 0.1.98 el texto asentado de esas paradas no pasaba por la
        // regla de la frase completa en el motor y un consumidor
        // directo de generate() recibía la frase a medias (ChatScreen
        // se salvaba recortando por su cuenta). La parada temprana
        // también es corte a efectos del recorte; lastCut conserva su
        // significado de tope para la nota de la pantalla.
        const stoppedEarly = timedOut || loopCut || this.stopCounter !== stopsAtStart;
        const completed = guardLoops ? trimToCompleteSentences(raw, this.lastCut || stoppedEarly) : raw;
        // Safety net (Qwen3 lane + estudio de modelos): for a noThink
        // model whose native layer ignored enable_thinking=false, and
        // for stripReasoning models (LFM2.5) whose chain-of-thought is
        // wanted for quality but must not be what history/memory keep
        // or parsers read, the final settled text never carries a raw
        // <think> block. Streamed tokens are NOT retroactively
        // changed — this only guarantees a clean settled result.
        if (this.modelInfo?.noThink || this.modelInfo?.stripReasoning) {
          const parsed = parseGemmaReasoning(completed);
          if (parsed.answer.trim().length > 0) return parsed.answer;
          // M-40 (F2-M5): red de vacío. Un <think> sin cerrar se traga
          // todo el texto (el patrón de gemmaReasoning lo trata como
          // razonamiento hasta el final) y la respuesta quedaba VACÍA
          // aunque el modelo sí hubiera escrito. Si lo único que hay
          // es el razonamiento, se sirve ese — recortado con la misma
          // regla de frase completa — en vez de un vacío que parece un
          // aparato roto. Si no hay ni eso, queda vacío como hasta hoy.
          if (parsed.reasoning && parsed.reasoning.trim().length > 0) {
            return guardLoops
              ? trimToCompleteSentences(parsed.reasoning, this.lastCut || stoppedEarly)
              : parsed.reasoning;
          }
          return parsed.answer;
        }
        return completed;
      } finally {
        // M4: desde aquí, la parada diferida de la guarda de
        // repetición ya no puede disparar contra este contexto.
        generationSettled = true;
        this.inFlight.delete(started.completion);
        if (started.timer) clearTimeout(started.timer);
      }
    } catch (e) {
      stopReason = "error";
      throw e;
    } finally {
      keepAliveDone = true;
      detachAbort?.();
      (releaseKeepAlive as (() => void) | null)?.();
      if (timedOut) stopReason = "timeout";
      else if (loopCut && stopReason === "completed") stopReason = "stopped";
      const totalMs = Date.now() - tStart;
      const ttftMs = firstTokenAt === null ? null : firstTokenAt - tStart;
      const genMs = totalMs - (ttftMs ?? 0);
      recordInferenceEvent({
        ts: tStart,
        modelId: this.modelInfo?.filename ?? null,
        taskType: telemetryContext?.taskType,
        promptChars,
        promptTokensEst: Math.ceil(promptChars / 3),
        completionTokens: tokenCount,
        ttftMs,
        totalMs,
        // 0.1.118: genMs empieza en el PRIMER token, así que en ese
        // tramo se generan tokenCount − 1 tokens. Dividir tokenCount
        // entero inflaba la tasa (≈3 % con 32 tokens, más en respuestas
        // cortas).
        // 0.1.121: manda la tasa del motor (cuenta tokens de verdad);
        // la de la app queda de respaldo si el nativo no la dio.
        tokensPerSec: writeRate(nativeTimings, genMs > 0 && tokenCount > 1 ? ((tokenCount - 1) / genMs) * 1000 : null),
        ...(nativeTimings ? { timings: nativeTimings } : {}),
        stopReason,
        samplingPreset,
        temperature,
        nPredict,
      });
    }
  }

  private async startCompletion({
    prompt,
    messages,
    nPredict = 512,
    temperature,
    topK,
    topP,
    minP,
    repeatPenalty,
    samplingPreset,
    responseFormat,
    grammar,
    enableThinking,
    onToken,
    stop,
    timeoutMs,
    onTimeout,
    signal,
    seed,
    publicPrefix,
  }: GenerateOptions): Promise<{ completion: Promise<{ text?: string }>; getFull: () => string; timer: ReturnType<typeof setTimeout> | null }> {
    if (!this.context) throw new Error("LlamaEngine: model not loaded");
    if (!prompt && !messages) {
      throw new Error("LlamaEngine.generate: either prompt or messages must be provided");
    }
    // m-74 (auditoría 2026-11-13, F2-m3): lo que el llamante pide se
    // valida ANTES de tocar el nativo. nPredict debe ser un entero
    // positivo — un 0, un negativo o un 2.5 llegaban tal cual a
    // llama.cpp. Y el prompt se estima contra el nCtx cargado con el
    // estimador de la casa (contextBudget.estimateTokens): si el
    // prompt SOLO ya no cabe, la generación moriría a media ingesta
    // con context_full; aquí se rechaza con la cuenta a la vista. No
    // se recorta ni se clampea nada: rechazar es la respuesta honesta.
    if (!Number.isInteger(nPredict) || nPredict <= 0) {
      throw new Error(`LlamaEngine.generate: nPredict debe ser un entero positivo (llegó ${nPredict})`);
    }
    const nCtx = this.modelInfo?.nCtx;
    if (nCtx) {
      const promptText = prompt ?? (messages ?? []).map((m) => m.content ?? "").join("\n");
      const promptTokens = estimateTokens(promptText);
      if (promptTokens >= nCtx) {
        throw new Error(
          `LlamaEngine.generate: el prompt solo (~${promptTokens} tokens estimados) no cabe en el contexto de ${nCtx}; acorta el texto o sube el contexto del modelo`,
        );
      }
    }

    // 0.1.122: caché del prompt en disco (solo texto público), antes de
    // armar el temporizador: su lectura o su guardado no gastan el plazo
    // de la respuesta.
    if (messages && publicPrefix) {
      await this.applyPromptDiskCache(messages, publicPrefix, enableThinking ?? (this.modelInfo?.noThink ? false : undefined), signal);
    } else {
      this.freshContext = null;
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          onTimeout?.();
          // m-76 (F2-m5): con la misma envoltura defensiva que los
          // demás sitios — stopCompletion cambió su retorno entre RCs
          // y un fallo suyo dentro del temporizador quedaba sin atrapar.
          void Promise.resolve(this.context?.stopCompletion()).catch(() => {});
        }, timeoutMs)
      : null;

    // P1.1/P1.2: preset fills unset sampling values; explicit values win.
    // Only defined values are added to the params so callers that don't
    // use the new options get exactly the same native call as before.
    const sampling = resolveSampling({
      temperature,
      topK,
      topP,
      minP,
      repeatPenalty,
      samplingPreset,
      modelDefaults: this.modelInfo?.sampling,
      // M-36: lo que el GGUF cargado declara de sí mismo va entre el
      // preset y el catálogo (ver resolveSampling).
      fileDefaults: this.loadSampling.declared,
    });
    // Los cuatro viajan siempre (ver loadTimeSampling): sin fijar = lo de
    // la carga, nunca lo que dejó la respuesta anterior en el contexto.
    const extraParams: Record<string, unknown> = {
      top_k: sampling.topK ?? this.loadSampling.topK,
      top_p: sampling.topP ?? this.loadSampling.topP,
      min_p: sampling.minP ?? this.loadSampling.minP,
      penalty_repeat: sampling.repeatPenalty ?? this.loadSampling.repeatPenalty,
    };
    if (responseFormat !== undefined) extraParams.response_format = responseFormat;
    if (grammar !== undefined) extraParams.grammar = grammar;
    // T-10 (0.1.99, m-31): semilla — la explícita manda; sin ella, los
    // presets reproducibles (structured/factual) fijan la constante y
    // chat no manda clave (llamada nativa como hasta la 0.1.98).
    // llama.rn la acepta en los params de completion (rc.11).
    const effectiveSeed = seed ?? (samplingPreset === "structured" || samplingPreset === "factual" ? DETERMINISTIC_SEED : undefined);
    if (effectiveSeed !== undefined) extraParams.seed = effectiveSeed;

    // messages+jinja lets llama.cpp apply the loaded GGUF's own embedded
    // chat_template — DEFAULT_STOP_SEQUENCES exist specifically because
    // this app's hand-built "Question:/Answer:" prompt shape gives the
    // model no other signal for where a turn ends (see that constant's own
    // doc comment); a real chat template already has its own proper
    // end-of-turn token the model was fine-tuned to emit, so forcing our
    // unrelated string-based stops on top of it would be either inert or
    // could truncate genuine content that happens to contain "User:"/
    // "Question:". Only applied when the caller passes explicit `stop`.
    // Qwen3 lane: the thinking switch only exists on the jinja path.
    // Explicit option wins; unset falls back to the loaded model's
    // catalog flag (noThink → false); models without the flag never
    // see the param (byte-identical legacy native call).
    const thinkingParam = enableThinking ?? (this.modelInfo?.noThink ? false : undefined);
    const nKeep = await this.systemKeepTokens(messages);
    if (nKeep !== undefined) extraParams.n_keep = nKeep;
    const completionParams = messages
      ? {
          messages,
          jinja: true,
          n_predict: nPredict,
          temperature: sampling.temperature,
          // P-34 (F2-p4): la ruta messages nacía con stop: [] — si la
          // plantilla del modelo no produce su token de fin, la
          // generación no tenía NINGUNA parada de texto y seguía hasta
          // agotar el presupuesto inventando turnos. La red es la
          // misma de la ruta prompt (marcadores anclados a salto de
          // línea); el token de fin de la plantilla sigue siendo la
          // parada primaria, porque llama.rn lo aplica siempre.
          stop: stop ?? DEFAULT_STOP_SEQUENCES,
          ...extraParams,
          ...(thinkingParam !== undefined ? { enable_thinking: thinkingParam } : {}),
        }
      : { prompt: prompt!, n_predict: nPredict, temperature: sampling.temperature, stop: stop ?? DEFAULT_STOP_SEQUENCES, ...extraParams };

    let full = "";
    const completion = this.context.completion(completionParams, (data) => {
      full += data.token;
      onToken?.(data.token);
    });
    // T-10 (0.1.99, M-20): si la señal ya venía abortada (o abortó
    // mientras la generación esperaba su turno en la cola), la parada
    // se pide ahora que la completion existe: antes de este punto no
    // había nada que parar.
    if (signal?.aborted) {
      void this.stop().catch(() => {});
    }
    this.inFlight.add(completion);
    return { completion, getFull: () => full, timer };
  }

  /**
   * Signals the native completion loop to stop. The in-flight generate()
   * call's completion() promise resolves normally with whatever text was
   * generated so far — this is llama.cpp's own clean-stop behavior, not an
   * error/abort path, so no try/catch needed around a stopped generate().
   */
  async stop(): Promise<void> {
    // M-39: la parada queda contada — generateOnce la lee al asentarse
    // para aplicar la regla de la frase completa a esta generación.
    this.stopCounter++;
    // m-76 (F2-m5): con la envoltura defensiva que el propio fichero
    // exige en los demás sitios (unloadNow, la guarda de bucle): un
    // stopCompletion que lanza o rechaza no debe tumbar al llamante,
    // que solo quería parar.
    await Promise.resolve(this.context?.stopCompletion()).catch(() => {});
  }
}

export const llamaEngine = new LlamaEngine();

/**
 * 0.1.121: margen de tokens sobre el prompt del sistema para n_keep: la
 * plantilla de chat envuelve el texto con sus marcas (p. ej.
 * «<|im_start|>system\n» … «<|im_end|>»). Guardar unos tokens de más solo
 * conserva el principio del primer mensaje; guardar de menos cortaría el
 * final del prompt de seguridad.
 */
export const N_KEEP_TEMPLATE_MARGIN = 16;

/** n_keep para un prompt del sistema de `tokens` tokens; nunca más de n_ctx − 4. */
export function keepTokensFor(tokens: number, nCtx: number | undefined): number {
  const want = Math.max(0, Math.floor(tokens)) + N_KEEP_TEMPLATE_MARGIN;
  if (!nCtx || nCtx <= 4) return want;
  return Math.min(want, nCtx - 4);
}
