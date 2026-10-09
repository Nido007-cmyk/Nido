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
 * - TRADEOFF: el staging (rekey-staging.json) guarda el DEK nuevo en
 *   plaintext (directorio privado de la app, vida corta). En dispositivo
 *   rooteado es extraíble. Alternativa (cifrar staging con DEK viejo)
 *   añade complejidad; documentado como riesgo aceptado.
 */

import { getDatabaseKeyHex } from "../privacy/keyManager";
import { requireUnlock } from "./biometricGate";
import { MANAGED_DB_NAMES, getCurrentDriver } from "./secureDatabase";

export interface RekeyResult {
  ok: boolean;
  error?: string;
}

/**
 * FIX 2026-10-09 (CR2-MULTIDB): rota la DEK de TODAS las bases gestionadas.
 *
 * Las 3 DBs de MANAGED_DB_NAMES comparten la misma DEK del Keystore, así que
 * el rekey debe cubrirlas todas con el MISMO DEK nuevo. Si solo se rotara
 * una, las otras quedarían inaccesibles (brick).
 *
 * El staging lista todas las rutas para que checkStaleRekeyStaging pueda
 * verificar cada una en el recovery.
 *
 * @param openDb Función que abre una DB con un DEK hex (inyectable para tests)
 * @param storeDek Función que guarda el DEK en Keystore (inyectable para tests)
 * @param stagingPath Ruta del archivo de staging (inyectable para tests)
 */
