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
import { rotateAllDatabaseKeys } from "./keyRotation";
import {
  ensureEncryptedDatabase,
  MANAGED_DB_NAMES,
  openEncryptedDatabase,
  setSecureDbTestDriver,
  type SecureDbDriver,
} from "./secureDatabase";
import type { StagingKeyStore } from "./stagingSeal";
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
