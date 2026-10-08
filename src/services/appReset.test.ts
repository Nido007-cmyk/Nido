/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * appReset.test.ts — verificación del "Clear All Data" completo (TD-1).
 *
 * Estrategia: Filesystem en memoria (expo-file-system y
 * expo-file-system/legacy), expo-sqlite falso que borra del FS en memoria,
 * motores nativos simulados; el resto es código REAL: appReset,
 * rag/db.resetDatabase, memoryStore.clearMemoryDb, keyManager con backend
 * en memoria y settings.clearSettings.
 *
 * Estos tests FALLAN contra el resetAllAppData anterior al fix: aquel no
 * llamaba a clearMemoryDb() ni borraba ninguna clave del Keystore, así que
 * las aserciones de destrucción de nido_memory.db y de las claves no se
 * cumplían. El test "comportamiento anterior" lo caracteriza explícitamente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Todo lo que las factorías vi.mock necesitan vive en este bloque hoisted:
// las factorías se ejecutan antes de que exista cualquier variable de nivel
// superior del fichero, así que no pueden referenciar nada fuera de aquí.
const fsx = vi.hoisted(() => {
  const files = new Map<string, string>();
  /** Rutas que deleteAsync finge borrar pero conserva (sabotaje para el test de verificación). */
  const noDelete = new Set<string>();
  /** Si true, getInfoAsync falla: simula E/S rota para probar fail-closed. */
  let failInfo = false;
  const DOC = "file:///docs/";
  const CACHE = "file:///cache/";
  const norm = (p: string) => (p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p);
  function fsExists(path: string): boolean {
    const n = norm(path);
    if (files.has(path) || files.has(n)) return true;
    for (const f of files.keys()) if (f.startsWith(n + "/")) return true;
    return false;
  }
  async function fsDelete(path: string): Promise<void> {
    const n = norm(path);
    if (noDelete.has(n)) return; // sabotaje: resuelve sin borrar
    for (const f of [...files.keys()]) {
      if (f === path || f === n || f.startsWith(n + "/")) files.delete(f);
    }
  }
  return {
    DOC,
    CACHE,
    files,
    noDelete,
    norm,
    fsExists,
    fsDelete,
    setFailInfo: (v: boolean) => {
      failInfo = v;
    },
    fsInfo: async (path: string) => {
      if (failInfo) throw new Error("EIO simulado en getInfoAsync");
      return { exists: fsExists(path) };
    },
  };
});

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: fsx.DOC,
  cacheDirectory: fsx.CACHE,
  getInfoAsync: async (path: string) => fsx.fsInfo(path),
  deleteAsync: async (path: string) => {
    await fsx.fsDelete(path);
  },
  writeAsStringAsync: async (path: string, content: string) => {
    fsx.files.set(path, content);
  },
  readAsStringAsync: async (path: string) => {
    const c = fsx.files.get(path);
    if (c === undefined) throw new Error(`no existe: ${path}`);
    return c;
  },
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async () => [] as string[],
}));
vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async (name: string) => {
    // Sabotaje R13: finge un fallo inesperado de borrado (p. ej. E/S) para
    // simular un wipe interrumpido a mitad.
    if (dbx.failDeleteUnexpected) throw new Error("EIO simulado: fallo de borrado");
    await fsx.fsDelete(`${fsx.DOC}SQLite/${name}`);
  },
}));
// Estado hoisted para el sabotaje del borrado (las factorías vi.mock no ven
// variables normales del fichero).
const dbx = vi.hoisted(() => ({ failDeleteUnexpected: false }));
// NOTA: no se simula "expo-file-system" (sin /legacy): secureDatabase lo
// requiere perezosamente dentro de prodDriver(), y ese require tardío no
// pasa por el registro de vi.mock. En su lugar se inyecta el driver falso
// con setSecureDbTestDriver (el seam previsto para tests), que ejercita el
// código REAL de deleteManagedDatabase/removeWithSidecars.
vi.mock("../inference/LlamaEngine", () => ({ llamaEngine: { unload: async () => {} } }));
vi.mock("../rag/embed", () => ({ embeddingEngine: { unload: async () => {} } }));
vi.mock("../rag/packs", () => ({ closeAllPacks: async () => {} }));
vi.mock("./downloadManager", () => ({ resetDownloadState: () => {}, cancelAllDownloads: async () => {} }));
// R6/R13: se usa el nidoMessenger REAL (sin mocks): begin/completeP2PDataReset
// son JS puro y el transporte por defecto en tests es el stub que falla
// explícito; destroy() lo tolera (best-effort). Así se prueba el bloqueo
// del singleton de verdad.
// Módulo de notificaciones del SO: lista programada y lista presentada (bandeja)
// en memoria, como estados SEPARADOS. N1 nació de la ceguera del mock (y
// del wipe): el mock solo modelaba programadas. El wipe real cancela las
// programadas vía cancelAllScheduledNotificationsAsync y despide las
// presentadas vía dismissAllNotificationsAsync; los flags de sabotaje
// permiten caracterizar los fallos de cada clase por separado.
const notifx = vi.hoisted(() => {
  return {
    scheduled: new Set<string>(),
    presented: new Set<string>(),
    sabotageCancel: false,
    sabotageDismiss: false,
    /** Presentadas que el SO no pudo despedir: dismiss resuelve pero quedan. */
    stuckPresented: new Set<string>(),
    /** Si true, getPresentedNotificationsAsync lanza: estado no verificable. */
    failPresentedInfo: false,
  };
});
vi.mock("expo-notifications", () => ({
  cancelAllScheduledNotificationsAsync: async () => {
    if (!notifx.sabotageCancel) notifx.scheduled.clear();
  },
  getAllScheduledNotificationsAsync: async () =>
    [...notifx.scheduled].map((identifier) => ({ identifier })),
  dismissAllNotificationsAsync: async () => {
    if (!notifx.sabotageDismiss) {
      // Las "stuck" simulan una notificación que el SO no pudo despedir:
      // el dismiss resuelve pero la bandeja la sigue mostrando.
      notifx.presented = new Set(
        [...notifx.presented].filter((id) => notifx.stuckPresented.has(id)),
      );
    }
  },
  getPresentedNotificationsAsync: async () => {
    if (notifx.failPresentedInfo)
      throw new Error("EIO simulado en getPresentedNotificationsAsync");
    return [...notifx.presented].map((identifier) => ({ identifier }));
  },
}));

