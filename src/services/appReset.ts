import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";
import { llamaEngine } from "../inference/LlamaEngine";
import { embeddingEngine } from "../rag/embed";
import { closeAllPacks } from "../rag/packs";
import { resetDatabase, KNOWLEDGE_DB_NAME, LEGACY_KNOWLEDGE_DB_NAME } from "../rag/db";
import { clearMemoryDb, resetMemoryKeyCache, MEMORY_DB_NAME } from "../agent/memory/memoryStore";
import { resetDownloadState } from "./downloadManager";
import { clearSettings } from "../models/settings";
import { installStatePath } from "../models/installState";
import { beginP2PDataReset, completeP2PDataReset } from "./nidoMessenger";
import { beginWipeGate, endWipeGate } from "../security/secureDatabase";
import {
  deleteDatabaseKey,
  deleteP2PPrivateKey,
  deleteP2PSigningKey,
  loadP2PPrivateKey,
  loadP2PSigningKey,
  peekDatabaseKey,
} from "../privacy/keyManager";

const MODELS_DIR = `${FileSystem.documentDirectory}models`;
const CORPUS_DIR = `${FileSystem.documentDirectory}corpus`;
const EVAL_DIR = `${FileSystem.documentDirectory}eval`;
const CACHE_DIR = FileSystem.cacheDirectory ?? `${FileSystem.documentDirectory}cache`;
const SQLITE_DIR = `${FileSystem.documentDirectory}SQLite`;
const SETTINGS_FILE = `${FileSystem.documentDirectory}settings.json`;

/**
 * R13 — marcador durable de wipe en curso. Se escribe ANTES de la primera
 * operación destructiva y solo se retira cuando el wipe termina Y se
 * verifica completo. Si Android mata el proceso a mitad (kill-mid-wipe),
 * el próximo arranque lo detecta con wipeInterrupted() ANTES de que
 * cualquier rutina toque las bases, los modelos o la UI normal, y reanuda
 * el borrado con recoverInterruptedWipe(). Nunca se crea estado nuevo
 * junto a restos viejos: la recuperación es fail-closed.
 */
const WIPE_MARKER = `${FileSystem.documentDirectory}.nido-wipe-in-progress`;

export async function wipeInterrupted(): Promise<boolean> {
  // Fail-closed: si el marcador no se puede comprobar, NO se asume
  // "limpio". El error se propaga para que el arranque muestre bloqueo en
  // vez de entrar a la UI normal con un wipe quizá a medias.
  return (await FileSystem.getInfoAsync(WIPE_MARKER)).exists;
}

async function markWipeStarted(): Promise<void> {
  await FileSystem.writeAsStringAsync(WIPE_MARKER, String(Date.now()));
}

async function clearWipeMarker(): Promise<void> {
  await FileSystem.deleteAsync(WIPE_MARKER, { idempotent: true });
}

/**
 * R13: reanuda un wipe interrumpido. resetAllAppData es idempotente por
 * construcción: cada borrado tolera el ausente (R1: not-found = ya limpio;
 * deleteAsync idempotente) y la verificación final decide el éxito. Si la
 * recuperación vuelve a fallar, el marcador queda y el runtime P2P queda
 * bloqueado: la app no entra en estado normal a medias.
 */
export async function recoverInterruptedWipe(): Promise<void> {
  await resetAllAppData();
}

// Sufijos que acompañan a cada base gestionada (ver secureDatabase.pathsFor
// y removeWithSidecars): fichero principal, sidecars WAL/SHM/journal,
// temporal de migración y marcador .sqlcipher.
const DB_SUFFIXES = ["", "-wal", "-shm", "-journal", ".migtmp", ".sqlcipher"];

/**
 * Error lanzado cuando el borrado no pudo verificarse completo. Nunca se
 * declara éxito en silencio: la UI (Danger Zone) captura este error y
 * muestra el mensaje al usuario en vez de fingir que todo se borró.
 */
export class WipeVerificationError extends Error {
  readonly survivors: string[];
  constructor(survivors: string[]) {
    super(
      `Clear All Data incompleto: ${survivors.length} resto(s) sobrevivieron al borrado: ${survivors.join(", ")}`,
    );
    this.name = "WipeVerificationError";
    this.survivors = survivors;
  }
}

async function checkGone(path: string, survivors: string[]): Promise<void> {
  let exists = false;
  let checkable = true;
  try {
    exists = (await FileSystem.getInfoAsync(path)).exists;
  } catch {
    checkable = false;
  }
  if (!checkable) survivors.push(`${path} (no verificable)`);
  else if (exists) survivors.push(path);
}

