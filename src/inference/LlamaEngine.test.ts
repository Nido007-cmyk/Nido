/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type FakeContext = {
  model: string;
  released: boolean;
  release: () => Promise<void>;
  completion: (params: unknown, onToken: (d: { token: string }) => void) => Promise<{ text: string }>;
  stopCompletion: () => Promise<void>;
  releasedWhileGenerating: boolean;
  lastParams: unknown;
};
const created: FakeContext[] = [];
let inFlightInits = 0;
// RAM-2026-10-11: parámetros de cada initLlama y rechazo simulado por perfil.
const initCalls: Array<Record<string, unknown>> = [];
let rejectInit: ((p: Record<string, unknown>) => boolean) | null = null;
let maxConcurrentInits = 0;

vi.mock("llama.rn", () => ({
  initLlama: async (params: { model: string } & Record<string, unknown>) => {
    const { model } = params;
    initCalls.push(params);
    if (rejectInit?.(params)) throw new Error("Failed to initialize context");
    inFlightInits++;
    maxConcurrentInits = Math.max(maxConcurrentInits, inFlightInits);
    await new Promise((r) => setTimeout(r, 5));
    inFlightInits--;
    const finishes: Array<() => void> = [];
    let generating = false;
    const ctx: FakeContext = {
      model,
      released: false,
      releasedWhileGenerating: false,
      lastParams: undefined,
      release: async () => {
        if (generating) ctx.releasedWhileGenerating = true;
        ctx.released = true;
      },
      // Like llama.cpp: runs until stopped, and settles a moment after the stop (prompt still processing).
      completion: (params, onToken) =>
        new Promise((resolve) => {
          generating = true;
          ctx.lastParams = params;
          onToken({ token: mockReplyText });
          finishes.push(() =>
            setTimeout(() => {
              generating = false;
              resolve({ text: mockReplyText });
            }, 20)
          );
        }),
      stopCompletion: async () => {
        finishes.splice(0).forEach((f) => f());
      },
    };
    created.push(ctx);
    return ctx;
  },
}));
// Bounty tanda 3: el CrashGuard persiste en un JSON junto a los
// modelos; el mock guarda los ficheros en memoria para poder sembrarlo.
const fsStore = new Map<string, string>();
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async () => ({ exists: true, size: 1_000_000 }),
  readAsStringAsync: async (path: string) => {
    const v = fsStore.get(path);
    if (v === undefined) throw new Error("File not found");
    return v;
  },
  writeAsStringAsync: async (path: string, data: string) => {
    fsStore.set(path, data);
  },
}));
let mockTotalRamBytes = 12 * 1024 ** 3;
let mockRssBytes = 1024 ** 3;
// Texto que la completion falsa emite/resuelve (los tests de noThink lo
// cambian por una respuesta con bloque <think>).
let mockReplyText = "Hi";
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockTotalRamBytes,
  getMemoryInfo: () => ({ rssBytes: mockRssBytes }),
}));
// The integrity gate is covered by src/models/modelTrust.test.ts; here it
// is stubbed so engine behavior is tested in isolation.
vi.mock("../models/modelTrust", () => ({
  assertTrustedModelFileByName: vi.fn(async () => {}),
}));

import { LlamaEngine, resolveSampling, SAMPLING_PRESETS } from "./LlamaEngine";

const live = () => created.filter((c) => !c.released);

beforeEach(() => {
  created.length = 0;
  inFlightInits = 0;
  maxConcurrentInits = 0;
  mockTotalRamBytes = 12 * 1024 ** 3;
  mockRssBytes = 1024 ** 3;
  initCalls.length = 0;
  rejectInit = null;
  mockReplyText = "Hi";
  fsStore.clear();
});