import { resetAllAppData, WipeVerificationError, wipeInterrupted, recoverInterruptedWipe } from "./appReset";
import { installStatePath } from "../models/installState";
import {
  completeP2PDataReset,
  getSharedNidoMessenger,
  isP2PDataResetInProgress,
} from "./nidoMessenger";
import { resetDatabase } from "../rag/db";
import { clearSettings } from "../models/settings";
import { setSecureDbTestDriver } from "../security/secureDatabase";
import {
  createMemorySecureBackend,
  deleteDatabaseKey,
  getDatabaseKeyHex,
  loadP2PPrivateKey,
  loadP2PSigningKey,
  peekDatabaseKey,
  setTestRandomBytes,
  setTestSecureBackend,
  storeP2PPrivateKey,
  storeP2PSigningKey,
} from "../privacy/keyManager";

const { DOC, CACHE, norm, fsExists } = fsx;
const DB_SUFFIXES = ["", "-wal", "-shm", "-journal", ".migtmp", ".sqlcipher"];

/** Siembra un "dispositivo" completo: bases, sidecars, ajustes, modelos, corpus, eval y caché. */
function seedFullDevice(): void {
  // Se siembran ambos nombres de la base de conocimiento: el actual y el
  // heredado pre-rebrand (por si la migración de fichero nunca se ejecutó).
  for (const db of ["nido_knowledge.db", "aoair_knowledge.db", "nido_memory.db"]) {
    for (const s of DB_SUFFIXES) fsx.files.set(`${DOC}SQLite/${db}${s}`, "datos");
  }
  fsx.files.set(`${DOC}settings.json`, "{}");
  fsx.files.set(`${DOC}models/llm.gguf`, "modelo");
  fsx.files.set(`${DOC}models/embedding.gguf`, "modelo");
  fsx.files.set(`${DOC}corpus/pack.sqlite`, "corpus");
  fsx.files.set(`${DOC}eval/run-1.jsonl`, "eval");
  fsx.files.set(`${CACHE}export.json`, "temporal");
}

