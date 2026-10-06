/**
 * wipeTerminal.test.ts — WIPE TERMINAL COMPLETION (lane 2026-09-28).
 *
 * Criterio del propietario: AFTER CLEAR ALL DATA STARTS, THE OLD NIDO DATA
 * LIFECYCLE CANNOT COME BACK. Estos tests prueban, de forma determinista
 * (puertas controladas, ningún sleep como evidencia), que:
 *
 * - R1: borrar una base ausente (p. ej. el nombre heredado
 *   `aoair_knowledge.db`) no aborta el wipe; un error inesperado de borrado
 *   falla en voz alta en vez de tragarse.
 * - R2: TODOS los writers de la base de conocimiento (chat, telemetría,
 *   colecciones, importación) pasan por el ciclo de vida guardado.
 * - R6: los writers P2P/memoria pasan por el guard; el messenger destruido
 *   no puede seguir operando; ningún frame entrante persiste nada.
 * - WIPE GATE: ningún trabajo de base de datos (lectura, escritura,
 *   apertura o DDL, de ningún ciclo) atraviesa un Clear All Data en curso:
 *   espera detrás de la puerta global; el writer del ciclo N+1 va DETRÁS
 *   del reset (nunca concurrente con el borrado/rotación de DEK); si el
 *   wipe falla, los trabajos en espera reciben su error (fail-closed).
 * - TOCTOU: el epoch viaja hasta la adquisición del handle; un reset entre
 *   "writer autorizado" y "handle adquirido" invalida el handle.
 *
 * Estrategia: código REAL (rag/db, memoryStore, p2p/store, messenger,
 * nidoMessenger, secureDatabase) contra driver falso inyectado +
 * expo-sqlite / expo-file-system / expo-sharing simulados y keyManager real
 * con backend en memoria. Nada depende de timings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// Mundo falso (hoisted)
// ---------------------------------------------------------------------------
const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  const files = new Map<string, string>();
  const opens: string[] = [];
  const closes: string[] = [];
  const deletedNames: string[] = [];
  const execLog: string[] = [];
  const sabotage = { ddl: false, close: false };
  /** Comportamiento de SQLite.deleteDatabaseAsync por nombre de base. */
  const deleteBehavior = new Map<string, "ok" | "notfound" | "unexpected">();
  // Puerta determinista para pausar la APERTURA de la base (TOCTOU).
  let holdOpen = false;
  let openStarted: Promise<void> = Promise.resolve();
  let signalOpenStarted: (() => void) | null = null;
  let openGate: Promise<void> = Promise.resolve();
  let releaseOpenGate: (() => void) | null = null;
  // Puerta determinista para pausar el BORRADO dentro de un wipe real
  // (barrera wipe-gate): el wipe se detiene en deleteDatabaseAsync hasta
  // que el test la libere.
  let holdDelete = false;
  let deleteStarted: Promise<void> = Promise.resolve();
  let signalDeleteStarted: (() => void) | null = null;
  let deleteGate: Promise<void> = Promise.resolve();
  let releaseDeleteGate: (() => void) | null = null;

  function armOpenHold(): void {
    holdOpen = true;
    openStarted = new Promise<void>((r) => {
      signalOpenStarted = r;
    });
    openGate = new Promise<void>((r) => {
      releaseOpenGate = r;
    });
  }
  function releaseOpenHold(): void {
    holdOpen = false;
    releaseOpenGate?.();
  }
  function armDeleteHold(): void {
    holdDelete = true;
    deleteStarted = new Promise<void>((r) => {
      signalDeleteStarted = r;
    });
    deleteGate = new Promise<void>((r) => {
      releaseDeleteGate = r;
    });
  }
  function releaseDeleteHold(): void {
    holdDelete = false;
    releaseDeleteGate?.();
  }
  function reset(): void {
    files.clear();
    opens.length = 0;
    closes.length = 0;
    deletedNames.length = 0;
    execLog.length = 0;
    sabotage.ddl = false;
    sabotage.close = false;
    deleteBehavior.clear();
    holdOpen = false;
    openStarted = Promise.resolve();
    signalOpenStarted = null;
    openGate = Promise.resolve();
    releaseOpenGate = null;
    holdDelete = false;
    deleteStarted = Promise.resolve();
    signalDeleteStarted = null;
    deleteGate = Promise.resolve();
    releaseDeleteGate = null;
  }

  function makeHandle() {
    const id = opens.length;
    let keyApplied = false;
    // Estado "de la base": vive con el handle. Una apertura nueva tras un
    // borrado crea un handle limpio (la base fresca no hereda filas).
    const p2pIdentity: Array<{ pk_hex: string; sk_hex: string; name: string }> = [];
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
        if (/table_info\s*\(\s*chunks\s*\)/i.test(sql))
          return [{ name: "chunk_id" }, { name: "collection_id" }] as T[];
        return [] as T[];
      },
      getFirstAsync: async <T>(sql: string): Promise<T | null> => {
        if (/schema_version/.test(sql)) return { value: "1" } as T;
        if (/integrity_check/i.test(sql)) return { integrity_check: "ok" } as T;
        if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) {
          throw new Error("file is not a database (sin clave)");
        }
        if (/FROM\s+p2p_identity/i.test(sql)) {
          return (p2pIdentity[0] ?? null) as T | null;
        }
        return { n: 1 } as T;
      },
      runAsync: async (sql: string, params?: unknown[]) => {
        execLog.push(`RUN ${sql}`);
        if (/^\s*DELETE\s+FROM\s+p2p_identity/i.test(sql)) p2pIdentity.length = 0;
        else if (/^\s*INSERT\s+INTO\s+p2p_identity/i.test(sql) && params) {
          p2pIdentity.length = 0;
          p2pIdentity.push({
            pk_hex: String(params[0]),
            sk_hex: String(params[1]),
            name: String(params[2]),
          });
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
        if (holdOpen) {
          signalOpenStarted?.();
          await openGate;
        }
        opens.push(path);
        files.set(path, "db-bytes");
        return makeHandle();
      },
      exists: async (path: string) => files.has(path),
      remove: async (path: string) => {
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
    execLog,
    sabotage,
    deleteBehavior,
    armOpenHold,
    releaseOpenHold,
    openStarted: () => openStarted,
    armDeleteHold,
    releaseDeleteHold,
    deleteStarted: () => deleteStarted,
    /** El mock de deleteDatabaseAsync la usa para pausar el borrado real. */
    deleteHoldActive: () => holdDelete,
    awaitDeleteGate: async () => {
      signalDeleteStarted?.();
      await deleteGate;
    },
    makeDriver,
    reset,
  };
});

vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async (name: string) => {
    fx.deletedNames.push(name);
    // Puerta determinista (barrera wipe-gate): pausa el borrado real.
    if (fx.deleteHoldActive()) {
      await fx.awaitDeleteGate();
    }
    const behavior = fx.deleteBehavior.get(name) ?? "ok";
    if (behavior === "notfound") {
      // Imita expo-sqlite real: DatabaseNotFoundException →
      // ERR_DATABASE_NOT_FOUND (ver secureDatabase.isDatabaseNotFoundError).
      const e = new Error(`Database '${name}' not found`) as Error & { code?: string };
      e.code = "ERR_DATABASE_NOT_FOUND";
      throw e;
    }
    if (behavior === "unexpected") throw new Error("EIO simulado: fallo de borrado");
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
  writeAsStringAsync: async (path: string, content: string) => {
    fx.files.set(path, content);
  },
}));

vi.mock("expo-sharing", () => ({}));
// resetAllAppData arrastra motores nativos: se simulan igual que en
// appReset.test.ts (la barrera wipe-gate se prueba contra el flujo real).
// El mock cubre TODA la superficie que usa appReset: N1 añadió el dismiss
// y la verificación de notificaciones ya presentadas (bandeja).
vi.mock("expo-notifications", () => ({
  cancelAllScheduledNotificationsAsync: async () => {},
  getAllScheduledNotificationsAsync: async () => [] as Array<{ identifier: string }>,
  dismissAllNotificationsAsync: async () => {},
  getPresentedNotificationsAsync: async () => [] as Array<{ identifier: string }>,
}));
vi.mock("../inference/LlamaEngine", () => ({ llamaEngine: { unload: async () => {} } }));
vi.mock("../rag/embed", () => ({ embeddingEngine: { unload: async () => {} } }));
vi.mock("../rag/packs", () => ({ closeAllPacks: async () => {} }));
vi.mock("./downloadManager", () => ({ resetDownloadState: () => {} }));

