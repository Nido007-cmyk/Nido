/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** Auditoría 2026-10-29: por defecto el dictado nunca usa un reconocedor que pueda ir a internet. */
import { describe, expect, it } from "vitest";
import { parseEngineState, voiceAvailability } from "./voicePolicy";

describe("qué reconocedor de voz se usa", () => {
  it("con reconocedor en el teléfono, siempre disponible y local", () => {
    expect(voiceAvailability("onDevice", true)).toEqual({ available: true, onDevice: true });
    expect(voiceAvailability("onDevice", false)).toEqual({ available: true, onDevice: true });
  });

  it("solo con el servicio del sistema: bloqueado por defecto, permitido si la persona lo elige", () => {
    expect(voiceAvailability("system", true)).toEqual({ available: false, reason: "onlineOnly" });
    expect(voiceAvailability("system", false)).toEqual({ available: true, onDevice: false });
  });

  it("sin reconocedor: no disponible", () => {
    expect(voiceAvailability("none", false)).toEqual({ available: false, reason: "noRecognizer" });
  });

  it("un estado desconocido del módulo nativo cuenta como «nada»", () => {
    expect(parseEngineState("onDevice")).toBe("onDevice");
    expect(parseEngineState(true)).toBe("none");
    expect(parseEngineState(undefined)).toBe("none");
  });
});
