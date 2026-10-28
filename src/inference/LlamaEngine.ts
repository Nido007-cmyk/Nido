/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import * as FileSystem from "expo-file-system/legacy";
import { initLlama, LlamaContext, type CompletionResponseFormat } from "llama.rn";
import { checkRamBudget, readRamSnapshot, toGb } from "./ramBudget";
import { assertTrustedModelFileByName } from "../models/modelTrust";
import { MODEL_CATALOG, type CatalogModel } from "../models/manifest";
import { withStage } from "../utils/stageError";
import { recordInferenceEvent, type TelemetryStopReason } from "./telemetry";
import { findRepetitionLoop, trimRepetitionLoop } from "./repetitionGuard";
import { parseGemmaReasoning } from "./gemmaReasoning";
import type { ModelSamplingDefaults } from "../routing/types";

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
   * exist on NativeCompletionParams). Unset = native defaults — callers
   * that don't set these get byte-identical behavior to before.
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
 * → the loaded model's manufacturer defaults (ModelCapabilities.
 * sampling, estudio de modelos 2026-10-12) → built-in defaults. The
 * model layer exists because presets never set topK/topP: without it,
 * every manufacturer's published recipe was silently dropped.
 */
export function resolveSampling(opts: {
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  samplingPreset?: SamplingPresetName;
  modelDefaults?: ModelSamplingDefaults;
}): { temperature: number; topK?: number; topP?: number; minP?: number; repeatPenalty?: number } {
  const preset = opts.samplingPreset ? SAMPLING_PRESETS[opts.samplingPreset] : undefined;
  const model = opts.modelDefaults;
  return {
    temperature: opts.temperature ?? preset?.temperature ?? model?.temperature ?? 0.7,
    topK: opts.topK ?? model?.topK,
    topP: opts.topP ?? model?.topP,
    minP: opts.minP ?? preset?.minP,
    repeatPenalty: opts.repeatPenalty ?? preset?.repeatPenalty ?? model?.repeatPenalty,
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
const DEFAULT_STOP_SEQUENCES = ["\nUser:", "\n\nUser:", "\nQuestion:", "\n\nQuestion:"];

export interface LoadedModelInfo {
  filename: string;
  nCtx: number;
  nThreads: number;
  /** RAM-2026-10-11: qué perfil de memoria aceptó llama.cpp (diagnóstico). */
  memoryProfile?: LlmMemoryProfile;
  /** Qwen3 lane: el modelo cargado pide enable_thinking=false (catálogo). */
  noThink?: boolean;
  /** Estudio de modelos: receta de muestreo del fabricante (catálogo). */
  sampling?: ModelSamplingDefaults;
  /** Estudio de modelos: quitar la cadena <think> del texto final. */
  stripReasoning?: boolean;
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
 */
export type LlmMemoryProfile = "kv-q8" | "small-batch" | "default";
export const LLM_N_BATCH = 512;
export const LLM_N_UBATCH = 256;

export function llmInitParamsForProfile(
  profile: LlmMemoryProfile,
  base: { model: string; n_ctx: number; n_threads: number },
): Record<string, unknown> {
  const common = {
    model: base.model,
    use_mlock: false, // avoid pinning full weights in RAM; rely on mmap streaming
    n_ctx: base.n_ctx,
    n_threads: base.n_threads,
    n_gpu_layers: 0, // CPU-only for broad device compatibility; adjust per-device
  };
  if (profile === "default") return common;
  const smallBatch = { ...common, n_batch: LLM_N_BATCH, n_ubatch: LLM_N_UBATCH };
  if (profile === "small-batch") return smallBatch;
  return { ...smallBatch, cache_type_k: "q8_0", cache_type_v: "q8_0" };
}

export const LLM_MEMORY_PROFILES: readonly LlmMemoryProfile[] = ["kv-q8", "small-batch", "default"];

/**
 * Thin wrapper around llama.rn. Loads a GGUF model with mmap so weights
 * stream from disk rather than being fully resident, keeping peak RAM under
 * the model's working-set size (weights touched + KV cache), not the full
 * file size. No network access anywhere in this module.
 */
export class LlamaEngine {
  private context: LlamaContext | null = null;
  private modelInfo: LoadedModelInfo | null = null;
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

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  load(modelFilename: string, opts?: { nCtx?: number; nThreads?: number }): Promise<void> {
    return this.enqueue(() => this.loadNow(modelFilename, opts));
  }

  private async loadNow(modelFilename: string, opts?: { nCtx?: number; nThreads?: number }) {
    // Per-model default context: smaller models declare a smaller defaultNCtx
    // in the catalog (context is the second biggest RAM term after weights).
    // An explicit opt always wins.
    const catalogEntry: CatalogModel | undefined = MODEL_CATALOG.find(
      (m) => m.filename === modelFilename
    );
    const nCtx = opts?.nCtx ?? catalogEntry?.defaultNCtx ?? 4096;
    const nThreads = opts?.nThreads ?? 4;

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
    const snapshot = readRamSnapshot();
    const spec = {
      fileSizeBytes,
      nCtx,
      nLayer: catalogEntry?.arch?.nLayer,
      nKvHeads: catalogEntry?.arch?.nKvHeads,
      headDim: catalogEntry?.arch?.headDim,
    };
    const verdict = snapshot ? checkRamBudget(spec, snapshot) : null;
    if (verdict && !verdict.fits) {
      throw new Error(
        `"${modelFilename}" needs roughly ${toGb(verdict.totalBytes)}GB of RAM, but this ` +
          `device only has about ${toGb(verdict.availableBytes)}GB free (of ${toGb(verdict.totalRamBytes)}GB total). ` +
          `Try a smaller model from Settings > Tone & Model.`
      );
    }

    // Release any previously loaded model (e.g. actually switching models
    // from Settings) so we don't leak the old context's native memory.
    await this.unloadNow();

    try {
      // RAM-2026-10-11: primer perfil que llama.cpp acepte (ver
      // LLM_MEMORY_PROFILES). El último es exactamente la llamada original.
      let lastErr: unknown = null;
      let loadedProfile: LlmMemoryProfile | null = null;
      for (const profile of LLM_MEMORY_PROFILES) {
        try {
          this.context = await withStage("initLlama", () =>
            initLlama(
              llmInitParamsForProfile(profile, { model: modelPath, n_ctx: nCtx, n_threads: nThreads }) as never,
            )
          );
          loadedProfile = profile;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!loadedProfile) throw lastErr;
      this.modelInfo = {
        filename: modelFilename,
        nCtx,
        nThreads,
        memoryProfile: loadedProfile,
        noThink: catalogEntry?.capabilities?.noThink,
        sampling: catalogEntry?.capabilities?.sampling,
        stripReasoning: catalogEntry?.capabilities?.stripReasoning,
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
    await context?.release();
  }

  getModelInfo(): LoadedModelInfo | null {
    return this.modelInfo;
  }

  get isLoaded(): boolean {
    return this.context !== null;
  }

  /**
   * Whether the loaded GGUF ships its own chat template (tokenizer.chat_template
   * metadata) that llama.cpp can parse as Jinja — i.e. whether generate({ messages })
   * will be formatted in the model's own instruction format.
   */
  hasEmbeddedChatTemplate(): boolean {
    return this.context?.isJinjaSupported() ?? false;
  }

  /**
   * F3-2026-10-06: generate() está serializado respecto a load()/unload()
   * durante el *arranque* de la completion (la cola garantiza que no se
   * interleavea con un unload). La espera de la completion ocurre FUERA de
   * la cola: si generate() retuviera la cola mientras espera, un load()
   * posterior (encolado detrás) nunca podría ejecutar su unloadNow() para
   * detener la generación → deadlock. unloadNow() detiene y espera todas
   * las completions en vuelo vía el conjunto inFlight.
   */
  async generate({
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
    telemetryContext,
  }: GenerateOptions): Promise<string> {
    // P2.4: telemetry measurement. All local, fire-and-forget, never throws.
    const tStart = Date.now();
    let firstTokenAt: number | null = null;
    let tokenCount = 0;
    let timedOut = false;
    // 0.1.34: guarda de bucle. Si el modelo repite el mismo trozo una y
    // otra vez («las aluminosas, las aluminosas…», visto en la Tab A9+),
    // se corta la generación (ahorra batería) y el texto final queda en
    // la primera aparición.
    // Salida estructurada (JSON/gramática): sin guarda, para no tocar
    // nunca un formato que se va a parsear.
    const guardLoops = responseFormat === undefined && grammar === undefined;
    let streamed = "";
    let loopCut = false;
    const watchLoop = (piece: string) => {
      if (!guardLoops) return;
      streamed += piece;
      if (loopCut || tokenCount % 8 !== 0) return;
      if (findRepetitionLoop(streamed)) {
        loopCut = true;
        void this.context?.stopCompletion();
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
      const started = await this.enqueue(() =>
        this.startCompletion({ prompt, messages, nPredict, temperature, topK, topP, minP, repeatPenalty, samplingPreset, responseFormat, grammar, enableThinking, onToken: wrappedOnToken, stop, timeoutMs, onTimeout: wrappedOnTimeout })
      );
      try {
        const { text } = await started.completion;
        const settled = text ?? started.getFull();
        const raw = guardLoops ? trimRepetitionLoop(settled) : settled;
        // Safety net (Qwen3 lane + estudio de modelos): for a noThink
        // model whose native layer ignored enable_thinking=false, and
        // for stripReasoning models (LFM2.5) whose chain-of-thought is
        // wanted for quality but must not be what history/memory keep
        // or parsers read, the final settled text never carries a raw
        // <think> block. Streamed tokens are NOT retroactively
        // changed — this only guarantees a clean settled result.
        return this.modelInfo?.noThink || this.modelInfo?.stripReasoning
          ? parseGemmaReasoning(raw).answer
          : raw;
      } finally {
        this.inFlight.delete(started.completion);
        if (started.timer) clearTimeout(started.timer);
      }
    } catch (e) {
      stopReason = "error";
      throw e;
    } finally {
      keepAliveDone = true;
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
        tokensPerSec: genMs > 0 && tokenCount > 0 ? (tokenCount / genMs) * 1000 : null,
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
  }: GenerateOptions): Promise<{ completion: Promise<{ text?: string }>; getFull: () => string; timer: ReturnType<typeof setTimeout> | null }> {
    if (!this.context) throw new Error("LlamaEngine: model not loaded");
    if (!prompt && !messages) {
      throw new Error("LlamaEngine.generate: either prompt or messages must be provided");
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          onTimeout?.();
          this.context?.stopCompletion();
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
    });
    const extraParams: Record<string, unknown> = {};
    if (sampling.topK !== undefined) extraParams.top_k = sampling.topK;
    if (sampling.topP !== undefined) extraParams.top_p = sampling.topP;
    if (sampling.minP !== undefined) extraParams.min_p = sampling.minP;
    if (sampling.repeatPenalty !== undefined) extraParams.penalty_repeat = sampling.repeatPenalty;
    if (responseFormat !== undefined) extraParams.response_format = responseFormat;
    if (grammar !== undefined) extraParams.grammar = grammar;

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
    const completionParams = messages
      ? {
          messages,
          jinja: true,
          n_predict: nPredict,
          temperature: sampling.temperature,
          stop: stop ?? [],
          ...extraParams,
          ...(thinkingParam !== undefined ? { enable_thinking: thinkingParam } : {}),
        }
      : { prompt: prompt!, n_predict: nPredict, temperature: sampling.temperature, stop: stop ?? DEFAULT_STOP_SEQUENCES, ...extraParams };

    let full = "";
    const completion = this.context.completion(completionParams, (data) => {
      full += data.token;
      onToken?.(data.token);
    });
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
    await this.context?.stopCompletion();
  }
}

export const llamaEngine = new LlamaEngine();
