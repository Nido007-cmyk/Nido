/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * backup.ts — NIDO: respaldo y restauración de la base cifrada.
 *
 * REWRITE 2026-10-07 (workflow 5 pasos, auditoría de fondo):
 * - BK-1 FIX: checkpoint WAL antes de copiar (los commits recientes viven en -wal).
 * - BK-2 FIX: closeDatabase() antes de restaurar, la conexión no queda colgada.
 * - BK-3 FIX: validación real antes de sobrescribir (header SQLCipher + apertura con DEK).
 * - BK-4 FIX: validateBackup verifica magic header y tamaño mínimo.
 * - Rollback automático: si el restore falla, se restaura la copia de seguridad.
 * - Manifest versionado con SHA-256 para detectar corrupción.
 *
 * La base `nido_memory.db` está cifrada con SQLCipher. El backup consiste en:
 * 1. Checkpoint WAL para consolidar datos en el archivo principal.
 * 2. Copiar el archivo de la base (ya cifrado) + manifest con checksum.
 * 3. Exportar la clave de cifrado de forma segura (el usuario la guarda aparte).
 *
 * Sin la clave, el backup es inútil. Sin el backup, la clave es inútil.
 * Ningún servidor ve ninguno de los dos.
 */

import * as FileSystem from "expo-file-system/legacy";
import { getDatabaseKeyHex } from "../privacy/keyManager";
import { WAL_CHECKPOINT_SQL } from "./secureDatabase";
import { getDatabase, closeDatabase } from "./databaseManager";
import { BackupError } from "./backupErrors";

const DB_NAME = "nido_memory.db";
const KNOWLEDGE_DB_NAME = "nido_knowledge.db";
const BACKUP_VERSION = 1;
/** Tope de un respaldo portable (.nidobackup.json): evita agotar la memoria. */
export const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;
// A14: misma versión que package.json y el tag del release.
const APP_VERSION = "0.1.66";
// SQLCipher magic header: "SQLite format 3\0" — los primeros 16 bytes
const SQLITE_MAGIC = "SQLite format 3\0";

/**
 * A2 (auditoría 2026-10-10): única fuente del nombre del backup de la base
 * de conocimiento. Antes createBackup escribía "X.knowledge.db" (reemplazando
 * ".db") mientras createPortableBundle y restoreBackup buscaban
 * "X.db.knowledge.db": la base de conocimiento nunca entraba en el bundle ni
 * se restauraba.
 */
export function knowledgeBackupUriFor(backupUri: string): string {
  return /\.db$/.test(backupUri)
    ? backupUri.replace(/\.db$/, ".knowledge.db")
    : `${backupUri}.knowledge.db`;
}

/**
 * Obtiene la ruta del archivo de la base de datos.
 */
async function getDbPath(): Promise<string> {
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new BackupError("storage", "No se pudo acceder al almacenamiento.");
  return `${dir}SQLite/${DB_NAME}`;
}

/** Hex en minúsculas de unos bytes. */
export function hexOfBytes(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

async function readFileBytes(uri: string): Promise<Uint8Array<ArrayBuffer>> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * SHA-256 real de los bytes del archivo (para el manifest). Null si no se
 * puede calcular.
 *
 * Auditoría 2026-10-29: hasta 0.1.61 el manifest guardaba otra cosa. Los
 * bytes se pasaban como texto a digestStringAsync, que los codifica en UTF-8:
 * cada byte ≥ 0x80 entraba como dos, así que el valor no era el SHA-256 del
 * archivo (no coincidía con `sha256sum`). Detectaba igual la corrupción,
 * porque se calculaba igual al crear y al comprobar, pero el nombre mentía.
 * Los manifests nuevos llevan `sha256Kind: "bytes"`; los viejos se siguen
 * comprobando con legacySha256File.
 */
async function sha256File(uri: string): Promise<string | null> {
  try {
    const { default: Crypto } = await import("expo-crypto");
    const bytes = await readFileBytes(uri);
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
    return hexOfBytes(digest);
  } catch {
    return null;
  }
}

/** El cálculo de 0.1.61 y anteriores, solo para comprobar respaldos viejos. */
async function legacySha256File(uri: string): Promise<string | null> {
  try {
    const { default: Crypto } = await import("expo-crypto");
    const bytes = await readFileBytes(uri);
    let latin1 = "";
    for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]);
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, latin1, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
  } catch {
    return null;
  }
}

/** Valor del manifest con el que se comprueba un archivo (nuevo o viejo). */
export const SHA256_KIND_BYTES = "bytes";

/**
 * Auditoría 2026-10-29: lo que dice el manifest de un respaldo, para avisar
 * antes de restaurar. Restaurar devuelve los datos tal como estaban ese día:
 * lo que borraste después (chats, notas, contactos que quitaste) vuelve. Los
 * contactos REVOCADOS siguen revocados: esa lista vive fuera de la base
 * (revoked-peers.json) y restaurar no la toca.
 */
export interface BackupManifestInfo {
  /** ISO de cuando se hizo, si el manifest lo trae y es una fecha. */
  createdAt: string | null;
  /** Versión de NIDO que lo hizo, si la trae. */
  appVersion: string | null;
  /** Formato del manifest; null si falta. */
  version: number | null;
  /** Formato más nuevo que el que esta versión sabe leer. */
  tooNew: boolean;
}

