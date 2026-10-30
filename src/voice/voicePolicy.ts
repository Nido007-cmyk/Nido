/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * voicePolicy.ts — qué reconocedor de voz puede usar NIDO (puro, testeable).
 *
 * Auditoría 2026-10-29: «preferir sin conexión» no es una garantía. Por
 * defecto el dictado solo funciona con un reconocedor EN el teléfono
 * (Android 12+, createOnDeviceSpeechRecognizer). El servicio del sistema
 * puede mandar el audio a internet: usarlo lo decide la persona en Ajustes.
 */

/** Lo que el teléfono ofrece: reconocedor en el teléfono, servicio del sistema, o nada. */
export type VoiceEngineState = "onDevice" | "system" | "none";

export type VoiceAvailability =
  | { available: true; onDevice: boolean }
  | { available: false; reason: "noRecognizer" | "onlineOnly" };

export function voiceAvailability(state: VoiceEngineState, onDeviceOnly: boolean): VoiceAvailability {
  if (state === "onDevice") return { available: true, onDevice: true };
  if (state === "system") return onDeviceOnly ? { available: false, reason: "onlineOnly" } : { available: true, onDevice: false };
  return { available: false, reason: "noRecognizer" };
}

export function parseEngineState(raw: unknown): VoiceEngineState {
  return raw === "onDevice" || raw === "system" ? raw : "none";
}
