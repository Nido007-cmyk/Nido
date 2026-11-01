/**
 * secureDatabase.migrationReal.test.ts — B-01, paso 6a: la matriz de
 * migración y recuperación contra bytes y motor REALES (SQLCipher vía
 * el driver-puente). La cobertura conductual de esta máquina de
 * estados era CERO: solo existía la fijación de cableado de
 * rekeyStartupWiring.test.ts y el FakeDriver semántico de
 * secureDatabase.test.ts, que supone la verdad del motor que aquí se
 * mide (p. ej. que un temporal en claro no verifica con la clave).
 *
 * Cada caso se construye con los módulos reales y el driver-puente;
 * solo se sustituye el entorno (el backend seguro en memoria que la
 * propia keyManager ofrece a tests, directorios temporales). Ningún
 * desenlace se afirma contando cadenas: se afirma reabriendo con la
 * clave candidata y leyendo la fila-centinela sembrada, por el texto
 * fail-closed exacto del handshake, o por la huella (sha256 /
 * esquema + conteos) del fichero.
 *
 * Límite del motor: la suite corre sobre el wheel sqlcipher3-binary
 * de esta máquina; el SQLCipher del build Android puede diferir en
 * parámetros por defecto. Lo que esta suite NO prueba: el crash real
 * en flash (los estados interrumpidos se construyen colocando bytes
 * o matando el proceso ayudante del WAL, no perdiendo la alimentación
 * a mitad de una escritura real) ni bases de tamaño de usuario.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  createMemorySecureBackend,
  KeyLossError,
  setTestSecureBackend,
  storeDatabaseKeyHex,
} from "../privacy/keyManager";
import {
  ensureEncryptedDatabase,
  getMigrationState,
  openEncryptedDatabase,
  setSecureDbTestDriver,
  type SecureDbDriver,
} from "./secureDatabase";
import { makeRealSqlcipherDriver, sqlcipherEngineAvailable } from "./testing/realSqlcipherDriver";
import { cleanupFreshDirs, expectPlainSqliteRejects, freshDir } from "./testing/b01Utils";

const DB = "nido_memory.db";
const DEK_A = "aa".repeat(32);
const DEK_X = "ee".repeat(32); // clave ajena: cifra la principal de M8
const DEK_WRONG = "cc".repeat(32);
const FAIL_CLOSED_PART = "la base no se pudo descifrar";
const CREATE_SQL = "CREATE TABLE datos (id INTEGER PRIMARY KEY, txt TEXT NOT NULL)";

/** La fila-centinela de la matriz: valores exactos, con acentos y emoji. */
const ROWS: Array<[number, string]> = [
  [1, "úrsula — café"],
  [2, "segunda fila"],
  [3, "emoji 🦎 axolote"],
  [4, "cuarta — ñandú"],
];
const ROW_OBJS = ROWS.map(([id, txt]) => ({ id, txt }));

const ENGINE_OK = await sqlcipherEngineAvailable();
if (!ENGINE_OK && process.env.CI) {
  // B-03: bajo CI la ausencia del motor es un FALLO, no un salto silencioso.
  throw new Error("B-01: python3/sqlcipher3 no disponible bajo CI — la cobertura real no puede saltarse.");
}
const describeEngine = ENGINE_OK ? describe : describe.skip;

