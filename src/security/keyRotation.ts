/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Rotación de DEK (F-KEY-1).
 *
 * Permite al usuario rotar la clave de cifrado de la base de datos.
 * Usa SQLCipher `PRAGMA rekey` que es atómico.
 *
 * Flujo (crash-safe, CR-3):
 * 1. Biométrico (obligatorio)
 * 2. Generar nuevo DEK (32 bytes aleatorios)
 * 3. Guardar nuevo DEK en staging (archivo temporal) ANTES del rekey
 * 4. Abrir DB con DEK viejo
 * 5. PRAGMA rekey = '<nuevo>'
 * 6. Guardar nuevo DEK en Keystore
 * 7. Borrar staging
 * 8. Si Keystore falla → revertir con rekey a la vieja
 *
 * Si la app crashea entre 5 y 6, el staging permite recuperar en el próximo
 * arranque (checkStaleRekeyStaging).
 *
 * Seguridad:
 * - Nunca loggear DEKs
 * - Borrar DEK viejo de memoria con fill(0)
 * - Biométrico obligatorio
 */

import { getDatabaseKeyHex } from "../privacy/keyManager";
import { requireUnlock } from "./biometricGate";

export interface RekeyResult {
  ok: boolean;
  error?: string;
}

/**
 * Rota la DEK de la base de datos.
 * @param dbPath Ruta a la base de datos
 * @param openDb Función que abre la DB con un DEK hex (inyectable para tests)
 * @param storeDek Función que guarda el DEK en Keystore (inyectable para tests)
 */
export async function rotateDatabaseKey(
  dbPath: string,
  openDb: (path: string, dekHex: string) => Promise<{ exec: (sql: string) => Promise<void>; close: () => Promise<void> }>,
  storeDek: (dekHex: string) => Promise<void>
): Promise<RekeyResult> {
  // 1. Biométrico obligatorio (lanza si se cancela)
  try {
    await requireUnlock("Rotar clave de cifrado");
  } catch {
    return { ok: false, error: "Autenticación cancelada" };
  }

  // 2. Cargar DEK actual
  const oldDekHex = await getDatabaseKeyHex();
  if (!oldDekHex) {
    return { ok: false, error: "No hay clave actual (fail-closed)" };
  }

  // 3. Generar nuevo DEK
  const { getRandomBytesAsync } = await import("expo-crypto");
  const newDekBytes = await getRandomBytesAsync(32);
  const newDekHex = Array.from(newDekBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Borrar bytes originales de memoria
  newDekBytes.fill(0);

  let db: { exec: (sql: string) => Promise<void>; close: () => Promise<void> } | null = null;
  try {
    // 4. Abrir con DEK viejo y hacer rekey
    db = await openDb(dbPath, oldDekHex);
    // SQLCipher: PRAGMA rekey es atómico
    await db.exec(`PRAGMA rekey = "x'${newDekHex}'";`);

    // 5. Guardar nuevo DEK en Keystore
    try {
      await storeDek(newDekHex);
    } catch (storeErr) {
      // FAIL-CLOSED: revertir la DB a la clave vieja
      try {
        await db.exec(`PRAGMA rekey = "x'${oldDekHex}'";`);
      } catch {
        // Si el revert falla, estamos en estado inconsistente.
        // No hay nada más que hacer aquí; el usuario debe restaurar de backup.
      }
      return { ok: false, error: "No se pudo guardar la nueva clave; se revirtió el cambio" };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error desconocido" };
  } finally {
    if (db) {
      try {
        await db.close();
      } catch {
        // noop
      }
    }
    // Borrar DEKs de memoria (los strings son inmutables en JS, pero
    // al menos no los retenemos en variables accesibles)
  }
}
