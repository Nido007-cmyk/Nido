/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * VoiceInput.test.ts — auditoría completa 2026-10-31 (F1 M-4 y
 * F6-07): el puente del dictado no tenía ninguna prueba. Se simula
 * el módulo nativo con un registro de oyentes propio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const nativeFake = vi.hoisted(() => {
  type Listener = (event: never) => void;
  const listeners = new Map<string, Set<Listener>>();
  const removed: string[] = [];
  return {
    listeners,
    removed,
    isAvailable: async () => true,
    engineState: async () => "on_device",
    startListening: vi.fn(async () => {}),
    stopListening: vi.fn(async () => {}),
    addListener(name: string, listener: Listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return {
        remove: () => {
          listeners.get(name)?.delete(listener);
          removed.push(name);
        },
      };
    },
    emit(name: string, event: unknown = {}) {
      for (const l of [...(listeners.get(name) ?? [])]) (l as (e: unknown) => void)(event);
    },
    listenerCount() {
      let n = 0;
      for (const s of listeners.values()) n += s.size;
      return n;
    },
    reset() {
      listeners.clear();
      removed.length = 0;
    },
  };
});

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => nativeFake,
}));
vi.mock("../models/settings", () => ({
  getVoiceOnDeviceOnly: async () => true,
}));

import { startListening, type VoiceEvent } from "./VoiceInput";

beforeEach(() => {
  nativeFake.reset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startListening (F1 M-4)", () => {
  it("un resultado normal resuelve con el texto y quita los oyentes", async () => {
    const events: VoiceEvent[] = [];
    const p = startListening((e) => events.push(e));
    nativeFake.emit("onSpeechStart");
    nativeFake.emit("onResults", { text: "hola mundo" });
    await expect(p).resolves.toBe("hola mundo");
    expect(events.map((e) => e.type)).toEqual(["start", "result"]);
    expect(nativeFake.listenerCount()).toBe(0);
  });

  it("el resultado que llega justo tras el fin de voz también vale (orden Android)", async () => {
    const p = startListening();
    nativeFake.emit("onSpeechEnd");
    nativeFake.emit("onResults", { text: "tarde pero válido" });
    await expect(p).resolves.toBe("tarde pero válido");
  });

  it("fin de voz sin resultado ni error: pasado el margen resuelve null y quita los oyentes", async () => {
    const events: VoiceEvent[] = [];
    const p = startListening((e) => events.push(e));
    nativeFake.emit("onSpeechEnd");
    vi.advanceTimersByTime(1001);
    await expect(p).resolves.toBeNull();
    expect(nativeFake.listenerCount()).toBe(0);
    // Un resultado tardío ya no alcanza a nadie: la sesión está muerta.
    nativeFake.emit("onResults", { text: "fantasma" });
    expect(events.map((e) => e.type)).toEqual(["end"]);
  });

  it("un error resuelve null y quita los oyentes", async () => {
    const p = startListening();
    nativeFake.emit("onError", { code: "7", message: "sin coincidencia" });
    await expect(p).resolves.toBeNull();
    expect(nativeFake.listenerCount()).toBe(0);
  });
});
