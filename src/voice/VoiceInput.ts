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
  /** 0.1.124: Whisper terminó de grabar y está transcribiendo. */
  | { type: "transcribing" }
  | { type: "partial"; text: string }
  | { type: "result"; text: string }
  | { type: "error"; code: string; message: string };

interface VoiceInputNativeModule {
  isAvailable(): Promise<boolean>;
  engineState(): Promise<string>;
  startListening(onDeviceOnly: boolean): Promise<void>;
  stopListening(): Promise<void>;
  /** 0.1.124: grabación WAV 16 kHz mono para Whisper (solo en el teléfono). */
  startRecording?(path: string, maxMs: number): Promise<void>;
  stopRecording?(): Promise<{ path: string; durationMs: number } | null>;
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

/**
 * 0.1.124: ¿está el modelo de Whisper descargado? (La puerta de confianza
 * lo comprueba de verdad antes de abrirlo, en transcribeWithWhisper.)
 */
export async function whisperModelPresent(): Promise<boolean> {
  if (!VoiceInputNative?.startRecording) return false;
  try {
    const { whisperAsset } = await import("./whisperDictation");
    const asset = whisperAsset();
    if (!asset) return false;
    const FileSystem = await import("expo-file-system/legacy");
    const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}${asset.filename}`);
    return info.exists && (info as { size?: number }).size === asset.sizeBytes;
  } catch {
    return false;
  }
}

/** Si el dictado puede usarse ahora, con el ajuste «solo en el teléfono». */
export async function voiceInputAvailability(): Promise<VoiceAvailability> {
  const [state, onDeviceOnly, whisper] = await Promise.all([
    voiceEngineState(),
    getVoiceOnDeviceOnly().catch(() => true),
    whisperModelPresent(),
  ]);
  // 0.1.124: Whisper es en el teléfono por construcción.
  if (whisper) return { available: true, onDevice: true };
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

/** 0.1.124: la sesión de Whisper en curso (para que stopListening la pare). */
let whisperSession: { stop: () => void } | null = null;

/**
 * 0.1.124 (decisión del dueño: «Whisper primero, Android de respaldo»):
 * Whisper si su modelo está descargado y cabe en la memoria de ahora; si
 * no, el reconocedor de Android como hasta ahora.
 */
export async function startListening(onEvent?: (event: VoiceEvent) => void): Promise<string | null> {
  if (!VoiceInputNative) return null;
  if (await whisperModelPresent()) {
    const { whisperAsset, whisperFitsNow } = await import("./whisperDictation");
    const { readRamSnapshot } = await import("../inference/ramBudget");
    const asset = whisperAsset();
    if (asset && whisperFitsNow(readRamSnapshot(), asset.sizeBytes)) {
      return listenWithWhisper(onEvent);
    }
  }
  return listenWithAndroid(onEvent);
}

function listenWithWhisper(onEvent?: (event: VoiceEvent) => void): Promise<string | null> {
  const native = VoiceInputNative!;
  return new Promise((resolve) => {
    let finished = false;
    let limitSub: EventSubscription | null = null;
    const done = (text: string | null) => {
      if (finished) return;
      finished = true;
      limitSub?.remove();
      whisperSession = null;
      resolve(text);
    };
    const stopAndTranscribe = async () => {
      if (whisperSession === null) return;
      whisperSession = null;
      try {
        const rec = await native.stopRecording!();
        onEvent?.({ type: "end" });
        if (!rec) return done(null);
        onEvent?.({ type: "transcribing" });
        const { transcribeWithWhisper } = await import("./whisperDictation");
        const i18n = (await import("../i18n")).default as { language?: string };
        const text = await transcribeWithWhisper(rec.path, { uiLanguage: i18n.language });
        onEvent?.({ type: "result", text });
        done(text.length > 0 ? text : null);
      } catch (e) {
        onEvent?.({ type: "error", code: "whisper", message: e instanceof Error ? e.message : String(e) });
        done(null);
      }
    };
    void (async () => {
      try {
        const FileSystem = await import("expo-file-system/legacy");
        const { dictationWavPath, WHISPER_MAX_RECORD_MS } = await import("./whisperDictation");
        const path = dictationWavPath(FileSystem.cacheDirectory ?? "");
        limitSub = native.addListener("onRecordLimit", () => void stopAndTranscribe());
        whisperSession = { stop: () => void stopAndTranscribe() };
        await native.startRecording!(path, WHISPER_MAX_RECORD_MS);
        onEvent?.({ type: "start" });
      } catch (e) {
        whisperSession = null;
        onEvent?.({ type: "error", code: "record", message: e instanceof Error ? e.message : String(e) });
        done(null);
      }
    })();
  });
}

function listenWithAndroid(onEvent?: (event: VoiceEvent) => void): Promise<string | null> {
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
  // 0.1.124: con Whisper, parar es «termina de grabar y transcribe».
  if (whisperSession) {
    whisperSession.stop();
    return;
  }
  await VoiceInputNative.stopListening().catch(() => {});
}