/** Crea las tres claves del Keystore como lo haría la app en uso real. */
async function seedKeys(): Promise<void> {
  await getDatabaseKeyHex(); // genera y guarda nido_db_key
  await storeP2PPrivateKey("ab".repeat(32)); // nido_p2p_sk
  await storeP2PSigningKey("cd".repeat(32)); // nido_p2p_sign_sk
}

beforeEach(() => {
  fsx.files.clear();
  fsx.noDelete.clear();
  fsx.setFailInfo(false);
  notifx.scheduled.clear();
  notifx.presented.clear();
  notifx.stuckPresented.clear();
  notifx.sabotageCancel = false;
  notifx.sabotageDismiss = false;
  notifx.failPresentedInfo = false;
  dbx.failDeleteUnexpected = false;
  // R6: ningún test debe heredar el bloqueo P2P de un wipe fallido anterior.
  completeP2PDataReset();
  setTestSecureBackend(createMemorySecureBackend());
  // Driver falso para secureDatabase.deleteManagedDatabase: código real de
  // borrado (principal + sidecars + temporal + marcador) sobre el FS en memoria.
  setSecureDbTestDriver({
    dbDir: () => `${DOC}SQLite/`,
    openDb: async () => {
      throw new Error("el wipe no debe abrir bases de datos");
    },
    exists: async (path: string) => fsx.fsExists(path),
    remove: async (path: string) => {
      await fsx.fsDelete(path);
    },
    rename: async () => {
      throw new Error("el wipe no debe renombrar ficheros");
    },
    writeFile: async (path: string, content: string) => {
      fsx.files.set(path, content);
    },
  });
  let n = 0;
  setTestRandomBytes(async (len: number) => {
    n += 1;
    const b = new Uint8Array(len);
    b[0] = n;
    b[1] = 0xab;
    return b;
  });
});

afterEach(() => {
  setSecureDbTestDriver(null);
});

describe("resetAllAppData (Clear All Data)", () => {
  it("destruye las dos bases con sidecars y marcadores", async () => {
    await seedKeys();
    seedFullDevice();
    await resetAllAppData();
    // El wipe debe eliminar también el fichero heredado pre-rebrand aunque
    // la migración nunca se ejecutara.
    for (const db of ["nido_knowledge.db", "aoair_knowledge.db", "nido_memory.db"]) {
      for (const s of DB_SUFFIXES) {
        expect(fsExists(`${DOC}SQLite/${db}${s}`), `${db}${s} debe haber desaparecido`).toBe(false);
      }
    }
  });

  it("destruye ajustes, modelos, corpus, eval y caché", async () => {
    await seedKeys();
    seedFullDevice();
    await resetAllAppData();
    for (const p of [
      `${DOC}settings.json`,
      `${DOC}models`,
      `${DOC}corpus`,
      `${DOC}eval`,
      CACHE,
    ]) {
      expect(fsExists(p), `${p} debe haber desaparecido`).toBe(false);
    }
  });

  it("destruye las tres claves del Keystore (DEK + identidad P2P)", async () => {
    await seedKeys();
    seedFullDevice();
    expect(await peekDatabaseKey()).not.toBeNull();
    expect(await loadP2PPrivateKey()).not.toBeNull();
    expect(await loadP2PSigningKey()).not.toBeNull();
    await resetAllAppData();
    expect(await peekDatabaseKey()).toBeNull();
    expect(await loadP2PPrivateKey()).toBeNull();
    expect(await loadP2PSigningKey()).toBeNull();
  });

  it("rota la DEK: tras el borrado se genera una clave nueva, no se reutiliza la vieja", async () => {
    const k1 = await getDatabaseKeyHex();
    await resetAllAppData();
    expect(await peekDatabaseKey()).toBeNull();
    const k2 = await getDatabaseKeyHex();
    expect(k2).toMatch(/^[0-9a-f]{64}$/);
    expect(k2).not.toBe(k1);
  });

  it("no falla en un dispositivo ya vacío", async () => {
    await expect(resetAllAppData()).resolves.toBeUndefined();
  });

  it("falla en voz alta si algo sobrevive: WipeVerificationError lista los supervivientes", async () => {
    await seedKeys();
    seedFullDevice();
    // Sabotaje: el borrado de settings.json "tiene éxito" pero el fichero sigue ahí.
    fsx.noDelete.add(norm(`${DOC}settings.json`));
    let err: unknown;
    try {
      await resetAllAppData();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WipeVerificationError);
    const survivors = (err as WipeVerificationError).survivors;
    expect(survivors.some((s) => s.includes("settings.json"))).toBe(true);
    // …y el mensaje no es silencioso: nombra al superviviente.
    expect((err as Error).message).toMatch(/settings\.json/);
  });

  it("cancela las notificaciones programadas del SO (no sobreviven al wipe)", async () => {
    seedFullDevice();
    notifx.scheduled.add("nido-reminder-1");
    notifx.scheduled.add("nido-daily-briefing");
    await expect(resetAllAppData()).resolves.toBeUndefined();
    expect(notifx.scheduled.size).toBe(0);
  });

  it("falla en voz alta si las notificaciones no se pudieron cancelar", async () => {
    seedFullDevice();
    notifx.scheduled.add("nido-reminder-1");
    notifx.sabotageCancel = true; // la cancelación "tiene éxito" pero no borra
    let err: unknown;
    try {
      await resetAllAppData();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WipeVerificationError);
    expect(
      (err as WipeVerificationError).survivors.some((s) => s.includes("notificaciones")),
    ).toBe(true);
  });

  it("el comportamiento ANTERIOR dejaba la base de memoria y las claves (caracterización del bug TD-1)", async () => {
    // Secuencia que ejecutaba el resetAllAppData previo al fix: borraba la
    // base de conocimiento, modelos, corpus y ajustes, pero NI la base de
    // memoria NI ninguna clave del Keystore.
    await seedKeys();
    seedFullDevice();
    await resetDatabase();
    await fsx.fsDelete(`${DOC}models`);
    await fsx.fsDelete(`${DOC}corpus`);
    await clearSettings();

    // …y por eso la memoria del agente y la identidad P2P sobrevivían:
    expect(fsExists(`${DOC}SQLite/nido_memory.db`)).toBe(true);
    expect(fsExists(`${DOC}SQLite/nido_memory.db.sqlcipher`)).toBe(true);
    expect(await peekDatabaseKey()).not.toBeNull();
    expect(await loadP2PPrivateKey()).not.toBeNull();
    expect(await loadP2PSigningKey()).not.toBeNull();
  });
});