/**
 * Notificaciones del SO (expo-notifications): el borrado cancela las
 * programadas Y despide las ya entregadas (bandeja); la verificación
 * cuenta cuántas quedan de cada clase.
 */

/**
 * Full app data wipe ("Danger Zone > Clear All Data" in Settings). This app
 * doesn't use MMKV/AsyncStorage — everything persisted lives in:
 *
 * - SQLite knowledge base `nido_knowledge.db` (chat history, all
 *   corpus/collection chunks, execution telemetry) + sidecars/marker
 *   (el fichero heredado pre-rebrand `aoair_knowledge.db` también se
 *   elimina si aún existe);
 * - SQLite memory base `nido_memory.db` (agent memory: facts, preferences,
 *   people, daily log, notes, reminders — AND the P2P tables: identity,
 *   paired contacts, inbox/outbox messages) + sidecars/marker;
 * - Android Keystore via SecureStore: `nido_db_key` (SQLCipher DEK shared
 *   by both databases), `nido_p2p_sk` (P2P identity X25519 private key),
 *   `nido_p2p_sign_sk` (P2P Ed25519 signing key);
 * - small JSON files under the document directory (`settings.json` and the
 *   model install journal `nido-install-state.json`);
 * - `models/` (downloaded GGUF weights), `corpus/` (knowledge packs),
 *   `eval/` (device eval result files) and the transient `cache/` exports.
 *
 * Order matters: the native llama.cpp contexts are released FIRST since
 * they hold the model files open (mmap'd) — deleting a file out from under
 * a live context is exactly the kind of native-lifecycle bug this project
 * has hit before (see LlamaEngine/EmbeddingEngine's own unload-before-load
 * guard). Databases are closed and deleted before their Keystore keys, so
 * no open handle can recreate or re-read them mid-wipe. After this call,
 * App.tsx's required-models check will fail and the app should be sent
 * back to the setup wizard.
 *
 * Failure semantics: the wipe is verified, not assumed. Every store above
 * is checked for non-survival afterwards; if anything remains (or cannot
 * even be checked), a WipeVerificationError is thrown listing the
 * survivors — never a silent partial wipe.
 */
export async function resetAllAppData(): Promise<void> {
  // Barrera global de wipe (ver secureDatabase.getWipeGate): se instala de
  // forma síncrona antes de cualquier await. Desde aquí, ningún trabajo de
  // base de datos (lectura, escritura, apertura o DDL, de ningún ciclo)
  // atraviesa el wipe: espera detrás de la puerta. El writer del ciclo N+1
  // va DETRÁS del reset, nunca concurrente con el borrado.
  beginWipeGate();
  try {
    await resetAllAppDataInner();
    // Éxito: la puerta se abre y lo en espera continúa en el ciclo nuevo,
    // ya con la DEK rotada y la caché restablecida.
    endWipeGate();
  } catch (err) {
    // Fail-closed: lo en espera recibe el error del wipe en vez de operar
    // sobre un estado a medias. El próximo resetAllAppData instala una
    // puerta nueva.
    endWipeGate(err);
    throw err;
  }
}

/**
 * Cuerpo del wipe. No llamar directamente: usar resetAllAppData (puerta) o
 * recoverInterruptedWipe (que delega en resetAllAppData).
 */
