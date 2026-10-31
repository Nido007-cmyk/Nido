/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * backupShare.ts — creación y compartido de backups desde la UI.
 *
 * TESTFIX-2026-10-08 (Fix 6): "Crear backup" escribía a la carpeta privada
 * del app (/data/user/0/...), inalcanzable para el usuario y para el
 * document picker de "Restaurar backup" — el round-trip era imposible
 * (evidencia física). Este módulo añade el compartido vía el share sheet
 * del sistema para que el archivo salga a un lugar accesible.
 *
 * La clave la muestra BackupKeyModal (copiable) en ambas rutas desde
 * 2026-10-12; antes la tarjeta de Ajustes la ponía en una alerta del
 * sistema cuyo texto no se puede copiar.
 */

import * as Sharing from "expo-sharing";
import * as FS from "expo-file-system/legacy";
import { createBackup, exportDatabaseKey, knowledgeBackupUriFor } from "../security/backup";
import { BackupError } from "../security/backupErrors";

export interface CreatedBackup {
  path: string;
  key: string;
  /** 0.1.29 (B-2): el teléfono no tiene PIN; la pantalla debe avisar. */
  noLock: boolean;
}

/** Crea el backup y devuelve ruta + clave. */
export async function createBackupFile(unlockReason = "Crear backup"): Promise<CreatedBackup> {
  // FIX 2026-10-09 (NEW-CR-2): biométrico obligatorio antes de exponer la DEK.
  // Antes se mostraba sin autenticación en el flujo real.
  const { unlockForSecret } = await import("../security/biometricGate");
  let noLock = false;
  try {
    noLock = (await unlockForSecret(unlockReason)) === "no-lock";
  } catch {
    throw new BackupError("authCancelled", "Autenticación cancelada");
  }
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const dest = `${FS.documentDirectory}nido-backup-${timestamp}.db`;
  await createBackup(dest);
  const key = await exportDatabaseKey();
  return { path: dest, key, noLock };
}

/** Ruta del backup más reciente, o null si no hay ninguno. */
export async function findLatestBackup(): Promise<string | null> {
  const files = await FS.readDirectoryAsync(FS.documentDirectory ?? "");
  const backups = files
    .filter((f) => f.startsWith("nido-backup-") && f.endsWith(".db"))
    .sort();
  if (backups.length === 0) return null;
  return `${FS.documentDirectory}${backups[backups.length - 1]}`;
}

/**
 * Copia el backup (y sus acompañantes .manifest.json / .knowledge.db si
 * existen) a una carpeta elegida por el usuario vía SAF (Descargas).
 * Devuelve los nombres copiados, o null si no se concedió el permiso de
 * carpeta. Extraído de BackupScreen (2026-10-12) para que la tarjeta de
 * Ajustes ofrezca exactamente el mismo guardado.
 */
export async function saveBackupToFolder(sourcePath: string): Promise<string[] | null> {
  const perms = await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!perms.granted) return null;
  // FIX 2026-10-09 (C1): copiar los 3 archivos (db + manifest + knowledge).
  // Si no, K1/K2/K3 no protegen el flujo de Descargas.
  // Auditoría completa 2026-10-31 (F3-02): el nombre del acompañante de
  // conocimiento sale de knowledgeBackupUriFor, la única fuente (A2).
  // Aquí se buscaba "X.db.knowledge.db" por concatenación, un fichero
  // que createBackup nunca escribe ("X.knowledge.db"): el guardado en
  // Descargas nunca copiaba el conocimiento, en silencio.
  const filesToCopy = [sourcePath];
  for (const extra of [`${sourcePath}.manifest.json`, knowledgeBackupUriFor(sourcePath)]) {
    try {
      const info = await FS.getInfoAsync(extra);
      if (info.exists) filesToCopy.push(extra);
    } catch { /* noop */ }
  }
  const copied: string[] = [];
  for (const srcUri of filesToCopy) {
    const fileName = srcUri.split("/").pop() ?? "nido-backup.db";
    const destUri = await FS.StorageAccessFramework.createFileAsync(
      perms.directoryUri,
      fileName,
      "application/octet-stream"
    );
    const content = await FS.readAsStringAsync(srcUri, {
      encoding: FS.EncodingType.Base64,
    });
    await FS.writeAsStringAsync(destUri, content, {
      encoding: FS.EncodingType.Base64,
    });
    copied.push(fileName);
  }
  // Auditoría completa 2026-10-31 (F3-09): SOLO aquí se registra la
  // fecha del respaldo para la puerta D9 de la bóveda. Guardar en
  // una carpeta elegida por el usuario es la única salida con
  // confirmación real: crear el fichero en el directorio privado no
  // saca nada del aparato, y la hoja de compartir de Android no
  // avisa de si el destino guardó algo.
  const { recordBackupMade } = await import("../security/vaultBackupGate");
  await recordBackupMade();
  return copied;
}

/**
 * Abre el share sheet del sistema con el backup como bundle portable.
 * FIX 2026-10-09 (CR-1): usa createPortableBundle para incluir db + manifest
 * + knowledge en un solo archivo. Así K1/K2/K3 protegen el flujo real.
 * Lanza si el compartido no está disponible en el dispositivo.
 */
export async function shareBackupFile(path: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("sharing-unavailable");
  }
  const { createPortableBundle } = await import("../security/backup");
  const bundleUri = await createPortableBundle(path);
  await Sharing.shareAsync(bundleUri);
}


