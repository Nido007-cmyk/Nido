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
  /** 0.1.125: Whisper terminó de grabar y está transcribiendo. */
  | { type: "transcribing" }
  /**
   * 0.1.125 (auditoría de la casa, E-1): Whisper falló en esta sesión y el
   * dictado sigue con el reconocedor de Android (hay que volver a hablar).
   */
  | { type: "fallback"; stage: "record" | "transcribe"; message: string }
  | { type: "partial"; text: string }
  | { type: "result"; text: string }
  | { type: "error"; code: string; message: string };

interface VoiceInputNativeModule {
  isAvailable(): Promise<boolean>;
  engineState(): Promise<string>;
  startListening(onDeviceOnly: boolean): Promise<void>;
  stopListening(): Promise<void>;
  /** 0.1.125: grabación WAV 16 kHz mono para Whisper (solo en el teléfono). */
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
 * 0.1.125: ¿está el modelo de Whisper descargado? (La puerta de confianza
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
  // 0.1.125: Whisper es en el teléfono por construcción.
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

/** 0.1.125: la sesión de Whisper en curso (para que stopListening la pare). */
let whisperSession: { stop: () => void } | null = null;

/**
 * 0.1.125 (decisión del dueño: «Whisper primero, Android de respaldo»):
 * Whisper si su modelo está descargado, cabe en la memoria de ahora y no
 * está apartado por fallos seguidos; si no, el reconocedor de Android como
 * hasta ahora. Auditoría de la casa (E-1): el respaldo cubre también el
 * FALLO de Whisper en la sesión (grabar o transcribir), no solo el modelo
 * ausente o la falta de memoria.
 */
export async function startListening(onEvent?: (event: VoiceEvent) => void): Promise<string | null> {
  if (!VoiceInputNative) return null;
  // E-2: barre los WAV que quedaron de una sesión cortada (proceso muerto
  // grabando): el audio no sobrevive a la sesión que lo grabó.
  await sweepDictationWavs();
  if (await whisperModelPresent()) {
    const { whisperAsset, whisperFitsNow, whisperSuspended } = await import("./whisperDictation");
    const { readRamSnapshot } = await import("../inference/ramBudget");
    const { getWhisperFailures } = await import("../models/settings");
    const { APP_VERSION } = await import("../security/backup");
    const asset = whisperAsset();
    const suspended = whisperSuspended(await getWhisperFailures().catch(() => null), APP_VERSION);
    if (asset && !suspended && whisperFitsNow(readRamSnapshot(), asset.sizeBytes)) {
      return listenWithWhisper(onEvent);
    }
  }
  return listenWithAndroid(onEvent);
}

/** E-2: borra los WAV de dictado que haya en la caché. Nunca lanza. */
async function sweepDictationWavs(): Promise<void> {
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const dir = FileSystem.cacheDirectory;
    if (!dir || typeof FileSystem.readDirectoryAsync !== "function") return;
    const { isDictationWav } = await import("./whisperDictation");
    for (const name of await FileSystem.readDirectoryAsync(dir)) {
      if (isDictationWav(name)) await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => {});
    }
  } catch {
    // Higiene: si falla, el próximo dictado lo reintenta.
  }
}

/** E-1: anota un fallo de Whisper (con 2 seguidos en esta versión se aparta). */
async function noteWhisperFailure(): Promise<void> {
  try {
    const { afterWhisperFailure } = await import("./whisperDictation");
    const { getWhisperFailures, setWhisperFailures } = await import("../models/settings");
    const { APP_VERSION } = await import("../security/backup");
    await setWhisperFailures(afterWhisperFailure(await getWhisperFailures(), APP_VERSION));
  } catch {
    // Sin registro, el siguiente dictado vuelve a intentar Whisper.
  }
}

async function noteWhisperSuccess(): Promise<void> {
  try {
    const { getWhisperFailures, setWhisperFailures } = await import("../models/settings");
    if (await getWhisperFailures()) await setWhisperFailures(null);
  } catch {
    // Nada que limpiar.
  }
}

function listenWithWhisper(onEvent?: (event: VoiceEvent) => void): Promise<string | null> {
  const native = VoiceInputNative!;
  return new Promise((resolve) => {
    let finished = false;
    let limitSub: EventSubscription | null = null;
    let wavPath: string | null = null;
    const done = (text: string | null) => {
      if (finished) return;
      finished = true;
      limitSub?.remove();
      whisperSession = null;
      resolve(text);
    };
    // E-2: el audio se borra al acabar, salga bien o mal (transcribeWithWhisper
    // ya lo borra; esto cubre stopRecording fallido o sin transcripción).
    const deleteWav = async () => {
      if (!wavPath) return;
      const FileSystem = await import("expo-file-system/legacy");
      await FileSystem.deleteAsync(wavPath, { idempotent: true }).catch(() => {});
    };
    // E-1: si Whisper falla, la sesión cae al reconocedor de Android.
    const fallBackToAndroid = async (stage: "record" | "transcribe", e: unknown) => {
      await noteWhisperFailure();
      onEvent?.({ type: "fallback", stage, message: e instanceof Error ? e.message : String(e) });
      done(await listenWithAndroid(onEvent));
    };
    const stopAndTranscribe = async () => {
      if (whisperSession === null) return;
      whisperSession = null;
      let rec: { path: string; durationMs: number } | null;
      try {
        rec = await native.stopRecording!();
      } catch (e) {
        await deleteWav();
        return fallBackToAndroid("record", e);
      }
      onEvent?.({ type: "end" });
      if (!rec) {
        await deleteWav();
        return done(null);
      }
      onEvent?.({ type: "transcribing" });
      try {
        const { transcribeWithWhisper } = await import("./whisperDictation");
        const i18n = (await import("../i18n")).default as { language?: string };
        // La URI que creó esta sesión (file://…), no la ruta que devuelve el
        // nativo: con ella se transcribe y, sobre todo, se BORRA (deleteAsync
        // de expo solo acepta URIs file://).
        const text = await transcribeWithWhisper(wavPath ?? rec.path, { uiLanguage: i18n.language });
        await noteWhisperSuccess();
        onEvent?.({ type: "result", text });
        done(text.length > 0 ? text : null);
      } catch (e) {
        await deleteWav();
        return fallBackToAndroid("transcribe", e);
      }
    };
    void (async () => {
      try {
        const FileSystem = await import("expo-file-system/legacy");
        const { dictationWavPath, WHISPER_MAX_RECORD_MS } = await import("./whisperDictation");
        wavPath = dictationWavPath(FileSystem.cacheDirectory ?? "");
        limitSub = native.addListener("onRecordLimit", () => void stopAndTranscribe());
        whisperSession = { stop: () => void stopAndTranscribe() };
        await native.startRecording!(wavPath, WHISPER_MAX_RECORD_MS);
        onEvent?.({ type: "start" });
      } catch (e) {
        whisperSession = null;
        limitSub?.remove();
        await deleteWav();
        // El permiso de micrófono denegado no es un fallo de Whisper: Android
        // también lo necesita, así que ahí no hay respaldo posible.
        if ((e as { code?: string })?.code === "E_PERMISSION_DENIED") {
          onEvent?.({ type: "error", code: "E_PERMISSION_DENIED", message: e instanceof Error ? e.message : String(e) });
          return done(null);
        }
        await fallBackToAndroid("record", e);
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
  // 0.1.125: con Whisper, parar es «termina de grabar y transcribe».
  if (whisperSession) {
    whisperSession.stop();
    return;
  }
  await VoiceInputNative.stopListening().catch(() => {});
}