export function backupManifestInfo(manifest: unknown): BackupManifestInfo {
  const m = (manifest && typeof manifest === "object" ? manifest : {}) as Record<string, unknown>;
  const created = typeof m.createdAt === "string" && !Number.isNaN(Date.parse(m.createdAt)) ? m.createdAt : null;
  const appVersion = typeof m.appVersion === "string" && m.appVersion.length <= 40 ? m.appVersion : null;
  const version = typeof m.version === "number" && Number.isInteger(m.version) ? m.version : null;
  return { createdAt: created, appVersion, version, tooNew: version !== null && version > BACKUP_VERSION };
}

/**
 * Crea un backup: checkpoint WAL + copia las bases cifradas + manifest.
 * Retorna la ruta del backup creado.
 *
 * BK-1 FIX: hace checkpoint WAL antes de copiar para que los commits
 * recientes (que viven en -wal) queden consolidados en el archivo principal.
 * M3 FIX: incluye nido_knowledge.db además de nido_memory.db.
 */
export async function createBackup(destinationUri: string): Promise<string> {
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new BackupError("storage", "No se pudo acceder al almacenamiento.");
  const dbPath = `${dir}SQLite/${DB_NAME}`;
  const knowledgePath = `${dir}SQLite/${KNOWLEDGE_DB_NAME}`;

  const info = await FileSystem.getInfoAsync(dbPath);
  if (!info.exists) {
    throw new BackupError("dbMissing", "Base de datos no encontrada.");
  }

  // 1. Checkpoint WAL: consolidar -wal en el archivo principal.
  // Auditoría completa 2026-10-31 (F3-03): si el checkpoint falla, NO
  // se continúa. Copiar en caliente sin consolidar puede dejar fuera
  // justo lo último escrito, y el respaldo nacería incompleto en
  // silencio; un respaldo que no se pudo hacer se dice, no se finge.
  try {
    const db = await getDatabase();
    await db.execAsync(WAL_CHECKPOINT_SQL);
  } catch (e) {
    throw new BackupError(
      "storage",
      `No se pudo consolidar la base antes del respaldo: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 2. Copiar la base principal.
  await FileSystem.copyAsync({ from: dbPath, to: destinationUri });

  // 2b. 0.1.47 (como Signal): los mensajes temporales NO viajan en los
  // respaldos. Se borran de la COPIA (nunca de la base viva) y se compacta,
  // para que su contenido no quede en páginas libres del archivo. Si no se
  // puede limpiar, no hay respaldo: mejor fallar que guardar lo que debía
  // desaparecer.
  try {
    await stripDisappearingMessages(destinationUri);
  } catch (e) {
    try {
      await FileSystem.deleteAsync(destinationUri, { idempotent: true });
    } catch {
      /* best-effort */
    }
    throw new BackupError(
      "storage",
      `No se pudo preparar el respaldo: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 3. Copiar la base de conocimiento si existe (M3).
  // Auditoría completa 2026-10-31 (F3-03): el conocimiento también se
  // consolida antes de copiar, con SU conexión (la de rag/db), y un
  // fallo ya no se traga: si la base existe y no se pudo respaldar,
  // el respaldo entero falla en voz alta en vez de nacer sin el
  // conocimiento y con un manifest que lo calla.
  const knowledgeDest = knowledgeBackupUriFor(destinationUri);
  let knowledgeBackedUp = false;
  try {
    const kInfo = await FileSystem.getInfoAsync(knowledgePath);
    if (kInfo.exists) {
      const { getDb } = await import("../rag/db");
      const kdb = await getDb();
      await kdb.execAsync(WAL_CHECKPOINT_SQL);
      await FileSystem.copyAsync({ from: knowledgePath, to: knowledgeDest });
      knowledgeBackedUp = true;
    }
  } catch (e) {
    throw new BackupError(
      "storage",
      `No se pudo respaldar la base de conocimiento: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 4. Crear manifest con metadata y checksum.
  const dekHex = await getDatabaseKeyHex().catch(() => null);
  let dekFingerprint: string | null = null;
  if (dekHex) {
    try {
      const { default: Crypto } = await import("expo-crypto");
      // Fingerprint del DEK (no el DEK): permite detectar backups de otra instalación.
      dekFingerprint = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        dekHex,
        { encoding: Crypto.CryptoEncoding.HEX }
      );
    } catch { /* noop */ }
  }
  const manifest = {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    dbName: DB_NAME,
    knowledgeDbName: knowledgeBackedUp ? KNOWLEDGE_DB_NAME : null,
    knowledgeBackupPath: knowledgeBackedUp ? knowledgeDest : null,
    appVersion: APP_VERSION,
    sha256: await sha256File(destinationUri),
    sha256Kind: SHA256_KIND_BYTES,
    // Auditoría completa 2026-10-31 (F3-08): huella del acompañante de
    // conocimiento. Sin ella nadie comprobaba su contenido: la base
    // principal llevaba SHA en el manifest, el conocimiento no, y su
    // validación al restaurar no busca manifest propio.
    knowledgeSha256: knowledgeBackedUp ? await sha256File(knowledgeDest) : null,
    // FIX 2026-10-09 (K1): fingerprint del DEK para detectar key mismatch en restore.
    dekFingerprint,
  };
  const manifestUri = `${destinationUri}.manifest.json`;
  await FileSystem.writeAsStringAsync(manifestUri, JSON.stringify(manifest, null, 2));

  // D9 (29-10-2026): la bóveda solo se activa con un respaldo reciente.
  const { recordBackupMade } = await import("./vaultBackupGate");
  await recordBackupMade();

  return destinationUri;
}

/**
 * 0.1.47: abre la copia del respaldo con la clave del teléfono, borra los
 * mensajes temporales (ttl_sec > 0) y hace VACUUM. Una base sin la columna
 * (anterior a 0.1.46, sin mensajes temporales) se deja como está.
 */
async function stripDisappearingMessages(copyUri: string): Promise<void> {
  const dek = await getDatabaseKeyHex().catch(() => null);
  const SQLite = await import("expo-sqlite");
  const { applyDatabaseKey } = await import("../privacy/keyManager");
  const slash = copyUri.lastIndexOf("/");
  const db = await SQLite.openDatabaseAsync(copyUri.slice(slash + 1), { useNewConnection: true }, copyUri.slice(0, slash));
  try {
    if (dek) await applyDatabaseKey(db as never, dek, "backup-strip");
    try {
      await db.execAsync("PRAGMA secure_delete = ON;");
      await db.execAsync("DELETE FROM p2p_messages WHERE ttl_sec > 0;");
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/no such (column|table)/i.test(msg)) return;
      throw e;
    }
    await db.execAsync("VACUUM;");
  } finally {
    await db.closeAsync().catch(() => {});
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await FileSystem.deleteAsync(`${copyUri}${suffix}`, { idempotent: true });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * 0.1.47: tras una restauración, la copia previa (*.pre-restore-*) se
 * guardaba para siempre: una copia completa más de la base, con mensajes que
 * quizá ya debían haber desaparecido. Ahora se borra en cuanto la base
 * restaurada abre bien en el siguiente arranque. Best-effort, nunca lanza.
 */
export async function cleanupAfterSuccessfulRestore(): Promise<number> {
  try {
    const dir = FileSystem.documentDirectory;
    if (!dir) return 0;
    const sqliteDir = `${dir}SQLite/`;
    const names = await FileSystem.readDirectoryAsync(sqliteDir).catch(() => [] as string[]);
    const copies = names.filter((n) => n.startsWith(`${DB_NAME}.pre-restore-`));
    const leftovers = (await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[])).filter((n) =>
      n.startsWith("restored.db"),
    );
    if (copies.length === 0 && leftovers.length === 0) return 0;
    // Solo si la base actual abre y se puede leer.
    const db = await getDatabase();
    await db.getFirstAsync("SELECT count(*) AS n FROM sqlite_master;");
    for (const n of copies) await FileSystem.deleteAsync(`${sqliteDir}${n}`, { idempotent: true });
    for (const n of leftovers) await FileSystem.deleteAsync(`${dir}${n}`, { idempotent: true });
    return copies.length + leftovers.length;
  } catch {
    return 0;
  }
}

/**
 * Exporta la clave de cifrado en formato hexadecimal.
 * ADVERTENCIA: quien tenga esta clave + el backup puede leer todo.
 * El usuario debe guardarla en un lugar seguro y separado del backup.
 */
export async function exportDatabaseKey(): Promise<string> {
  const keyHex = await getDatabaseKeyHex();
  if (!keyHex) {
    throw new BackupError("noDbKey", "No se pudo obtener la clave de la base de datos.");
  }
  return keyHex;
}

/**
 * FIX 2026-10-09 (NEW-CR-1, NEW-H-1, NEW-H-2): valida un bundle portable.
 * - NEW-H-1: límite de 100MB para evitar OOM (FIX 2026-10-09 S5: el comentario
 *   decía 500MB pero el código siempre fue 100MB)
 * - NEW-H-2: valida la forma del manifest (no solo JSON.parse)
 */
async function validateBundle(bundleUri: string): Promise<BackupValidation> {
  const info = await FileSystem.getInfoAsync(bundleUri);
  if (!info.exists) {
    return { valid: false, reason: "El archivo no existe." };
  }
  const size = (info as any).size ?? 0;
  if (size > MAX_BUNDLE_BYTES) {
    return { valid: false, reason: "El bundle es demasiado grande." };
  }
  if (size < 100) {
    return { valid: false, reason: "El bundle es demasiado pequeño." };
  }

  let bundle: any;
  try {
    const raw = await FileSystem.readAsStringAsync(bundleUri);
    bundle = JSON.parse(raw);
  } catch {
    return { valid: false, reason: "El bundle no es JSON válido." };
  }

  if (!bundle || typeof bundle !== "object" || bundle.format !== "nidobackup") {
    return { valid: false, reason: "Formato de bundle no reconocido." };
  }
  if (!bundle.manifest || typeof bundle.manifest !== "object") {
    return { valid: false, reason: "El bundle no tiene manifest válido." };
  }
  if (typeof bundle.db !== "string" || bundle.db.length < 100) {
    return { valid: false, reason: "El bundle no tiene base de datos válida." };
  }
  const m = bundle.manifest;
  if (typeof m.sha256 !== "string" || typeof m.dekFingerprint !== "string") {
    return { valid: false, reason: "El manifest está incompleto (falta SHA o fingerprint)." };
  }
  const mInfo = backupManifestInfo(m);
  if (mInfo.tooNew) {
    return { valid: false, reason: "Este respaldo es de una versión más nueva de NIDO. Actualiza NIDO para restaurarlo." };
  }

  return { valid: true, sizeBytes: size, info: mInfo };
}

/**
 * Valida que un archivo sea un backup válido:
 * - Existe y tiene tamaño mínimo.
 * - Tiene el magic header de SQLite (no es un archivo de texto aleatorio).
 *
 * BK-4 FIX: antes solo verificaba existencia y tamaño. Ahora verifica
 * el header mágico para descartar archivos que no son bases SQLite.
 */
export interface BackupValidation {
  valid: boolean;
  sizeBytes?: number;
  reason?: string;
  /** Lo que dice el manifest, si había uno (para avisar antes de restaurar). */
  info?: BackupManifestInfo;
}

export async function validateBackup(uri: string): Promise<BackupValidation> {
  try {
    // FIX 2026-10-09 (NEW-CR-1): si es un bundle, validar el contenido extraído.
    // Antes rechazaba el bundle por no tener header SQLite.
    if (uri.endsWith(".nidobackup.json")) {
      return await validateBundle(uri);
    }
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return { valid: false, reason: "El archivo no existe." };
    }
    const size = (info as any).size ?? 0;
    if (size < 1024) {
      return { valid: false, reason: "El archivo es demasiado pequeño para ser un backup válido." };
    }
    // FIX 2026-10-09 (B13): NO rechazar por magic header. SQLCipher cifra el
    // header por defecto (default_plaintext_header_size=0), así que un backup
    // real NO empieza con "SQLite format 3". En su lugar, hacer trial-open
    // con el DEK actual: si abre, es un backup válido nuestro.
    // (El check de header anterior rompía la restauración en producción.)
    // A5 (auditoría 2026-10-10): un backup solo es válido si se VERIFICÓ por
    // alguna vía: apertura de prueba con la clave, o manifest con SHA-256
    // correcto. Antes, si la apertura fallaba por un error técnico y no
    // había manifest, cualquier archivo de más de 1 KB se aceptaba y
    // sobrescribía la base viva.
    let trialOpenOk = false;
    let manifestVerified = false;
    let parsedInfo: BackupManifestInfo | undefined;
    let dekPresent = false;
    try {
      const { getDatabaseKeyHex, applyDatabaseKey } = await import("../privacy/keyManager");
      const dekHex = await getDatabaseKeyHex().catch(() => null);
      dekPresent = !!dekHex;
      const SQLite = await import("expo-sqlite");
      if (dekHex) {
        const slash = uri.lastIndexOf("/");
        const db = await SQLite.openDatabaseAsync(
          uri.slice(slash + 1),
          { useNewConnection: true },
          uri.slice(0, slash)
        );
        try {
          await applyDatabaseKey(db as any, dekHex, "backup-validate");
          // Si llegamos aquí, el DEK abre la DB → backup válido.
          await (db as any).closeAsync().catch(() => {});
          trialOpenOk = true;
        } catch {
          await (db as any).closeAsync().catch(() => {});
          return { valid: false, reason: "El backup no se puede abrir con la clave actual (es de otra instalación o está corrupto)." };
        }
      }
      // Si no hay DEK (instalación fresca), no podemos hacer trial-open.
      // Continuar con validación de manifest (K1/K2).
    } catch {
      // Si el trial-open falla por error técnico, continuar con validación básica.
    }
    // 0.1.29 (B-1, auditoría ofensiva 2026-10-12): con clave en el teléfono
    // la única prueba que vale es abrir el archivo con ella. Un manifest no
    // va firmado: basura + manifest con el SHA recalculado lo pasaba si la
    // apertura de prueba no llegaba a ejecutarse (error técnico).
    if (dekPresent && !trialOpenOk) {
      return { valid: false, reason: "No se pudo comprobar el backup con la clave de este teléfono." };
    }
    // FIX 2026-10-09 (K1/K2): verificar manifest — SHA-256 del archivo y
    // fingerprint del DEK. Si el backup es de otra instalación (DEK distinto),
    // se rechaza ANTES de sobrescribir la DB viva.
    try {
      const manifestUri = `${uri}.manifest.json`;
      const manifestInfo = await FileSystem.getInfoAsync(manifestUri);
      if (manifestInfo.exists) {
        const manifestRaw = await FileSystem.readAsStringAsync(manifestUri);
        let manifest: any;
        try {
          manifest = JSON.parse(manifestRaw);
        } catch {
          return { valid: false, reason: "El manifest está corrupto (JSON inválido)." };
        }
        // FIX 2026-10-09 (NEW-H-2): validar forma del manifest en path .db crudo.
        if (!manifest || typeof manifest !== "object") {
          return { valid: false, reason: "El manifest no es un objeto válido." };
        }
        // K2: verificar SHA-256.
        // FIX 2026-10-09 (H-5): fail-closed si no se puede calcular el SHA.
        // FIX 2026-10-09 (K2-FAILOPEN): fail-closed si el manifest no trae SHA.
        // Un backup con manifest pero sin SHA no se puede verificar → rechazar.
        // FIX 2026-10-09 (K2-TYPEFAIL): verificar tipo string. Un sha256 truthy
        // no-string (ej. número) haría throw en .toLowerCase(), el catch externo
        // lo tragaría y el check se saltaría (fail-open).
        if (typeof manifest.sha256 !== "string" || !manifest.sha256) {
          return { valid: false, reason: "El manifest no incluye SHA-256 válido (no se puede verificar integridad)." };
        }
        parsedInfo = backupManifestInfo(manifest);
        if (parsedInfo.tooNew) {
          return { valid: false, reason: "Este respaldo es de una versión más nueva de NIDO. Actualiza NIDO para restaurarlo." };
        }
        // Manifest nuevo: SHA-256 real de los bytes. Manifest de 0.1.61 o
        // anterior (sin sha256Kind): el cálculo de entonces.
        const actualSha =
          manifest.sha256Kind === SHA256_KIND_BYTES ? await sha256File(uri) : await legacySha256File(uri);
        if (!actualSha) {
          return { valid: false, reason: "No se pudo verificar la integridad (SHA-256)." };
        }
        if (actualSha.toLowerCase() !== manifest.sha256.toLowerCase()) {
          return { valid: false, reason: "El backup está corrupto (SHA-256 no coincide)." };
        }
        // K1: verificar DEK fingerprint.
        // FIX 2026-10-09 (K2-TYPEFAIL): mismo guard de tipo para dekFingerprint.
        if (manifest.dekFingerprint) {
          if (typeof manifest.dekFingerprint !== "string") {
            return { valid: false, reason: "El manifest tiene fingerprint inválido." };
          }
          const currentDek = await getDatabaseKeyHex().catch(() => null);
          if (currentDek) {
            const { default: Crypto } = await import("expo-crypto");
            const currentFp = await Crypto.digestStringAsync(
              Crypto.CryptoDigestAlgorithm.SHA256,
              currentDek,
              { encoding: Crypto.CryptoEncoding.HEX }
            );
            if (currentFp.toLowerCase() !== manifest.dekFingerprint.toLowerCase()) {
              return { valid: false, reason: "Este backup es de otra instalación (clave distinta). No se puede restaurar." };
            }
          }
        }
        manifestVerified = true;
      }
    } catch {
      // Error al leer o verificar el manifest: no cuenta como verificado.
    }
    if (!trialOpenOk && !manifestVerified) {
      return {
        valid: false,
        reason:
          "No se pudo verificar el backup: no abre con la clave de este dispositivo y no trae un manifest válido.",
      };
    }
    return { valid: true, sizeBytes: size, ...(parsedInfo ? { info: parsedInfo } : {}) };
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message : "Error desconocido." };
  }
}

/**
 * Restaura un backup: valida antes de sobrescribir, cierra la conexión,
 * reemplaza el archivo, y hace rollback automático si algo falla.
 *
 * BK-2 FIX: cierra la base antes de reemplazar el archivo.
 * BK-3 FIX: valida el backup ANTES de sobrescribir; rollback automático.
 *
 * ADVERTENCIA: esto sobrescribe los datos actuales. La app debe reiniciarse después.
 */
export async function restoreBackup(backupUri: string): Promise<void> {
  // 0.1.29 (B-1): sin clave en este teléfono no hay forma de comprobar el
  // respaldo (ni de abrirlo después): validateBackup solo podía fiarse del
  // manifest, que no va firmado, y aceptaba un archivo fabricado. Se
  // rechaza y la pantalla ofrece «Restaurar con clave», que sí lo abre con
  // la clave que guardó el usuario antes de tocar nada.
  const dek = await getDatabaseKeyHex().catch(() => null);
  if (!dek) {
    throw new BackupError(
      "noDeviceKey",
      "Este teléfono no tiene una clave de cifrado disponible: usa «Restaurar con clave».",
    );
  }

  // FIX 2026-10-09 (CR-1): si es un bundle portable, extraer primero.
  let actualUri = backupUri;
  const extracted: string[] = [];
  if (backupUri.endsWith(".nidobackup.json")) {
    const dir = FileSystem.documentDirectory;
    if (!dir) throw new BackupError("storage", "No se pudo acceder al almacenamiento.");
    actualUri = await extractPortableBundle(backupUri, dir);
    extracted.push(actualUri, `${actualUri}.manifest.json`, knowledgeBackupUriFor(actualUri));
  }
  try {
    await restoreExtracted(actualUri);
  } finally {
    // 0.1.29 (B-3): los archivos extraídos del bundle (restored.db, su
    // manifest y la base de conocimiento) ya no se quedan para siempre en
    // documentos tras restaurar o fallar. Estaban cifrados, pero eran una
    // copia completa más de los datos.
    for (const uri of extracted) {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch { /* best-effort */ }
    }
  }
}

async function restoreExtracted(actualUri: string): Promise<void> {
  // 1. Validar ANTES de tocar nada (BK-3).
  const validation = await validateBackup(actualUri);
  if (!validation.valid) {
    throw new BackupError("invalid", `Backup inválido: ${validation.reason}`);
  }

  const dbPath = await getDbPath();

  // 2. Hacer copia de seguridad de la base actual.
  // Auditoría completa 2026-10-31 (F3-04): si la base existe y su
  // copia de seguridad FALLA, se aborta ANTES de tocar la base viva.
  // Antes el catch tragaba el fallo de la copia igual que el caso
  // «no hay base», y la restauración sobrescribía sin red: si el
  // reemplazo fallaba después, no quedaba rollback posible.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyCopy = `${dbPath}.pre-restore-${timestamp}`;
  let hasSafetyCopy = false;
  try {
    const info = await FileSystem.getInfoAsync(dbPath);
    if (info.exists) {
      await FileSystem.copyAsync({ from: dbPath, to: safetyCopy });
      hasSafetyCopy = true;
    }
  } catch (e) {
    throw new BackupError(
      "storage",
      `No se pudo guardar una copia de la base actual antes de restaurar: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 3. Cerrar la conexión antes de reemplazar el archivo (BK-2).
  // También eliminar sidecars -wal/-shm viejos para que no contaminen.
  try {
    await closeDatabase();
  } catch {
    // Best-effort: si no se puede cerrar, continuamos.
  }
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await FileSystem.deleteAsync(`${dbPath}${suffix}`, { idempotent: true });
    } catch { /* ignorar */ }
  }

  // 4. Reemplazar el archivo. Si falla, rollback automático (BK-3).
  // Auditoría completa 2026-10-31 (F3-04): el reemplazo ya no copia
  // encima de la base viva. Se copia a un temporal vecino (prefijo
  // nido-restore-, que el borrado total ya sabe recoger si un corte
  // lo deja huérfano) y se renombra sobre la base: el renombrado en
  // el mismo directorio es atómico. La copia directa antigua, si el
  // proceso moría a mitad, dejaba la base viva truncada.
  const tmpRestore = `${dbPath.slice(0, dbPath.lastIndexOf("/") + 1)}nido-restore-${timestamp}.db`;
  try {
    await FileSystem.copyAsync({ from: actualUri, to: tmpRestore });
    await FileSystem.moveAsync({ from: tmpRestore, to: dbPath });
  } catch (e) {
    try {
      await FileSystem.deleteAsync(tmpRestore, { idempotent: true });
    } catch { /* best-effort */ }
    // Rollback: restaurar la copia de seguridad.
    if (hasSafetyCopy) {
      try {
        await FileSystem.copyAsync({ from: safetyCopy, to: dbPath });
      } catch { /* rollback best-effort */ }
    }
    throw new BackupError("rollback", `Falló la restauración y se revirtió: ${e instanceof Error ? e.message : "error desconocido"}`);
  }

  // 5. FIX 2026-10-09 (K3): restaurar la DB de conocimiento también.
  // createBackup la guarda como <dest>.knowledge.db; si existe, restaurarla
  // junto a la principal para no dejarlas de épocas distintas.
  // FIX 2026-10-09 (NEW3-H-1): usar actualUri (para bundles, el knowledge
  // se extrajo junto al .db, no junto al .nidobackup.json).
  // Auditoría completa 2026-10-31 (F3-07): si el respaldo TRAE base de
  // conocimiento, su restauración ya no es best-effort silencioso: se
  // valida en voz alta, se guarda copia previa de la viva (como la
  // principal) y se reemplaza por temporal y renombrado; si algo
  // falla se revierten las dos bases para no dejarlas de épocas
  // distintas. Lo único que sigue en silencio es el respaldo SIN
  // conocimiento, que es una forma legítima: no se toca.
  let knowledgeSafetyCopy: string | null = null;
  {
    // A2: nombre canónico; se acepta también el sufijo antiguo por si el
    // usuario conserva archivos extraídos con una versión anterior.
    let knowledgeBackupUri = knowledgeBackupUriFor(actualUri);
    let kbInfo = await FileSystem.getInfoAsync(knowledgeBackupUri);
    if (!kbInfo.exists) {
      const legacyUri = `${actualUri}.knowledge.db`;
      const legacyInfo = await FileSystem.getInfoAsync(legacyUri);
      if (legacyInfo.exists) {
        knowledgeBackupUri = legacyUri;
        kbInfo = legacyInfo;
      }
    }
    if (kbInfo.exists) {
      // FIX 2026-10-09 (R3): usar KNOWLEDGE_DB_NAME, no derivar del nombre.
      // dbPath.replace() producía "nido_memory_knowledge.db" (huérfano).
      const dir = FileSystem.documentDirectory;
      const knowledgeDbPath = `${dir}SQLite/${KNOWLEDGE_DB_NAME}`;
      const rollbackMain = async () => {
        if (hasSafetyCopy) {
          try {
            await FileSystem.copyAsync({ from: safetyCopy, to: dbPath });
          } catch { /* rollback best-effort */ }
        }
      };
      const kbValidation = await validateBackup(knowledgeBackupUri);
      if (!kbValidation.valid) {
        await rollbackMain();
        throw new BackupError("invalid", `El respaldo de conocimiento no es válido: ${kbValidation.reason}`);
      }
      // F3-08: si el manifest de la principal declara la huella del
      // conocimiento, se comprueba antes de reemplazar nada. Los
      // respaldos anteriores no la declaran y se aceptan como antes
      // (la apertura de prueba ya juzgó el acompañante).
      try {
        const mRaw = await FileSystem.readAsStringAsync(`${actualUri}.manifest.json`);
        const m = JSON.parse(mRaw);
        if (typeof m?.knowledgeSha256 === "string" && m.knowledgeSha256) {
          const actualKbSha = await sha256File(knowledgeBackupUri);
          if (!actualKbSha || actualKbSha.toLowerCase() !== m.knowledgeSha256.toLowerCase()) {
            await rollbackMain();
            throw new BackupError("invalid", "El respaldo de conocimiento está corrupto (SHA-256 no coincide).");
          }
        }
      } catch (e) {
        if (e instanceof BackupError) throw e;
        // Sin manifest legible no hay huella que comprobar.
      }
      const curInfo = await FileSystem.getInfoAsync(knowledgeDbPath);
      if (curInfo.exists) {
        knowledgeSafetyCopy = `${knowledgeDbPath}.pre-restore-${timestamp}`;
        try {
          await FileSystem.copyAsync({ from: knowledgeDbPath, to: knowledgeSafetyCopy });
        } catch (e) {
          knowledgeSafetyCopy = null;
          await rollbackMain();
          throw new BackupError(
            "storage",
            `No se pudo guardar una copia de la base de conocimiento actual: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      const tmpKb = `${dir}SQLite/nido-restore-k-${timestamp}.db`;
      try {
        await FileSystem.copyAsync({ from: knowledgeBackupUri, to: tmpKb });
        await FileSystem.moveAsync({ from: tmpKb, to: knowledgeDbPath });
      } catch (e) {
        try {
          await FileSystem.deleteAsync(tmpKb, { idempotent: true });
        } catch { /* best-effort */ }
        if (knowledgeSafetyCopy) {
          try {
            await FileSystem.copyAsync({ from: knowledgeSafetyCopy, to: knowledgeDbPath });
          } catch { /* rollback best-effort */ }
        }
        await rollbackMain();
        throw new BackupError("rollback", `Falló la restauración del conocimiento y se revirtió: ${e instanceof Error ? e.message : "error desconocido"}`);
      }
    }
  }

  // 6. A12 (auditoría 2026-10-10): conservar SOLO la copia de seguridad de
  // esta restauración. Antes cada restauración dejaba una copia completa de
  // la base que nunca se borraba. La copia actual se mantiene porque la
  // base restaurada aún no se ha reabierto (la app debe reiniciarse).
  if (hasSafetyCopy || knowledgeSafetyCopy) {
    try {
      const readDir = (FileSystem as { readDirectoryAsync?: (uri: string) => Promise<string[]> })
        .readDirectoryAsync;
      if (typeof readDir === "function") {
        const slash = dbPath.lastIndexOf("/");
        const dirUri = dbPath.slice(0, slash + 1);
        const prefix = `${dbPath.slice(slash + 1)}.pre-restore-`;
        const keep = safetyCopy.slice(slash + 1);
        // F3-07: la misma poda para las copias previas del conocimiento.
        const kbPrefix = `${KNOWLEDGE_DB_NAME}.pre-restore-`;
        const kbKeep = knowledgeSafetyCopy ? knowledgeSafetyCopy.slice(slash + 1) : null;
        for (const name of await readDir(dirUri)) {
          if (name.startsWith(prefix) && name !== keep) {
            await FileSystem.deleteAsync(`${dirUri}${name}`, { idempotent: true });
          }
          if (name.startsWith(kbPrefix) && name !== kbKeep) {
            await FileSystem.deleteAsync(`${dirUri}${name}`, { idempotent: true });
          }
        }
      }
    } catch {
      // Best-effort: la limpieza nunca debe hacer fallar una restauración.
    }
  }
  // Nota: no reabrimos la base aquí; la app debe reiniciarse.
}

/**
 * Crea un bundle portable (.nidobackup.json) con los 3 archivos en uno solo.
 * FIX 2026-10-09 (CR-1): el share sheet solo maneja un archivo. El bundle
 * JSON incluye db + manifest + knowledge en base64, así K1/K2/K3 protegen
 * el flujo real de compartir.
 */
export async function createPortableBundle(backupUri: string): Promise<string> {
  const manifestUri = `${backupUri}.manifest.json`;
  const knowledgeUri = knowledgeBackupUriFor(backupUri);

  const manifestRaw = await FileSystem.readAsStringAsync(manifestUri);
  const dbBase64 = await FileSystem.readAsStringAsync(backupUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  let knowledgeBase64: string | null = null;
  try {
    const kInfo = await FileSystem.getInfoAsync(knowledgeUri);
    if (kInfo.exists) {
      knowledgeBase64 = await FileSystem.readAsStringAsync(knowledgeUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  } catch { /* noop */ }

  const bundle = {
    format: "nidobackup",
    version: 1,
    manifest: JSON.parse(manifestRaw),
    db: dbBase64,
    knowledge: knowledgeBase64,
  };

  const bundleUri = backupUri.replace(/\.db$/, ".nidobackup.json");
  await FileSystem.writeAsStringAsync(bundleUri, JSON.stringify(bundle));
  return bundleUri;
}

/**
 * Extrae un bundle portable a los 3 archivos separados.
 * Retorna la URI del .db extraído.
 */
export async function extractPortableBundle(bundleUri: string, destDir: string): Promise<string> {
  // Auditoría 2026-10-29: el mismo tope que validateBundle, aquí también.
  // Hoy toda llamada valida antes, pero esta función no debe fiarse de eso.
  const info = await FileSystem.getInfoAsync(bundleUri);
  const size = (info as { size?: number }).size;
  if (!info.exists || typeof size !== "number" || size > MAX_BUNDLE_BYTES) {
    throw new BackupError("invalid", "El bundle no existe o es demasiado grande.");
  }
  const raw = await FileSystem.readAsStringAsync(bundleUri);
  const bundle = JSON.parse(raw);
  if (bundle.format !== "nidobackup") {
    throw new BackupError("invalid", "Formato de bundle no reconocido");
  }

  const dbUri = `${destDir.replace(/\/+$/, "")}/restored.db`;
  // FIX 2026-10-09 (B1): argumentos en orden correcto (uri, contenido).
  // Estaban invertidos: el blob base64 iba como URI y el path como contenido.
  await FileSystem.writeAsStringAsync(dbUri, bundle.db, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await FileSystem.writeAsStringAsync(
    `${dbUri}.manifest.json`,
    JSON.stringify(bundle.manifest, null, 2)
  );

  if (bundle.knowledge) {
    await FileSystem.writeAsStringAsync(knowledgeBackupUriFor(dbUri), bundle.knowledge, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  return dbUri;
}

/** Una clave de respaldo es exactamente 64 caracteres hexadecimales. */
export function normalizeBackupKey(input: string): string | null {
  const hex = input.replace(/\s+/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/**
 * A1 (auditoría 2026-10-10): restaurar un respaldo hecho con OTRA clave
 * (otra instalación, otro teléfono, o antes de rotar la clave).
 *
 * Diseño conservador: nunca se toca la clave guardada en este teléfono ni la
 * base viva hasta el final.
 *   1. Se copia el respaldo a un archivo temporal.
 *   2. La copia se abre con la clave que el usuario escribió. Si no abre,
 *      se aborta sin haber cambiado nada.
 *   3. La copia se vuelve a cifrar (PRAGMA rekey) con la clave de ESTE
 *      teléfono.
 *   4. La copia ya recifrada entra por restoreBackup(), con su validación,
 *      su copia de seguridad previa y su reversión automática.
 * Los temporales se borran siempre.
 */
export async function restoreBackupWithKey(backupUri: string, backupKeyInput: string): Promise<void> {
  const backupKey = normalizeBackupKey(backupKeyInput);
  if (!backupKey) {
    throw new BackupError("keyFormat", "La clave del respaldo debe tener 64 caracteres hexadecimales.");
  }
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new BackupError("storage", "No se pudo acceder al almacenamiento.");

  const { getDatabaseKeyHex, applyDatabaseKey } = await import("../privacy/keyManager");
  const currentKey = await getDatabaseKeyHex();
  if (!currentKey || !/^[0-9a-f]{64}$/i.test(currentKey)) {
    throw new BackupError("noDeviceKey", "Este teléfono no tiene una clave de cifrado disponible.");
  }

  let sourceUri = backupUri;
  const extracted: string[] = [];
  if (backupUri.endsWith(".nidobackup.json")) {
    const v = await validateBackup(backupUri);
    if (!v.valid) throw new BackupError("invalid", `Backup inválido: ${v.reason}`);
    sourceUri = await extractPortableBundle(backupUri, dir);
    extracted.push(sourceUri, `${sourceUri}.manifest.json`, knowledgeBackupUriFor(sourceUri));
  }

  const stamp = Date.now();
  const sqliteDir = `${dir}SQLite/`;
  await FileSystem.makeDirectoryAsync(sqliteDir, { intermediates: true }).catch(() => {});
  const tempMain = `${sqliteDir}nido-restore-${stamp}.db`;
  const tempKnowledge = knowledgeBackupUriFor(tempMain);
  const temps = [tempMain, tempKnowledge];

  const SQLite = await import("expo-sqlite");
  const rekeyCopy = async (from: string, to: string, label: string): Promise<void> => {
    await FileSystem.copyAsync({ from, to });
    const slash = to.lastIndexOf("/");
    const db = await SQLite.openDatabaseAsync(
      to.slice(slash + 1),
      { useNewConnection: true },
      to.slice(0, slash),
    );
    try {
      // Lanza (y cierra) si la clave no abre el archivo.
      await applyDatabaseKey(db as any, backupKey, label);
      await (db as any).execAsync(`PRAGMA rekey = "x'${currentKey.toLowerCase()}'";`);
    } finally {
      await (db as any).closeAsync().catch(() => {});
    }
  };

  try {
    const info = await FileSystem.getInfoAsync(sourceUri);
    if (!info.exists) throw new BackupError("invalid", "El archivo no existe.");
    try {
      await rekeyCopy(sourceUri, tempMain, "restore-with-key");
    } catch {
      throw new BackupError("wrongKey", "La clave no abre este respaldo. Revisa que sea la clave que guardaste al crearlo.");
    }
    // La base de conocimiento es opcional: si viene, se recifra igual.
    let knowledgeSource = knowledgeBackupUriFor(sourceUri);
    let kInfo = await FileSystem.getInfoAsync(knowledgeSource);
    if (!kInfo.exists) {
      knowledgeSource = `${sourceUri}.knowledge.db`;
      kInfo = await FileSystem.getInfoAsync(knowledgeSource);
    }
    if (kInfo.exists) {
      try {
        await rekeyCopy(knowledgeSource, tempKnowledge, "restore-with-key-knowledge");
      } catch {
        // Si la base de conocimiento no abre con esa clave, se restaura
        // solo la principal (los documentos se pueden volver a importar).
        await FileSystem.deleteAsync(tempKnowledge, { idempotent: true }).catch(() => {});
      }
    }
    await restoreBackup(tempMain);
  } finally {
    for (const f of [...temps, ...extracted]) {
      for (const suffix of ["", "-wal", "-shm"]) {
        await FileSystem.deleteAsync(`${f}${suffix}`, { idempotent: true }).catch(() => {});
      }
    }
  }
}
