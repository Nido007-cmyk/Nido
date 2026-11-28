/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.125 — «Whisper primero, Android de respaldo» (decisión del dueño).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeFake = vi.hoisted(() => {
  type Listener = (event: never) => void;
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    engineState: async () => "onDevice",
    isAvailable: async () => true,
    startListening: vi.fn(async () => {}),
    stopListening: vi.fn(async () => {}),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async () => ({ path: "file:///cache/dictation-1.wav", durationMs: 2000 })),
    addListener(name: string, listener: Listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return { remove: () => listeners.get(name)?.delete(listener) };
    },
    emit(name: string, event: unknown = {}) {
      for (const l of [...(listeners.get(name) ?? [])]) (l as (e: unknown) => void)(event);
    },
  };
});
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => nativeFake }));
const env = vi.hoisted(() => ({
  modelSize: 147951465 as number | null,
  availBytes: 2000 * 1024 * 1024,
  transcript: "hola desde whisper" as string | Error,
  failures: null as { count: number; appVersion: string } | null,
  cacheFiles: [] as string[],
  deleted: [] as string[],
}));
vi.mock("../models/settings", () => ({
  getVoiceOnDeviceOnly: async () => true,
  getWhisperFailures: async () => env.failures,
  setWhisperFailures: async (r: { count: number; appVersion: string } | null) => {
    env.failures = r;
  },
}));
vi.mock("../security/backup", () => ({ APP_VERSION: "0.1.125" }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: async () => (env.modelSize == null ? { exists: false } : { exists: true, size: env.modelSize }),
  readDirectoryAsync: async () => [...env.cacheFiles],
  deleteAsync: async (p: string) => {
    env.deleted.push(p);
  },
}));
vi.mock("../inference/ramBudget", () => ({
  readRamSnapshot: () => ({ totalRamBytes: 3416 * 1024 * 1024, rssBytes: 0, availBytes: env.availBytes, lowMemThresholdBytes: 216 * 1024 * 1024 }),
}));
vi.mock("../i18n", () => ({ default: { language: "es" } }));
vi.mock("./whisperDictation", async (orig) => {
  const real = await orig<typeof import("./whisperDictation")>();
  return {
    ...real,
    transcribeWithWhisper: vi.fn(async () => {
      if (env.transcript instanceof Error) throw env.transcript;
      return env.transcript;
    }),
  };
});

import { startListening, stopListening, voiceInputAvailability, type VoiceEvent } from "./VoiceInput";
import { transcribeWithWhisper } from "./whisperDictation";

/** Espera a que el dictado arranque por uno de los dos motores (hay imports dinámicos por medio). */
const flush = () =>
  vi.waitFor(() => {
    if (nativeFake.startRecording.mock.calls.length + nativeFake.startListening.mock.calls.length === 0) throw new Error("aún no");
  });

beforeEach(() => {
  env.modelSize = 147951465;
  env.availBytes = 2000 * 1024 * 1024;
  env.transcript = "hola desde whisper";
  env.failures = null;
  env.cacheFiles = [];
  env.deleted = [];
  nativeFake.startRecording.mockImplementation(async () => {});
  nativeFake.stopRecording.mockImplementation(async () => ({ path: "file:///cache/dictation-1.wav", durationMs: 2000 }));
  nativeFake.listeners.clear();
  nativeFake.startListening.mockClear();
  nativeFake.startRecording.mockClear();
  nativeFake.stopRecording.mockClear();
  vi.mocked(transcribeWithWhisper).mockClear();
});

