/**
 * keyLoss.test.ts — NIDO: N4 — pérdida del Keystore / recovery honesto.
 *
 * REGLA CENTRAL: si existen bases cifradas y la DEK esperada falta o es
 * inválida, NIDO JAMÁS genera una DEK nueva en silencio ni continúa como si
 * fuera first-run. La ruta de arranque debe distinguir:
 *   (a) instalación genuinamente nueva — sin bases, sin clave → first-run normal;
 *   (b) pérdida/inconsistencia — bases presentes, clave ausente → estado de
 *       RECOVERY explícito, verificable y visible para el usuario.
 *
 * Estos tests se escribieron ANTES del fix: contra el código pre-N4,
 * "DBs exist + key missing" generaba una DEK fresca en silencio (reproducción
 * del hallazgo del audit). Tras el fix deben pasar todos.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMemorySecureBackend,
  getDatabaseKeyHex,
  KeyLossError,
  SecureStoreReadError,
  setTestRandomBytes,
  setTestSecureBackend,
  type SecureBackend,
} from "./keyManager";
// Importar secureDatabase registra la sonda de pérdida de clave (probe) en
// keyManager: es la ruta real por la que producción la registra (memoryStore
// y rag/db importan secureDatabase antes de resolver la DEK).
import {
  ensureEncryptedDatabase,
  recoverFromKeyLoss,
  setSecureDbTestDriver,
  type SecureDbDriver,
  type SecureDbHandle,
} from "../security/secureDatabase";

const DEK = "aa".repeat(32);

/** Driver falso mínimo: solo necesita existir/directorio/rename para N4. */
class MiniDriver implements SecureDbDriver {
  paths = new Set<string>();
  failExists = false;
  dir = "/fake";

  dbDir(): string {
    return this.dir + "/";
  }
  async exists(path: string): Promise<boolean> {
    if (this.failExists) throw new Error("fs: fallo de lectura");
    return this.paths.has(path);
  }
  async remove(path: string): Promise<void> {
    this.paths.delete(path);
  }
  async rename(from: string, to: string): Promise<void> {
    if (!this.paths.has(from)) throw new Error(`no existe: ${from}`);
    this.paths.delete(from);
    this.paths.add(to);
  }
  async writeFile(path: string): Promise<void> {
    this.paths.add(path);
  }
  openDb(): Promise<SecureDbHandle> {
    throw new Error("MiniDriver.openDb no soportado");
  }

  seedDb(name: string): void {
    this.paths.add(`${this.dir}/${name}`);
  }
}

let driver: MiniDriver;
let map: Map<string, string>;

function backendWith(seed: Record<string, string> = {}): SecureBackend {
  const m = new Map(Object.entries(seed));
  map = m;
  return {
    getItemAsync: async (k: string) => (m.has(k) ? m.get(k)! : null),
    setItemAsync: async (k: string, v: string) => {
      m.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      m.delete(k);
    },
  };
}

beforeEach(() => {
  setTestSecureBackend(backendWith());
  setSecureDbTestDriver((driver = new MiniDriver()));
  let n = 0;
  setTestRandomBytes(async (len: number) => {
    n += 1;
    const b = new Uint8Array(len);
    b[0] = n;
    return b;
  });
});

