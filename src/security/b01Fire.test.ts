/**
 * b01Fire.test.ts — LA PRUEBA DE FUEGO DE B-01 (arnés reutilizable).
 *
 * Ejercita la rotación de producción ENTERA — `rotateAllDatabaseKeys`
 * (keyRotation.ts) con el handshake verdadero `applyDatabaseKey`
 * (keyManager.ts) y la siembra verdadera `ensureEncryptedDatabase`
 * (secureDatabase.ts) — contra ficheros SQLCipher REALES servidos por el
 * driver-puente (testing/realSqlcipherDriver.ts → puente.py → sqlcipher3).
 * Nada de la lógica de la app se mockea: solo se sustituye el ENTORNO
 * (biometría desbloqueada, aleatoriedad de expo-crypto por la del sistema,
 * expo-file-system por node:fs, el almacén seguro por el backend en memoria
 * que la propia keyManager ofrece para tests, y el sellado de staging por
 * un StagingKeyStore en memoria — el sellado tweetnacl sí es el real).
 *
 * La señal de éxito de una rotación es REABRIR con la clave nueva y leer el
 * centinela (sonda Paso 0, ajuste 1): un `PRAGMA rekey` con la clave no
 * verificada devuelve en silencio sin rotar nada (B6-bis), así que el
 * silencio de `exec` no prueba nada. Este fichero contiene además el
 * control que lo demuestra (veneno B).
 *
 * REGLA DE ORO DEL CARRIL: si esta prueba falla contra producción, NO se
 * parchea en silencio — se para y se sube como hallazgo crítico.
 *
 * En el árbol (paso 15) vive en src/security/b01Fire.test.ts.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// --- Entorno (no lógica de la app) -----------------------------------------
vi.mock("./biometricGate", () => ({
  requireUnlock: vi.fn(async () => undefined),
}));

vi.mock("expo-crypto", async () => {
  const { randomBytes } = await import("node:crypto");
  return {
    getRandomBytesAsync: async (n: number) => new Uint8Array(randomBytes(n)),
  };
});

vi.mock("expo-file-system/legacy", async () => {
  const nfs = await import("node:fs");
  const strip = (p: string) => (p.startsWith("file://") ? p.slice("file://".length) : p);
  return {
    documentDirectory: "file:///nido-b01-unused-docs/",
    cacheDirectory: "file:///nido-b01-unused-cache/",
    writeAsStringAsync: async (p: string, content: string) => {
      nfs.writeFileSync(strip(p), content, "utf8");
    },
    readAsStringAsync: async (p: string) => nfs.readFileSync(strip(p), "utf8"),
    deleteAsync: async (p: string) => {
      nfs.rmSync(strip(p), { force: true });
    },
    getInfoAsync: async (p: string) => {
      const fp = strip(p);
      return nfs.existsSync(fp)
        ? { exists: true, size: nfs.statSync(fp).size, isDirectory: nfs.statSync(fp).isDirectory() }
        : { exists: false };
    },
    moveAsync: async (from: string, to: string) => {
      nfs.renameSync(strip(from), strip(to));
    },
  };
});

// --- Código real bajo prueba (sin mockear) ----------------------------------
import {
  applyDatabaseKey,
  createMemorySecureBackend,
  getDatabaseKeyHex,
  setTestSecureBackend,
  storeDatabaseKeyHex,
} from "../privacy/keyManager";
import { checkStaleRekeyStaging, rotateAllDatabaseKeys } from "./keyRotation";
import {
  ensureEncryptedDatabase,
  MANAGED_DB_NAMES,
  openEncryptedDatabase,
  setSecureDbTestDriver,
  type SecureDbDriver,
} from "./secureDatabase";
import { sealStaging, type StagingKeyStore } from "./stagingSeal";
import { makeRealSqlcipherDriver, sqlcipherEngineAvailable } from "./testing/realSqlcipherDriver";
import { cleanupFreshDirs, expectPlainSqliteRejects, freshDir } from "./testing/b01Utils";

const execFileAsync = promisify(execFile);

const OLD_DEK = "aa".repeat(32);
const WRONG_DEK = "cc".repeat(32);
const CANDIDATE_DEK = "dd".repeat(32);
const FAIL_CLOSED_PART = "la base no se pudo descifrar";
const secretFor = (name: string) => `centinela-b01-fuego-${name}`;

const ENGINE_OK = await sqlcipherEngineAvailable();
if (!ENGINE_OK && process.env.CI) {
  // B-03: bajo CI la ausencia del motor es un FALLO, no un salto silencioso.
  throw new Error("B-01: python3/sqlcipher3 no disponible bajo CI — la cobertura real no puede saltarse.");
}
const describeEngine = ENGINE_OK ? describe : describe.skip;

function memoryStagingKeys(): StagingKeyStore {
  let stored: string | null = null;
  return {
    get: async () => stored,
    set: async (hex: string) => {
      stored = hex;
    },
  };
}

/** Siembra honesta: las bases gestionadas nacen con el código de producción. */
async function seedAll(driver: SecureDbDriver, dekHex: string): Promise<void> {
  for (const name of MANAGED_DB_NAMES) {
    const h = await ensureEncryptedDatabase(name, `b01-siembra(${name})`, { driver, dekHex });
    try {
      await h.execAsync("CREATE TABLE IF NOT EXISTS b01_sentinel (id INTEGER PRIMARY KEY, secret TEXT NOT NULL);");
      await h.runAsync("INSERT OR REPLACE INTO b01_sentinel (id, secret) VALUES (1, ?);", [secretFor(name)]);
    } finally {
      await h.closeAsync();
    }
  }
}