describe("RAM-2026-10-11: perfiles de memoria del LLM", () => {
  it("usa primero el perfil ahorrador: KV q8_0, n_ubatch 256, n_batch 512", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ cache_type_k: "q8_0", cache_type_v: "q8_0", n_ubatch: 256, n_batch: 512, use_mlock: false });
    expect(engine.getModelInfo()?.memoryProfile).toBe("kv-q8");
  });

  it("si llama.cpp rechaza la KV cuantizada, carga con lote pequeño y KV normal", async () => {
    rejectInit = (p) => p.cache_type_v !== undefined;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(2);
    expect(initCalls[1].cache_type_k).toBeUndefined();
    expect(initCalls[1].n_ubatch).toBe(256);
    expect(engine.getModelInfo()?.memoryProfile).toBe("small-batch");
  });

  it("como último recurso usa exactamente los parámetros originales", async () => {
    rejectInit = (p) => p.n_ubatch !== undefined;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls).toHaveLength(3);
    expect(Object.keys(initCalls[2]).sort()).toEqual(["model", "n_ctx", "n_gpu_layers", "n_threads", "use_mlock"]);
    expect(engine.getModelInfo()?.memoryProfile).toBe("default");
  });

  it("si ningún perfil carga, el error llega igual que antes", async () => {
    rejectInit = () => true;
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/Failed to load/);
    expect(engine.isLoaded).toBe(false);
  });
});

describe("LlamaEngine load/unload", () => {
  it("never leaves an orphaned context when loads overlap (quick model swaps)", async () => {
    const engine = new LlamaEngine();
    await Promise.all([engine.load("models/a.gguf"), engine.load("models/b.gguf"), engine.load("models/a.gguf")]);
    expect(maxConcurrentInits).toBe(1);
    expect(live()).toHaveLength(1);
    expect(live()[0].model).toBe("file:///docs/models/a.gguf");
    expect(engine.getModelInfo()?.filename).toBe("models/a.gguf");
  });

  it("skips a load of the model that is already loaded", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await Promise.all([engine.load("models/a.gguf"), engine.load("models/a.gguf")]);
    expect(created).toHaveLength(1);
  });

  it("serializes unload with a pending load, leaving nothing loaded", async () => {
    const engine = new LlamaEngine();
    await Promise.all([engine.load("models/a.gguf"), engine.unload()]);
    expect(live()).toHaveLength(0);
    expect(engine.isLoaded).toBe(false);
  });

  it("keeps working after a failed load", async () => {
    const engine = new LlamaEngine();
    const fs = await import("expo-file-system/legacy");
    const spy = vi.spyOn(fs, "getInfoAsync").mockResolvedValueOnce({ exists: false } as any);
    await expect(engine.load("models/missing.gguf")).rejects.toThrow(/not found/);
    await engine.load("models/b.gguf");
    expect(engine.getModelInfo()?.filename).toBe("models/b.gguf");
    spy.mockRestore();
  });

  it("stops and waits for a running generation before releasing its model", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "say hi" });
    await engine.load("models/b.gguf");
    await expect(reply).resolves.toBe("Hi");
    expect(created[0].released).toBe(true);
    expect(created[0].releasedWhileGenerating).toBe(false);
    expect(engine.getModelInfo()?.filename).toBe("models/b.gguf");
  });

  it("F3-2026-10-06 + M-6: dos generate() a la vez se asientan; unload espera a la que corre y la encolada falla sin colgarse", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    // M-6 (auditoría 2026-10-31): ya no corren dos completions a la
    // vez sobre el contexto (la caché KV es compartida). La primera
    // corre; la segunda espera en la cadena de generaciones. unload
    // detiene la que corre y libera; la encolada arranca después
    // contra un contexto liberado y rechaza con «model not loaded»
    // en vez de colgarse o de generar sobre un contexto muerto.
    const r1 = engine.generate({ prompt: "one" });
    const r2 = engine.generate({ prompt: "two" });
    await engine.unload();
    await expect(r1).resolves.toBe("Hi");
    await expect(r2).rejects.toThrow("model not loaded");
    expect(created[0].released).toBe(true);
    expect(created[0].releasedWhileGenerating).toBe(false);
    expect(engine.isLoaded).toBe(false);
  });

  it("M-6: dos generate() concurrentes corren en serie, cada una con su texto", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const ctx = created[0];
    const origCompletion = ctx.completion;
    let active = 0;
    let maxActive = 0;
    const starts: string[] = [];
    ctx.completion = (params, onToken) => {
      active++;
      maxActive = Math.max(maxActive, active);
      starts.push(String((params as { prompt?: string }).prompt ?? ""));
      return origCompletion(params, onToken).finally(() => { active--; });
    };
    const r1 = engine.generate({ prompt: "one" });
    const r2 = engine.generate({ prompt: "two" });
    // Dar tiempo a que arranquen las que puedan arrancar: solo la
    // primera debe haber empezado.
    await new Promise((r) => setTimeout(r, 30));
    expect(starts).toEqual(["one"]);
    expect(maxActive).toBe(1);
    // Al detener la primera (como hace stop en la app), se asienta
    // y solo entonces arranca la segunda.
    await engine.stop();
    await expect(r1).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 30));
    expect(starts).toEqual(["one", "two"]);
    await engine.stop();
    await expect(r2).resolves.toBe("Hi");
    expect(maxActive).toBe(1);
  });

  it("refuses to load with a clear RAM error when the model does not fit", async () => {
    // 2 GiB device, 1 GiB resident: 2 - 1 - 2 (headroom) = 0 available.
    // The error must mention RAM so ModelLoadErrorCard's memory diagnosis picks it up.
    mockTotalRamBytes = 2 * 1024 ** 3;
    mockRssBytes = 1024 ** 3;
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/RAM/);
    expect(created).toHaveLength(0);
    expect(engine.isLoaded).toBe(false);
  });

  it("loads when the model fits the device budget", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
    expect(created).toHaveLength(1);
  });

  it("skips the pre-flight when the RAM readout is blind instead of blocking", async () => {
    mockTotalRamBytes = 0;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
  });
});

