/**
 * db.lifecycle.test.ts — P0 DATABASE LIFECYCLE HARDENING.
 *
 * GOAL 1 (wipe terminal): un write encolado bajo un ciclo de vida anterior a
 * Clear All Data no puede reabrir ni repoblar la base; falla explícitamente
 * con DbLifecycleEndedError.
 *
 * GOAL 2 (init failure recovery): si el DDL falla en la primera apertura, el
 * handle se cierra best-effort, la promesa cacheada no queda envenenada y el
 * siguiente intento legítimo puede reintentar. El error original nunca queda
 * enmascarado por la limpieza.
 *
 * Estrategia: código REAL (rag/db, memoryStore, secureDatabase con
 * ensureEncryptedDatabase/deleteManagedDatabase reales) contra un driver
 * falso inyectado con setSecureDbTestDriver + expo-sqlite y keyManager
 * simulados. Nada aquí depende de timings: el guard de epoch es síncrono y
 * los "holds" usan puertas deterministas (promesas controladas), nunca
 * sleeps para decidir el resultado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// Mundo falso (hoisted: las factorías vi.mock no pueden ver nada de fuera)
// ---------------------------------------------------------------------------
const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  const files = new Map<string, string>(); // FS falso: path -> contenido
  const opens: string[] = []; // cada openDb del driver
  const closes: string[] = []; // cada closeAsync de un handle
  const deletedNames: string[] = []; // cada SQLite.deleteDatabaseAsync(name)
  const removedPaths: string[] = []; // cada driver.remove(path) — mecanismo de wipe actual
  const execLog: string[] = []; // SQL ejecutado (para probar que el write corrió)
  const sabotage = { ddl: false, close: false };
  // Puerta determinista para mantener un write en vuelo:
  let holdWrites = false;
  let holdEngaged: Promise<void> = Promise.resolve();
  let signalEngaged: (() => void) | null = null;
  let writeHold: Promise<void> = Promise.resolve();
  let releaseHold: (() => void) | null = null;

  function armWriteHold(): void {
    holdWrites = true;
    holdEngaged = new Promise<void>((r) => {
      signalEngaged = r;
    });
    writeHold = new Promise<void>((r) => {
      releaseHold = r;
    });
  }
  function releaseWriteHold(): void {
    holdWrites = false;
    releaseHold?.();
  }
  function reset(): void {
    files.clear();
    opens.length = 0;
    closes.length = 0;
    deletedNames.length = 0;
    removedPaths.length = 0;
    execLog.length = 0;
    sabotage.ddl = false;
    sabotage.close = false;
    holdWrites = false;
    holdEngaged = Promise.resolve();
    signalEngaged = null;
    writeHold = Promise.resolve();
    releaseHold = null;
  }

  function makeHandle() {
    const id = opens.length; // 1-based tras el push de openDb
    // Modela SQLCipher: sin PRAGMA key la base no se puede leer (como una
    // base cifrada real). Así probeDatabaseKind la clasifica como
    // "encrypted" y el reintento no cae en la ruta de migración.
    let keyApplied = false;
    return {
      execAsync: async (sql: string) => {
        execLog.push(sql);
        if (/^\s*PRAGMA\s+key/i.test(sql)) keyApplied = true;
        if (sabotage.ddl && /CREATE\s+(VIRTUAL\s+)?TABLE/i.test(sql)) {
          throw new Error("DDL simulado: disco lleno");
        }
      },
      getAllAsync: async <T>(sql: string): Promise<T[]> => {
        if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
        // La tabla ya trae collection_id: openAndMigrate no intenta el ALTER.
        if (/table_info\s*\(\s*chunks\s*\)/i.test(sql))
          return [{ name: "chunk_id" }, { name: "collection_id" }] as T[];
        return [] as T[];
      },
      getFirstAsync: async <T>(sql: string): Promise<T | null> => {
        // schema_version ya presente: openAndMigrate no hace el INSERT.
        if (/schema_version/.test(sql)) return { value: "1" } as T;
        if (/integrity_check/i.test(sql)) return { integrity_check: "ok" } as T;
        if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) {
          throw new Error("file is not a database (sin clave)");
        }
        return { n: 1 } as T;
      },
      runAsync: async (sql: string, _params?: unknown[]) => {
        execLog.push(`RUN ${sql}`);
        if (holdWrites) {
          signalEngaged?.();
          await writeHold;
        }
        return { lastInsertRowId: 0, changes: 0 };
      },
      withTransactionAsync: async (fn: () => Promise<void>) => {
        await fn();
      },
      closeAsync: async () => {
        closes.push(`handle-${id}`);
        if (sabotage.close) throw new Error("close simulado: EBUSY");
      },
    };
  }

  function makeDriver() {
    return {
      dbDir: () => `${DOC}SQLite/`,
      openDb: async (path: string) => {
        opens.push(path);
        files.set(path, "db-bytes");
        return makeHandle();
      },
      exists: async (path: string) => files.has(path),
      remove: async (path: string) => {
        removedPaths.push(path);
        files.delete(path);
      },
      rename: async () => {
        throw new Error("rename no usado en estos tests");
      },
      writeFile: async (path: string, content: string) => {
        files.set(path, content);
      },
    };
  }

  return {
    DOC,
    files,
    opens,
    closes,
    deletedNames,
    removedPaths,
    execLog,
    sabotage,
    armWriteHold,
    releaseWriteHold,
    holdEngaged: () => holdEngaged,
    makeDriver,
    reset,
  };
});

vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async (name: string) => {
    fx.deletedNames.push(name);
    const prefix = `${fx.DOC}SQLite/${name}`;
    for (const k of [...fx.files.keys()]) {
      if (k === prefix || k.startsWith(`${prefix}-`) || k.startsWith(`${prefix}.`)) {
        fx.files.delete(k);
      }
    }
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: fx.DOC,
  cacheDirectory: fx.DOC,
  getInfoAsync: async (path: string) => ({ exists: fx.files.has(path) }),
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const c = fx.files.get(from);
    if (c === undefined) throw new Error(`no existe: ${from}`);
    fx.files.delete(from);
    fx.files.set(to, c);
  },
  deleteAsync: async (path: string) => {
    fx.files.delete(path);
  },
}));

// keyManager falso pero fiel: aplica la clave con el mismo handshake
// (formato hex, PRAGMA key, exige cipher_version, lectura de prueba) para no
// relajar el fail-closed en los tests.
vi.mock("../privacy/keyManager", () => ({

  registerKeyLossProbe: () => {},
  getDatabaseKeyHex: async () => "ab".repeat(32),
  applyDatabaseKey: async (
    db: {
      execAsync(s: string): Promise<void>;
      getAllAsync(s: string): Promise<Array<{ cipher_version?: string }>>;
      getFirstAsync(s: string): Promise<unknown>;
      closeAsync(): Promise<void>;
    },
    keyHex: string | null,
  ) => {
    if (!keyHex) return;
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      await db.closeAsync().catch(() => {});
      throw new Error("formato de clave inválido (fail-closed)");
    }
    await db.execAsync(`PRAGMA key = "x'${keyHex.toLowerCase()}'";`);
    const rows = await db.getAllAsync("PRAGMA cipher_version;");
    if (!rows?.[0]?.cipher_version) {
      await db.closeAsync().catch(() => {});
      throw new Error("sin SQLCipher: fail-closed");
    }
    await db.getFirstAsync("SELECT count(*) AS n FROM sqlite_master;");
  },
}));

// secureDatabase REAL (ensureEncryptedDatabase + deleteManagedDatabase +
// DbLifecycleEndedError reales) con el driver falso inyectado.
import { setSecureDbTestDriver, DbLifecycleEndedError } from "../security/secureDatabase";
import { getDb, writeTransaction, resetDatabase } from "./db";
import { getMemoryDb, clearMemoryDb, saveFact } from "../agent/memory/memoryStore";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  fx.reset();
  setSecureDbTestDriver(fx.makeDriver());
});

afterEach(() => {
  setSecureDbTestDriver(null);
});

// ---------------------------------------------------------------------------
// GOAL 1 — WIPE MUST BE TERMINAL (base de conocimiento)
// ---------------------------------------------------------------------------
describe("GOAL 1 — wipe terminal (nido_knowledge.db)", () => {
  it("1. queued write → reset antes de que empiece → el write obsoleto no puede recrear la DB", async () => {
    await getDb();
    const opensAfterOpen = fx.opens.length;
    let staleRan = false;
    const stale = writeTransaction(async () => {
      staleRan = true;
    });
    // Reset SINCRÓNICO tras encolar: el callback del write necesita un
    // microtask para empezar, así que el bump de epoch llega antes sí o sí.
    await resetDatabase();
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    expect(staleRan).toBe(false);
    expect(fx.opens.length).toBe(opensAfterOpen); // ningún reopen
    expect(fx.deletedNames).toContain("nido_knowledge.db");
  });

  it("2. write en vuelo → reset → estado final sin DB recreada", async () => {
    await getDb();
    const opensBefore = fx.opens.length;
    fx.armWriteHold();
    const inFlight = writeTransaction(async (db) => {
      await db.runAsync("INSERT INTO chunks (chunk_id) VALUES ('en-vuelo')");
    });
    await fx.holdEngaged(); // el write ya empezó y está detenido en runAsync
    await resetDatabase();
    expect(fx.opens.length).toBe(opensBefore); // nada reabierto durante el reset
    fx.releaseWriteHold();
    await expect(inFlight).resolves.toBeUndefined(); // el write en vuelo termina
    await tick();
    expect(fx.opens.length).toBe(opensBefore); // y sigue sin recrearse
    expect(fx.deletedNames).toContain("nido_knowledge.db");
  });

  it("3. múltiples writes obsoletos encolados → todos rechazados/invalidados", async () => {
    await getDb();
    const opensBefore = fx.opens.length;
    const stales = [0, 1, 2].map((i) =>
      writeTransaction(async () => {
        throw new Error(`write obsoleto ${i} nunca debe ejecutarse`);
      }),
    );
    await resetDatabase();
    for (const s of stales) {
      await expect(s).rejects.toBeInstanceOf(DbLifecycleEndedError);
    }
    expect(fx.opens.length).toBe(opensBefore);
    expect(fx.deletedNames).toContain("nido_knowledge.db");
  });

  it("4. un write nuevo post-reset usa el nuevo ciclo de vida y funciona normal", async () => {
    await resetDatabase(); // estado limpio
    const opensBefore = fx.opens.length;
    await expect(
      writeTransaction(async (db) => {
        await db.runAsync("INSERT INTO chunks (chunk_id) VALUES ('nuevo-ciclo')");
      }),
    ).resolves.toBeUndefined();
    expect(fx.opens.length).toBe(opensBefore + 1); // apertura fresca del nuevo ciclo
    expect(fx.execLog.some((s) => s.includes("INSERT INTO chunks"))).toBe(true);
    // La cadena serializada sigue intacta: otro write del mismo ciclo reusa
    // la conexión sin reaperturas.
    await expect(writeTransaction(async () => {})).resolves.toBeUndefined();
    expect(fx.opens.length).toBe(opensBefore + 1);
  });

  it("5. carrera en frontera de chunk de seed/import con reset", async () => {
    await getDb();
    const opensBefore = fx.opens.length;
    const order: string[] = [];
    fx.armWriteHold();
    // chunk-1 en vuelo (detenido), chunk-2 ya encolado detrás: el reset cae
    // exactamente entre chunks, como en un import/seed real.
    const chunk1 = writeTransaction(async (db) => {
      order.push("chunk-1");
      await db.runAsync("INSERT INTO chunks (chunk_id) VALUES ('c1')");
    });
    const chunk2 = writeTransaction(async () => {
      order.push("chunk-2");
    });
    await fx.holdEngaged();
    await resetDatabase();
    fx.releaseWriteHold();
    await expect(chunk1).resolves.toBeUndefined();
    // El loop de import ve el fallo explícito y aborta en vez de seguir en
    // silencio: chunk-2 nunca se ejecuta.
    await expect(chunk2).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(order).toEqual(["chunk-1"]);
    expect(fx.opens.length).toBe(opensBefore);
    expect(fx.deletedNames).toContain("nido_knowledge.db");
  });
});

// ---------------------------------------------------------------------------
// GOAL 2 — INITIALIZATION FAILURE RECOVERY (base de conocimiento)
// ---------------------------------------------------------------------------
describe("GOAL 2 — recuperación de fallo de inicialización (nido_knowledge.db)", () => {
  it("6. DDL lanza en la primera apertura → se intenta cerrar el handle", async () => {
    await resetDatabase(); // garantiza dbPromise == null → apertura fresca
    fx.sabotage.ddl = true;
    const closesBefore = fx.closes.length;
    await expect(getDb()).rejects.toThrow("DDL simulado");
    expect(fx.closes.length).toBe(closesBefore + 1);
    fx.sabotage.ddl = false;
  });

  it("7. la inicialización fallida no envenena permanentemente la promesa", async () => {
    await resetDatabase();
    fx.sabotage.ddl = true;
    const p1 = getDb();
    await expect(p1).rejects.toThrow("DDL simulado");
    await tick(); // deja que el limpiador de getDb() corra
    fx.sabotage.ddl = false;
    const p2 = getDb();
    expect(p2).not.toBe(p1); // no es la promesa envenenada
    await expect(p2).resolves.toBeDefined(); // el reintento legítimo abre
  });

  it("8. la segunda apertura tras un fallo transitorio puede tener éxito y usarse", async () => {
    await resetDatabase();
    fx.sabotage.ddl = true;
    await expect(getDb()).rejects.toThrow("DDL simulado");
    await tick();
    fx.sabotage.ddl = false;
    const db = await getDb();
    await expect(db.execAsync("SELECT 1")).resolves.toBeUndefined();
    await expect(writeTransaction(async () => {})).resolves.toBeUndefined();
  });

  it("9. un fallo de closeAsync en la limpieza no oculta el error DDL original", async () => {
    await resetDatabase();
    fx.sabotage.ddl = true;
    fx.sabotage.close = true;
    const err = await getDb().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch("DDL simulado");
    expect((err as Error).message).not.toMatch("close simulado");
    fx.sabotage.ddl = false;
    fx.sabotage.close = false;
  });
});

// ---------------------------------------------------------------------------
// Consistencia: la base de memoria endurecida igual que la de conocimiento
// ---------------------------------------------------------------------------
describe("base de memoria (nido_memory.db) — mismo contrato", () => {
  it("M1. write de memoria obsoleto tras clearMemoryDb no recrea la base", async () => {
    await getMemoryDb();
    const opensBefore = fx.opens.length;
    fx.armWriteHold();
    const p1 = saveFact({ content: "hecho en vuelo" });
    await fx.holdEngaged(); // el write de p1 ya empezó (detenido en runAsync)
    const p2 = saveFact({ content: "hecho obsoleto" });
    await tick();
    await tick(); // p2: lecturas hechas, write encolado detrás del held, sin empezar
    await clearMemoryDb();
    fx.releaseWriteHold();
    await expect(p1).resolves.toBeDefined();
    await expect(p2).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(fx.opens.length).toBe(opensBefore);
    // El wipe actual elimina el fichero vía driver.remove (no SQLite.deleteDatabaseAsync).
    expect(fx.removedPaths).toContain(`${fx.DOC}SQLite/nido_memory.db`);
  });

  it("M2. fallo DDL en memoria: handle cerrado, sin promesa envenenada, reintento OK", async () => {
    await clearMemoryDb();
    fx.sabotage.ddl = true;
    const closesBefore = fx.closes.length;
    await expect(getMemoryDb()).rejects.toThrow("DDL simulado");
    expect(fx.closes.length).toBeGreaterThan(closesBefore);
    await tick();
    fx.sabotage.ddl = false;
    const db = await getMemoryDb();
    await expect(db.execAsync("SELECT 1")).resolves.toBeUndefined();
    // Y la memoria vuelve a funcionar con normalidad en el nuevo ciclo.
    await expect(saveFact({ content: "post-reset ok" })).resolves.toBeDefined();
  });

  it("M3. clearMemoryDb no aborta el wipe si closeAsync falla (consistente con resetDatabase)", async () => {
    await getMemoryDb();
    fx.sabotage.close = true;
    await expect(clearMemoryDb()).resolves.toBeUndefined();
    // El wipe actual elimina el fichero vía driver.remove (no SQLite.deleteDatabaseAsync).
    expect(fx.removedPaths).toContain(`${fx.DOC}SQLite/nido_memory.db`);
    fx.sabotage.close = false;
  });
});