async function readSentinel(driver: SecureDbDriver, name: string, dekHex: string): Promise<string | null> {
  const h = await openEncryptedDatabase(name, dekHex, `b01-lectura(${name})`, driver);
  try {
    const row = await h.getFirstAsync<{ secret: string }>("SELECT secret FROM b01_sentinel WHERE id = 1;");
    const integ = await h.getFirstAsync<{ integrity_check: string }>("PRAGMA integrity_check;");
    expect(integ?.integrity_check).toBe("ok");
    return row?.secret ?? null;
  } finally {
    await h.closeAsync();
  }
}

async function expectOpenRejected(driver: SecureDbDriver, name: string, dekHex: string): Promise<void> {
  await expect(openEncryptedDatabase(name, dekHex, `b01-rechazo(${name})`, driver)).rejects.toThrow(FAIL_CLOSED_PART);
}

/**
 * El cableado de producción de BackupScreen.tsx, con el puente en el lugar
 * de expo-sqlite: abrir + aplicar el handshake REAL + exponer exec/close.
 * El exec del rekey va desnudo, fuera de toda transacción (Paso 0, ajuste 2).
 */
function productionOpenDb(driver: SecureDbDriver) {
  return async (dbPath: string, dekHex: string) => {
    const h = await driver.openDb(dbPath);
    await applyDatabaseKey(h, dekHex, "rekey");
    return {
      exec: async (sql: string) => {
        await h.execAsync(sql);
      },
      close: async () => {
        await h.closeAsync();
      },
    };
  };
}

