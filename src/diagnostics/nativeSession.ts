/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * nativeSession.ts — M2+M3 del diagnóstico del crash nativo (2026-10-31).
 *
 * El Crash B de la ronda (SIGSEGV, status 11, en proceso frío) dejó dos
 * preguntas que el informe de cierres no puede responder: ¿murió
 * generando? ¿y el indexado de fondo corría a la vez? Son las dos
 * mitades que separan las hipótesis vivas: H1 (solape nativo entre la
 * completion y el contexto de embeddings) frente a H2 (defecto de la
 * propia ruta de completion de la RC). Este módulo es el instrumento
 * que las separa sin pedir nada al dueño:
 *
 * - M2 — REGISTRO DE SESIÓN NATIVA: al empezar cada generación se
 *   persiste (sobrescribiendo) un registro con SOLO metadatos de
 *   sesión: instante, modelo, nCtx, hilos, perfil de memoria aceptado,
 *   estado del re-indexado y la bandera «generación en vuelo», que se
 *   limpia al completarse. Si el proceso muere generando, la bandera
 *   queda puesta en disco. Nada de contenido del usuario: ni prompts
 *   ni respuestas viajan aquí. La persistencia vive en LlamaEngine
 *   (fichero JSON junto a los modelos, a prueba de fallos, como el
 *   registro del CrashGuard); aquí viven el tipo, la lectura tolerante
 *   y el cruce, puros y testeables.
 *
 * - EL CRUCE: al arrancar, el registro se cruza con el último cierre
 *   que registró Android (ApplicationExitInfo, vía ram-monitor). Si
 *   ese cierre es posterior al inicio de la generación registrada y
 *   aún no se había cruzado, el cruce asienta el veredicto: murió o no
 *   murió generando, y si el indexado corría. El veredicto es lo que
 *   la tarjeta de cierres enseña («murió generando · indexado en
 *   curso: sí · perfil kv-q8 · nCtx 3072»). La variante nativa cargada
 *   no es legible desde el JS de llama.rn rc.7 (sin getter en el
 *   binding): el campo `backend` guarda como sustituto el resumen de
 *   getBackendDevicesInfo() de la sesión, una vez por sesión.
 *
 * - M3 — LA REACCIÓN: si el cruce dice CRASH_NATIVE con generación en
 *   vuelo, la muerte cuenta un choque en el CrashGuard (su factor
 *   ×0,8; el conteo lo aplica LlamaEngine, dueño del registro) y el
 *   indexado de fondo queda desactivado durante toda la sesión
 *   siguiente (la bandera de este módulo, que consultan reembed y los
 *   índices de packs dentro de los propios llamados). Los LOW_MEMORY
 *   NO se mezclan: son la cosecha del sistema en segundo plano
 *   (diagnóstico §5), un fenómeno aparte que no cuenta ni apaga nada.
 */

import * as FileSystem from "expo-file-system/legacy";
import type { ExitInfoLike } from "./crashReport";

/** El fichero del registro, junto a los modelos (inventario del borrado total: appReset.ts). */
export const NATIVE_SESSION_FILENAME = "nido-native-session.json";

/** Lo que el cruce asentó sobre la última muerte nativa cruzada. */
export interface NativeSessionVerdict {
  /** Instante del cierre (ApplicationExitInfo) que se cruzó. */
  exitAt: number;
  /** ¿La generación estaba en vuelo cuando el proceso murió? */
  diedGenerating: boolean;
  /** ¿El re-indexado de fondo corría al empezar aquella generación? */
  reembedRunning: boolean;
  model: string;
  nCtx: number;
  memoryProfile: string | null;
}

export interface NativeSessionRecord {
  /** Inicio de la generación registrada (ms epoch). */
  at: number;
  model: string;
  nCtx: number;
  nThreads: number;
  /** Perfil de memoria aceptado por llama.cpp (modelInfo); null si aún no se conoce. */
  memoryProfile: string | null;
  /** Estado del re-indexado al empezar: corriendo / hechos / total. */
  reembed: { running: boolean; done: number; total: number };
  /** La bandera: true mientras la generación registrada no se ha asentado. */
  generating: boolean;
  /** Sustituto de la variante nativa: resumen de getBackendDevicesInfo() de la sesión. */
  backend: string | null;
  /** El cierre ya cruzado (su timestamp): un mismo cierre nunca se cruza dos veces. */
  crossedExitAt: number | null;
  /** El veredicto de la última muerte CRASH_NATIVE cruzada, si la hubo. */
  verdict: NativeSessionVerdict | null;
}