export async function rotateAllDatabaseKeys(
  openDb: (path: string, dekHex: string) => Promise<{ exec: (sql: string) => Promise<void>; close: () => Promise<void> }>,
  storeDek: (dekHex: string) => Promise<void>,
  stagingPath?: string
): Promise<RekeyResult> {
  // 1. Biométrico obligatorio.
  // FIX 2026-10-09: distinguir cancelación de error real.
  try {
    await requireUnlock("Rotar clave de cifrado");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    // El usuario canceló explícitamente vs. fallo del hardware/sistema.
    if (/cancel|cancelled|dismissed|user_cancel/i.test(msg)) {
      return { ok: false, error: "Autenticación cancelada" };
    }
    return { ok: false, error: `No se pudo autenticar: ${msg || "error desconocido"}` };
  }

  // 2. Cargar DEK actual
  const oldDekHex = await getDatabaseKeyHex();
  if (!oldDekHex) {
    return { ok: false, error: "No hay clave actual (fail-closed)" };
  }

  // 3. Derivar rutas canónicas de las DBs existentes (CR2-PATH: no hardcodear)
  const driver = getCurrentDriver();
  const dir = driver.dbDir().replace(/\/$/, "");
  const dbPaths: string[] = [];
  for (const name of MANAGED_DB_NAMES) {
    const fullPath = `${dir}/${name}`;
    if (await driver.exists(fullPath)) {
      dbPaths.push(fullPath);
    }
  }
  if (dbPaths.length === 0) {
    return { ok: false, error: "No se encontraron bases de datos" };
  }

  // 4. Generar nuevo DEK (uno solo para todas las DBs)
  const { getRandomBytesAsync } = await import("expo-crypto");
  const newDekBytes = await getRandomBytesAsync(32);
  const newDekHex = Array.from(newDekBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  newDekBytes.fill(0);

  // 5. Staging con TODAS las rutas + DEK viejo (crash-safe, CR-3, PARTIAL-REKEY).
  // FIX 2026-10-09 (PARTIAL-REKEY): guardar también oldDekHex para que el
  // recovery pueda converger cada DB individualmente al DEK correcto,
  // en vez de asumir que todas quedaron con el nuevo.
  const FS = await import("expo-file-system/legacy");
  const staging = stagingPath ?? `${FS.documentDirectory}rekey-staging.json`;
  try {
    await FS.writeAsStringAsync(staging, JSON.stringify({
      newDekHex,
      oldDekHex,
      dbPaths,
      rekeyed: [] as string[],
      at: Date.now(),
    }));
  } catch {
    return { ok: false, error: "No se pudo crear el staging (fail-closed)" };
  }

  // 6. Rekey de cada DB con el DEK nuevo.
  // FIX 2026-10-09 (PARTIAL-REKEY): actualizar el staging tras cada DB
  // para que el recovery sepa exactamente cuáles quedaron con el DEK nuevo.
  const openedDbs: { exec: (sql: string) => Promise<void>; close: () => Promise<void> }[] = [];
  const rekeyedPaths: string[] = [];
  try {
    for (const dbPath of dbPaths) {
      const db = await openDb(dbPath, oldDekHex);
      openedDbs.push(db);
      await db.exec(`PRAGMA rekey = "x'${newDekHex}'";`);
      rekeyedPaths.push(dbPath);
      // Persistir progreso: si crashea aquí, el recovery sabe cuáles converger.
      try {
        await FS.writeAsStringAsync(staging, JSON.stringify({
          newDekHex,
          oldDekHex,
          dbPaths,
          rekeyed: rekeyedPaths,
          at: Date.now(),
        }));
      } catch { /* noop: el staging original sigue válido */ }
    }

    // 7. Guardar nuevo DEK en Keystore
    try {
      await storeDek(newDekHex);
    } catch (storeErr) {
      // Revertir TODAS las DBs al DEK viejo
      for (const db of openedDbs) {
        try {
          await db.exec(`PRAGMA rekey = "x'${oldDekHex}'";`);
        } catch { /* noop */ }
      }
      try {
        await FS.deleteAsync(staging, { idempotent: true });
      } catch { /* noop */ }
      return { ok: false, error: "No se pudo guardar la nueva clave; se revirtió el cambio" };
    }

    // 8. Éxito: borrar staging
    try {
      await FS.deleteAsync(staging, { idempotent: true });
    } catch { /* noop */ }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error desconocido" };
  } finally {
    for (const db of openedDbs) {
      try { await db.close(); } catch { /* noop */ }
    }
  }
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
  // 1. Biométrico obligatorio.
  // FIX 2026-10-09: distinguir cancelación de error real.
  try {
    await requireUnlock("Rotar clave de cifrado");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/cancel|cancelled|dismissed|user_cancel/i.test(msg)) {
      return { ok: false, error: "Autenticación cancelada" };
    }
    return { ok: false, error: `No se pudo autenticar: ${msg || "error desconocido"}` };
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
    const parsed = JSON.parse(raw);
    const newDekHex = parsed.newDekHex;
    const oldDekHex: unknown = parsed.oldDekHex;
    // FIX 2026-10-09 (CR2-MULTIDB): staging puede tener dbPaths (array) o
    // dbPath (string, formato legacy de rotateDatabaseKey). Normalizar.
    const dbPaths: string[] = Array.isArray(parsed.dbPaths)
      ? parsed.dbPaths
      : (typeof parsed.dbPath === "string" ? [parsed.dbPath] : []);
    if (!newDekHex || typeof newDekHex !== "string" || dbPaths.length === 0) {
      await FS.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
      return { recovered: false, error: "Staging corrupto, eliminado" };
    }

    // FIX 2026-10-09 (PARTIAL-REKEY): convergencia por DB cuando hay oldDekHex.
    // Para cada DB: si abre con el nuevo → ya convergida; si abre con el
    // viejo → completar su rekey ahora; si no abre con ninguno → fail-closed.
    // Solo guardar en keystore cuando TODAS convergen.
    if (typeof oldDekHex === "string" && oldDekHex.length > 0) {
      for (const dbPath of dbPaths) {
        let db: { exec: (sql: string) => Promise<void>; close: () => Promise<void> } | null = null;
        try {
          let opensWithNew = false;
          let opensWithOld = false;
          try {
            db = await openDb(dbPath, newDekHex);
            await db.exec("SELECT 1;");
            opensWithNew = true;
          } catch {
            if (db) { try { await db.close(); } catch { /* noop */ } db = null; }
            try {
              db = await openDb(dbPath, oldDekHex);
              await db.exec("SELECT 1;");
              opensWithOld = true;
            } catch {
              // No abre con ninguno.
            }
          }
          if (opensWithNew) {
            // Ya convergida.
          } else if (opensWithOld && db) {
            await db.exec(`PRAGMA rekey = "x'${newDekHex}'";`);
          } else {
            await FS.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
            return { recovered: false, error: `DB inaccesible: ${dbPath} (fail-closed)` };
          }
        } finally {
          if (db) {
            try { await db.close(); } catch { /* noop */ }
          }
        }
      }
      await storeDek(newDekHex);
      await FS.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
      return { recovered: true };
    }

    // Staging legacy sin oldDekHex: lógica anterior (CR3-NEW).
    // FIX 2026-10-09 (CR3-NEW): probe-open antes de tocar el keystore.
    // Verificar CADA DB: si alguna abre con el DEK nuevo, el rekey ocurrió.
    // Si ninguna abre, el crash fue antes del rekey.
    let anyOpened = false;
    for (const dbPath of dbPaths) {
      let probeDb: { exec: (sql: string) => Promise<void>; close: () => Promise<void> } | null = null;
      try {
        probeDb = await openDb(dbPath, newDekHex);
        await probeDb.exec("SELECT 1;");
        anyOpened = true;
      } catch {
        // Esta DB no abre con el DEK nuevo; continuar con las demás.
      } finally {
        if (probeDb) {
          try { await probeDb.close(); } catch { /* noop */ }
        }
      }
      if (anyOpened) break;
    }
    if (!anyOpened) {
      // Ninguna DB abre con el DEK nuevo → el crash fue ANTES del rekey.
      // Las DBs tienen el DEK viejo. Borrar staging, no tocar keystore.
      await FS.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
      return { recovered: false, error: "Crash antes del rekey; staging eliminado, keystore intacto" };
    }

    // El rekey SÍ ocurrió. Ahora sí guardar en keystore.
    await storeDek(newDekHex);
    await FS.deleteAsync(stagingPath, { idempotent: true }).catch(() => {});
    return { recovered: true };
  } catch (e) {
    return { recovered: false, error: e instanceof Error ? e.message : "Error" };
  }
}
