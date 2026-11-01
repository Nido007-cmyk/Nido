/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P-01 paso 1: migra EN SITIO los vectores almacenados de la base del
 * usuario, de float32 (dim*4 B) a int8 (dim B), y al drenar voltea el
 * sello de escritura (db.ts) para que lo nuevo nazca ya en int8.
 *
 * Espejo de las garantías de reembed.ts, que es quien la encadena al
 * terminar (ver reembedMissing):
 * - Por lotes y en segundo plano; la búsqueda sirve durante todo el
 *   proceso porque el lector es dual y la base mixta es un estado
 *   válido permanente.
 * - Reanudable: el progreso no vive en memoria — es el conteo de filas
 *   aún en float32. Una muerte del proceso a mitad de lote deja el lote
 *   sin aplicar o aplicado entero (una transacción por lote), y la
 *   siguiente apertura continúa donde el conteo diga.
 * - Idempotente: cada UPDATE exige que la fila siga en float32; una
 *   segunda corrida sobre una base migrada no encuentra filas y las
 *   filas quedan byte a byte iguales.
 * - Aparca mientras una generación está en vuelo (la misma puerta
 *   nativeGate que la cadena de crashes le dio a reembed.ts) y no
 *   arranca si el indexado de fondo está retenido en la sesión.
 * - Si un cambio de modelo aterriza a mitad (resetEmbeddingsForModel
 *   borra todas las filas y re-sella), el lote en curso no escribe nada
 *   y la migración termina sin filas y sin error: ya no hay nada suyo
 *   que migrar.
 *
 * PUNTO SIN RETORNO, declarado: la conversión es con pérdida — de int8
 * no se vuelve al float32 original. Revertir el LECTOR es gratis (es
 * dual), pero revertir los DATOS exigiría re-embedir (reembed.ts).
 */
import {
  countFloat32VectorRows,
  getDbEpoch,
  getEmbeddingStamp,
  listFloat32VectorBatch,
  sealVectorStorageInt8,
  storeQuantizedVectorBatch,
} from "./db";
import { quantizeVectorInt8 } from "./pure";
import { isNativeGateTaken, waitForNativeGateFree } from "../inference/nativeGate";
import { isBackgroundIndexingHeld } from "../diagnostics/nativeSession";

export interface VectorFormatMigrationProgress {
  /** Filas aún en float32 cuando se emitió el progreso. */
  remaining: number;
  running: boolean;
}

const BATCH = 64;

type Listener = (p: VectorFormatMigrationProgress) => void;
const listeners = new Set<Listener>();
let current: Promise<VectorFormatMigrationProgress> | null = null;
let last: VectorFormatMigrationProgress = { remaining: 0, running: false };

function emit(p: VectorFormatMigrationProgress) {
  last = p;
  for (const l of listeners) {
    try {
      l(p);
    } catch {
      /* a listener's bug never stops the work */
    }
  }
}

export function onVectorFormatMigrationProgress(listener: Listener): () => void {
  listeners.add(listener);
  listener(last);
  return () => listeners.delete(listener);
}

export function lastVectorFormatMigrationProgress(): VectorFormatMigrationProgress {
  return last;
}

/** Arranca (o se une a) la migración de formato. Resuelve al drenar y sellar, o al tener que parar. */
export function migrateVectorStorageFormat(): Promise<VectorFormatMigrationProgress> {
  if (current) return current;
  current = run().finally(() => {
    current = null;
  });
  return current;
}

async function run(): Promise<VectorFormatMigrationProgress> {
  // Hay suites que mockean ./db parcialmente (reembed.test.ts, alcanzado
  // por el encadenado desde reembedMissing): sin estas funciones no hay
  // migración posible y la respuesta correcta es no hacer nada, en
  // silencio — la migración de verdad corre en la app, no en ese mock.
  if (
    typeof countFloat32VectorRows !== "function" ||
    typeof listFloat32VectorBatch !== "function" ||
    typeof storeQuantizedVectorBatch !== "function" ||
    typeof sealVectorStorageInt8 !== "function"
  ) {
    return last;
  }
  // La misma retención de sesión que reembed: si el arranque cruzó una
  // muerte con generación en vuelo, el trabajo de fondo no se repite
  // contra esta sesión. La deuda sigue ahí; la próxima apertura la recoge.
  if (isBackgroundIndexingHeld()) return last;
  const epoch = getDbEpoch();
  let remaining = 0;
  try {
    remaining = await countFloat32VectorRows();
    emit({ remaining, running: true });
    for (;;) {
      // Clear All Data desde que empezamos: parar; la base nueva no
      // hereda trabajo del ciclo anterior (y sus writes fallarían por
      // epoch de todos modos).
      if (getDbEpoch() !== epoch) break;
      // Generación en vuelo: aparcar por lote y reanudar al liberarse.
      if (isNativeGateTaken()) {
        await waitForNativeGateFree();
        if (getDbEpoch() !== epoch) break;
      }
      const stamp = await getEmbeddingStamp();
      const batch = await listFloat32VectorBatch(BATCH);
      if (batch.length === 0) break;
      const before = await countFloat32VectorRows();
      const updates = batch.map((row) => {
        const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dim);
        return { chunkId: row.chunkId, bytes: quantizeVectorInt8(vec) };
      });
      const ok = await storeQuantizedVectorBatch(updates, stamp, { lifecycleEpoch: epoch });
      // El modelo cambió a mitad de lote (o el ciclo terminó): el reset
      // ya borró las filas; la migración acaba aquí, sin error.
      if (!ok) break;
      remaining = await countFloat32VectorRows();
      emit({ remaining, running: true });
      if (remaining === 0) break;
      // Sin progreso neto (otro escritor repone float32 al mismo ritmo):
      // parar y dejar el resto a la siguiente apertura antes que girar.
      if (remaining >= before) break;
    }
    // Drenado o no, intentar el sellado solo vale con el ciclo intacto;
    // el volteo revalida dentro de su transacción (modelo + conteo 0),
    // así que en cualquier otro estado devuelve false sin tocar nada.
    if (getDbEpoch() === epoch) {
      const stamp = await getEmbeddingStamp();
      await sealVectorStorageInt8(stamp, { lifecycleEpoch: epoch });
      remaining = await countFloat32VectorRows();
    }
  } catch (e) {
    // Base reseteada a mitad, driver no disponible en este entorno, etc.:
    // parar en silencio funcional — la búsqueda no depende de esto y la
    // siguiente apertura lo reintenta.
    console.warn(
      "[vector-format] migration stopped:",
      e instanceof Error ? e.message : String(e)
    );
  }
  emit({ remaining, running: false });
  return last;
}