describeEngine("B-01 · prueba de fuego de rotación contra el motor real", () => {
  beforeAll(() => {
    setTestSecureBackend(createMemorySecureBackend());
  });

  afterAll(() => {
    setSecureDbTestDriver(null);
    setTestSecureBackend(null);
    cleanupFreshDirs();
  });

  it(
    "fuego completo: siembra con A → rotación real → REABRIR con la nueva lee el centinela; la vieja es rechazada",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("fuego");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);

      // (1) Crear con la llave A usando el motor real, por el código de producción.
      await seedAll(driver, OLD_DEK);

      // (2) Precondición: con A se lee lo sembrado.
      for (const name of MANAGED_DB_NAMES) {
        expect(await readSentinel(driver, name, OLD_DEK)).toBe(secretFor(name));
      }

      // (3) Rotación de producción entera.
      await storeDatabaseKeyHex(OLD_DEK);
      let capturedNew: string | null = null;
      const storeDek = async (dekHex: string) => {
        capturedNew = dekHex;
        await storeDatabaseKeyHex(dekHex);
      };
      const stagingPath = path.join(dir, "rekey-staging.json");
      const result = await rotateAllDatabaseKeys(
        productionOpenDb(driver),
        storeDek,
        stagingPath,
        "b01-fuego",
        memoryStagingKeys(),
      );
      expect(result.ok).toBe(true);
      expect(capturedNew).toMatch(/^[0-9a-f]{64}$/);
      expect(capturedNew).not.toBe(OLD_DEK);
      expect(await getDatabaseKeyHex()).toBe(capturedNew);
      expect(fs.existsSync(stagingPath)).toBe(false); // staging borrado al cerrar con éxito

      // (4) LA señal de éxito: reabrir con la clave NUEVA y leer el centinela.
      for (const name of MANAGED_DB_NAMES) {
        expect(await readSentinel(driver, name, capturedNew!)).toBe(secretFor(name));
      }

      // (5) La clave VIEJA debe fallar, y por el texto fail-closed del handshake real.
      for (const name of MANAGED_DB_NAMES) {
        await expectOpenRejected(driver, name, OLD_DEK);
      }

      // (6) Sin fugas, con todos los handles cerrados.
      for (const name of MANAGED_DB_NAMES) {
        await expectPlainSqliteRejects(path.join(dir, name), secretFor(name));
      }
    },
  );

  it(
    "veneno A: rotar con la clave vieja EQUIVOCADA no rota nada y no se declara éxito (detección por el handshake y la reapertura)",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("veneno");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);

      // El «keystore» del test miente: la DEK «actual» es otra.
      await storeDatabaseKeyHex(WRONG_DEK);
      let storeCalled = false;
      const result = await rotateAllDatabaseKeys(
        productionOpenDb(driver),
        async () => {
          storeCalled = true;
        },
        path.join(dir, "rekey-staging.json"),
        "b01-veneno",
        memoryStagingKeys(),
      );
      // El openDb de producción aplica el handshake real ANTES del rekey:
      // la apertura con la clave equivocada lanza su texto fail-closed y la
      // rotación devuelve fracaso — nunca un éxito silencioso.
      expect(result.ok).toBe(false);
      expect(result.error ?? "").toContain(FAIL_CLOSED_PART);
      expect(storeCalled).toBe(false);

      // Nada rotó: A sigue leyendo el centinela; la equivocada sigue rechazada.
      for (const name of MANAGED_DB_NAMES) {
        expect(await readSentinel(driver, name, OLD_DEK)).toBe(secretFor(name));
        await expectOpenRejected(driver, name, WRONG_DEK);
      }
    },
  );

  it(
    "veneno B (control B6-bis): un rekey crudo con clave no verificada «tiene éxito» en exec y NO rota — el veredicto es la reapertura",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("crudo");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      const name = MANAGED_DB_NAMES[0];
      const h0 = await ensureEncryptedDatabase(name, `b01-crudo(${name})`, { driver, dekHex: OLD_DEK });
      await h0.execAsync("CREATE TABLE IF NOT EXISTS b01_sentinel (id INTEGER PRIMARY KEY, secret TEXT NOT NULL);");
      await h0.runAsync("INSERT OR REPLACE INTO b01_sentinel (id, secret) VALUES (1, ?);", [secretFor(name)]);
      await h0.closeAsync();

      // Rekey a pelo: clave equivocada aplicada SIN la lectura de verificación
      // del handshake, y rekey a la candidata. Medido en la sonda Paso 0:
      // exec NO lanza… y no rota nada.
      const file = path.join(dir, name);
      const raw = await driver.openDb(file);
      let execThrew = false;
      try {
        await raw.execAsync(`PRAGMA key = "x'${WRONG_DEK}'";`);
        await raw.execAsync(`PRAGMA rekey = "x'${CANDIDATE_DEK}'";`);
      } catch {
        execThrew = true;
      }
      await raw.closeAsync().catch(() => {});
      // Si un motor futuro lanzara aquí, este expect lo delata: habría que
      // re-medir B6-bis, no «arreglar» el test.
      expect(execThrew).toBe(false);

      // El veredicto por reapertura: la candidata NO abre; la vieja SÍ.
      // Un criterio de «exec no lanzó» habría declarado una rotación falsa.
      await expectOpenRejected(driver, name, CANDIDATE_DEK);
      expect(await readSentinel(driver, name, OLD_DEK)).toBe(secretFor(name));
    },
  );

  it(
    "gemela de reversión: si guardar la clave nueva falla, las bases siguen con la vieja y no con la nueva",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("reversion");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);
      await storeDatabaseKeyHex(OLD_DEK);

      let attemptedNew: string | null = null;
      const result = await rotateAllDatabaseKeys(
        productionOpenDb(driver),
        async (dekHex: string) => {
          attemptedNew = dekHex;
          throw new Error("keystore caído (fixture)");
        },
        path.join(dir, "rekey-staging.json"),
        "b01-reversion",
        memoryStagingKeys(),
      );
      expect(result.ok).toBe(false);
      expect(result.code).toBe("storeFailed");
      expect(attemptedNew).toMatch(/^[0-9a-f]{64}$/);

      // Afirmado reabriendo contra el motor, no contando cadenas «PRAGMA rekey».
      for (const name of MANAGED_DB_NAMES) {
        expect(await readSentinel(driver, name, OLD_DEK)).toBe(secretFor(name));
        await expectOpenRejected(driver, name, attemptedNew!);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// B-01 · paso 6b — convergencia de checkStaleRekeyStaging contra el motor real
//
// La definición real de «rancio» que esta suite documenta en vez de
// probar una ficción: el código NO compara ninguna edad (el campo
// `at: Date.now()` del staging no se lee en ningún sitio). Rancio =
// el fichero rekey-staging.json EXISTE cuando el arranque corre la
// comprobación; al arrancar no hay rotación en curso posible, así que
// todo staging presente es el resto de una rotación muerta. Lo
// «fresco» está protegido por cableado (nadie llama a la comprobación
// fuera del arranque), no por cerrojos ni marcas de tiempo.
//
// Inventario: diez casos (S1, S2, S3, S4, S5, S5-bis, S6, S7, S8a,
// S8b) en nueve `it`: S5 y S5-bis comparten un `it` en dos fases con
// directorios frescos — el diseño lo permite expresamente para la
// variante y ninguna fase absorbe a la otra: cada una afirma su
// desenlace entero. S7 lleva también sus dos formas en un `it`.
// Todo desenlace se afirma por reapertura (la clave nueva abre y la
// vieja ya no — o al revés), por el texto exacto del resultado o por
// huella sha256; nunca contando cadenas «PRAGMA rekey».
// ---------------------------------------------------------------------------

const STG_NEW = "bb".repeat(32);
const STG_FOREIGN = "ee".repeat(32);

function sha256OfFile(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

async function rekeyDbTo(
  driver: SecureDbDriver,
  dbPath: string,
  fromDek: string,
  toDek: string,
): Promise<void> {
  const db = await productionOpenDb(driver)(dbPath, fromDek);
  try {
    await db.exec(`PRAGMA rekey = "x'${toDek}'";`);
  } finally {
    await db.close();
  }
}

async function writeSealedStaging(
  dir: string,
  keys: StagingKeyStore,
  staging: Record<string, unknown>,
): Promise<string> {
  const p = path.join(dir, "rekey-staging.json");
  fs.writeFileSync(p, await sealStaging(JSON.stringify(staging), keys), "utf8");
  return p;
}

/** storeDek de captura: anota llamadas Y guarda de verdad (el almacén es el backend en memoria). */
function makeStoreDek() {
  const calls: string[] = [];
  const fn = async (dekHex: string) => {
    calls.push(dekHex);
    await storeDatabaseKeyHex(dekHex);
  };
  return { calls, fn };
}

const pathsOf = (dir: string) => MANAGED_DB_NAMES.map((n) => path.join(dir, n));

describeEngine("B-01 · convergencia de staging de rotación interrumpida (checkStaleRekeyStaging)", () => {
  beforeAll(() => {
    setTestSecureBackend(createMemorySecureBackend());
  });

  afterAll(() => {
    setSecureDbTestDriver(null);
    setTestSecureBackend(null);
    cleanupFreshDirs();
  });

  it(
    "S1 · control sin staging: no hay fichero ⇒ { recovered: false } sin error y sin tocar el almacén",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("stg-s1");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);
      await storeDatabaseKeyHex(OLD_DEK);
      const store = makeStoreDek();

      const res = await checkStaleRekeyStaging(
        path.join(dir, "rekey-staging.json"),
        store.fn,
        productionOpenDb(driver),
        memoryStagingKeys(),
      );
      expect(res.recovered).toBe(false);
      expect(res.error).toBeUndefined();
      expect(store.calls).toHaveLength(0);
      for (const name of MANAGED_DB_NAMES) {
        expect(await readSentinel(driver, name, OLD_DEK)).toBe(secretFor(name));
      }
    },
  );

  it(
    "S2 · crash antes del rekey (rekeyed: []): la convergencia COMPLETA el rekey, guarda la nueva y borra el staging",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("stg-s2");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);
      await storeDatabaseKeyHex(OLD_DEK);
      const store = makeStoreDek();
      const keys = memoryStagingKeys();
      const stagingPath = await writeSealedStaging(dir, keys, {
        newDekHex: STG_NEW,
        oldDekHex: OLD_DEK,
        dbPaths: pathsOf(dir),
        rekeyed: [],
        at: Date.now(),
      });

      const res = await checkStaleRekeyStaging(stagingPath, store.fn, productionOpenDb(driver), keys);
      expect(res.recovered).toBe(true);
      expect(store.calls).toEqual([STG_NEW]);
      expect(fs.existsSync(stagingPath)).toBe(false);
      for (const name of MANAGED_DB_NAMES) {
        expect(await readSentinel(driver, name, STG_NEW)).toBe(secretFor(name));
        await expectOpenRejected(driver, name, OLD_DEK);
      }
    },
  );

  it(
    "S3 · crash después del rekey de todas, antes de guardar: guarda la nueva una vez y borra el staging",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("stg-s3");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);
      for (const p of pathsOf(dir)) await rekeyDbTo(driver, p, OLD_DEK, STG_NEW);
      await storeDatabaseKeyHex(OLD_DEK);
      const store = makeStoreDek();
      const keys = memoryStagingKeys();
      const stagingPath = await writeSealedStaging(dir, keys, {
        newDekHex: STG_NEW,
        oldDekHex: OLD_DEK,
        dbPaths: pathsOf(dir),
        rekeyed: pathsOf(dir),
        at: Date.now(),
      });

      const res = await checkStaleRekeyStaging(stagingPath, store.fn, productionOpenDb(driver), keys);
      expect(res.recovered).toBe(true);
      expect(store.calls).toEqual([STG_NEW]);
      expect(fs.existsSync(stagingPath)).toBe(false);
      for (const name of MANAGED_DB_NAMES) {
        expect(await readSentinel(driver, name, STG_NEW)).toBe(secretFor(name));
        await expectOpenRejected(driver, name, OLD_DEK);
      }
    },
  );

  it(
    "S4 · crash a mitad (PARTIAL-REKEY): 1 de 3 con la nueva — las 2 restantes se re-cifran en la comprobación",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("stg-s4");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);
      const paths = pathsOf(dir);
      await rekeyDbTo(driver, paths[0], OLD_DEK, STG_NEW);
      await storeDatabaseKeyHex(OLD_DEK);
      const store = makeStoreDek();
      const keys = memoryStagingKeys();
      const stagingPath = await writeSealedStaging(dir, keys, {
        newDekHex: STG_NEW,
        oldDekHex: OLD_DEK,
        dbPaths: paths,
        rekeyed: [paths[0]],
        at: Date.now(),
      });

      const res = await checkStaleRekeyStaging(stagingPath, store.fn, productionOpenDb(driver), keys);
      expect(res.recovered).toBe(true);
      expect(store.calls).toEqual([STG_NEW]);
      expect(fs.existsSync(stagingPath)).toBe(false);
      // La sonda final es la de S2: un rekey que no rotara de verdad
      // (B6-bis) dejaría una base con la vieja y esta lectura lo caza.
      for (const name of MANAGED_DB_NAMES) {
        expect(await readSentinel(driver, name, STG_NEW)).toBe(secretFor(name));
        await expectOpenRejected(driver, name, OLD_DEK);
      }
    },
  );

  it(
    "S5 + S5-bis · una base inaccesible con ambas claves: el orden de dbPaths decide qué se re-cifra antes del fallo (dos fases)",
    { timeout: 240_000 },
    async () => {
      // — Fase S5: la inaccesible va PRIMERA. Nada se re-cifra: el
      // fallo llega antes que cualquier rekey y el almacén no se toca.
      {
        const dir = freshDir("stg-s5");
        const driver = makeRealSqlcipherDriver(dir);
        setSecureDbTestDriver(driver);
        await seedAll(driver, OLD_DEK);
        const paths = pathsOf(dir);
        await rekeyDbTo(driver, paths[0], OLD_DEK, STG_FOREIGN);
        await storeDatabaseKeyHex(OLD_DEK);
        const store = makeStoreDek();
        const keys = memoryStagingKeys();
        const stagingPath = await writeSealedStaging(dir, keys, {
          newDekHex: STG_NEW,
          oldDekHex: OLD_DEK,
          dbPaths: paths,
          rekeyed: [],
          at: Date.now(),
        });
        const foreignBefore = sha256OfFile(paths[0]);

        const res = await checkStaleRekeyStaging(stagingPath, store.fn, productionOpenDb(driver), keys);
        expect(res.recovered).toBe(false);
        expect(res.error ?? "").toContain("DB inaccesible:");
        expect(res.error ?? "").toContain("(fail-closed)");
        expect(fs.existsSync(stagingPath)).toBe(false); // el staging SÍ se borra en esta rama
        expect(store.calls).toHaveLength(0);
        expect(await getDatabaseKeyHex()).toBe(OLD_DEK);
        expect(sha256OfFile(paths[0])).toBe(foreignBefore);
        expect(await readSentinel(driver, MANAGED_DB_NAMES[0], STG_FOREIGN)).toBe(secretFor(MANAGED_DB_NAMES[0]));
        for (const name of MANAGED_DB_NAMES.slice(1)) {
          expect(await readSentinel(driver, name, OLD_DEK)).toBe(secretFor(name)); // no re-cifradas
        }
      }

      // — Fase S5-bis (variante registrada): la inaccesible va ÚLTIMA.
      // Por el orden del bucle, las anteriores que abran con la vieja
      // YA habrán sido re-cifradas a la nueva cuando el fallo llega, y
      // como storeDek nunca se llama, quedan con una clave que el
      // almacén no tiene: su puerta pasa a ser la recuperación de
      // pérdida de clave. Propiedad real y áspera del orden de
      // iteración, afirmada tal cual se leyó y el motor confirma.
      {
        const dir = freshDir("stg-s5bis");
        const driver = makeRealSqlcipherDriver(dir);
        setSecureDbTestDriver(driver);
        await seedAll(driver, OLD_DEK);
        const paths = pathsOf(dir);
        await rekeyDbTo(driver, paths[2], OLD_DEK, STG_FOREIGN);
        await storeDatabaseKeyHex(OLD_DEK);
        const store = makeStoreDek();
        const keys = memoryStagingKeys();
        const stagingPath = await writeSealedStaging(dir, keys, {
          newDekHex: STG_NEW,
          oldDekHex: OLD_DEK,
          dbPaths: paths,
          rekeyed: [],
          at: Date.now(),
        });
        const foreignBefore = sha256OfFile(paths[2]);

        const res = await checkStaleRekeyStaging(stagingPath, store.fn, productionOpenDb(driver), keys);
        expect(res.recovered).toBe(false);
        expect(res.error ?? "").toContain("DB inaccesible:");
        expect(store.calls).toHaveLength(0);
        expect(await getDatabaseKeyHex()).toBe(OLD_DEK); // el almacén sigue con la vieja
        // Las dos anteriores YA están con la nueva, que el almacén no tiene:
        for (const name of MANAGED_DB_NAMES.slice(0, 2)) {
          expect(await readSentinel(driver, name, STG_NEW)).toBe(secretFor(name));
          await expectOpenRejected(driver, name, OLD_DEK);
        }
        expect(sha256OfFile(paths[2])).toBe(foreignBefore);
        expect(await readSentinel(driver, MANAGED_DB_NAMES[2], STG_FOREIGN)).toBe(secretFor(MANAGED_DB_NAMES[2]));
      }
    },
  );

  it(
    "S6 · sellado sin su llave: el staging NO se toca y el reintento del próximo arranque converge",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("stg-s6");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);
      for (const p of pathsOf(dir)) await rekeyDbTo(driver, p, OLD_DEK, STG_NEW);
      await storeDatabaseKeyHex(OLD_DEK);
      const store = makeStoreDek();
      const keysSeal = memoryStagingKeys();
      const stagingPath = await writeSealedStaging(dir, keysSeal, {
        newDekHex: STG_NEW,
        oldDekHex: OLD_DEK,
        dbPaths: pathsOf(dir),
        rekeyed: pathsOf(dir),
        at: Date.now(),
      });
      const sealedBefore = sha256OfFile(stagingPath);

      // La comprobación corre con OTRO almacén de sellado, vacío.
      const res1 = await checkStaleRekeyStaging(
        stagingPath,
        store.fn,
        productionOpenDb(driver),
        memoryStagingKeys(),
      );
      expect(res1.recovered).toBe(false);
      expect(res1.error ?? "").toContain("No está la llave del archivo de rotación");
      expect(sha256OfFile(stagingPath)).toBe(sealedBefore); // intacto, deliberado
      expect(store.calls).toHaveLength(0);

      // Segunda mitad: con el almacén de sellado restaurado, converge como en S3.
      const res2 = await checkStaleRekeyStaging(stagingPath, store.fn, productionOpenDb(driver), keysSeal);
      expect(res2.recovered).toBe(true);
      expect(store.calls).toEqual([STG_NEW]);
      expect(fs.existsSync(stagingPath)).toBe(false);
    },
  );

  it(
    "S7 · staging corrupto, en sus dos formas reales: el parseado-inválido se borra; los bytes basura permanecen",
    { timeout: 240_000 },
    async () => {
      // (a) Sobre sellado válido cuyo contenido parseado carece de newDekHex.
      {
        const dir = freshDir("stg-s7a");
        const driver = makeRealSqlcipherDriver(dir);
        setSecureDbTestDriver(driver);
        await seedAll(driver, OLD_DEK);
        await storeDatabaseKeyHex(OLD_DEK);
        const store = makeStoreDek();
        const keys = memoryStagingKeys();
        const stagingPath = await writeSealedStaging(dir, keys, {
          oldDekHex: OLD_DEK,
          dbPaths: pathsOf(dir),
          rekeyed: [],
          at: Date.now(),
        });
        const res = await checkStaleRekeyStaging(stagingPath, store.fn, productionOpenDb(driver), keys);
        expect(res.recovered).toBe(false);
        expect(res.error).toBe("Staging corrupto, eliminado");
        expect(fs.existsSync(stagingPath)).toBe(false);
        expect(store.calls).toHaveLength(0);
        expect(await getDatabaseKeyHex()).toBe(OLD_DEK);
      }

      // (b) Bytes basura: ni JSON ni sobre sellado. El catch general
      // devuelve el error y el fichero PERMANECE (solo la rama
      // «parseado pero inválido» borra).
      {
        const dir = freshDir("stg-s7b");
        const driver = makeRealSqlcipherDriver(dir);
        setSecureDbTestDriver(driver);
        await seedAll(driver, OLD_DEK);
        await storeDatabaseKeyHex(OLD_DEK);
        const store = makeStoreDek();
        const stagingPath = path.join(dir, "rekey-staging.json");
        fs.writeFileSync(stagingPath, "esto no es json ni un sobre sellado {{{", "utf8");
        const res = await checkStaleRekeyStaging(
          stagingPath,
          store.fn,
          productionOpenDb(driver),
          memoryStagingKeys(),
        );
        expect(res.recovered).toBe(false);
        expect(typeof res.error).toBe("string");
        expect((res.error ?? "").length).toBeGreaterThan(0);
        expect(fs.existsSync(stagingPath)).toBe(true);
        expect(store.calls).toHaveLength(0);
      }
    },
  );

  it(
    "S8a · staging en claro sin oldDekHex, crash antes del rekey: staging eliminado, keystore intacto",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("stg-s8a");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);
      await storeDatabaseKeyHex(OLD_DEK);
      const store = makeStoreDek();
      const paths = pathsOf(dir);
      // Staging en claro (la tolerancia de lectura lo admite), formato
      // actual dbPaths, sin oldDekHex: la pierna CR3-NEW (probe-open).
      const stagingPath = path.join(dir, "rekey-staging.json");
      fs.writeFileSync(stagingPath, JSON.stringify({ newDekHex: STG_NEW, dbPaths: [paths[0]] }), "utf8");

      const res = await checkStaleRekeyStaging(
        stagingPath,
        store.fn,
        productionOpenDb(driver),
        memoryStagingKeys(),
      );
      expect(res.recovered).toBe(false);
      expect(res.error).toBe("Crash antes del rekey; staging eliminado, keystore intacto");
      expect(fs.existsSync(stagingPath)).toBe(false);
      expect(store.calls).toHaveLength(0);
      expect(await getDatabaseKeyHex()).toBe(OLD_DEK);
      expect(await readSentinel(driver, MANAGED_DB_NAMES[0], OLD_DEK)).toBe(secretFor(MANAGED_DB_NAMES[0]));
      await expectOpenRejected(driver, MANAGED_DB_NAMES[0], STG_NEW);
    },
  );

  it(
    "S8b · staging en claro sin oldDekHex, rekey ya hecho: se guarda la nueva y se borra el staging (contrato CR3-NEW)",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("stg-s8b");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      await seedAll(driver, OLD_DEK);
      const paths = pathsOf(dir);
      await rekeyDbTo(driver, paths[0], OLD_DEK, STG_NEW);
      await storeDatabaseKeyHex(OLD_DEK);
      const store = makeStoreDek();
      const stagingPath = path.join(dir, "rekey-staging.json");
      fs.writeFileSync(stagingPath, JSON.stringify({ newDekHex: STG_NEW, dbPaths: [paths[0]] }), "utf8");

      const res = await checkStaleRekeyStaging(
        stagingPath,
        store.fn,
        productionOpenDb(driver),
        memoryStagingKeys(),
      );
      expect(res.recovered).toBe(true);
      expect(store.calls).toEqual([STG_NEW]);
      expect(fs.existsSync(stagingPath)).toBe(false);
      expect(await readSentinel(driver, MANAGED_DB_NAMES[0], STG_NEW)).toBe(secretFor(MANAGED_DB_NAMES[0]));
    },
  );
});
