import { requireOptionalNativeModule, EventSubscription } from "expo-modules-core";

export type VoiceEvent =
  | { type: "start" }
  | { type: "end" }
  | { type: "partial"; text: string }
  | { type: "result"; text: string }
  | { type: "error"; code: string; message: string };

interface VoiceInputNativeModule {
  isAvailable(): Promise<boolean>;
  startListening(): Promise<void>;
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
export async function isVoiceInputAvailable(): Promise<boolean> {
  if (!VoiceInputNative) return false;
  try {
    return await VoiceInputNative.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Starts one listening session, requesting on-device (offline) recognition
 * via EXTRA_PREFER_OFFLINE (see modules/voice-input). Resolves with the
 * final transcript once the recognizer reports a result, or null on
 * error/cancel. `onEvent` is optional, for UI feedback (e.g. partial
 * results, listening state) beyond the final resolved text.
 */
export function startListening(onEvent?: (event: VoiceEvent) => void): Promise<string | null> {
  if (!VoiceInputNative) return Promise.resolve(null);

  return new Promise((resolve) => {
    const subscriptions: EventSubscription[] = [];
    let resolved = false;

    const finish = (text: string | null) => {
      if (resolved) return;
      resolved = true;
      subscriptions.forEach((s) => s.remove());
      resolve(text);
    };

    subscriptions.push(
      VoiceInputNative.addListener("onSpeechStart", () => onEvent?.({ type: "start" })),
      VoiceInputNative.addListener("onSpeechEnd", () => onEvent?.({ type: "end" })),
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

    VoiceInputNative.startListening().catch(() => finish(null));
  });
}

export async function stopListening(): Promise<void> {
  if (!VoiceInputNative) return;
  await VoiceInputNative.stopListening().catch(() => {});
}