// keyManager REAL con backend en memoria (más fiel que un mock): las claves
// P2P se guardan/borran de verdad en el backend de prueba.
import {
  createMemorySecureBackend,
  setTestSecureBackend,
  setTestRandomBytes,
  loadP2PPrivateKey,
  deleteP2PPrivateKey,
  deleteP2PSigningKey,
} from "../privacy/keyManager";
import { setSecureDbTestDriver, DbLifecycleEndedError, getWipeGate } from "../security/secureDatabase";
import { resetAllAppData } from "./appReset";
import {
  getDb,
  getDbEpoch,
  writeTransaction,
  resetDatabase,
  insertChunk,
  createCustomCollection,
  KNOWLEDGE_DB_NAME,
  LEGACY_KNOWLEDGE_DB_NAME,
} from "../rag/db";
import { getMemoryDb, clearMemoryDb, saveFact } from "../agent/memory/memoryStore";
import { createSession, addMessage, listSessions } from "./chatHistory";
import { recordExecution } from "./executionTelemetry";
import { saveMessage as saveP2PMessage, saveContact, getIdentity } from "../p2p/store";
import { NidoMessenger } from "../p2p/messenger";
import { LoopbackTransport } from "../p2p/transport";
import {
  getSharedNidoMessenger,
  beginP2PDataReset,
  completeP2PDataReset,
  isP2PDataResetInProgress,
} from "./nidoMessenger";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  fx.reset();
  setSecureDbTestDriver(fx.makeDriver());
  setTestSecureBackend(createMemorySecureBackend());
  // R6: ningún test hereda el bloqueo P2P de otro.
  completeP2PDataReset();
  // Entropía determinista: evita require("expo-crypto") (nativo) en tests.
  setTestRandomBytes(async (len: number) => {
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) b[i] = (i * 31 + 7) & 0xff;
    return b;
  });
});

afterEach(() => {
  setSecureDbTestDriver(null);
  completeP2PDataReset();
  // Seguro anti-cascada: si un test falló con una puerta armada, liberarla
  // para no colgar los borrados de los tests siguientes.
  fx.releaseDeleteHold();
  fx.releaseOpenHold();
});

// ---------------------------------------------------------------------------
// R1 — el borrado de una base ausente no aborta el wipe
// ---------------------------------------------------------------------------
describe("R1 — legacy delete no aborta el wipe", () => {
  it("1. legacy ausente → el wipe continúa y completa", async () => {
    await getDb(); // existe nido_knowledge.db
    fx.deleteBehavior.set(LEGACY_KNOWLEDGE_DB_NAME, "notfound");
    await expect(resetDatabase()).resolves.toBeUndefined();
    expect(fx.deletedNames).toContain(KNOWLEDGE_DB_NAME);
    expect(fx.deletedNames).toContain(LEGACY_KNOWLEDGE_DB_NAME);
  });

  it("2. legacy principal y sidecars ausentes → benigno (no se traga nada)", async () => {
    // Ni siquiera existe la base principal: todo ausente = ya limpio.
    fx.deleteBehavior.set(KNOWLEDGE_DB_NAME, "notfound");
    fx.deleteBehavior.set(LEGACY_KNOWLEDGE_DB_NAME, "notfound");
    await expect(resetDatabase()).resolves.toBeUndefined();
  });

  it("3. error inesperado de borrado → falla honesto, no tragado", async () => {
    await getDb();
    fx.deleteBehavior.set(KNOWLEDGE_DB_NAME, "unexpected");
    await expect(resetDatabase()).rejects.toThrow("EIO simulado");
  });

  it("4. el predicado not-found no traga otros errores (unidad)", async () => {
    await getDb();
    // Un error con mensaje parecido pero código distinto NO es benigno.
    fx.deleteBehavior.set(LEGACY_KNOWLEDGE_DB_NAME, "unexpected");
    await expect(resetDatabase()).rejects.toThrow("EIO simulado");
    // …y el borrado de la base principal sí se intentó antes del fallo.
    expect(fx.deletedNames[0]).toBe(KNOWLEDGE_DB_NAME);
  });
});