export const EMPTY_NATIVE_SESSION_RECORD: NativeSessionRecord = {
  at: 0,
  model: "",
  nCtx: 0,
  nThreads: 0,
  memoryProfile: null,
  reembed: { running: false, done: 0, total: 0 },
  generating: false,
  backend: null,
  crossedExitAt: null,
  verdict: null,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Lectura tolerante del registro persistido: lo ilegible es un registro vacío. */
export function parseNativeSessionRecord(raw: string | null | undefined): NativeSessionRecord {
  if (!raw) return { ...EMPTY_NATIVE_SESSION_RECORD };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...EMPTY_NATIVE_SESSION_RECORD };
    const r = isRecord(parsed.reembed) ? parsed.reembed : {};
    const v = isRecord(parsed.verdict) ? parsed.verdict : null;
    return {
      at: num(parsed.at, 0),
      model: typeof parsed.model === "string" ? parsed.model : "",
      nCtx: num(parsed.nCtx, 0),
      nThreads: num(parsed.nThreads, 0),
      memoryProfile: strOrNull(parsed.memoryProfile),
      reembed: {
        running: r.running === true,
        done: num(r.done, 0),
        total: num(r.total, 0),
      },
      generating: parsed.generating === true,
      backend: strOrNull(parsed.backend),
      crossedExitAt:
        typeof parsed.crossedExitAt === "number" && Number.isFinite(parsed.crossedExitAt)
          ? parsed.crossedExitAt
          : null,
      verdict: v
        ? {
            exitAt: num(v.exitAt, 0),
            diedGenerating: v.diedGenerating === true,
            reembedRunning: v.reembedRunning === true,
            model: typeof v.model === "string" ? v.model : "",
            nCtx: num(v.nCtx, 0),
            memoryProfile: strOrNull(v.memoryProfile),
          }
        : null,
    };
  } catch {
    return { ...EMPTY_NATIVE_SESSION_RECORD };
  }
}

export interface NativeSessionCrossing {
  /** El registro tras el cruce (la MISMA referencia si nada cambió). */
  record: NativeSessionRecord;
  /** M3: la muerte cuenta un choque en el CrashGuard (solo CRASH_NATIVE generando). */
  countedNativeCrash: boolean;
  /** M3: el indexado de fondo queda desactivado durante esta sesión. */
  holdBackground: boolean;
}

/**
 * Cruza el registro con el ÚLTIMO cierre del proceso. Reglas:
 *
 * - Sin cierre, cierre ya cruzado, o cierre ANTERIOR al inicio de la
 *   generación registrada (ese cierre no es la muerte de este
 *   registro: es historia vieja o el mismo proceso sigue vivo): nada.
 * - Un cierre posterior y no cruzado asienta el registro: la bandera
 *   de generación cae (aquel proceso ya no existe) y el cierre queda
 *   marcado como cruzado para no contarlo dos veces.
 * - Solo CRASH_NATIVE produce veredicto; con generación en vuelo,
 *   además cuenta el choque y apaga el fondo (M3). Cualquier otro
 *   motivo (LOW_MEMORY, USER_REQUESTED…) se cruza en silencio: no
 *   cuenta, no apaga, no pisa el veredicto anterior.
 */
export function crossNativeSessionRecord(
  record: NativeSessionRecord,
  latestExit: ExitInfoLike | null,
): NativeSessionCrossing {
  const none: NativeSessionCrossing = { record, countedNativeCrash: false, holdBackground: false };
  if (!latestExit) return none;
  if (record.crossedExitAt === latestExit.timestamp) return none;
  if (latestExit.timestamp <= record.at) return none;
  const crossed: NativeSessionRecord = {
    ...record,
    crossedExitAt: latestExit.timestamp,
    generating: false,
  };
  if (latestExit.reason !== "CRASH_NATIVE") {
    return { record: crossed, countedNativeCrash: false, holdBackground: false };
  }
  const verdict: NativeSessionVerdict = {
    exitAt: latestExit.timestamp,
    diedGenerating: record.generating,
    reembedRunning: record.reembed.running,
    model: record.model,
    nCtx: record.nCtx,
    memoryProfile: record.memoryProfile,
  };
  const withVerdict: NativeSessionRecord = { ...crossed, verdict };
  if (!record.generating) {
    return { record: withVerdict, countedNativeCrash: false, holdBackground: false };
  }
  return { record: withVerdict, countedNativeCrash: true, holdBackground: true };
}

// ------------------------------------------------------------ M3: el fondo apagado esta sesión

/**
 * La bandera de sesión de M3: el cruce la levanta y la consultan los
 * indexadores dentro de sus propios llamados (como la puerta nativa
 * de M1), así ningún lanzador puede saltársela. Vive solo en memoria:
 * es una degradación de UNA sesión, no un ajuste del usuario; el
 * siguiente arranque sin muerte nueva arranca con el fondo normal.
 */
let backgroundHeld = false;

export function holdBackgroundIndexingForSession(): void {
  backgroundHeld = true;
}

export function isBackgroundIndexingHeld(): boolean {
  return backgroundHeld;
}

/** Borrado total y tests: la sesión degradada se olvida con todo lo demás. */
export function resetBackgroundIndexingHold(): void {
  backgroundHeld = false;
}

// ------------------------------------------------------------ lectura para superficies

export function nativeSessionFilePath(): string {
  return `${FileSystem.documentDirectory ?? ""}${NATIVE_SESSION_FILENAME}`;
}

/**
 * El registro persistido, para la tarjeta de cierres. null si no hay
 * fichero (nadie ha generado aún en este aparato) o no se puede leer.
 */
export async function readNativeSessionRecord(): Promise<NativeSessionRecord | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(nativeSessionFilePath());
    return parseNativeSessionRecord(raw);
  } catch {
    return null;
  }
}
