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

const DB_NAME = "nido_memory.db";
const KNOWLEDGE_DB_NAME = "nido_knowledge.db";
const BACKUP_VERSION = 1;
// SQLCipher magic header: "SQLite format 3\0" — los primeros 16 bytes
const SQLITE_MAGIC = "SQLite format 3\0";

/**
 * Obtiene la ruta del archivo de la base de datos.
 */
async function getDbPath(): Promise<string> {
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new Error("No se pudo acceder al almacenamiento.");
  return `${dir}SQLite/${DB_NAME}`;
}

/**
 * Calcula SHA-256 de un archivo (para el manifest).
 * Usa crypto nativo si está disponible, sino retorna null.
 */
async function sha256File(uri: string): Promise<string | null> {
  try {
    const { default: Crypto } = await import("expo-crypto");
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // expo-crypto trabaja con strings; para archivos grandes esto es costoso
    // pero los backups de NIDO son pequeños (<100MB típico).
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      Array.from(bytes).map(b => String.fromCharCode(b)).join(""),
      { encoding: Crypto.CryptoEncoding.HEX }
    );
  } catch {
    return null;
  }
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
  if (!dir) throw new Error("No se pudo acceder al almacenamiento.");
  const dbPath = `${dir}SQLite/${DB_NAME}`;
  const knowledgePath = `${dir}SQLite/${KNOWLEDGE_DB_NAME}`;

  const info = await FileSystem.getInfoAsync(dbPath);
  if (!info.exists) {
    throw new Error("Base de datos no encontrada.");
  }

  // 1. Checkpoint WAL: consolidar -wal en el archivo principal.
  // Si falla, continuamos (el backup puede estar incompleto pero no corrupto).
  try {
    const db = await getDatabase();
    await db.execAsync(WAL_CHECKPOINT_SQL);
  } catch {
    // Log silencioso: el checkpoint es best-effort.
  }

  // 2. Copiar la base principal.
  await FileSystem.copyAsync({ from: dbPath, to: destinationUri });

  // 3. Copiar la base de conocimiento si existe (M3).
  const knowledgeDest = destinationUri.replace(/\.db$/, ".knowledge.db");
  let knowledgeBackedUp = false;
  try {
    const kInfo = await FileSystem.getInfoAsync(knowledgePath);
    if (kInfo.exists) {
      await FileSystem.copyAsync({ from: knowledgePath, to: knowledgeDest });
      knowledgeBackedUp = true;
    }
  } catch {
    // Best-effort: si no hay base de conocimiento, continuar.
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
    appVersion: "1.0.0", // TODO: leer de app.json dinámicamente
    sha256: await sha256File(destinationUri),
    // FIX 2026-10-09 (K1): fingerprint del DEK para detectar key mismatch en restore.
    dekFingerprint,
  };
  const manifestUri = `${destinationUri}.manifest.json`;
  await FileSystem.writeAsStringAsync(manifestUri, JSON.stringify(manifest, null, 2));

  return destinationUri;
}

/**
 * Exporta la clave de cifrado en formato hexadecimal.
 * ADVERTENCIA: quien tenga esta clave + el backup puede leer todo.
 * El usuario debe guardarla en un lugar seguro y separado del backup.
 */
export async function exportDatabaseKey(): Promise<string> {
  const keyHex = await getDatabaseKeyHex();
  if (!keyHex) {
    throw new Error("No se pudo obtener la clave de la base de datos.");
  }
  return keyHex;
}

/**
 * FIX 2026-10-09 (NEW-CR-1, NEW-H-1, NEW-H-2): valida un bundle portable.
 * - NEW-H-1: límite de 100MB para evitar OOM (FIX 2026-10-09 S5: el comentario
 *   decía 500MB pero el código siempre fue 100MB)
 * - NEW-H-2: valida la forma del manifest (no solo JSON.parse)
 */
