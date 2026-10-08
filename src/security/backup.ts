/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * backup.ts — NIDO: respaldo y restauración de la base cifrada.
 *
 * La base `nido_memory.db` está cifrada con SQLCipher. El backup consiste en:
 * 1. Copiar el archivo de la base (ya cifrado) a una ubicación elegida por el usuario.
 * 2. Exportar la clave de cifrado de forma segura (el usuario la guarda aparte).
 *
 * Sin la clave, el backup es inútil. Sin el backup, la clave es inútil.
 * Ningún servidor ve ninguno de los dos.
 */

import * as FileSystem from "expo-file-system/legacy";
import { getDatabaseKeyHex } from "../privacy/keyManager";

const DB_NAME = "nido_memory.db";

/**
 * Obtiene la ruta del archivo de la base de datos.
 */
async function getDbPath(): Promise<string> {
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new Error("No se pudo acceder al almacenamiento.");
  return `${dir}SQLite/${DB_NAME}`;
}

/**
 * Crea un backup: copia la base cifrada a la ruta destino.
 * Retorna la ruta del backup creado.
 */
export async function createBackup(destinationUri: string): Promise<string> {
  const dbPath = await getDbPath();
  const info = await FileSystem.getInfoAsync(dbPath);
  if (!info.exists) {
    throw new Error("Base de datos no encontrada.");
  }
  await FileSystem.copyAsync({ from: dbPath, to: destinationUri });
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
 * Restaura un backup: reemplaza la base actual con el archivo de backup.
 * ADVERTENCIA: esto sobrescribe los datos actuales. La app debe reiniciarse después.
 */
export async function restoreBackup(backupUri: string): Promise<void> {
  const dbPath = await getDbPath();
  const backupInfo = await FileSystem.getInfoAsync(backupUri);
  if (!backupInfo.exists) {
    throw new Error("Archivo de backup no encontrado.");
  }
  // Hacer copia de seguridad de la base actual antes de sobrescribir.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyCopy = `${dbPath}.pre-restore-${timestamp}`;
  try {
    await FileSystem.copyAsync({ from: dbPath, to: safetyCopy });
  } catch {
    // Si no hay base actual, no hay nada que respaldar.
  }
  await FileSystem.copyAsync({ from: backupUri, to: dbPath });
}

/**
 * Verifica que un archivo sea un backup válido (existe y tiene tamaño razonable).
 */
export async function validateBackup(uri: string): Promise<{ valid: boolean; sizeBytes?: number; reason?: string }> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return { valid: false, reason: "El archivo no existe." };
    }
    const size = (info as any).size ?? 0;
    if (size < 1024) {
      return { valid: false, reason: "El archivo es demasiado pequeño para ser un backup válido." };
    }
    return { valid: true, sizeBytes: size };
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message : "Error desconocido." };
  }
}