function sha256File(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/** Base en claro construida fuera de la app (node:sqlite), con índice y las filas-centinela. */
function makePlainDb(file: string, rows: Array<[number, string]> = ROWS): void {
  const sqlite = new DatabaseSync(file);
  try {
    sqlite.exec(CREATE_SQL);
    sqlite.exec("CREATE INDEX idx_datos_txt ON datos(txt)");
    const stmt = sqlite.prepare("INSERT INTO datos (id, txt) VALUES (?, ?)");
    for (const [id, txt] of rows) stmt.run(id, txt);
  } finally {
    sqlite.close();
  }
}

/** Siembra por el camino de producción: ensure sobre directorio vacío + filas por el handle real. */
async function seedEncrypted(
  driver: SecureDbDriver,
  dekHex: string,
  rows: Array<[number, string]> = ROWS,
): Promise<void> {
  const h = await ensureEncryptedDatabase(DB, `b01-mig-siembra(${DB})`, { driver, dekHex });
  try {
    await h.execAsync(CREATE_SQL);
    await h.execAsync("CREATE INDEX idx_datos_txt ON datos(txt)");
    for (const [id, txt] of rows) {
      await h.runAsync("INSERT INTO datos (id, txt) VALUES (?, ?);", [id, txt]);
    }
  } finally {
    await h.closeAsync();
  }
}

/** Reapertura con la clave candidata y lectura exacta de las filas (la señal válida). */
async function readRows(driver: SecureDbDriver, dekHex: string): Promise<Array<{ id: number; txt: string }>> {
  const h = await openEncryptedDatabase(DB, dekHex, `b01-mig-lectura(${DB})`, driver);
  try {
    const integ = await h.getFirstAsync<{ integrity_check: string }>("PRAGMA integrity_check;");
    expect(integ?.integrity_check).toBe("ok");
    return await h.getAllAsync<{ id: number; txt: string }>("SELECT id, txt FROM datos ORDER BY id;");
  } finally {
    await h.closeAsync();
  }
}

async function expectFailClosed(driver: SecureDbDriver, dekHex: string): Promise<void> {
  await expect(openEncryptedDatabase(DB, dekHex, `b01-mig-rechazo(${DB})`, driver)).rejects.toThrow(
    FAIL_CLOSED_PART,
  );
}

/** Gemela migrada con la misma DEK y el mismo contenido (material de temporales). */
async function migratedTwinBytes(rows: Array<[number, string]> = ROWS): Promise<Buffer> {
  const twinDir = freshDir("mig-twin");
  const twinDriver = makeRealSqlcipherDriver(twinDir);
  makePlainDb(path.join(twinDir, DB), rows);
  const h = await ensureEncryptedDatabase(DB, `b01-mig-twin(${DB})`, { driver: twinDriver, dekHex: DEK_A });
  await h.closeAsync();
  return fs.readFileSync(path.join(twinDir, DB));
}

describeEngine("B-01 · matriz de migración contra el motor real", () => {
  afterEach(() => {
    setSecureDbTestDriver(null);
  });

  afterAll(() => {
    setTestSecureBackend(null);
    cleanupFreshDirs();
  });

  it(
    "M1 · primera instalación: sin base, la DEK del almacén real crea la base cifrada y el centinela se lee reabriendo",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m1");
      const driver = makeRealSqlcipherDriver(dir);
      setSecureDbTestDriver(driver);
      setTestSecureBackend(createMemorySecureBackend());
      await storeDatabaseKeyHex(DEK_A);

      // Sin opts: la DEK se resuelve por el camino real (keyManager).
      const h = await ensureEncryptedDatabase(DB, `b01-m1(${DB})`);
      try {
        await h.execAsync(CREATE_SQL);
        for (const [id, txt] of ROWS) {
          await h.runAsync("INSERT INTO datos (id, txt) VALUES (?, ?);", [id, txt]);
        }
      } finally {
        await h.closeAsync();
      }

      expect(await readRows(driver, DEK_A)).toEqual(ROW_OBJS);
      await expectFailClosed(driver, DEK_WRONG);
      await expectPlainSqliteRejects(path.join(dir, DB), "úrsula");
    },
  );

  it(
    "M2 · en claro con datos y WAL viva: la migración lee también las filas que solo vivían en el WAL",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m2");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);

      // Proceso ayudante: deja la segunda tanda SOLO en el WAL y muere
      // por SIGKILL sin cerrar — el estado real de un usuario que
      // actualiza con la base caliente.
      const helper = path.join(dir, "wal-helper.py");
      fs.writeFileSync(
        helper,
        [
          "import sqlite3,sys,time",
          "c=sqlite3.connect(sys.argv[1])",
          "c.execute('PRAGMA journal_mode=WAL')",
          `c.execute('${CREATE_SQL}')`,
          "c.execute('CREATE INDEX idx_datos_txt ON datos(txt)')",
          "c.executemany('INSERT INTO datos (id, txt) VALUES (?,?)', [(1,'\\u00farsula \\u2014 caf\\u00e9'),(2,'segunda fila')])",
          "c.commit()",
          "c.execute('PRAGMA wal_checkpoint(TRUNCATE)')",
          "c.executemany('INSERT INTO datos (id, txt) VALUES (?,?)', [(3,'emoji \\U0001F98E axolote'),(4,'cuarta \\u2014 \\u00f1and\\u00fa')])",
          "c.commit()",
          "print('READY', flush=True)",
          "time.sleep(120)",
          "",
        ].join("\n"),
        "utf8",
      );
      const proc = spawn("python3", [helper, file], { stdio: ["ignore", "pipe", "ignore"] });
      try {
        await new Promise<void>((resolve, reject) => {
          let buf = "";
          proc.stdout.setEncoding("utf8");
          proc.stdout.on("data", (chunk: string) => {
            buf += chunk;
            if (buf.includes("READY")) resolve();
          });
          proc.on("exit", (code) => reject(new Error(`el ayudante WAL salió antes de READY (código ${code})`)));
          setTimeout(() => reject(new Error("el ayudante WAL no llegó a READY")), 30_000);
        });
      } finally {
        proc.kill("SIGKILL");
      }
      expect(fs.existsSync(`${file}-wal`)).toBe(true);
      expect(fs.statSync(`${file}-wal`).size).toBeGreaterThan(0);

      const h = await ensureEncryptedDatabase(DB, `b01-m2(${DB})`, { driver, dekHex: DEK_A });
      await h.closeAsync();

      // TODAS las filas, incluidas las del WAL, con valores exactos.
      expect(await readRows(driver, DEK_A)).toEqual(ROW_OBJS);
      expect(fs.existsSync(path.join(dir, `${DB}.sqlcipher`))).toBe(true); // marcador
      for (const s of [`${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
        expect(fs.existsSync(path.join(dir, s))).toBe(false); // sidecars en claro eliminados
      }
      await expectPlainSqliteRejects(file, "úrsula");
      await expectFailClosed(driver, DEK_WRONG);
    },
  );

  it(
    "M3 · cifrada sin marcador: el estado se decide por sonda y ensure NO re-migra (sha256 idéntico)",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m3");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);
      makePlainDb(file);
      const h = await ensureEncryptedDatabase(DB, `b01-m3(${DB})`, { driver, dekHex: DEK_A });
      await h.closeAsync();

      fs.rmSync(path.join(dir, `${DB}.sqlcipher`)); // instalación intermedia: sin marcador
      expect(await getMigrationState(DB, DEK_A, driver)).toBe("MIGRATION_COMPLETE");
      const before = sha256File(file);
      const h2 = await ensureEncryptedDatabase(DB, `b01-m3b(${DB})`, { driver, dekHex: DEK_A });
      await h2.closeAsync();
      expect(sha256File(file)).toBe(before);
      expect(await readRows(driver, DEK_A)).toEqual(ROW_OBJS);
    },
  );

  it(
    "M4 · cifrada con marcador, idempotente: dos ensure más, sha256 idéntico tras ambas",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m4");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);
      makePlainDb(file);
      const h = await ensureEncryptedDatabase(DB, `b01-m4(${DB})`, { driver, dekHex: DEK_A });
      await h.closeAsync();
      const before = sha256File(file);
      for (let i = 0; i < 2; i++) {
        const hi = await ensureEncryptedDatabase(DB, `b01-m4-${i}(${DB})`, { driver, dekHex: DEK_A });
        await hi.closeAsync();
        expect(sha256File(file)).toBe(before);
      }
      expect(await readRows(driver, DEK_A)).toEqual(ROW_OBJS);
    },
  );

  it(
    "M4-bis · marcador presente pero principal en claro: el marcador manda y el handshake falla cerrado; nada se toca",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m4bis");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);
      makePlainDb(file);
      // Marcador escrito a mano con la forma real que escribe la migración.
      fs.writeFileSync(
        path.join(dir, `${DB}.sqlcipher`),
        JSON.stringify({ v: 1, cipher: "sqlcipher4", migratedAt: new Date().toISOString(), db: DB }),
        "utf8",
      );
      expect(await getMigrationState(DB, DEK_A, driver)).toBe("MIGRATION_COMPLETE");
      const before = sha256File(file);
      await expect(ensureEncryptedDatabase(DB, `b01-m4bis(${DB})`, { driver, dekHex: DEK_A })).rejects.toThrow(
        FAIL_CLOSED_PART,
      );
      expect(sha256File(file)).toBe(before); // jamás se abrió en claro en silencio
      expect(fs.existsSync(`${file}.migtmp`)).toBe(false);
    },
  );

  it(
    "M5 · temporal parcial truncado: no demuestra el contenido, se descarta y se re-migra completa",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m5");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);
      makePlainDb(file);
      const twin = await migratedTwinBytes();
      fs.writeFileSync(`${file}.migtmp`, twin.subarray(0, Math.floor(twin.length * 0.4)));

      const h = await ensureEncryptedDatabase(DB, `b01-m5(${DB})`, { driver, dekHex: DEK_A });
      await h.closeAsync();
      expect(await readRows(driver, DEK_A)).toEqual(ROW_OBJS);
      expect(fs.existsSync(`${file}.migtmp`)).toBe(false);
      expect(fs.existsSync(path.join(dir, `${DB}.sqlcipher`))).toBe(true);
    },
  );

  it(
    "M6 · temporal completo y demostrable: se completa el rename; y sin principal, el temporal válido se promueve igual",
    { timeout: 240_000 },
    async () => {
      // (a) Con principal en claro de huella idéntica: rename pendiente.
      const dir = freshDir("mig-m6");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);
      makePlainDb(file);
      fs.writeFileSync(`${file}.migtmp`, await migratedTwinBytes());
      const h = await ensureEncryptedDatabase(DB, `b01-m6(${DB})`, { driver, dekHex: DEK_A });
      await h.closeAsync();
      expect(await readRows(driver, DEK_A)).toEqual(ROW_OBJS);
      expect(fs.existsSync(`${file}.migtmp`)).toBe(false);
      expect(fs.existsSync(path.join(dir, `${DB}.sqlcipher`))).toBe(true);

      // (b) Sin principal: crash en la ventana en que solo queda el temporal.
      const dir2 = freshDir("mig-m6b");
      const driver2 = makeRealSqlcipherDriver(dir2);
      const file2 = path.join(dir2, DB);
      fs.writeFileSync(`${file2}.migtmp`, await migratedTwinBytes());
      const h2 = await ensureEncryptedDatabase(DB, `b01-m6b(${DB})`, { driver: driver2, dekHex: DEK_A });
      await h2.closeAsync();
      expect(await readRows(driver2, DEK_A)).toEqual(ROW_OBJS);
      expect(fs.existsSync(path.join(dir2, `${DB}.sqlcipher`))).toBe(true);
    },
  );

  it(
    "M7 · temporal en claro: no verifica con la clave sobre el motor real — descarte y re-migración completa",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m7");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);
      makePlainDb(file);
      // El temporal «de un crash antes del export»: bytes en claro.
      const plainTwin = freshDir("mig-m7-twin");
      makePlainDb(path.join(plainTwin, DB));
      fs.copyFileSync(path.join(plainTwin, DB), `${file}.migtmp`);

      const h = await ensureEncryptedDatabase(DB, `b01-m7(${DB})`, { driver, dekHex: DEK_A });
      await h.closeAsync();
      expect(await readRows(driver, DEK_A)).toEqual(ROW_OBJS);
      expect(fs.existsSync(`${file}.migtmp`)).toBe(false);
      await expectPlainSqliteRejects(file, "úrsula");
    },
  );

  it(
    "M8 · principal ilegible con temporal presente: RECOVERY_REQUIRED antes de tocar nada (invariante A/F-NEW-1)",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m8");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);
      await seedEncrypted(driver, DEK_X); // la principal vive con una DEK ajena
      const plainTwin = freshDir("mig-m8-twin");
      makePlainDb(path.join(plainTwin, DB));
      fs.copyFileSync(path.join(plainTwin, DB), `${file}.migtmp`);

      const mainBefore = sha256File(file);
      const tmpBefore = sha256File(`${file}.migtmp`);
      await expect(ensureEncryptedDatabase(DB, `b01-m8(${DB})`, { driver, dekHex: DEK_A })).rejects.toThrow(
        "RECOVERY_REQUIRED — la base principal existe pero no es legible",
      );
      // La mitad negativa del caso: nada se promovió, descartó ni marcó.
      expect(sha256File(file)).toBe(mainBefore);
      expect(sha256File(`${file}.migtmp`)).toBe(tmpBefore);
      expect(fs.existsSync(path.join(dir, `${DB}.sqlcipher`))).toBe(false);
      expect(await readRows(driver, DEK_X)).toEqual(ROW_OBJS); // la principal sigue abriendo con X
    },
  );

  it(
    "M9 · el almacén no tiene la entrada que la base espera: RECOVERY_REQUIRED sin destrucción ni re-cifrado silencioso",
    { timeout: 240_000 },
    async () => {
      const dir = freshDir("mig-m9");
      const driver = makeRealSqlcipherDriver(dir);
      const file = path.join(dir, DB);
      setSecureDbTestDriver(driver);
      const backend1 = createMemorySecureBackend();
      setTestSecureBackend(backend1);
      await storeDatabaseKeyHex(DEK_A);
      await seedEncrypted(driver, DEK_A);
      const before = sha256File(file);

      // El almacén cambia a uno VACÍO: la entrada que la base espera no está.
      const backend2 = createMemorySecureBackend();
      setTestSecureBackend(backend2);
      const err = await ensureEncryptedDatabase(DB, `b01-m9(${DB})`).catch((e: unknown) => e);
      // DESENLACE MEDIDO (rama interna real, registrada): el encargo
      // esperaba el texto de la rama final de ensure («RECOVERY_REQUIRED
      // — la base no abre ni en claro ni con la clave del Keystore…»),
      // que es el desenlace cuando la máquina de estados decide. En la
      // superficie real ocurre OTRA rama, y es la puerta diseñada: la
      // sonda de pérdida de clave está registrada por el propio
      // secureDatabase.ts (:456) al importarlo, así que la resolución
      // de la DEK detecta «almacén vacío + bases cifradas presentes» y
      // lanza KeyLossError — el estado de recuperación explícito, con
      // consentimiento, que el propio M9 nombra como única puerta
      // legítima. El veredicto exigido es el mismo y se cumple entero:
      // fallo cerrado y nombrado, sin generar clave en silencio, sin
      // destruir ni re-cifrar nada.
      expect(err).toBeInstanceOf(KeyLossError);
      expect((err as Error).message).toContain("will NOT generate a new key silently");
      expect((err as Error).message).toContain(`(${DB})`);
      expect(sha256File(file)).toBe(before);

      // Al restaurar el almacén nº 1, la base abre con A y el centinela está.
      setTestSecureBackend(backend1);
      expect(await readRows(driver, DEK_A)).toEqual(ROW_OBJS);
    },
  );
});