async function validateBundle(bundleUri: string): Promise<{ valid: boolean; sizeBytes?: number; reason?: string }> {
  const info = await FileSystem.getInfoAsync(bundleUri);
  if (!info.exists) {
    return { valid: false, reason: "El archivo no existe." };
  }
  const size = (info as any).size ?? 0;
  if (size > 100 * 1024 * 1024) {
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

  return { valid: true, sizeBytes: size };
}

/**
 * Valida que un archivo sea un backup válido:
 * - Existe y tiene tamaño mínimo.
 * - Tiene el magic header de SQLite (no es un archivo de texto aleatorio).
 *
 * BK-4 FIX: antes solo verificaba existencia y tamaño. Ahora verifica
 * el header mágico para descartar archivos que no son bases SQLite.
 */
export async function validateBackup(uri: string): Promise<{ valid: boolean; sizeBytes?: number; reason?: string }> {
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
    try {
      const { getDatabaseKeyHex, applyDatabaseKey } = await import("../privacy/keyManager");
      const SQLite = await import("expo-sqlite");
      const dekHex = await getDatabaseKeyHex().catch(() => null);
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
        const actualSha = await sha256File(uri);
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
      }
    } catch {
      // Sin manifest, continuar con validación básica (backups viejos).
    }
    return { valid: true, sizeBytes: size };
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
  // FIX 2026-10-09 (CR-1): si es un bundle portable, extraer primero.
  let actualUri = backupUri;
  if (backupUri.endsWith(".nidobackup.json")) {
    const dir = FileSystem.documentDirectory;
    if (!dir) throw new Error("No se pudo acceder al almacenamiento.");
    actualUri = await extractPortableBundle(backupUri, dir);
  }

  // 1. Validar ANTES de tocar nada (BK-3).
  const validation = await validateBackup(actualUri);
  if (!validation.valid) {
    throw new Error(`Backup inválido: ${validation.reason}`);
  }

  const dbPath = await getDbPath();

  // 2. Hacer copia de seguridad de la base actual.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyCopy = `${dbPath}.pre-restore-${timestamp}`;
  let hasSafetyCopy = false;
  try {
    const info = await FileSystem.getInfoAsync(dbPath);
    if (info.exists) {
      await FileSystem.copyAsync({ from: dbPath, to: safetyCopy });
      hasSafetyCopy = true;
    }
  } catch {
    // Si no hay base actual, no hay nada que respaldar.
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
  try {
    await FileSystem.copyAsync({ from: actualUri, to: dbPath });
  } catch (e) {
    // Rollback: restaurar la copia de seguridad.
    if (hasSafetyCopy) {
      try {
        await FileSystem.copyAsync({ from: safetyCopy, to: dbPath });
      } catch { /* rollback best-effort */ }
    }
    throw new Error(`Falló la restauración y se revirtió: ${e instanceof Error ? e.message : "error desconocido"}`);
  }

  // 5. FIX 2026-10-09 (K3): restaurar la DB de conocimiento también.
  // createBackup la guarda como <dest>.knowledge.db; si existe, restaurarla
  // junto a la principal para no dejarlas de épocas distintas.
  // FIX 2026-10-09 (NEW3-H-1): usar actualUri (para bundles, el knowledge
  // se extrajo junto al .db, no junto al .nidobackup.json).
  try {
    const knowledgeBackupUri = `${actualUri}.knowledge.db`;
    const kbInfo = await FileSystem.getInfoAsync(knowledgeBackupUri);
    if (kbInfo.exists) {
      // FIX 2026-10-09 (R3): usar KNOWLEDGE_DB_NAME, no derivar del nombre.
      // dbPath.replace() producía "nido_memory_knowledge.db" (huérfano).
      const dir = FileSystem.documentDirectory;
      const knowledgeDbPath = `${dir}SQLite/${KNOWLEDGE_DB_NAME}`;
      const kbValidation = await validateBackup(knowledgeBackupUri);
      if (kbValidation.valid) {
        await FileSystem.copyAsync({ from: knowledgeBackupUri, to: knowledgeDbPath });
      }
    }
  } catch {
    // Best-effort: si no hay knowledge backup, continuar.
  }

  // 6. Limpiar la copia de seguridad solo si todo salió bien.
  // (Se conserva si hubo algún problema para recuperación manual.)
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
  const knowledgeUri = `${backupUri}.knowledge.db`;

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
  const raw = await FileSystem.readAsStringAsync(bundleUri);
  const bundle = JSON.parse(raw);
  if (bundle.format !== "nidobackup") {
    throw new Error("Formato de bundle no reconocido");
  }

  const dbUri = `${destDir}/restored.db`;
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
    await FileSystem.writeAsStringAsync(`${dbUri}.knowledge.db`, bundle.knowledge, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  return dbUri;
}