describe("Bounty tanda 3: escalera de memoria y CrashGuard", () => {
  // Costes con la arquitectura por defecto y el fichero de 1 MB del
  // mock: ctx 4096 ≈ 698 MB · 3072 ≈ 602 MB. Disponible = total − RSS
  // − 2 GiB de reserva.
  it("baja un peldaño de contexto en vez de rechazar cuando el techo no cabe", async () => {
    mockTotalRamBytes = 2 * 1024 ** 3 + 650_000_000; // ≈650 MB libres: 4096 no, 3072 sí
    mockRssBytes = 0;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
    expect(initCalls[0].n_ctx).toBe(3072);
  });

  it("un choque sin confirmar reduce el presupuesto de la siguiente carga, y generar confirma", async () => {
    // ≈800 MB libres: a factor 1 el 4096 cabría; el pendiente de un
    // proceso muerto cuenta un choque (factor 0,8 → 640 MB) y baja a 3072.
    mockTotalRamBytes = 2 * 1024 ** 3 + 800_000_000;
    mockRssBytes = 0;
    fsStore.set(
      "file:///docs/nido-crash-guard.json",
      JSON.stringify({ crashes: 0, pending: { model: "models/a.gguf", nCtx: 4096, at: 1 } })
    );
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initCalls[0].n_ctx).toBe(3072);
    // El intento nuevo quedó persistido como pendiente…
    const during = JSON.parse(fsStore.get("file:///docs/nido-crash-guard.json")!) as {
      crashes: number;
      pending: unknown;
    };
    expect(during.crashes).toBe(1);
    expect(during.pending).not.toBeNull();
    // …y la primera generación que termina bien lo confirma todo
    // (la completion del mock solo se asienta al detener, como siempre).
    const gen = engine.generate({ prompt: "hola" });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("Hi");
    await new Promise((r) => setTimeout(r, 0));
    const after = JSON.parse(fsStore.get("file:///docs/nido-crash-guard.json")!) as {
      crashes: number;
      pending: unknown;
    };
    expect(after).toEqual({ crashes: 0, pending: null });
  });
});