describe("0.1.125 — dictado: Whisper primero, Android de respaldo", () => {
  it("con el modelo descargado y memoria de sobra: graba, para, transcribe en el teléfono y devuelve el texto", async () => {
    const events: VoiceEvent[] = [];
    const p = startListening((e) => events.push(e));
    await flush();
    expect(nativeFake.startRecording).toHaveBeenCalledTimes(1);
    expect(nativeFake.startListening).not.toHaveBeenCalled();
    const [path, maxMs] = nativeFake.startRecording.mock.calls[0] as unknown as [string, number];
    expect(path).toMatch(/^file:\/\/\/cache\/dictation-\d+\.wav$/);
    expect(maxMs).toBe(30_000);
    await stopListening();
    await expect(p).resolves.toBe("hola desde whisper");
    expect(events.map((e) => e.type)).toEqual(["start", "end", "transcribing", "result"]);
    expect(vi.mocked(transcribeWithWhisper).mock.calls[0][0]).toMatch(/^file:\/\/\/cache\/dictation-\d+\.wav$/);
    expect(vi.mocked(transcribeWithWhisper).mock.calls[0][1]).toMatchObject({ uiLanguage: "es" });
  });

  it("al llegar al tope de 30 s para sola y transcribe", async () => {
    const p = startListening();
    await flush();
    nativeFake.emit("onRecordLimit");
    await expect(p).resolves.toBe("hola desde whisper");
    expect(nativeFake.stopRecording).toHaveBeenCalledTimes(1);
  });

  it("si no se dijo nada, resuelve null", async () => {
    env.transcript = "";
    const p = startListening();
    await flush();
    await stopListening();
    await expect(p).resolves.toBeNull();
  });

  it("si Whisper no cabe en la memoria de ahora, usa el reconocedor de Android", async () => {
    env.availBytes = 300 * 1024 * 1024;
    const p = startListening();
    await flush();
    expect(nativeFake.startRecording).not.toHaveBeenCalled();
    expect(nativeFake.startListening).toHaveBeenCalledTimes(1);
    nativeFake.emit("onResults", { text: "desde android" });
    await expect(p).resolves.toBe("desde android");
  });

  it("sin el modelo descargado (o a medias), usa el reconocedor de Android", async () => {
    env.modelSize = 1000;
    const p = startListening();
    await flush();
    expect(nativeFake.startRecording).not.toHaveBeenCalled();
    expect(nativeFake.startListening).toHaveBeenCalledTimes(1);
    nativeFake.emit("onResults", { text: "android" });
    await expect(p).resolves.toBe("android");
  });

  it("con Whisper descargado el dictado está disponible y es en el teléfono", async () => {
    await expect(voiceInputAvailability()).resolves.toEqual({ available: true, onDevice: true });
  });

  // ---- Auditoría de la casa sobre el PR #422 ----

  it("E-1: si la transcripción de Whisper falla, cae al reconocedor de Android, anota el fallo y borra el audio", async () => {
    env.transcript = new Error("initWhisper failed");
    const events: VoiceEvent[] = [];
    const p = startListening((e) => events.push(e));
    await flush();
    await stopListening();
    await vi.waitFor(() => {
      if (nativeFake.startListening.mock.calls.length === 0) throw new Error("aún no");
    });
    nativeFake.emit("onResults", { text: "desde android" });
    await expect(p).resolves.toBe("desde android");
    expect(events.map((e) => e.type)).toEqual(["start", "end", "transcribing", "fallback", "result"]);
    expect(events.find((e) => e.type === "fallback")).toMatchObject({ stage: "transcribe" });
    expect(env.failures).toEqual({ count: 1, appVersion: "0.1.125" });
    // Se borra la URI file:// que creó la sesión (la que deleteAsync acepta).
    expect(env.deleted.some((d) => /^file:\/\/\/cache\/dictation-\d+\.wav$/.test(d))).toBe(true);
  });

  it("E-1: si la grabación de Whisper no arranca, cae al reconocedor de Android en la misma pulsación", async () => {
    nativeFake.startRecording.mockImplementation(async () => {
      throw Object.assign(new Error("AudioRecord not initialized"), { code: "E_RECORD_FAILED" });
    });
    const events: VoiceEvent[] = [];
    const p = startListening((e) => events.push(e));
    await vi.waitFor(() => {
      if (nativeFake.startListening.mock.calls.length === 0) throw new Error("aún no");
    });
    nativeFake.emit("onResults", { text: "android" });
    await expect(p).resolves.toBe("android");
    expect(events[0]).toMatchObject({ type: "fallback", stage: "record" });
    expect(env.failures?.count).toBe(1);
    // El WAV que se iba a grabar no queda en la caché.
    expect(env.deleted.some((d) => /dictation-\d+\.wav$/.test(d))).toBe(true);
  });

  it("E-1: sin permiso de micrófono no hay respaldo posible (Android también lo necesita) ni se cuenta como fallo de Whisper", async () => {
    nativeFake.startRecording.mockImplementation(async () => {
      throw Object.assign(new Error("Microphone permission denied"), { code: "E_PERMISSION_DENIED" });
    });
    const events: VoiceEvent[] = [];
    await expect(startListening((e) => events.push(e))).resolves.toBeNull();
    expect(nativeFake.startListening).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "error", code: "E_PERMISSION_DENIED", message: "Microphone permission denied" }]);
    expect(env.failures).toBeNull();
  });

  it("E-1: con dos fallos seguidos en esta versión, el dictado va directo al reconocedor de Android", async () => {
    env.failures = { count: 2, appVersion: "0.1.125" };
    const p = startListening();
    await flush();
    expect(nativeFake.startRecording).not.toHaveBeenCalled();
    expect(nativeFake.startListening).toHaveBeenCalledTimes(1);
    nativeFake.emit("onResults", { text: "android" });
    await expect(p).resolves.toBe("android");
  });

  it("E-1: los fallos de otra versión de la app no apartan a Whisper, y un éxito los borra", async () => {
    env.failures = { count: 5, appVersion: "0.1.124" };
    const p = startListening();
    await flush();
    expect(nativeFake.startRecording).toHaveBeenCalledTimes(1);
    await stopListening();
    await expect(p).resolves.toBe("hola desde whisper");
    expect(env.failures).toBeNull();
  });

  it("E-2: si stopRecording falla, el audio se borra igual y la sesión cae a Android", async () => {
    nativeFake.stopRecording.mockImplementation(async () => {
      throw new Error("stop failed");
    });
    const p = startListening();
    await flush();
    await stopListening();
    await vi.waitFor(() => {
      if (nativeFake.startListening.mock.calls.length === 0) throw new Error("aún no");
    });
    expect(env.deleted.some((d) => /dictation-\d+\.wav$/.test(d))).toBe(true);
    nativeFake.emit("onResults", { text: "android" });
    await expect(p).resolves.toBe("android");
  });

  it("E-2: al empezar un dictado se barren los WAV que quedaron de una sesión cortada (y nada más)", async () => {
    env.cacheFiles = ["dictation-111.wav", "dictation-222.wav", "export.json", "prompt-cache"];
    const p = startListening();
    await flush();
    expect(env.deleted).toEqual(["file:///cache/dictation-111.wav", "file:///cache/dictation-222.wav"]);
    await stopListening();
    await p;
  });
});