describe("N4: pérdida del Keystore / recovery honesto", () => {
  it("instalación genuinamente nueva → first-run normal (sin regresión)", async () => {
    // Sin clave y sin bases: generar y persistir es legítimo.
    const k = await getDatabaseKeyHex();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(map.get("nido_db_key")).toBe(k);
  });

  it("N4: DBs existen + clave ausente → RECOVERY explícito, NUNCA DEK fresca", async () => {
    driver.seedDb("nido_memory.db");
    const err = await getDatabaseKeyHex().catch((e) => e);
    expect(err).toBeInstanceOf(KeyLossError);
    expect((err as KeyLossError).code).toBe("NIDO_KEY_LOST");
    expect((err as KeyLossError).databases).toContain("nido_memory.db");
    // Verificable y visible: el mensaje dice qué pasó y que los datos no se tocaron.
    expect(String(err.message)).toMatch(/fail-closed/i);
    // CRÍTICO: ninguna DEK nueva fue generada ni persistida en silencio.
    expect(map.has("nido_db_key")).toBe(false);
  });

  it("N4: también dispara con la base de conocimiento (nido_knowledge.db)", async () => {
    driver.seedDb("nido_knowledge.db");
    const err = await getDatabaseKeyHex().catch((e) => e);
    expect(err).toBeInstanceOf(KeyLossError);
    expect((err as KeyLossError).databases).toContain("nido_knowledge.db");
    expect(map.has("nido_db_key")).toBe(false);
  });

  it("N4: clave corrupta + DBs → sigue fail-closed, sin sobrescribir (M-1 intacto)", async () => {
    setTestSecureBackend(backendWith({ nido_db_key: "basura" }));
    driver.seedDb("nido_memory.db");
    const err = await getDatabaseKeyHex().catch((e) => e);
    expect(err).toBeInstanceOf(SecureStoreReadError);
    expect(map.get("nido_db_key")).toBe("basura");
  });

  it("clave presente + DBs presentes → desbloqueo normal (sin regresión)", async () => {
    setTestSecureBackend(backendWith({ nido_db_key: DEK }));
    driver.seedDb("nido_memory.db");
    await expect(getDatabaseKeyHex()).resolves.toBe(DEK);
    expect(map.get("nido_db_key")).toBe(DEK);
  });

  it("N4: el estado de recovery es estable entre reintentos (no se envenena)", async () => {
    driver.seedDb("nido_memory.db");
    for (let i = 0; i < 3; i++) {
      const err = await getDatabaseKeyHex().catch((e) => e);
      expect(err).toBeInstanceOf(KeyLossError);
      expect(map.has("nido_db_key")).toBe(false);
    }
  });

  it("N4: fallo de la sonda de ficheros → fail-closed, no generación (ambiguo)", async () => {
    driver.failExists = true;
    const err = await getDatabaseKeyHex().catch((e) => e);
    // No podemos distinguir "nuevo" de "pérdida": no generar.
    expect(err).toBeInstanceOf(SecureStoreReadError);
    expect(map.has("nido_db_key")).toBe(false);
  });

  it("N4: recoverFromKeyLoss exige confirmación explícita (sin auto-destrucción)", async () => {
    driver.seedDb("nido_memory.db");
    await expect(recoverFromKeyLoss({ confirmed: false })).rejects.toThrow(
      /confirmaci/i,
    );
    // Nada se tocó sin confirmación.
    expect(driver.paths.has("/fake/nido_memory.db")).toBe(true);
  });

  it("N4: recovery confirmado archiva (no borra) y permite un first-run legítimo", async () => {
    driver.seedDb("nido_memory.db");
    const res = await recoverFromKeyLoss({ confirmed: true });
    expect(res.archived.length).toBeGreaterThan(0);
    expect(res.archived[0]).toMatch(/nido_memory\.db\.keyloss-/);
    // La base original ya no está en su sitio, pero NO fue destruida.
    expect(driver.paths.has("/fake/nido_memory.db")).toBe(false);
    expect([...driver.paths].some((p) => p.includes("nido_memory.db.keyloss-"))).toBe(
      true,
    );
    // Ahora sí: sin bases gestionadas, el arranque genera una DEK legítima.
    const k = await getDatabaseKeyHex();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(map.get("nido_db_key")).toBe(k);
  });

  it("N4: integración — el path real de arranque aterriza en recovery, no en first-run", async () => {
    driver.seedDb("nido_memory.db");
    // ensureEncryptedDatabase sin dekHex explícita resuelve por la misma
    // getDatabaseKeyHex() que usan memoryStore.openAndMigrate() y
    // rag/db.openAndMigrate(): es el path real de inicialización.
    const err = await ensureEncryptedDatabase("nido_memory.db", "memoryStore", {
      driver,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(KeyLossError);
    expect((err as KeyLossError).code).toBe("NIDO_KEY_LOST");
    expect(map.has("nido_db_key")).toBe(false);
  });
});
