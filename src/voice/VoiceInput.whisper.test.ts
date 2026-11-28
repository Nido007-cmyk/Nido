/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.124 — «Whisper primero, Android de respaldo» (decisión del dueño).
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
vi.mock("../models/settings", () => ({ getVoiceOnDeviceOnly: async () => true }));

const env = vi.hoisted(() => ({ modelSize: 147951465 as number | null, availBytes: 2000 * 1024 * 1024, transcript: "hola desde whisper" }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: async () => (env.modelSize == null ? { exists: false } : { exists: true, size: env.modelSize }),
  deleteAsync: async () => {},
}));
vi.mock("../inference/ramBudget", () => ({
  readRamSnapshot: () => ({ totalRamBytes: 3416 * 1024 * 1024, rssBytes: 0, availBytes: env.availBytes, lowMemThresholdBytes: 216 * 1024 * 1024 }),
}));
vi.mock("../i18n", () => ({ default: { language: "es" } }));
vi.mock("./whisperDictation", async (orig) => {
  const real = await orig<typeof import("./whisperDictation")>();
  return { ...real, transcribeWithWhisper: vi.fn(async () => env.transcript) };
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
  nativeFake.listeners.clear();
  nativeFake.startListening.mockClear();
  nativeFake.startRecording.mockClear();
  nativeFake.stopRecording.mockClear();
  vi.mocked(transcribeWithWhisper).mockClear();
});

describe("0.1.124 — dictado: Whisper primero, Android de respaldo", () => {
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
    expect(vi.mocked(transcribeWithWhisper).mock.calls[0][0]).toBe("file:///cache/dictation-1.wav");
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
});