async function resetAllAppDataInner(): Promise<void> {
  // R13: el marcador durable se escribe ANTES de la primera operación
  // destructiva: si el proceso muere a mitad, el próximo arranque reanuda.
  await markWipeStarted();

  // R6: invalidar el runtime P2P vivo ANTES de tocar el disco: la instancia
  // actual se destruye (transporte detenido, sesiones/identidad en memoria
  // descartadas) y el singleton se desacopla y bloquea. Ningún objeto viejo
  // puede seguir operando y ningún frame entrante puede persistir nada.
  await beginP2PDataReset();

  await Promise.all([llamaEngine.unload(), embeddingEngine.unload(), closeAllPacks()]);
  resetDownloadState();

  // 0. Notificaciones programadas y ya entregadas del SO: su contenido
  //    (textos de recordatorios, resumen diario con eventos del calendario)
  //    vive fuera del filesystem y del Keystore. Sin esto sobrevivían al
  //    borrado y se seguían mostrando en la pantalla de bloqueo/bandeja
  //    después del wipe. N1: no basta con cancelar las programadas; las ya
  //    mostradas en la bandeja también se despiden explícitamente.
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  // Si el dismiss falla aquí, no se finge éxito: la verificación del paso 5
  // lo detecta y falla en voz alta (fail-closed).
  await Notifications.dismissAllNotificationsAsync().catch(() => {});

  // 1. Bases de datos: conocimiento (chat, corpus, telemetría) y memoria
  //    (memoria del agente + identidad/contactos/mensajes P2P). Cierran la
  //    conexión y eliminan fichero, sidecars, temporal y marcador.
  await resetDatabase();
  await clearMemoryDb();

  // 2. Material del Keystore: DEK de SQLCipher + claves privadas P2P
  //    (cifrado X25519 y firma Ed25519). Sin esto la identidad P2P y la
  //    clave de cifrado sobrevivían al borrado. Se restablece además la
  //    caché de clave en memoria para que la próxima apertura genere una
  //    clave nueva en vez de reutilizar la borrada.
  await deleteDatabaseKey();
  await deleteP2PPrivateKey();
  await deleteP2PSigningKey();
  resetMemoryKeyCache();

  // 3. Ficheros y directorios de datos.
  await FileSystem.deleteAsync(MODELS_DIR, { idempotent: true });
  await FileSystem.deleteAsync(CORPUS_DIR, { idempotent: true });
  await FileSystem.deleteAsync(EVAL_DIR, { idempotent: true });
  await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  await clearSettings();
  // W-F1: el journal de instalación (nido-install-state.json) también se
  // elimina aquí. Sin esto sobrevivía al Clear All Data y contradecía la
  // garantía del wipe: una app "limpia" seguía arrastrando los registros
  // de instalación de los modelos.
  await FileSystem.deleteAsync(installStatePath(), { idempotent: true });

  // 4. Verificación: todo lo anterior debe haber desaparecido. Si algo
  //    sobrevive (o no se puede comprobar), se lanza en vez de declarar
  //    éxito en silencio.
  const survivors: string[] = [];
  // El nombre heredado pre-rebrand también se verifica: si la migración de
  // fichero nunca se ejecutó, Clear All Data debe igualmente eliminarlo.
  for (const db of [KNOWLEDGE_DB_NAME, LEGACY_KNOWLEDGE_DB_NAME, MEMORY_DB_NAME]) {
    for (const suffix of DB_SUFFIXES) {
      await checkGone(`${SQLITE_DIR}/${db}${suffix}`, survivors);
    }
  }
  for (const p of [
    SETTINGS_FILE,
    // W-F1: el journal de instalación se verifica ausente igual que el
    // resto del inventario. El éxito del wipe solo se declara si su
    // ausencia quedó verificada, no asumida.
    installStatePath(),
    MODELS_DIR,
    CORPUS_DIR,
    EVAL_DIR,
    CACHE_DIR,
  ]) {
    await checkGone(p, survivors);
  }
  if ((await peekDatabaseKey()) !== null) survivors.push("keystore:nido_db_key");
  if ((await loadP2PPrivateKey()) !== null) survivors.push("keystore:nido_p2p_sk");
  if ((await loadP2PSigningKey()) !== null) survivors.push("keystore:nido_p2p_sign_sk");
  // 5. Notificaciones del SO: ni programadas ni ya presentadas (bandeja)
  //    pueden sobrevivir. N1: las presentadas son un estado separado — la
  //    ceguera que las ignoraba fue la que creó el hallazgo.
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    if (pending.length > 0)
      survivors.push(`notificaciones programadas: ${pending.length} pendiente(s)`);
  } catch {
    survivors.push("notificaciones programadas (no verificable)");
  }
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    if (presented.length > 0)
      survivors.push(`notificaciones presentadas: ${presented.length} visible(s)`);
  } catch {
    survivors.push("notificaciones presentadas (no verificable)");
  }
  if (survivors.length > 0) throw new WipeVerificationError(survivors);

  // R13: el marcador durable se retira y se VERIFICA su ausencia ANTES de
  // desbloquear el runtime P2P. Si la retirada falla (o no se puede
  // verificar), el wipe falla de forma honesta y el bloqueo P2P se mantiene
  // (fail-closed): el próximo arranque reanuda con recoverInterruptedWipe().
  // Nunca se desbloquea con un wipe sin confirmar.
  await clearWipeMarker();
  let markerGone = false;
  try {
    markerGone = !(await FileSystem.getInfoAsync(WIPE_MARKER)).exists;
  } catch {
    markerGone = false;
  }
  if (!markerGone) {
    throw new WipeVerificationError([`${WIPE_MARKER} (marcador no retirado/verificable)`]);
  }

  // R6: solo tras éxito verificado (incluido el marcador) se permite que
  // nazca un ciclo P2P nuevo (instancia fresca, identidad nueva, sin
  // sesiones heredadas). Si el wipe falla, el bloqueo queda: fail closed,
  // ningún messenger a medias.
  completeP2PDataReset();
}
