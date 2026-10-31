/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { requireOptionalNativeModule, EventSubscription } from "expo-modules-core";
import { getVoiceOnDeviceOnly } from "../models/settings";
import { parseEngineState, voiceAvailability, type VoiceAvailability, type VoiceEngineState } from "./voicePolicy";

export type VoiceEvent =
  | { type: "start" }
  | { type: "end" }
  | { type: "partial"; text: string }
  | { type: "result"; text: string }
  | { type: "error"; code: string; message: string };

interface VoiceInputNativeModule {
  isAvailable(): Promise<boolean>;
  engineState(): Promise<string>;
  startListening(onDeviceOnly: boolean): Promise<void>;
  stopListening(): Promise<void>;
  addListener(eventName: string, listener: (event: any) => void): EventSubscription;
}

const VoiceInputNative = requireOptionalNativeModule<VoiceInputNativeModule>("VoiceInput");

/**
 * Whether an on-device speech recognition service is available at all.
 * Android's SpeechRecognizer needs a system-provided recognition service
 * (Google's, or an OEM's) — commonly absent on GrapheneOS / de-Googled
 * builds with no such service installed. Returns false there rather than
 * pretending to work.
 */
export async function voiceEngineState(): Promise<VoiceEngineState> {
  if (!VoiceInputNative) return "none";
  try {
    return parseEngineState(await VoiceInputNative.engineState());
  } catch {
    return "none";
  }
}

/** Si el dictado puede usarse ahora, con el ajuste «solo en el teléfono». */
export async function voiceInputAvailability(): Promise<VoiceAvailability> {
  const [state, onDeviceOnly] = await Promise.all([voiceEngineState(), getVoiceOnDeviceOnly().catch(() => true)]);
  return voiceAvailability(state, onDeviceOnly);
}

export async function isVoiceInputAvailable(): Promise<boolean> {
  return (await voiceInputAvailability()).available;
}

/**
 * Starts one listening session. With «solo en el teléfono» (the default) the
 * native side uses the on-device recognizer or refuses; otherwise it prefers
 * the on-device one and falls back to the system service with
 * EXTRA_PREFER_OFFLINE (see modules/voice-input). Resolves with the
 * final transcript once the recognizer reports a result, or null on
 * error/cancel. `onEvent` is optional, for UI feedback (e.g. partial
 * results, listening state) beyond the final resolved text.
 */
/**
 * Auditoría completa 2026-10-31 (F1 M-4): margen tras el fin de la
 * voz. El reconocedor emite primero el fin (onEndOfSpeech) y después
 * el resultado o el error, así que no se puede resolver en el fin
 * sin romper el dictado normal; pero si tras el fin no llega ni
 * resultado ni error (el usuario paró con otro toque y el nativo
 * solo emitió el fin), la promesa quedaba colgada para siempre y
 * los oyentes vivos. Pasado este margen sin desenlace, la sesión
 * se cierra con null y los oyentes se quitan: un resultado tardío
 * ya no puede llamar a onEvent con la sesión muerta.
 */
const END_GRACE_MS = 1000;

export function startListening(onEvent?: (event: VoiceEvent) => void): Promise<string | null> {
  if (!VoiceInputNative) return Promise.resolve(null);

  return new Promise((resolve) => {
    const subscriptions: EventSubscription[] = [];
    let resolved = false;
    let endTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (text: string | null) => {
      if (resolved) return;
      resolved = true;
      if (endTimer) clearTimeout(endTimer);
      subscriptions.forEach((s) => s.remove());
      resolve(text);
    };

    subscriptions.push(
      VoiceInputNative.addListener("onSpeechStart", () => onEvent?.({ type: "start" })),
      VoiceInputNative.addListener("onSpeechEnd", () => {
        onEvent?.({ type: "end" });
        if (!endTimer) endTimer = setTimeout(() => finish(null), END_GRACE_MS);
      }),
      VoiceInputNative.addListener("onPartialResults", (e: { text: string }) =>
        onEvent?.({ type: "partial", text: e.text })
      ),
      VoiceInputNative.addListener("onResults", (e: { text: string }) => {
        onEvent?.({ type: "result", text: e.text });
        finish(e.text);
      }),
      VoiceInputNative.addListener("onError", (e: { code: string; message: string }) => {
        onEvent?.({ type: "error", code: e.code, message: e.message });
        finish(null);
      })
    );

    getVoiceOnDeviceOnly()
      .catch(() => true)
      .then((onDeviceOnly) => VoiceInputNative.startListening(onDeviceOnly))
      .catch(() => finish(null));
  });
}

export async function stopListening(): Promise<void> {
  if (!VoiceInputNative) return;
  await VoiceInputNative.stopListening().catch(() => {});
}
