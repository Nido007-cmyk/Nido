/**
 * databaseManager.lifecycle.test.ts — Regresión específica del DatabaseManager.
 *
 * Cobertura explícita exigida:
 * - todos los stores usando el mismo manager (una sola conexión)
 * - concurrent writes (serialización vía write queue)
 * - epoch invalidation (writes obsoletos fallan con DbLifecycleEndedError)
 * - stale handles (handle de epoch anterior no se usa)
 * - key retrieval failure (fail-closed, sin fallback)
 * - SecureStore failure (fail-closed)
 * - no-key = no sensitive DB access
 * - wipe de todos los dominios (memory/task/skills/graph comparten la base)
 * - reopen después de wipe (nuevo ciclo limpio)
 * - migrations/recovery (DDL + version check)
 * - fallo parcial durante wipe (close falla, el wipe continúa)
 *
 * Estrategia: driver falso inyectado vía setSecureDbTestDriver + keyManager
 * simulado. El DatabaseManager usa getCurrentDriver() explícitamente, por lo
 * que el driver de test se propaga sin tocar prodDriver().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// Mundo falso
// ---------------------------------------------------------------------------
const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  const files = new Map<string, string>();
  const opens: string[] = [];
  const closes: string[] = [];
  const removedPaths: string[] = [];
  const execLog: string[] = [];
  const sabotage = { keyFails: false, secureStoreFails: false, closeFails: false };

  function reset() {
    files.clear();
    opens.length = 0;
    closes.length = 0;
    removedPaths.length = 0;
    execLog.length = 0;
    sabotage.keyFails = false;
    sabotage.secureStoreFails = false;
    sabotage.closeFails = false;
  }

  let id = 0;
  function makeHandle() {
    const hid = ++id;
    return {
      execAsync: async (sql: string) => {
        execLog.push(`RUN ${sql}`);
      },
      getAllAsync: async <T,>(sql: string): Promise<T[]> => {
        execLog.push(`GETALL ${sql}`);
        if (sql.includes("cipher_version")) return [{ cipher_version: "4.5.1" }] as unknown as T[];
        if (sql.includes("sqlite_master")) return [{ n: 1 }] as unknown as T[];
        return [] as T[];
      },
      getFirstAsync: async <T,>(sql: string): Promise<T | null> => {
        execLog.push(`GETFIRST ${sql}`);
        if (sql.includes("schema_version")) return { value: "1" } as unknown as T;
        if (sql.includes("count(*)")) return { n: 1 } as unknown as T;
        if (sql.includes("integrity_check")) return { integrity_check: "ok" } as unknown as T;
        return null;
      },
      runAsync: async (sql: string) => {
        execLog.push(`RUN ${sql}`);
        return { lastInsertRowId: 1, changes: 1 };
      },
      withTransactionAsync: async (fn: () => Promise<void>) => {
        await fn();
      },
      closeAsync: async () => {
        closes.push(`handle-${hid}`);
        if (sabotage.closeFails) throw new Error("close simulado: EBUSY");
      },
    };
  }

  function makeDriver() {
    return {
      dbDir: () => `${DOC}SQLite/`,
      openDb: async (path: string) => {
        opens.push(path);
        files.set(path, "db-bytes");
        // Marcar como cifrada para evitar migraciones en tests.
        if (path.endsWith(".db")) {
          files.set(`${path}.sqlcipher`, "marker");
        }
        return makeHandle();
      },
      exists: async (path: string) => files.has(path),
      remove: async (path: string) => {
        removedPaths.push(path);
        files.delete(path);
      },
      rename: async () => {
        throw new Error("rename no usado");
      },
      writeFile: async (path: string, content: string) => {
        files.set(path, content);
      },
    };
  }

  return { DOC, files, opens, closes, removedPaths, execLog, sabotage, reset, makeDriver };
});

// keyManager simulado con sabotaje configurable.
vi.mock("../privacy/keyManager", () => ({
  registerKeyLossProbe: () => {},
  getDatabaseKeyHex: async () => {
    if (fx.sabotage.keyFails) throw new Error("Keystore simulado: fallo de lectura");
    if (fx.sabotage.secureStoreFails) throw new Error("SecureStore simulado: no disponible");
    return "ab".repeat(32);
  },
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

// Código REAL bajo prueba.
import { setSecureDbTestDriver, DbLifecycleEndedError } from "./secureDatabase";
import {
  getDatabase,
  writeTransaction,
  closeDatabase,
  wipeDatabase,
  getDatabaseEpoch,
} from "./databaseManager";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(async () => {
  fx.reset();
  setSecureDbTestDriver(fx.makeDriver());
  // Cerrar cualquier conexión cacheada de tests anteriores.
  await closeDatabase().catch(() => {});
});

afterEach(() => {
  setSecureDbTestDriver(null);
});

// ---------------------------------------------------------------------------
// 1. Todos los stores comparten el mismo manager (una sola conexión)
// ---------------------------------------------------------------------------
describe("una sola conexión para todos los dominios", () => {
  it("múltiples getDatabase() reutilizan la misma conexión (no reabren)", async () => {
    const db1 = await getDatabase();
    const opensAfterFirst = fx.opens.length;
    const db2 = await getDatabase();
    const db3 = await getDatabase();
    expect(fx.opens.length).toBe(opensAfterFirst);
    expect(db2).toBe(db1);
    expect(db3).toBe(db1);
  });

  it("writeTransaction usa la misma conexión subyacente", async () => {
    await getDatabase();
    const opensBefore = fx.opens.length;
    await writeTransaction(async () => {});
    await writeTransaction(async () => {});
    expect(fx.opens.length).toBe(opensBefore);
  });
});

// ---------------------------------------------------------------------------
// 2. Concurrent writes se serializan (write queue)
// ---------------------------------------------------------------------------
describe("concurrent writes", () => {
  it("writes concurrentes se ejecutan en orden sin intercalarse", async () => {
    const order: number[] = [];
    const w1 = writeTransaction(async () => {
      order.push(1);
      await tick();
      order.push(2);
    });
    const w2 = writeTransaction(async () => {
      order.push(3);
    });
    const w3 = writeTransaction(async () => {
      order.push(4);
    });
    await Promise.all([w1, w2, w3]);
    // Cada write es atómico: 1,2 siempre juntos y antes que 3,4 en orden de encolado.
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("un write que falla no bloquea los siguientes", async () => {
    const w1 = writeTransaction(async () => {
      throw new Error("fallo simulado");
    });
    const w2 = writeTransaction(async () => "ok");
    await expect(w1).rejects.toThrow("fallo simulado");
    await expect(w2).resolves.toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 3. Epoch invalidation + 4. Stale handles
// ---------------------------------------------------------------------------
describe("epoch invalidation y stale handles", () => {
  it("closeDatabase avanza el epoch", async () => {
    await getDatabase();
    const e1 = getDatabaseEpoch();
    await closeDatabase();
    const e2 = getDatabaseEpoch();
    expect(e2).toBeGreaterThan(e1);
  });

  it("write encolado antes del close falla con DbLifecycleEndedError tras el close", async () => {
    await getDatabase();
    // Encolar un write (se ejecuta inmediatamente si no hay otros).
    // Para probar stale, necesitamos el write en la cola cuando ocurre el close.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const blocking = writeTransaction(async () => {
      await gate; // bloquea la queue
    });
    await tick(); // blocking está en ejecución, ocupando la queue
    const stale = writeTransaction(async () => "nunca corre");
    await tick(); // stale está encolado detrás de blocking
    await closeDatabase(); // avanza el epoch; stale queda obsoleto
    release();
    await blocking; // el bloqueante termina ok (empezó antes del close)
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
  });

  it("tras closeDatabase, getDatabase() reabre (nuevo ciclo)", async () => {
    const db1 = await getDatabase();
    await closeDatabase();
    const db2 = await getDatabase();
    expect(db2).not.toBe(db1);
    expect(fx.closes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Key retrieval failure (fail-closed) + 6. SecureStore failure
// ---------------------------------------------------------------------------
describe("fail-closed sin clave", () => {
  it("si getDatabaseKeyHex falla, getDatabase propaga el error (sin fallback)", async () => {
    await closeDatabase(); // asegurar que no hay conexión cacheada
    fx.sabotage.keyFails = true;
    await expect(getDatabase()).rejects.toThrow("Keystore simulado");
    fx.sabotage.keyFails = false;
  });

  it("si SecureStore falla, no se abre la base", async () => {
    await closeDatabase();
    fx.sabotage.secureStoreFails = true;
    const opensBefore = fx.opens.length;
    await expect(getDatabase()).rejects.toThrow("SecureStore simulado");
    expect(fx.opens.length).toBe(opensBefore);
    fx.sabotage.secureStoreFails = false;
  });

  it("tras fallo de clave, un reintento con clave OK funciona (sin promesa envenenada)", async () => {
    await closeDatabase();
    fx.sabotage.keyFails = true;
    await expect(getDatabase()).rejects.toThrow();
    fx.sabotage.keyFails = false;
    const db = await getDatabase();
    expect(db).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Wipe de todos los dominios + 9. Reopen después de wipe
// ---------------------------------------------------------------------------
describe("wipe total y reapertura", () => {
  it("wipeDatabase elimina el fichero principal", async () => {
    await getDatabase();
    expect(fx.files.has(`${fx.DOC}SQLite/nido_memory.db`)).toBe(true);
    await wipeDatabase();
    expect(fx.removedPaths).toContain(`${fx.DOC}SQLite/nido_memory.db`);
    expect(fx.files.has(`${fx.DOC}SQLite/nido_memory.db`)).toBe(false);
  });

  it("wipeDatabase cierra la conexión antes de borrar (best-effort)", async () => {
    await getDatabase();
    const closesBefore = fx.closes.length;
    await wipeDatabase();
    expect(fx.closes.length).toBeGreaterThan(closesBefore);
  });

  it("después del wipe, getDatabase() reabre limpio (nuevo ciclo)", async () => {
    await getDatabase();
    await wipeDatabase();
    const db = await getDatabase();
    expect(db).toBeDefined();
    // Se reabrió el fichero.
    expect(fx.opens.filter((p) => p.includes("nido_memory.db")).length).toBeGreaterThan(1);
  });

  it("writes encolados antes del wipe fallan con DbLifecycleEndedError", async () => {
    await getDatabase();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const blocking = writeTransaction(async () => {
      await gate;
    });
    await tick();
    const stale = writeTransaction(async () => "nunca");
    await tick();
    await wipeDatabase();
    release();
    await blocking;
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
  });
});

// ---------------------------------------------------------------------------
// 11. Fallo parcial durante wipe (close falla, el wipe continúa)
// ---------------------------------------------------------------------------
describe("fallo parcial durante wipe", () => {
  it("si closeAsync falla, wipeDatabase igual borra el fichero", async () => {
    await getDatabase();
    fx.sabotage.closeFails = true;
    await expect(wipeDatabase()).resolves.toBeUndefined();
    expect(fx.removedPaths).toContain(`${fx.DOC}SQLite/nido_memory.db`);
    fx.sabotage.closeFails = false;
  });

  it("tras wipe con close fallido, el manager sigue operativo", async () => {
    await getDatabase();
    fx.sabotage.closeFails = true;
    await wipeDatabase();
    fx.sabotage.closeFails = false;
    const db = await getDatabase();
    expect(db).toBeDefined();
    await expect(writeTransaction(async () => "ok")).resolves.toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 10. Migrations/recovery (DDL + version check)
// ---------------------------------------------------------------------------
describe("migrations y recovery", () => {
  it("la apertura ejecuta el DDL del esquema", async () => {
    await closeDatabase();
    fx.execLog.length = 0;
    await getDatabase();
    const ddlRuns = fx.execLog.filter(
      (s) => s.includes("CREATE TABLE") || s.includes("CREATE INDEX"),
    );
    expect(ddlRuns.length).toBeGreaterThan(0);
  });

  it("si el DDL falla, el handle se cierra y el siguiente intento puede reintentar", async () => {
    await closeDatabase();
    // Sabotear el DDL haciendo que execAsync falle en CREATE.
    const origExec = fx.execLog.push.bind(fx.execLog);
    let ddlFailed = false;
    // Usamos un driver envolvente que falla en DDL.
    const badDriver = fx.makeDriver();
    const origOpen = badDriver.openDb;
    badDriver.openDb = async (path: string) => {
      const h = await origOpen(path);
      const origExecAsync = h.execAsync;
      h.execAsync = async (sql: string) => {
        if (sql.includes("CREATE TABLE") && !ddlFailed) {
          ddlFailed = true;
          throw new Error("DDL simulado");
        }
        return origExecAsync(sql);
      };
      return h;
    };
    setSecureDbTestDriver(badDriver);
    await expect(getDatabase()).rejects.toThrow("DDL simulado");
    // El handle se cerró best-effort.
    expect(fx.closes.length).toBeGreaterThan(0);
    // Reintento con driver sano funciona.
    setSecureDbTestDriver(fx.makeDriver());
    const db = await getDatabase();
    expect(db).toBeDefined();
  });
});