describe("W-F1 — el journal de instalación no sobrevive al Clear All Data", () => {
  it("journal presente → borrado y verificado ausente: el wipe declara éxito", async () => {
    await seedKeys();
    seedFullDevice();
    fsx.files.set(installStatePath(), JSON.stringify({ version: 1, records: {} }));
    // Con el path canónico: si la ruta cambiara en installState.ts, este
    // test seguiría al wipe real en vez de seguir a un literal obsoleto.
    expect(installStatePath()).toBe(`${DOC}nido-install-state.json`);
    await expect(resetAllAppData()).resolves.toBeUndefined();
    expect(fsExists(installStatePath()), "el journal debe haber desaparecido").toBe(false);
  });

  it("journal ausente → el wipe sigue declarando éxito (sin regresión)", async () => {
    await seedKeys();
    seedFullDevice();
    expect(fsExists(installStatePath())).toBe(false);
    await expect(resetAllAppData()).resolves.toBeUndefined();
  });

  it("fallo de borrado del journal → el wipe NO declara éxito (fail-closed)", async () => {
    await seedKeys();
    seedFullDevice();
    fsx.files.set(installStatePath(), JSON.stringify({ version: 1, records: {} }));
    // Sabotaje: el borrado "tiene éxito" pero el fichero sigue ahí.
    fsx.noDelete.add(norm(installStatePath()));
    let err: unknown;
    try {
      await resetAllAppData();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WipeVerificationError);
    const survivors = (err as WipeVerificationError).survivors;
    expect(survivors.some((s) => s.includes("nido-install-state.json"))).toBe(true);
    // Fail-closed: el marcador queda y el runtime P2P sigue bloqueado; el
    // próximo arranque reanuda con recoverInterruptedWipe().
    expect(await wipeInterrupted()).toBe(true);
    expect(isP2PDataResetInProgress()).toBe(true);
    expect(() => getSharedNidoMessenger()).toThrow(/Clear All Data en curso/);

    // Sin sabotaje, la recuperación completa y el journal desaparece.
    fsx.noDelete.clear();
    await expect(recoverInterruptedWipe()).resolves.toBeUndefined();
    expect(fsExists(installStatePath())).toBe(false);
    expect(await wipeInterrupted()).toBe(false);
  });

  it("checkGone no verificable para el journal → fallo honesto, nunca éxito", async () => {
    await seedKeys();
    seedFullDevice();
    fsx.files.set(installStatePath(), JSON.stringify({ version: 1, records: {} }));
    fsx.setFailInfo(true); // getInfoAsync falla: nada es verificable
    let err: unknown;
    try {
      await resetAllAppData();
    } catch (e) {
      err = e;
    }
    fsx.setFailInfo(false);
    expect(err).toBeInstanceOf(WipeVerificationError);
    expect(
      (err as WipeVerificationError).survivors.some((s) => s.includes("nido-install-state.json")),
    ).toBe(true);
  });

  it("con journal sembrado, el resto del inventario sigue borrándose igual", async () => {
    await seedKeys();
    seedFullDevice();
    fsx.files.set(installStatePath(), JSON.stringify({ version: 1, records: {} }));
    await resetAllAppData();
    // Bases + sidecars, ajustes, modelos, corpus, eval, caché y claves: sin cambios.
    for (const db of ["nido_knowledge.db", "aoair_knowledge.db", "nido_memory.db"]) {
      for (const s of DB_SUFFIXES) {
        expect(fsExists(`${DOC}SQLite/${db}${s}`), `${db}${s} debe haber desaparecido`).toBe(false);
      }
    }
    for (const p of [`${DOC}settings.json`, `${DOC}models`, `${DOC}corpus`, `${DOC}eval`, CACHE]) {
      expect(fsExists(p), `${p} debe haber desaparecido`).toBe(false);
    }
    expect(fsExists(installStatePath())).toBe(false);
    expect(await peekDatabaseKey()).toBeNull();
    expect(await loadP2PPrivateKey()).toBeNull();
    expect(await loadP2PSigningKey()).toBeNull();
  });
});

