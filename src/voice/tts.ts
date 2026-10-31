/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * tts.ts — NIDO: lectura en voz alta 100% offline.
 *
 * Usa el motor TTS del sistema Android (voces preinstaladas, sin red).
 * Nada de lo que se lee sale del teléfono.
 */

import * as Speech from "expo-speech";
import i18n from "../i18n";

/**
 * Auditoría completa 2026-10-31 (F1 M-3): la lectura forzaba siempre
 * voz y locale es-MX, con la app en inglés o en portugués el texto se
 * leía con voz española y resultaba difícil de entender. El locale de
 * lectura sale ahora del idioma de la app, con la variante regional
 * que la app ya usa como referencia en cada idioma.
 */
const SPEECH_LOCALES: Record<string, string> = {
  es: "es-MX",
  en: "en-US",
  pt: "pt-BR",
};

export function speechLocaleFor(appLanguage: string | null | undefined): string {
  const base = (appLanguage ?? "").toLowerCase().split("-")[0];
  // Sin idioma conocido manda la lengua de respaldo declarada (en).
  return SPEECH_LOCALES[base] ?? "en-US";
}

const voiceCache = new Map<string, string | null>();

/** Elige la mejor voz del idioma de lectura disponible en el dispositivo. */
async function pickVoice(locale: string): Promise<string | undefined> {
  const cached = voiceCache.get(locale);
  if (cached !== undefined) return cached ?? undefined;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const lang = locale.toLowerCase();
    const prefix = lang.split("-")[0];
    const same = voices.filter((v) => v.language?.toLowerCase().startsWith(prefix));
    const pick =
      same.find((v) => v.language.toLowerCase().startsWith(lang)) ?? same[0];
    voiceCache.set(locale, pick?.identifier ?? null);
    return pick?.identifier;
  } catch {
    voiceCache.set(locale, null);
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

/** Lee un texto en voz alta en el idioma de la app. Corta lo anterior. */
export async function speakAloud(text: string): Promise<void> {
  const clean = cleanForSpeech(text);
  if (!clean) return;
  try {
    await Speech.stop();
    const locale = speechLocaleFor(i18n.language);
    const voice = await pickVoice(locale);
    Speech.speak(clean, {
      language: locale,
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
