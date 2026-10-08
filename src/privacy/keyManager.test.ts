/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyDatabaseKey,
  createMemorySecureBackend,
  deleteDatabaseKey,
  deleteP2PPrivateKey,
  getDatabaseKeyHex,
  loadP2PPrivateKey,
  loadP2PSigningKey,
  peekDatabaseKey,
  SecureStoreReadError,
  setTestRandomBytes,
  setTestSecureBackend,
  storeP2PPrivateKey,
  type SecureBackend,
} from "./keyManager";

/** Backend que falla `failReads` lecturas (transitorio) y luego se recupera. */
function makeFlakyBackend(seed: Record<string, string> = {}, failReads = 0) {
  const map = new Map(Object.entries(seed));
  let remaining = failReads;
  const backend: SecureBackend = {
    getItemAsync: async (k: string) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error("boom: fallo transitorio del SecureStore");
      }
      return map.has(k) ? map.get(k)! : null;
    },
    setItemAsync: async (k: string, v: string) => {
      map.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      map.delete(k);
    },
  };
  return { backend, map };
}

beforeEach(() => {
  setTestSecureBackend(createMemorySecureBackend());
  // Bytes deterministas pero únicos por llamada (contador en el primer byte).
  let n = 0;
  setTestRandomBytes(async (len: number) => {
    n += 1;
    const b = new Uint8Array(len);
    b[0] = n;
    b[1] = 0xab;
    return b;
  });
});