// ---------------------------------------------------------------------------
// R2 — todos los writers de conocimiento pasan por el ciclo de vida
// ---------------------------------------------------------------------------
describe("R2 — writers de conocimiento invalidados tras el wipe", () => {
  it("5. addMessage encolado → wipe → rechazado, sin recrear la DB", async () => {
    const s = await createSession("t");
    const opensBefore = fx.opens.length;
    const stale = addMessage(s.id, "user", "hola obsoleta");
    await resetDatabase();
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(fx.opens.length).toBe(opensBefore); // ningún reopen
  });

  it("6. createSession encolado → wipe → rechazado", async () => {
    const opensBefore = fx.opens.length;
    const stale = createSession("obsoleta");
    await resetDatabase();
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(fx.opens.length).toBe(opensBefore);
  });

  it("7. recordExecution (telemetría) encolado → wipe → rechazado", async () => {
    const opensBefore = fx.opens.length;
    const stale = recordExecution({
      modelId: "m",
      taskType: "chat",
      adaptiveRoutingUsed: false,
      reasonCodes: [],
      retrievalUsed: false,
      modelSwitches: 0,
      crossMessageModelSwitch: false,
      modelResidency: "resident",
      modelLoadMs: 0,
      ttftMs: 0,
      generationLatencyMs: 0,
      totalLatencyMs: 0,
      tokensGenerated: 0,
      tokPerSec: 0,
      peakRssBytes: 0,
      outcome: "success",
      errorMessage: undefined,
    });
    await resetDatabase();
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(fx.opens.length).toBe(opensBefore);
  });

  it("8. createCustomCollection (finalización de import) encolado → wipe → rechazado", async () => {
    const opensBefore = fx.opens.length;
    const stale = createCustomCollection({
      id: "custom-1",
      name: "Import obsoleto",
      sourceFilename: "doc.txt",
      docCount: 1,
      chunkCount: 1,
      sizeBytes: 10,
    });
    await resetDatabase();
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(fx.opens.length).toBe(opensBefore);
  });

  it("9. insertChunk con token de operación obsoleto (seed a mitad) → rechazado", async () => {
    await getDb();
    const opensBefore = fx.opens.length;
    // El seed capturó el epoch al inicio; el wipe avanzó el ciclo.
    const runEpoch = getDbEpoch();
    await resetDatabase();
    const stale = insertChunk(
      { chunkId: "c1", docId: "d1", title: "t", body: "b" },
      new Float32Array([0.1]),
      { lifecycleEpoch: runEpoch },
    );
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(fx.opens.length).toBe(opensBefore);
  });

  it("10. writers mixtos obsoletos → todos invalidados; writer del ciclo nuevo funciona", async () => {
    const s = await createSession("t");
    const opensBefore = fx.opens.length;
    const stales = [
      addMessage(s.id, "user", "a"),
      createSession("b"),
      recordExecution({
        modelId: "m",
        taskType: "chat",
        adaptiveRoutingUsed: false,
        reasonCodes: [],
        retrievalUsed: false,
        modelSwitches: 0,
        crossMessageModelSwitch: false,
        modelResidency: "resident",
        modelLoadMs: 0,
        ttftMs: 0,
        generationLatencyMs: 0,
        totalLatencyMs: 0,
        tokensGenerated: 0,
        tokPerSec: 0,
        peakRssBytes: 0,
        outcome: "success",
        errorMessage: undefined,
      }),
    ];
    await resetDatabase();
    for (const st of stales) {
      await expect(st).rejects.toBeInstanceOf(DbLifecycleEndedError);
    }
    await tick();
    expect(fx.opens.length).toBe(opensBefore);
    // Ciclo nuevo: el writer legítimo abre la base fresca y escribe.
    const s2 = await createSession("nueva");
    expect(s2.title).toBe("nueva");
    expect(fx.opens.length).toBe(opensBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// TOCTOU — el epoch viaja hasta la adquisición del handle
// ---------------------------------------------------------------------------
describe("TOCTOU — reset entre autorización y adquisición invalida el handle", () => {
  it("11. write autorizado pre-reset pero con apertura en curso → el handle se descarta sin usar", async () => {
    // Parte de base cerrada para que el write pase por una apertura real.
    await resetDatabase();
    const opensBefore = fx.opens.length;
    fx.armOpenHold();
    let staleRan = false;
    const stale = writeTransaction(async () => {
      staleRan = true;
    });
    await fx.openStarted(); // el write ya pasó el pre-chequeo y está en openDb
    const resetting = resetDatabase(); // bump de epoch síncrono + drenaje
    // El drenaje espera al write en vuelo: se libera la apertura para que
    // el post-chequeo la invalide de forma determinista.
    fx.releaseOpenHold();
    await resetting;
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    expect(staleRan).toBe(false); // el trabajo nunca corrió sobre ese handle
    // La apertura pausada SÍ ocurrió (el driver la completó), pero el
    // handle se descartó: ningún write posterior lo reutiliza sin revalidar.
    expect(fx.opens.length).toBe(opensBefore + 1);
    expect(fx.deletedNames).toContain(KNOWLEDGE_DB_NAME);
    // Un write del ciclo nuevo no reutiliza el handle descartado.
    await writeTransaction(async () => {});
    expect(fx.opens.length).toBe(opensBefore + 2);
  });

  it("12. memoria: mismo TOCTOU en writeMemoryTransaction", async () => {
    await getMemoryDb();
    const opensBefore = fx.opens.length;
    const stale = saveFact({ content: "k: v-obsoleta" });
    await clearMemoryDb();
    // saveFact usa el guard: falla explícito en vez de repoblar.
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(fx.opens.length).toBe(opensBefore);
  });
});

// ---------------------------------------------------------------------------
// R6 — P2P/memoria: writers guardados, transporte invalidado
// ---------------------------------------------------------------------------
describe("R6 — runtime P2P invalidado tras el wipe", () => {
  it("13. saveMessage P2P encolado → wipe de memoria → rechazado, sin recrear la DB", async () => {
    await getMemoryDb();
    const opensBefore = fx.opens.length;
    const stale = saveP2PMessage({
      id: "m1",
      dir: "in",
      peerPk: "aa".repeat(32),
      type: "chat",
      text: "hola obsoleto",
    });
    await clearMemoryDb();
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    await tick();
    expect(fx.opens.length).toBe(opensBefore);
  });

  it("14. saveContact tras el wipe funciona: el DDL se repite en el ciclo nuevo", async () => {
    await saveContact("bb".repeat(32), "Beto");
    const ddlRunsBefore = fx.execLog.filter((s) => s.includes("p2p_contacts")).length;
    expect(ddlRunsBefore).toBeGreaterThan(0);
    await clearMemoryDb();
    // Sin el fix del epoch, el flag "ya migrado" sobreviviría y la base
    // nueva quedaría sin tablas (roto hasta reiniciar).
    await saveContact("cc".repeat(32), "Ceci");
    const ddlRunsAfter = fx.execLog.filter((s) => s.includes("p2p_contacts")).length;
    expect(ddlRunsAfter).toBeGreaterThan(ddlRunsBefore);
  });

  it("15. messenger destruido: ningún método puede seguir operando", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await m.destroy();
    await expect(m.ensureIdentity()).rejects.toThrow(/invalidado por Clear All Data/);
    await expect(m.sendChat("x", "hola")).rejects.toThrow(/invalidado por Clear All Data/);
    await expect(m.contacts()).rejects.toThrow(/invalidado por Clear All Data/);
    await expect(m.handleFrame("aa".repeat(64), new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /invalidado por Clear All Data/,
    );
    // …pero stopLink sigue siendo idempotente (la UI puede llamarlo al desmontar).
    await expect(m.stopLink()).resolves.toBeUndefined();
  });

  it("16. frame entrante tras destroy se descarta: no persiste nada", async () => {
    const m = new NidoMessenger(new LoopbackTransport());
    await m.destroy();
    // El callback del transporte traga el error (fail closed): el frame se
    // pierde en vez de persistir en la base.
    await expect(m.handleFrame("aa".repeat(64), new Uint8Array([1, 2, 3]))).rejects.toThrow();
    await tick();
    expect(fx.execLog.some((s) => s.includes("INSERT INTO p2p_messages"))).toBe(false);
  });

  it("17. beginP2PDataReset bloquea el singleton; complete lo libera con instancia fresca", async () => {
    expect(isP2PDataResetInProgress()).toBe(false);
    const before = getSharedNidoMessenger();
    await beginP2PDataReset();
    expect(isP2PDataResetInProgress()).toBe(true);
    expect(() => getSharedNidoMessenger()).toThrow(/Clear All Data en curso/);
    // El messenger viejo quedó destruido: no puede seguir operando.
    await expect(before.contacts()).rejects.toThrow(/invalidado por Clear All Data/);
    completeP2PDataReset();
    expect(isP2PDataResetInProgress()).toBe(false);
    const after = getSharedNidoMessenger();
    expect(after).not.toBe(before);
    // La instancia nueva es operativa (puede generar su identidad).
    const id = await after.ensureIdentity("Test");
    expect(id.pkHex).toMatch(/^[0-9a-f]{64}$/);
    expect(await loadP2PPrivateKey()).not.toBeNull();
  });

  it("18. getIdentity tras el wipe: sin clave en Keystore no hay identidad heredada", async () => {
    // Aislamiento F-2: el handle cacheado del test anterior podría traer una
    // fila durable sin su secreto del Keystore (backend fresco por
    // beforeEach) — eso es KEY_LOSS, no el escenario de este test. Se parte
    // de base fresca, como tras un wipe real.
    await clearMemoryDb();
    const m = new NidoMessenger(new LoopbackTransport());
    await m.ensureIdentity("Test");
    expect(await getIdentity()).not.toBeNull();
    await clearMemoryDb();
    // El wipe real (appReset) borra además las claves; aquí se simula esa
    // parte para probar que la identidad no resucita de la base.
    await deleteP2PPrivateKey();
    await deleteP2PSigningKey();
    await m.destroy();
    expect(await getIdentity()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WIPE GATE — el writer del ciclo N+1 va DETRÁS del reset (barrera global)
// ---------------------------------------------------------------------------
describe("WIPE GATE — ningún trabajo atraviesa un Clear All Data en curso", () => {
  /**
   * Vacía la cola de microtareas. NO es un sleep ni evidencia de timing:
   * la no-terminación está garantizada por la puerta (promesa sin
   * resolver); el flush solo deja que el código alcance el punto de
   * espera antes de afirmar.
   */
  async function flush(turns = 20): Promise<void> {
    for (let i = 0; i < turns; i += 1) await Promise.resolve();
  }

  it("19. writer N+1 encolado durante el wipe espera detrás y aterriza en la base nueva", async () => {
    // Ciclo N con datos reales y handle conocido.
    const old = await createSession("vieja");
    const dbBefore = await getDb();

    // Pausa determinista del wipe REAL dentro del borrado de ficheros.
    fx.armDeleteHold();
    const wipeP = resetAllAppData();
    await fx.deleteStarted();
    // La puerta se instaló de forma síncrona al entrar a resetAllAppData.
    expect(getWipeGate()).not.toBeNull();

    // Writer del ciclo N+1 encolado DURANTE el wipe (el epoch ya avanzó).
    expect(getDbEpoch()).toBeGreaterThan(0);
    let writeSettled = false;
    const w = createSession("nueva").then((s) => {
      writeSettled = true;
      return s;
    });
    // La lectura tampoco atraviesa la barrera.
    let readSettled = false;
    const r = getDb().then((db) => {
      readSettled = true;
      return db;
    });
    await flush();
    expect(writeSettled).toBe(false);
    expect(readSettled).toBe(false);
    // Nada del ciclo nuevo tocó la base mientras el borrado estaba a medias.
    const opensBefore = fx.opens.length;
    fx.execLog.length = 0;

    fx.releaseDeleteHold();
    await wipeP;
    expect(getWipeGate()).toBeNull();
    const created = await w;
    const dbAfter = await r;
    expect(writeSettled).toBe(true);
    expect(readSettled).toBe(true);

    // El writer aterrizó DESPUÉS del wipe, en un handle fresco del ciclo
    // nuevo: exactamente un INSERT (el de la sesión nueva) y apertura nueva.
    const inserts = fx.execLog.filter((s) => s.includes("INSERT INTO chat_sessions"));
    expect(inserts).toHaveLength(1);
    expect(fx.opens.length).toBeGreaterThan(opensBefore);
    expect(dbAfter).not.toBe(dbBefore);
    expect(created.title).toBe("nueva");
    // Y el ciclo viejo no volvió: la base fresca no devuelve la sesión vieja.
    const ids = (await listSessions()).map((s) => s.id);
    expect(ids).not.toContain(old.id);
  });

  it("20. si el wipe falla, los trabajos en espera reciben su error (fail-closed)", async () => {
    await createSession("vieja");
    fx.deleteBehavior.set(KNOWLEDGE_DB_NAME, "unexpected");
    const wipeP = resetAllAppData();
    expect(getWipeGate()).not.toBeNull();
    // Encolado mientras la puerta está activa: no puede haber cruzado.
    const w = createSession("envenenada");
    await expect(wipeP).rejects.toThrow("EIO simulado");
    expect(getWipeGate()).toBeNull();
    // Fail-closed: el writer en espera no operó sobre restos: recibió el
    // error del wipe en vez de escribir a ciegas.
    await expect(w).rejects.toThrow("EIO simulado");
  });

  it("21. writer del ciclo ANTERIOR encolado durante el wipe falla explícito", async () => {
    await createSession("vieja");
    const oldEpoch = getDbEpoch();
    fx.armDeleteHold();
    const wipeP = resetAllAppData();
    await fx.deleteStarted();
    // Encolado durante el wipe pero con el epoch del ciclo anterior:
    // espera detrás de la puerta y luego el guard lo invalida.
    const w = writeTransaction(async () => {}, { lifecycleEpoch: oldEpoch });
    await flush();
    fx.releaseDeleteHold();
    await wipeP;
    await expect(w).rejects.toBeInstanceOf(DbLifecycleEndedError);
  });

  it("22. la barrera también frena a los writers de memoria (no cruzan el wipe)", async () => {
    fx.armDeleteHold();
    const wipeP = resetAllAppData();
    await fx.deleteStarted();
    // saveFact captura el memoryEpoch vigente al encolar (anterior al reset
    // de la base de memoria, que ocurre después en el wipe): espera detrás
    // de la puerta y luego falla explícito como obsoleto, en vez de abrir
    // la base a mitad del borrado con la DEK a punto de rotar.
    let settled = false;
    const w = saveFact({ content: "no debe cruzar" }).then(
      () => {
        settled = true;
      },
      (err) => {
        settled = true;
        throw err;
      }
    );
    await flush();
    expect(settled).toBe(false);
    fx.releaseDeleteHold();
    await wipeP;
    await expect(w).rejects.toBeInstanceOf(DbLifecycleEndedError);
    expect(settled).toBe(true);
  });
});