describe("Bounty tanda 8: la frase cortada", () => {
  it("una generación que consume su presupuesto devuelve el texto cerrado en frase completa", async () => {
    mockReplyText = "La primera frase está completa. La segunda quedó cort";
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola", nPredict: 1 });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("La primera frase está completa.");
    expect(engine.lastGenerationWasCut).toBe(true);
  });

  it("con presupuesto de sobra, el texto vuelve entero y sin marca de corte", async () => {
    mockReplyText = "La primera frase está completa. La segunda quedó cort";
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const gen = engine.generate({ prompt: "hola", nPredict: 64 });
    await new Promise((r) => setTimeout(r, 30));
    await engine.stop();
    await expect(gen).resolves.toBe("La primera frase está completa. La segunda quedó cort");
    expect(engine.lastGenerationWasCut).toBe(false);
  });
});

describe("P1.2 sampling presets", () => {
  it("resolveSampling: no preset, no overrides -> old 0.7 default", () => {
    expect(resolveSampling({})).toEqual({ temperature: 0.7, topK: undefined, topP: undefined, minP: undefined, repeatPenalty: undefined });
  });

  it("resolveSampling: preset fills unset values", () => {
    const s = resolveSampling({ samplingPreset: "structured" });
    expect(s.temperature).toBe(0.1);
    expect(s.minP).toBe(0);
    expect(s.repeatPenalty).toBeUndefined();
    const c = resolveSampling({ samplingPreset: "chat" });
    expect(c.temperature).toBe(0.7);
    expect(c.repeatPenalty).toBe(1.1);
    expect(c.minP).toBe(0);
  });

  it("resolveSampling: explicit values always win over the preset", () => {
    const s = resolveSampling({ samplingPreset: "structured", temperature: 0.5, minP: 0.05, repeatPenalty: 1.2 });
    expect(s.temperature).toBe(0.5);
    expect(s.minP).toBe(0.05);
    expect(s.repeatPenalty).toBe(1.2);
  });

  // Estudio de modelos (2026-10-12): la capa del fabricante va DEBAJO
  // del preset — rellena lo que ningún preset define (topK/topP) sin
  // pisar la política por tarea.
  it("resolveSampling: los defaults del modelo rellenan topK/topP", () => {
    const s = resolveSampling({ modelDefaults: { topK: 20, topP: 0.8 } });
    expect(s.temperature).toBe(0.7);
    expect(s.topK).toBe(20);
    expect(s.topP).toBe(0.8);
  });

  it("resolveSampling: el preset gana a la temperatura del modelo; el topK del modelo sobrevive", () => {
    const s = resolveSampling({ samplingPreset: "factual", modelDefaults: { temperature: 0.2, topK: 80, repeatPenalty: 1.05 } });
    expect(s.temperature).toBe(0.3); // factual, no el 0.2 de LiquidAI
    expect(s.topK).toBe(80);
    expect(s.repeatPenalty).toBe(1.1); // 0.1.34: factual trae su propia penalización (bucles en la Tab A9+)
  });

  it("resolveSampling: explícito gana al modelo, y el preset de chat gana en repetición", () => {
    expect(resolveSampling({ topK: 5, modelDefaults: { topK: 80 } }).topK).toBe(5);
    expect(resolveSampling({ samplingPreset: "chat", modelDefaults: { repeatPenalty: 1.05 } }).repeatPenalty).toBe(1.1);
    expect(resolveSampling({ modelDefaults: { temperature: 0.2 } }).temperature).toBe(0.2);
  });

  it("SAMPLING_PRESETS table matches the research calibration", () => {
    expect(SAMPLING_PRESETS.structured.temperature).toBeLessThanOrEqual(0.2);
    expect(SAMPLING_PRESETS.factual.temperature).toBeLessThanOrEqual(0.4);
    // min_p pinned to 0 everywhere (llama.cpp default 0.05 breaks repetition-loop escape)
    for (const p of Object.values(SAMPLING_PRESETS)) expect(p.minP).toBe(0);
    // repeat penalty only on open chat, never on structured paths
    expect(SAMPLING_PRESETS.structured.repeatPenalty).toBeUndefined();
    expect(SAMPLING_PRESETS.chat.repeatPenalty).toBeGreaterThan(1);
  });

  it("generate() with no new options sends exactly the old params", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "hi" });
    await engine.unload(); // mock completion only settles on stop, like the existing tests
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.7);
    expect("top_k" in params).toBe(false);
    expect("min_p" in params).toBe(false);
    expect("penalty_repeat" in params).toBe(false);
    expect("response_format" in params).toBe(false);
    expect("grammar" in params).toBe(false);
  });

  it("generate() forwards sampling tunables to the native call", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "hi", samplingPreset: "structured", topK: 40 });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.1);
    expect(params.min_p).toBe(0);
    expect(params.top_k).toBe(40);
    expect("penalty_repeat" in params).toBe(false);
  });

  it("generate() forwards response_format and grammar (P1.1)", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const schema = { type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] };
    const reply = engine.generate({
      messages: [{ role: "user", content: "x" }],
      responseFormat: { type: "json_schema", json_schema: { schema } },
    });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.response_format).toEqual({ type: "json_schema", json_schema: { schema } });
    // grammar on the prompt path too
    const engine2 = new LlamaEngine();
    await engine2.load("models/a.gguf");
    const reply2 = engine2.generate({ prompt: "y", grammar: "root ::= \"a\"" });
    await engine2.unload();
    await expect(reply2).resolves.toBe("Hi");
    const params2 = created[1].lastParams as Record<string, unknown>;
    expect(params2.grammar).toBe('root ::= "a"');
  });
});

