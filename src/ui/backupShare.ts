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
 * La clave se sigue mostrando en la alerta (sin cambios).
 */

import * as Sharing from "expo-sharing";
import {
  documentDirectory,
  readDirectoryAsync,
} from "expo-file-system/legacy";
import { createBackup, exportDatabaseKey } from "../security/backup";

export interface CreatedBackup {
  path: string;
  key: string;
}

/** Crea el backup y devuelve ruta + clave. */
export async function createBackupFile(): Promise<CreatedBackup> {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const dest = `${documentDirectory}nido-backup-${timestamp}.db`;
  await createBackup(dest);
  const key = await exportDatabaseKey();
  return { path: dest, key };
}

/** Ruta del backup más reciente, o null si no hay ninguno. */
export async function findLatestBackup(): Promise<string | null> {
  const files = await readDirectoryAsync(documentDirectory ?? "");
  const backups = files
    .filter((f) => f.startsWith("nido-backup-") && f.endsWith(".db"))
    .sort();
  if (backups.length === 0) return null;
  return `${documentDirectory}${backups[backups.length - 1]}`;
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


