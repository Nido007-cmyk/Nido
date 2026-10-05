/**
 * tts.ts — NIDO: lectura en voz alta 100% offline.
 *
 * Usa el motor TTS del sistema Android (voces preinstaladas, sin red).
 * Nada de lo que se lee sale del teléfono.
 */

import * as Speech from "expo-speech";

let cachedVoiceId: string | null | undefined;

/** Elige la mejor voz en español disponible en el dispositivo. */
async function pickSpanishVoice(): Promise<string | undefined> {
  if (cachedVoiceId !== undefined) return cachedVoiceId ?? undefined;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const es = voices.filter((v) => v.language?.toLowerCase().startsWith("es"));
    const pick =
      es.find((v) => v.language.toLowerCase().startsWith("es-mx")) ??
      es.find((v) => v.language.toLowerCase().startsWith("es-es")) ??
      es.find((v) => v.language.toLowerCase().startsWith("es-us")) ??
      es[0];
    cachedVoiceId = pick?.identifier ?? null;
    return pick?.identifier;
  } catch {
    cachedVoiceId = null;
    return undefined;
  }
}

/** Limpia markdown y bloques de código antes de leer. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#*_>~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 2000);
}

/** Lee un texto en voz alta con voz en español. Corta lo anterior. */
export async function speakAloud(text: string): Promise<void> {
  const clean = cleanForSpeech(text);
  if (!clean) return;
  try {
    await Speech.stop();
    const voice = await pickSpanishVoice();
    Speech.speak(clean, {
      language: "es-MX",
      voice,
      rate: 1.0,
      pitch: 1.0,
    });
  } catch {
    // TTS no disponible: se ignora en silencio, el texto sigue visible.
  }
}

/** Detiene la lectura en curso. */
export function stopSpeaking(): void {
  Speech.stop().catch(() => {});
}