describe("P2.4 telemetry", () => {
  it("records an event per generation with timings and counts", async () => {
    const { clearTelemetry, getRecentTelemetry } = await import("./telemetry");
    clearTelemetry();
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    // The mock completion only resolves after stopCompletion (via unload),
    // like llama.cpp settling after a stop — same pattern as the P1.1 tests.
    const reply = engine.generate({
      messages: [{ role: "user", content: "hello" }],
      telemetryContext: { taskType: "test-task" },
    });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const events = getRecentTelemetry(10);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.taskType).toBe("test-task");
    expect(e.completionTokens).toBe(1); // mock emits one token
    expect(e.ttftMs).not.toBeNull();
    expect(e.totalMs).toBeGreaterThanOrEqual(0);
    expect(e.stopReason).toBe("completed");
    expect(e.promptChars).toBeGreaterThan(0);
    expect(e.nPredict).toBe(512);
  });

  it("records timeout stopReason when the timer fires", async () => {
    const { clearTelemetry, getRecentTelemetry } = await import("./telemetry");
    clearTelemetry();
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    // The mock completion only resolves after stopCompletion; a 1ms
    // timeout forces the timeout path.
    await engine.generate({ prompt: "x", timeoutMs: 1 }).catch(() => {});
    await engine.unload();
    const events = getRecentTelemetry(10);
    expect(events).toHaveLength(1);
    expect(events[0].stopReason).toBe("timeout");
  });
});

