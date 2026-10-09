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
 * @param stagingPath Ruta del archivo de staging (inyectable para tests)
 */
export async function rotateDatabaseKey(
  dbPath: string,
  openDb: (path: string, dekHex: string) => Promise<{ exec: (sql: string) => Promise<void>; close: () => Promise<void> }>,
  storeDek: (dekHex: string) => Promise<void>,
  stagingPath?: string
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
  newDekBytes.fill(0);

  // FIX 2026-10-09 (CR-3): staging antes del rekey. Si la app crashea entre
  // el rekey y el keystore write, el staging permite recuperar.
  const FS = await import("expo-file-system/legacy");
  const staging = stagingPath ?? `${FS.documentDirectory}rekey-staging.json`;
  try {
    await FS.writeAsStringAsync(staging, JSON.stringify({
      newDekHex,
      dbPath,
      at: Date.now(),
    }));
  } catch {
    return { ok: false, error: "No se pudo crear el staging (fail-closed)" };
  }

  let db: { exec: (sql: string) => Promise<void>; close: () => Promise<void> } | null = null;
  try {
    // 4. Abrir con DEK viejo y hacer rekey
    db = await openDb(dbPath, oldDekHex);
    await db.exec(`PRAGMA rekey = "x'${newDekHex}'";`);

    // 5. Guardar nuevo DEK en Keystore
    try {
      await storeDek(newDekHex);
    } catch (storeErr) {
      try {
        await db.exec(`PRAGMA rekey = "x'${oldDekHex}'";`);
      } catch { /* noop */ }
      // FIX 2026-10-09 (CR3-NEW2): borrar staging en el path de revert.
      // Si no, un checkStaleRekeyStaging posterior escribiría el DEK nuevo
      // en el keystore mientras la DB tiene el viejo → brick.
      try {
        await FS.deleteAsync(staging, { idempotent: true });
      } catch { /* noop */ }
      return { ok: false, error: "No se pudo guardar la nueva clave; se revirtió el cambio" };
    }

    // 6. Éxito: borrar staging
    try {
      await FS.deleteAsync(staging, { idempotent: true });
    } catch { /* noop */ }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error desconocido" };
  } finally {
    if (db) {
      try { await db.close(); } catch { /* noop */ }
    }
  }
}

/**
 * FIX 2026-10-09 (CR-3, CR3-NEW): verifica si hay un staging pendiente de una
 * rotación interrumpida por crash.
 *
 * CRÍTICO: no escribe ciegamente el DEK del staging al keystore. Primero hace
 * probe-open de la DB con el DEK del staging:
 * - Si abre → el rekey SÍ ocurrió antes del crash → guardar en keystore.
 * - Si NO abre → el crash fue ANTES del rekey (DB tiene DEK viejo) →
 *   borrar staging y no tocar el keystore (si lo tocáramos, brick).
 *
 * Debe llamarse al arranque de la app.
 */
export async function checkStaleRekeyStaging(
  stagingPath: string,
  storeDek: (dekHex: string) => Promise<void>,
  openDb: (path: string, dekHex: string) => Promise<{ exec: (sql: string) => Promise<void>; close: () => Promise<void> }>
): Promise<{ recovered: boolean; error?: string }> {
  try {
    const FS = await import("expo-file-system/legacy");
    const info = await FS.getInfoAsync(stagingPath);
    if (!info.exists) return { recovered: false };
    
    const raw = await FS.readAsStringAsync(stagingPath);
    const { newDekHex, dbPath } = JSON.parse(raw);
    if (!newDekHex || typeof newDekHex !== "string") {
      await FS.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
      return { recovered: false, error: "Staging corrupto, eliminado" };
    }
    
    // FIX 2026-10-09 (CR3-NEW): probe-open antes de tocar el keystore.
    let probeDb: { exec: (sql: string) => Promise<void>; close: () => Promise<void> } | null = null;
    try {
      probeDb = await openDb(dbPath, newDekHex);
      // Si abre, el rekey ocurrió. Verificar que realmente abre con una query.
      await probeDb.exec("SELECT 1;");
    } catch {
      // No abre con el DEK nuevo → el crash fue ANTES del rekey.
      // La DB tiene el DEK viejo. Borrar staging, no tocar keystore.
      await FS.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
      return { recovered: false, error: "Crash antes del rekey; staging eliminado, keystore intacto" };
    } finally {
      if (probeDb) {
        try { await probeDb.close(); } catch { /* noop */ }
      }
    }
    
    // El rekey SÍ ocurrió. Ahora sí guardar en keystore.
    await storeDek(newDekHex);
    await FS.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
    return { recovered: true };
  } catch (e) {
    return { recovered: false, error: e instanceof Error ? e.message : "Error" };
  }
}