describe("keyManager", () => {
  it("genera la clave de base una vez y la reutiliza", async () => {
    const k1 = await getDatabaseKeyHex();
    const k2 = await getDatabaseKeyHex();
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(k2).toBe(k1);
  });

  it("M-1: un valor guardado corrupto NO se sobrescribe (fail-closed)", async () => {
    const { backend, map } = makeFlakyBackend({ nido_db_key: "basura" });
    setTestSecureBackend(backend);
    const err = await getDatabaseKeyHex().catch((e) => e);
    expect(err).toBeInstanceOf(SecureStoreReadError);
    expect(String(err.message)).toMatch(/fail-closed/i);
    // El material existente sigue intacto: nada se regeneró ni sobrescribió.
    expect(map.get("nido_db_key")).toBe("basura");
  });

  it("M-1: un fallo transitorio de lectura NO regenera la DEK (fail-closed)", async () => {
    const DEK = "aa".repeat(32);
    const { backend, map } = makeFlakyBackend({ nido_db_key: DEK }, 1);
    setTestSecureBackend(backend);
    // La lectura falla → error explícito, no una clave nueva.
    const err = await getDatabaseKeyHex().catch((e) => e);
    expect(err).toBeInstanceOf(SecureStoreReadError);
    expect((err as SecureStoreReadError).alias).toBe("nido_db_key");
    expect(String(err.message)).toMatch(/fail-closed/i);
    // Nada se escribió: la clave real sigue intacta.
    expect(map.get("nido_db_key")).toBe(DEK);
    // Tras recuperarse el store, se devuelve la clave ORIGINAL.
    expect(await getDatabaseKeyHex()).toBe(DEK);
    expect(map.get("nido_db_key")).toBe(DEK);
  });

  it("M-1: dos resoluciones concurrentes en primera vez comparten una sola clave", async () => {
    const { backend, map } = makeFlakyBackend();
    setTestSecureBackend(backend);
    const [k1, k2] = await Promise.all([getDatabaseKeyHex(), getDatabaseKeyHex()]);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(k2).toBe(k1);
    expect(map.get("nido_db_key")).toBe(k1);
  });

  it("M-2: un fallo transitorio de lectura NO reemplaza la clave privada P2P", async () => {
    const SK = "bb".repeat(32);
    const { backend, map } = makeFlakyBackend({ nido_p2p_sk: SK }, 1);
    setTestSecureBackend(backend);
    const err = await loadP2PPrivateKey().catch((e) => e);
    expect(err).toBeInstanceOf(SecureStoreReadError);
    expect((err as SecureStoreReadError).alias).toBe("nido_p2p_sk");
    expect(String(err.message)).toMatch(/fail-closed/i);
    expect(map.get("nido_p2p_sk")).toBe(SK);
    expect(await loadP2PPrivateKey()).toBe(SK);
  });

  it("M-2: un fallo transitorio de lectura NO reemplaza la clave de firma P2P", async () => {
    const SSK = "cc".repeat(32);
    const { backend, map } = makeFlakyBackend({ nido_p2p_sign_sk: SSK }, 1);
    setTestSecureBackend(backend);
    const err = await loadP2PSigningKey().catch((e) => e);
    expect(err).toBeInstanceOf(SecureStoreReadError);
    expect((err as SecureStoreReadError).alias).toBe("nido_p2p_sign_sk");
    expect(String(err.message)).toMatch(/fail-closed/i);
    expect(map.get("nido_p2p_sign_sk")).toBe(SSK);
    expect(await loadP2PSigningKey()).toBe(SSK);
  });

  it("M-2: una clave P2P corrupta NO se sobrescribe en silencio (fail-closed)", async () => {
    const { backend, map } = makeFlakyBackend({ nido_p2p_sk: "no-hex" });
    setTestSecureBackend(backend);
    await expect(loadP2PPrivateKey()).rejects.toThrow(SecureStoreReadError);
    expect(map.get("nido_p2p_sk")).toBe("no-hex");
  });

  it("peekDatabaseKey: un fallo de lectura lanza (no finge ausencia)", async () => {
    const DEK = "dd".repeat(32);
    const { backend } = makeFlakyBackend({ nido_db_key: DEK }, 1);
    setTestSecureBackend(backend);
    // La verificación de borrado no puede declarar "no existe" si la
    // lectura falló: debe lanzar en vez de devolver null.
    await expect(peekDatabaseKey()).rejects.toThrow(SecureStoreReadError);
    expect(await peekDatabaseKey()).toBe(DEK);
  });

  it("clave privada P2P: guarda y lee", async () => {
    const sk = "ab".repeat(32);
    await storeP2PPrivateKey(sk);
    expect(await loadP2PPrivateKey()).toBe(sk);
  });

  it("rechaza sk inválida", async () => {
    await expect(storeP2PPrivateKey("corta")).rejects.toThrow();
    await expect(storeP2PPrivateKey("zz".repeat(32))).rejects.toThrow();
  });

  it("borrar la sk la deja en null", async () => {
    await storeP2PPrivateKey("cd".repeat(32));
    await deleteP2PPrivateKey();
    expect(await loadP2PPrivateKey()).toBeNull();
  });

  it("peekDatabaseKey: lee sin generar", async () => {
    expect(await peekDatabaseKey()).toBeNull(); // nada guardado → null, sin generar
    const k = await getDatabaseKeyHex();
    expect(await peekDatabaseKey()).toBe(k); // ahora sí existe
  });

  it("deleteDatabaseKey: borra la DEK y no la regenera sola", async () => {
    const k1 = await getDatabaseKeyHex();
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    await deleteDatabaseKey();
    expect(await peekDatabaseKey()).toBeNull();
    // La próxima petición genera una clave NUEVA (rotación tras Clear All Data).
    const k2 = await getDatabaseKeyHex();
    expect(k2).toMatch(/^[0-9a-f]{64}$/);
    expect(k2).not.toBe(k1);
  });

  it("sin backend y sin __DEV__ → fail-closed", async () => {
    setTestSecureBackend(null);
    await expect(getDatabaseKeyHex()).rejects.toThrow("fail-closed");
  });

  it("applyDatabaseKey: sin cipher disponible → lanza y cierra", async () => {
    let closed = false;
    const db = {
      execAsync: async () => undefined,
      getAllAsync: async () => [] as Array<{ cipher_version: string }>,
      getFirstAsync: async () => {
        throw new Error("no debe llegar a verificar la clave");
      },
      closeAsync: async () => {
        closed = true;
      },
    };
    await expect(applyDatabaseKey(db, "aa".repeat(32), "test")).rejects.toThrow(
      "fail-closed",
    );
    expect(closed).toBe(true);
  });

  it("applyDatabaseKey: con cipher → aplica la clave y verifica lectura", async () => {
    const seen: string[] = [];
    let verified = false;
    const db = {
      execAsync: async (sql: string) => {
        seen.push(sql);
      },
      getAllAsync: async () => [{ cipher_version: "4.5.0" }],
      getFirstAsync: async (sql: string) => {
        expect(sql).toMatch(/sqlite_master/);
        verified = true;
        return { n: 3 };
      },
      closeAsync: async () => undefined,
    };
    await applyDatabaseKey(db, "bb".repeat(32), "test");
    expect(seen.some((s) => s.includes(`PRAGMA key = "x'${"bb".repeat(32)}'"`))).toBe(true);
    expect(verified).toBe(true);
  });

  it("applyDatabaseKey: clave incorrecta o base corrupta → fail-closed y cierra", async () => {
    let closed = false;
    const db = {
      execAsync: async () => undefined,
      getAllAsync: async () => [{ cipher_version: "4.5.0" }],
      getFirstAsync: async () => {
        throw new Error("file is not a database");
      },
      closeAsync: async () => {
        closed = true;
      },
    };
    await expect(applyDatabaseKey(db, "cc".repeat(32), "test")).rejects.toThrow(
      /no se pudo descifra/i,
    );
    expect(closed).toBe(true);
  });

  it("applyDatabaseKey: formato de clave inválido → fail-closed sin tocar la base", async () => {
    const db = {
      execAsync: async () => {
        throw new Error("no debe ejecutar PRAGMA");
      },
      getAllAsync: async () => [{ cipher_version: "4.5.0" }],
      getFirstAsync: async () => ({ n: 1 }),
      closeAsync: async () => undefined,
    };
    await expect(applyDatabaseKey(db, "clave-corta", "test")).rejects.toThrow(
      /formato de clave inválido/,
    );
  });

  it("applyDatabaseKey: sin clave → no hace nada (dev)", async () => {
    const seen: string[] = [];
    const db = {
      execAsync: async (sql: string) => {
        seen.push(sql);
      },
      getAllAsync: async () => [],
      getFirstAsync: async () => {
        throw new Error("no debe verificarse sin clave");
      },
      closeAsync: async () => undefined,
    };
    await applyDatabaseKey(db, null, "test");
    expect(seen).toHaveLength(0);
  });
});