// Lane Qwen3 (2026-10-12): el interruptor de pensamiento. Qwen3 piensa
// por defecto; su entrada de catálogo trae noThink y el motor debe
// pasar enable_thinking=false en la ruta jinja sin que ningún llamador
// tenga que acordarse, y sin tocar los params de los demás modelos.
describe("Qwen3 noThink: enable_thinking en el motor", () => {
  const QWEN3 = "models/qwen3-0.6b-q4km.gguf";
  const QWEN25 = "models/qwen2.5-0.5b-instruct-q4km.gguf";
  const MSGS = [{ role: "user", content: "hola" }];

  it("un modelo noThink recibe enable_thinking=false con messages", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.jinja).toBe(true);
    expect(params.enable_thinking).toBe(false);
  });

  it("un modelo sin la marca NO recibe el parámetro (params legacy intactos)", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN25);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect("enable_thinking" in params).toBe(false);
  });

  it("la ruta prompt (sin plantilla) nunca lleva el parámetro", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    const reply = engine.generate({ prompt: "hola" });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect("enable_thinking" in params).toBe(false);
  });

  it("la opción explícita gana sobre la marca del catálogo", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    const reply = engine.generate({ messages: MSGS, enableThinking: true });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.enable_thinking).toBe(true);
  });

  it("red de seguridad: un <think> filtrado no llega al texto final de un noThink", async () => {
    mockReplyText = "<think>razonamiento interno</think>Respuesta visible.";
    const engine = new LlamaEngine();
    await engine.load(QWEN3);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Respuesta visible.");
  });

  it("la red NO se aplica a modelos sin la marca (su texto pasa intacto)", async () => {
    mockReplyText = "<think>razonamiento interno</think>Respuesta visible.";
    const engine = new LlamaEngine();
    await engine.load(QWEN25);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("<think>razonamiento interno</think>Respuesta visible.");
  });
});

// Estudio de modelos (2026-10-12): la receta del fabricante declarada en
// el catálogo llega a la llamada nativa vía el modelo cargado, y los
// modelos de razonamiento (LFM2.5) pierden su cadena en el texto final.
describe("estudio de modelos: sampling por modelo y stripReasoning", () => {
  const LFM = "models/hf-liquidai-lfm2-5-8b-a1b-gguf-lfm2-5-8b-a1b-q4-k-m-gguf.gguf";
  const QWEN15 = "models/qwen2.5-1.5b-instruct-q4km.gguf";
  const MSGS = [{ role: "user", content: "hola" }];

  it("LFM2.5 sin preset: llega su receta oficial (temp 0.2, top_k 80, rep 1.05)", async () => {
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.2);
    expect(params.top_k).toBe(80);
    expect(params.penalty_repeat).toBe(1.05);
  });

  it("LFM2.5 con preset factual: la temperatura es del preset, el top_k sobrevive", async () => {
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS, samplingPreset: "factual" });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.3);
    expect(params.top_k).toBe(80);
  });

  it("0.1.34: un bucle de repetición del modelo queda en la primera vez", async () => {
    mockReplyText = "Ejemplos de plantas que conozco son " + "las aluminosas, ".repeat(30);
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Ejemplos de plantas que conozco son las aluminosas…");
  });

  it("0.1.34: con salida estructurada (JSON) la guarda no toca nada", async () => {
    mockReplyText = '{"a":"las aluminosas, ' + "las aluminosas, ".repeat(30) + '"}';
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS, responseFormat: { type: "json_object" } });
    await engine.unload();
    await expect(reply).resolves.toBe(mockReplyText);
  });

  it("LFM2.5: la cadena <think> no llega al texto final (stripReasoning)", async () => {
    mockReplyText = "<think>cadena de razonamiento muy larga</think>La respuesta final.";
    const engine = new LlamaEngine();
    await engine.load(LFM);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("La respuesta final.");
  });

  it("Qwen2.5-1.5B: su top_p/top_k oficiales rellenan sin preset", async () => {
    const engine = new LlamaEngine();
    await engine.load(QWEN15);
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect(params.temperature).toBe(0.7);
    expect(params.top_k).toBe(20);
    expect(params.top_p).toBe(0.8);
  });

  it("un archivo fuera de catálogo no recibe capa de modelo (legacy intacto)", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ messages: MSGS });
    await engine.unload();
    await expect(reply).resolves.toBe("Hi");
    const params = created[0].lastParams as Record<string, unknown>;
    expect("top_k" in params).toBe(false);
    expect("top_p" in params).toBe(false);
  });
});