describe("N1 — las notificaciones ya entregadas no sobreviven al Clear All Data", () => {
  it("solo programadas → el wipe cancela y declara éxito", async () => {
    seedFullDevice();
    notifx.scheduled.add("nido-reminder-1");
    notifx.scheduled.add("nido-daily-briefing");
    await expect(resetAllAppData()).resolves.toBeUndefined();
    expect(notifx.scheduled.size).toBe(0);
    expect(notifx.presented.size).toBe(0);
  });

  it("solo presentadas (bandeja) → el wipe las despide y declara éxito", async () => {
    seedFullDevice();
    notifx.presented.add("nido-reminder-1");
    notifx.presented.add("nido-daily-briefing");
    await expect(resetAllAppData()).resolves.toBeUndefined();
    expect(notifx.presented.size, "la bandeja debe quedar vacía").toBe(0);
  });

  it("programadas + presentadas → ambas desaparecen y el wipe declara éxito", async () => {
    seedFullDevice();
    notifx.scheduled.add("nido-reminder-1");
    notifx.presented.add("nido-daily-briefing");
    await expect(resetAllAppData()).resolves.toBeUndefined();
    expect(notifx.scheduled.size).toBe(0);
    expect(notifx.presented.size).toBe(0);
  });

  it("sin notificaciones → el wipe sigue declarando éxito (idempotente, sin regresión)", async () => {
    seedFullDevice();
    await expect(resetAllAppData()).resolves.toBeUndefined();
    await expect(resetAllAppData()).resolves.toBeUndefined();
  });

  it("falla en voz alta si el dismiss no despidió las presentadas", async () => {
    seedFullDevice();
    notifx.presented.add("nido-reminder-1");
    notifx.sabotageDismiss = true; // el dismiss "tiene éxito" pero no despide
    let err: unknown;
    try {
      await resetAllAppData();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WipeVerificationError);
    const survivors = (err as WipeVerificationError).survivors;
    expect(survivors.some((s) => s.includes("presentadas"))).toBe(true);
  });

  it("falla en voz alta si la verificación aún encuentra una notificación en la bandeja", async () => {
    seedFullDevice();
    notifx.presented.add("nido-reminder-1");
    // El dismiss resuelve pero la notificación queda pegada en el SO: la
    // verificación debe atraparla, no fiarse del dismiss.
    notifx.stuckPresented.add("nido-reminder-1");
    let err: unknown;
    try {
      await resetAllAppData();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WipeVerificationError);
    expect(
      (err as WipeVerificationError).survivors.some((s) => s.includes("presentadas")),
    ).toBe(true);
  });

  it("estado de bandeja no verificable → fallo honesto, nunca éxito silencioso", async () => {
    seedFullDevice();
    notifx.presented.add("nido-reminder-1");
    notifx.failPresentedInfo = true; // getPresentedNotificationsAsync lanza
    let err: unknown;
    try {
      await resetAllAppData();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WipeVerificationError);
    expect(
      (err as WipeVerificationError).survivors.some((s) => s.includes("presentadas")),
    ).toBe(true);
  });

  it("interrupción con bandeja presente → recoverInterruptedWipe() despide y completa", async () => {
    seedFullDevice();
    notifx.presented.add("nido-reminder-1");
    notifx.sabotageDismiss = true;
    await expect(resetAllAppData()).rejects.toBeInstanceOf(WipeVerificationError);
    // Fail-closed: marcador presente; la bandeja sigue sucia.
    expect(await wipeInterrupted()).toBe(true);
    expect(notifx.presented.size).toBe(1);

    // Sin sabotaje, la recuperación despide la bandeja y declara éxito.
    notifx.sabotageDismiss = false;
    await expect(recoverInterruptedWipe()).resolves.toBeUndefined();
    expect(notifx.presented.size).toBe(0);
    expect(await wipeInterrupted()).toBe(false);
  });

  it("ejecución repetida es idempotente: bandeja ya vacía → éxito, sin efectos", async () => {
    seedFullDevice();
    notifx.presented.add("nido-reminder-1");
    await expect(resetAllAppData()).resolves.toBeUndefined();
    expect(notifx.presented.size).toBe(0);
    // Segunda pasada con todo ya limpio: éxito y sin cambios.
    await expect(resetAllAppData()).resolves.toBeUndefined();
    await expect(recoverInterruptedWipe()).resolves.toBeUndefined();
    expect(await wipeInterrupted()).toBe(false);
  });

  it("el comportamiento ANTERIOR dejaba las presentadas en la bandeja (caracterización del bug N1)", async () => {
    // Secuencia que ejecutaba el resetAllAppData previo al fix: cancelaba
    // las programadas pero jamás despedía las ya entregadas.
    notifx.scheduled.add("nido-reminder-1");
    notifx.presented.add("nido-daily-briefing");
    await (await import("expo-notifications")).cancelAllScheduledNotificationsAsync();
    // …y por eso la bandeja del SO seguía mostrando el contenido sensible
    // después del wipe:
    expect(notifx.scheduled.size).toBe(0);
    expect(notifx.presented.size).toBe(1);
  });
});

