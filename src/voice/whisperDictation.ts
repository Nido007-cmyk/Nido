/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.125 (etapa 3) — dictado con Whisper, en el teléfono y sin internet.
 *
 * Decisiones del dueño: modelo «base» multilingüe (~145 MB) y «Whisper
 * primero, Android de respaldo». PocketPal usa whisper.rn para lo mismo;
 * NIDO lo hace con sus propias reglas:
 *  - El modelo es una entrada del catálogo firmado (whisper-base) y pasa
 *    por la puerta de confianza antes de abrirse (assertTrustedModelFile).
 *  - Se carga solo para transcribir y se libera al acabar: en un aparato
 *    de 4 GiB no comparte memoria con el modelo de chat más de lo justo.
 *  - Si no cabe en la memoria de ese momento, no se intenta: el dictado
 *    cae al reconocedor de Android en el teléfono (whisperFitsNow).
 *  - El audio se graba a un WAV en la caché (módulo nativo voice-input)
 *    y se BORRA en cuanto termina la transcripción, salga bien o mal.
 */

import * as FileSystem from "expo-file-system/legacy";
import { MODEL_CATALOG, type CatalogModel } from "../models/manifest";
import type { RamSnapshot } from "../inference/ramBudget";

/** El modelo de voz del catálogo (único de su tipo). */
export function whisperAsset(): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.kind === "speech");
}

/** Tope de una grabación: Whisper trabaja en ventanas de 30 s. */
export const WHISPER_MAX_RECORD_MS = 30_000;

/**
 * Memoria que necesita whisper.cpp «base» en total (pesos + búferes de
 * trabajo): ~388 MB según la tabla de memoria del README de whisper.cpp
 * (base: 142 MiB en disco, ~388 MB de memoria). Se usa la cifra publicada
 * entera, no solo el tamaño del fichero.
 */
export const WHISPER_BASE_MEMORY_BYTES = 388 * 1000 * 1000;

/** Margen que se deja libre por encima del umbral de memoria baja. */
export const WHISPER_LIVE_MARGIN_BYTES = 128 * 1024 * 1024;

/**
 * ¿Cabe Whisper AHORA? Lo libre en este momento, menos el umbral de
 * memoria baja de Android y un margen, debe cubrir la memoria publicada
 * de whisper.cpp base (o el fichero, si fuera mayor). Sin lectura de
 * memoria, no se arriesga (false → reconocedor de Android).
 */
export function whisperFitsNow(snapshot: RamSnapshot | null, modelBytes: number): boolean {
  if (!snapshot || snapshot.availBytes == null || snapshot.lowMemThresholdBytes == null) return false;
  const room = snapshot.availBytes - snapshot.lowMemThresholdBytes - WHISPER_LIVE_MARGIN_BYTES;
  return room >= Math.max(WHISPER_BASE_MEMORY_BYTES, modelBytes);
}

/** Idioma para Whisper según la interfaz: es/en/pt fijos; el resto, autodetección. */
export function whisperLanguageFor(uiLanguage: string | undefined | null): "es" | "en" | "pt" | "auto" {
  const l = (uiLanguage ?? "").slice(0, 2).toLowerCase();
  return l === "es" || l === "en" || l === "pt" ? l : "auto";
}

/**
 * Limpia la salida de Whisper: quita marcas de no-habla que el modelo
 * escribe entre corchetes o paréntesis ([BLANK_AUDIO], (música), [Música])
 * y espacios sobrantes. Una salida que solo era eso queda vacía.
 */
export function cleanWhisperText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\[[^\]]{1,40}\]/g, " ")
    .replace(/\((?:m[uú]sica|music|música|aplausos|applause|risas|laughter|silencio|silence|ruido|noise)\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 0.1.125 (auditoría de la casa, E-1): fallos seguidos a partir de los
 * cuales Whisper se aparta en este aparato y versión de la app.
 */
export const WHISPER_SUSPEND_AFTER = 2;

/** ¿Está Whisper apartado por fallos seguidos en esta versión de la app? */
export function whisperSuspended(record: { count: number; appVersion: string } | null, appVersion: string): boolean {
  return record !== null && record.appVersion === appVersion && record.count >= WHISPER_SUSPEND_AFTER;
}

/** El registro tras un fallo: suma en la misma versión, empieza de 1 en otra. */
export function afterWhisperFailure(record: { count: number; appVersion: string } | null, appVersion: string) {
  return { count: record && record.appVersion === appVersion ? record.count + 1 : 1, appVersion };
}

/** ¿Es un WAV temporal del dictado? (para barrer los que quedaron de una sesión cortada). */
export function isDictationWav(name: string): boolean {
  return /^dictation-\d+\.wav$/.test(name);
}

/** Ruta del WAV temporal de una sesión de dictado (en la caché, que el borrado total elimina). */
export function dictationWavPath(cacheDir: string, now: number = Date.now()): string {
  return `${cacheDir}dictation-${now}.wav`;
}

export interface WhisperRuntime {
  initWhisper: (o: { filePath: string }) => Promise<{
    transcribe: (path: string, o: Record<string, unknown>) => { promise: Promise<{ result: string }> };
    release: () => Promise<void>;
  }>;
}

/**
 * Transcribe el WAV con Whisper y lo borra SIEMPRE al acabar. Devuelve el
 * texto limpio ("" si no se dijo nada). Lanza si Whisper falla: quien
 * llama decide el respaldo.
 */
export async function transcribeWithWhisper(
  wavPath: string,
  opts: { uiLanguage?: string | null; threads?: number; runtime?: WhisperRuntime } = {},
): Promise<string> {
  const asset = whisperAsset();
  try {
    if (!asset) throw new Error("whisper: no speech model in the catalog");
    const { assertTrustedModelFile } = await import("../models/modelTrust");
    await assertTrustedModelFile(asset);
    const runtime: WhisperRuntime = opts.runtime ?? ((await import("whisper.rn/index")) as unknown as WhisperRuntime);
    const ctx = await runtime.initWhisper({ filePath: `${FileSystem.documentDirectory}${asset.filename}` });
    try {
      const lang = whisperLanguageFor(opts.uiLanguage);
      // whisper.cpp abre una ruta del sistema de ficheros, sin «file://».
      const { promise } = ctx.transcribe(wavPath.replace(/^file:\/\//, ""), {
        language: lang,
        translate: false,
        maxThreads: Math.max(1, Math.min(4, opts.threads ?? 4)),
      });
      const result = await promise;
      return cleanWhisperText(result?.result);
    } finally {
      await ctx.release().catch(() => {});
    }
  } finally {
    // deleteAsync de expo solo acepta URIs: una ruta desnuda fallaría en
    // silencio y el audio se quedaría en la caché.
    const uri = wavPath.startsWith("file://") ? wavPath : `file://${wavPath}`;
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}