describe("keyManager: borrado de la DEK", () => {
  it("deleteDatabaseKey elimina nido_db_key y peekDatabaseKey no la regenera", async () => {
    const k1 = await getDatabaseKeyHex();
    expect(await peekDatabaseKey()).toBe(k1);
    await deleteDatabaseKey();
    expect(await peekDatabaseKey()).toBeNull();
    // peek es no generador: sigue en null hasta que algo pida la clave de verdad.
    expect(await peekDatabaseKey()).toBeNull();
  });
});

describe("R13 — wipe interrumpido / recuperación", () => {
  it("el marcador se escribe antes de la primera operación destructiva y se retira tras el éxito", async () => {
    await seedKeys();
    seedFullDevice();
    expect(await wipeInterrupted()).toBe(false);
    // Sabotaje: el borrado de la base falla de forma inesperada a mitad del
    // wipe (simula el kill-mid-wipe: el proceso "muere" aquí).
    dbx.failDeleteUnexpected = true;
    await expect(resetAllAppData()).rejects.toThrow("EIO simulado");
    // El marcador sobrevivió: el próximo arranque sabe que hubo un wipe.
    expect(await wipeInterrupted()).toBe(true);
    // …y el runtime P2P quedó bloqueado (fail closed): ningún messenger
    // nuevo puede nacer a mitad del wipe.
    expect(isP2PDataResetInProgress()).toBe(true);
    expect(() => getSharedNidoMessenger()).toThrow(/Clear All Data en curso/);

    // Recuperación: sin sabotaje, el wipe reanuda idempotentemente y
    // termina verificado.
    dbx.failDeleteUnexpected = false;
    await recoverInterruptedWipe();
    expect(await wipeInterrupted()).toBe(false);
    expect(isP2PDataResetInProgress()).toBe(false);
    // El dispositivo quedó limpio de verdad (nada a medias).
    for (const db of ["nido_knowledge.db", "aoair_knowledge.db", "nido_memory.db"]) {
      for (const s of DB_SUFFIXES) {
        expect(fsExists(`${DOC}SQLite/${db}${s}`), `${db}${s} debe haber desaparecido`).toBe(false);
      }
    }
    expect(await peekDatabaseKey()).toBeNull();
    expect(await loadP2PPrivateKey()).toBeNull();
    expect(await loadP2PSigningKey()).toBeNull();
  });

  it("la recuperación es idempotente: reejecutar el wipe completo no falla", async () => {
    await seedKeys();
    seedFullDevice();
    await resetAllAppData();
    expect(await wipeInterrupted()).toBe(false);
    await expect(recoverInterruptedWipe()).resolves.toBeUndefined();
    expect(await wipeInterrupted()).toBe(false);
  });

  it("tras una recuperación exitosa nace un messenger fresco del ciclo nuevo", async () => {
    await seedKeys();
    seedFullDevice();
    dbx.failDeleteUnexpected = true;
    await expect(resetAllAppData()).rejects.toThrow("EIO simulado");
    dbx.failDeleteUnexpected = false;
    await recoverInterruptedWipe();
    // El singleton bloqueado se libera y la instancia nueva es operativa
    // (aquí basta con que se pueda crear: la identidad se genera bajo demanda).
    const m = getSharedNidoMessenger();
    expect(m).toBe(getSharedNidoMessenger()); // mismo singleton del ciclo nuevo
    expect(isP2PDataResetInProgress()).toBe(false);
  });

  it("si la recuperación vuelve a fallar, el marcador queda y la app sigue en fail-closed", async () => {
    seedFullDevice();
    dbx.failDeleteUnexpected = true;
    await expect(resetAllAppData()).rejects.toThrow("EIO simulado");
    // La recuperación también falla: ni marcador retirado ni P2P desbloqueado.
    await expect(recoverInterruptedWipe()).rejects.toThrow("EIO simulado");
    expect(await wipeInterrupted()).toBe(true);
    expect(isP2PDataResetInProgress()).toBe(true);
    expect(() => getSharedNidoMessenger()).toThrow(/Clear All Data en curso/);
  });

  it("wipeInterrupted es fail-closed: si el marcador no se puede comprobar, no se asume limpio", async () => {
    seedFullDevice();
    // Sin marcador y con E/S sana: no interrumpido.
    expect(await wipeInterrupted()).toBe(false);
    // Con E/S rota: propaga el error en vez de devolver false. El arranque
    // debe mostrar bloqueo, nunca la UI normal con un wipe quizá a medias.
    fsx.setFailInfo(true);
    await expect(wipeInterrupted()).rejects.toThrow("EIO simulado");
    fsx.setFailInfo(false);
    expect(await wipeInterrupted()).toBe(false);
  });

  it("si el marcador no se puede retirar, el wipe falla honesto y el P2P sigue bloqueado", async () => {
    await seedKeys();
    seedFullDevice();
    // Sabotaje: el borrado del marcador finge éxito pero lo conserva.
    fsx.noDelete.add(fsx.norm(`${DOC}.nido-wipe-in-progress`));
    await expect(resetAllAppData()).rejects.toThrow(WipeVerificationError);
    // Fail-closed: marcador presente y runtime P2P bloqueado. La próxima
    // recuperación reintentará retirar el marcador.
    expect(await wipeInterrupted()).toBe(true);
    expect(isP2PDataResetInProgress()).toBe(true);
    expect(() => getSharedNidoMessenger()).toThrow(/Clear All Data en curso/);
    // Sin sabotaje, la recuperación completa y desbloquea.
    fsx.noDelete.clear();
    await recoverInterruptedWipe();
    expect(await wipeInterrupted()).toBe(false);
    expect(isP2PDataResetInProgress()).toBe(false);
  });
});
