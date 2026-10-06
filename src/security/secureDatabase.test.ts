/**
 * secureDatabase.test.ts — NIDO: tests de la migración plaintext→SQLCipher.
 *
 * El FakeDriver simula la semántica de SQLCipher (clave incorrecta / sin
 * clave / base en claro → "file is not a database"; ATTACH+sqlcipher_export;
 * PRAGMA cipher_version) para probar la MÁQUINA DE ESTADOS, el orden de
 * operaciones fail-closed y la recuperación. La semántica criptográfica REAL
 * se verifica en sqlcipherReal.test.ts contra SQLCipher 4.12 de verdad.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertDbHandleShape,
  assertFileSystemShape,
  assertSqliteModuleShape,
  buildAttachEncryptedSql,
  buildKeyPragmaSql,
  ensureEncryptedDatabase,
  getMigrationState,
  migratePlaintextToEncrypted,
  openEncryptedDatabase,
  recoverInterruptedMigration,
  INTEGRITY_CHECK_SQL,
  SCHEMA_SQL,
  SQLCIPHER_EXPORT_SQL,
  VERIFY_READ_SQL,
  WAL_CHECKPOINT_SQL,
  type SecureDbDriver,
  type SecureDbHandle,
} from "./secureDatabase";

const DEK = "aa".repeat(32);
const WRONG_DEK = "bb".repeat(32);
const NOT_A_DB = "file is not a database";

interface FakeTable {
  sql: string | null;
  count: number;
}
interface FakeDbFile {
  kind: "plaintext" | "encrypted";
  dekHex: string | null;
  tables: Map<string, FakeTable>;
}

/** Simula un fichero SQLite con semántica SQLCipher. */
class FakeDriver implements SecureDbDriver {
  files = new Map<string, FakeDbFile>();
  texts = new Map<string, string>();
  failExport = false;
  tamperExport = false; // la exportación pierde una tabla → huella distinta
  failCheckpoint = false;

  private dir = "/fake";
  dbDir(): string {
    return this.dir + "/";
  }

  /** Crea una base en claro con tablas. */
  seedPlaintext(name: string, tables: Record<string, number>): void {
    const m = new Map<string, FakeTable>();
    for (const [t, count] of Object.entries(tables)) {
      m.set(t, { sql: `CREATE TABLE ${t} (id INTEGER)`, count });
    }
    this.files.set(`${this.dir}/${name}`, { kind: "plaintext", dekHex: null, tables: m });
  }

  /** Crea una base cifrada con tablas (simula una principal ya migrada). */
  seedEncrypted(name: string, dekHex: string, tables: Record<string, number>): void {
    const m = new Map<string, FakeTable>();
    for (const [t, count] of Object.entries(tables)) {
      m.set(t, { sql: `CREATE TABLE ${t} (id INTEGER)`, count });
    }
    this.files.set(`${this.dir}/${name}`, {
      kind: "encrypted",
      dekHex: dekHex.toLowerCase(),
      tables: m,
    });
  }

  /** Crea un temporal cifrado con tablas dadas (contenido controlado). */
  seedTmp(tables: Record<string, number>, dekHex: string = DEK): void {
    const m = new Map<string, FakeTable>();
    for (const [t, count] of Object.entries(tables)) {
      m.set(t, { sql: `CREATE TABLE ${t} (id INTEGER)`, count });
    }
    this.files.set(`${this.dir}/${DB}.migtmp`, {
      kind: "encrypted",
      dekHex: dekHex.toLowerCase(),
      tables: m,
    });
  }

  seedSidecar(name: string, suffix: "-wal" | "-shm" | "-journal"): void {
    this.texts.set(`${this.dir}/${name}${suffix}`, "sidecar");
  }

  async openDb(path: string): Promise<SecureDbHandle> {
    if (!this.files.has(path)) {
      this.files.set(path, { kind: "plaintext", dekHex: null, tables: new Map() });
    }
    return new FakeHandle(this, path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.texts.has(path);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.texts.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (!f) throw new Error(`rename: no existe ${from}`);
    this.files.delete(to);
    this.files.set(to, f);
    this.files.delete(from);
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.texts.set(path, content);
  }

  fileKind(path: string): string | undefined {
    return this.files.get(path)?.kind;
  }
}

class FakeHandle implements SecureDbHandle {
  private keyApplied: string | null = null;
  private attach: { path: string; key: string } | null = null;
  private closed = false;

  constructor(
    private driver: FakeDriver,
    private path: string,
  ) {}

  private file(): FakeDbFile {
    const f = this.driver.files.get(this.path);
    if (!f) throw new Error(`no existe ${this.path}`);
    return f;
  }

  private checkAccess(): void {
    const f = this.file();
    if (f.kind === "plaintext") return;
    if (this.keyApplied && f.dekHex && this.keyApplied.toLowerCase() === f.dekHex.toLowerCase()) {
      return;
    }
    throw new Error(NOT_A_DB);
  }

  async execAsync(sql: string): Promise<void> {
    if (this.closed) throw new Error("closed");
    const keyMatch = sql.match(/PRAGMA key = "x'([0-9a-f]{64})'";/i);
    if (keyMatch) {
      this.keyApplied = keyMatch[1].toLowerCase();
      return;
    }
    const attachMatch = sql.match(
      /ATTACH DATABASE '((?:[^']|'')+)' AS nido_enc KEY "x'([0-9a-f]{64})'";/i,
    );
    if (attachMatch) {
      this.attach = { path: attachMatch[1].replace(/''/g, "'"), key: attachMatch[2].toLowerCase() };
      return;
    }
    if (/DETACH DATABASE nido_enc/i.test(sql)) {
      this.attach = null;
      return;
    }
    if (/wal_checkpoint/i.test(sql)) {
      if (this.driver.failCheckpoint) throw new Error("checkpoint falló");
      return;
    }
    throw new Error(`FakeHandle.execAsync: SQL no soportado: ${sql.slice(0, 60)}`);
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    if (this.closed) throw new Error("closed");
    if (/PRAGMA cipher_version/i.test(sql)) {
      return [{ cipher_version: "4.12.0 community" }] as unknown as T[];
    }
    if (/sqlcipher_export/i.test(sql)) {
      if (this.driver.failExport) throw new Error("export falló");
      if (!this.attach) throw new Error("sin ATTACH previo");
      const src = this.file();
      const tables = new Map<string, FakeTable>();
      for (const [name, t] of src.tables) {
        if (this.driver.tamperExport && name === "p2p_messages") continue; // pierde una tabla
        tables.set(name, { sql: t.sql, count: t.count });
      }
      this.driver.files.set(this.attach.path, {
        kind: "encrypted",
        dekHex: this.attach.key,
        tables,
      });
      return [] as unknown as T[];
    }
    if (/FROM sqlite_master/i.test(sql) && /ORDER BY/i.test(sql)) {
      this.checkAccess();
      const rows = [...this.file().tables.entries()].map(([name, t]) => ({
        type: "table",
        name,
        sql: t.sql,
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as T[];
    }
    throw new Error(`FakeHandle.getAllAsync: SQL no soportado: ${sql.slice(0, 60)}`);
  }

  async getFirstAsync<T>(sql: string): Promise<T | null> {
    if (this.closed) throw new Error("closed");
    if (/PRAGMA integrity_check/i.test(sql)) {
      this.checkAccess();
      return { integrity_check: "ok" } as unknown as T;
    }
    const countMatch = sql.match(/SELECT count\(\*\) AS n FROM "((?:[^"]|"")+)";/i);
    if (countMatch && !/sqlite_master/.test(sql)) {
      this.checkAccess();
      const t = this.file().tables.get(countMatch[1].replace(/""/g, '"'));
      if (!t) throw new Error(`no such table: ${countMatch[1]}`);
      return { n: t.count } as unknown as T;
    }
    if (/FROM sqlite_master/i.test(sql)) {
      this.checkAccess();
      return { n: this.file().tables.size } as unknown as T;
    }
    throw new Error(`FakeHandle.getFirstAsync: SQL no soportado: ${sql.slice(0, 60)}`);
  }

  async closeAsync(): Promise<void> {
    this.closed = true;
  }
}

const DB = "nido_memory.db";
let driver: FakeDriver;

beforeEach(() => {
  driver = new FakeDriver();
});

describe("getMigrationState", () => {
  it("sin ficheros → MIGRATION_NOT_REQUIRED", async () => {
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("MIGRATION_NOT_REQUIRED");
  });

  it("base en claro sin marcador → MIGRATION_REQUIRED", async () => {
    driver.seedPlaintext(DB, { agent_facts: 3 });
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("MIGRATION_REQUIRED");
  });

  it("temporal existente → MIGRATION_IN_PROGRESS", async () => {
    driver.seedPlaintext(DB, { agent_facts: 3 });
    driver.files.set("/fake/nido_memory.db.migtmp", {
      kind: "encrypted",
      dekHex: DEK,
      tables: new Map(),
    });
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("MIGRATION_IN_PROGRESS");
  });

  it("marcador existente → MIGRATION_COMPLETE", async () => {
    driver.seedPlaintext(DB, { agent_facts: 1 });
    driver.texts.set("/fake/nido_memory.db.sqlcipher", "{}");
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("MIGRATION_COMPLETE");
  });

  it("cifrada con la DEK correcta y sin marcador → MIGRATION_COMPLETE", async () => {
    driver.files.set("/fake/" + DB, { kind: "encrypted", dekHex: DEK, tables: new Map() });
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("MIGRATION_COMPLETE");
  });

  it("ilegible con la DEK (otra clave) → RECOVERY_REQUIRED", async () => {
    driver.files.set("/fake/" + DB, { kind: "encrypted", dekHex: WRONG_DEK, tables: new Map() });
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("RECOVERY_REQUIRED");
  });
});

describe("migratePlaintextToEncrypted", () => {
  it("migración completa: datos preservados, cifrada, marcador y sin sidecars", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5, p2p_messages: 7 });
    driver.seedSidecar(DB, "-wal");
    driver.seedSidecar(DB, "-shm");

    await migratePlaintextToEncrypted(DB, DEK, driver);

    // La principal ahora es cifrada con la DEK.
    expect(driver.fileKind("/fake/" + DB)).toBe("encrypted");
    // Abre con la DEK y los conteos coinciden.
    const h = await driver.openDb("/fake/" + DB);
    await h.execAsync(buildKeyPragmaSql(DEK));
    const n = await h.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM "agent_facts";`);
    expect(n?.n).toBe(5);
    await h.closeAsync();
    // Sin clave no abre.
    const h2 = await driver.openDb("/fake/" + DB);
    await expect(h2.getFirstAsync(VERIFY_READ_SQL)).rejects.toThrow(NOT_A_DB);
    await h2.closeAsync();
    // Marcador presente, temporal fuera, sidecars fuera.
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(true);
    expect(await driver.exists("/fake/nido_memory.db.migtmp")).toBe(false);
    expect(await driver.exists("/fake/nido_memory.db-wal")).toBe(false);
    expect(await driver.exists("/fake/nido_memory.db-shm")).toBe(false);
  });

  it("fallo en export → la original queda intacta y no hay marcador", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5 });
    driver.failExport = true;
    await expect(migratePlaintextToEncrypted(DB, DEK, driver)).rejects.toThrow();
    expect(driver.fileKind("/fake/" + DB)).toBe("plaintext");
    const h = await driver.openDb("/fake/" + DB);
    const n = await h.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM "agent_facts";`);
    expect(n?.n).toBe(5); // legible en claro: no se perdió nada
    await h.closeAsync();
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(false);
    // Sin temporal creado, el estado es REQUIRED: reintento limpio.
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("MIGRATION_REQUIRED");
  });

  it("export a medias deja temporal parcial → IN_PROGRESS → recover lo descarta y re-migra", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5 });
    driver.failExport = true;
    await expect(migratePlaintextToEncrypted(DB, DEK, driver)).rejects.toThrow();
    // Simula el temporal parcial que SQLCipher deja tras un fallo a mitad de export.
    driver.failExport = false;
    driver.files.set("/fake/nido_memory.db.migtmp", {
      kind: "encrypted",
      dekHex: WRONG_DEK,
      tables: new Map(),
    });
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("MIGRATION_IN_PROGRESS");
    await recoverInterruptedMigration(DB, DEK, driver);
    expect(driver.fileKind("/fake/" + DB)).toBe("encrypted");
    const h = await driver.openDb("/fake/" + DB);
    await h.execAsync(buildKeyPragmaSql(DEK));
    const n = await h.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM "agent_facts";`);
    expect(n?.n).toBe(5);
    await h.closeAsync();
  });

  it("huella distinta tras export → aborta y no sustituye la original", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5, p2p_messages: 2 });
    driver.tamperExport = true;
    await expect(migratePlaintextToEncrypted(DB, DEK, driver)).rejects.toThrow(/no coincide/);
    expect(driver.fileKind("/fake/" + DB)).toBe("plaintext");
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(false);
  });

  it("DEK inválida → no toca nada", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5 });
    await expect(migratePlaintextToEncrypted(DB, "corta", driver)).rejects.toThrow(/DEK inválida/);
    expect(driver.fileKind("/fake/" + DB)).toBe("plaintext");
  });
});

describe("recoverInterruptedMigration", () => {
  it("temporal válido + principal en claro → completa el rename", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5 });
    // Simula crash tras export+verificación pero antes del rename.
    const src = await driver.openDb("/fake/" + DB);
    await src.execAsync(
      `ATTACH DATABASE '/fake/nido_memory.db.migtmp' AS nido_enc KEY "x'${DEK}'";`,
    );
    await src.getAllAsync(SQLCIPHER_EXPORT_SQL);
    await src.closeAsync();

    await recoverInterruptedMigration(DB, DEK, driver);

    expect(driver.fileKind("/fake/" + DB)).toBe("encrypted");
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(true);
    expect(await driver.exists("/fake/nido_memory.db.migtmp")).toBe(false);
  });

  it("temporal inválido + principal en claro → descarta y re-migra", async () => {
    driver.seedPlaintext(DB, { agent_facts: 4 });
    driver.files.set("/fake/nido_memory.db.migtmp", {
      kind: "encrypted",
      dekHex: WRONG_DEK, // basura de un intento corrupto
      tables: new Map(),
    });
    await recoverInterruptedMigration(DB, DEK, driver);
    expect(driver.fileKind("/fake/" + DB)).toBe("encrypted");
    const h = await driver.openDb("/fake/" + DB);
    await h.execAsync(buildKeyPragmaSql(DEK));
    const n = await h.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM "agent_facts";`);
    expect(n?.n).toBe(4);
    await h.closeAsync();
  });

  it("sin principal y temporal válido → recupera con el rename", async () => {
    driver.files.set("/fake/nido_memory.db.migtmp", {
      kind: "encrypted",
      dekHex: DEK,
      tables: new Map([["agent_facts", { sql: "CREATE TABLE agent_facts (id INTEGER)", count: 9 }]]),
    });
    await recoverInterruptedMigration(DB, DEK, driver);
    expect(driver.fileKind("/fake/" + DB)).toBe("encrypted");
  });

  it("ni temporal ni principal legibles → RECOVERY_REQUIRED", async () => {
    driver.files.set("/fake/nido_memory.db.migtmp", {
      kind: "encrypted",
      dekHex: WRONG_DEK,
      tables: new Map(),
    });
    driver.files.set("/fake/" + DB, { kind: "encrypted", dekHex: WRONG_DEK, tables: new Map() });
    await expect(recoverInterruptedMigration(DB, DEK, driver)).rejects.toThrow(/RECOVERY_REQUIRED/);
  });
});

describe("recoverInterruptedMigration — A/F-NEW-1: la principal nunca se destruye sin prueba de contenido", () => {
  async function readCount(path: string, dek: string | null, table: string): Promise<number> {
    const h = await driver.openDb(path);
    if (dek) await h.execAsync(buildKeyPragmaSql(dek));
    const n = await h.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM "${table}";`);
    await h.closeAsync();
    return n?.n ?? -1;
  }

  it("tmp válido-pero-vacío (kill durante export) → no se promueve; contenido original preservado", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5, p2p_messages: 2 });
    // El kill durante sqlcipher_export deja un tmp que pasa integrity_check
    // pero está vacío tras el rollback.
    driver.seedTmp({}, DEK);
    await recoverInterruptedMigration(DB, DEK, driver);
    // El vacío nunca sustituyó a la principal: se re-migró desde el original.
    expect(await readCount("/fake/" + DB, DEK, "agent_facts")).toBe(5);
    expect(await readCount("/fake/" + DB, DEK, "p2p_messages")).toBe(2);
    expect(await driver.exists("/fake/nido_memory.db.migtmp")).toBe(false);
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(true);
  });

  it("tmp parcial (faltan tablas) → no se promueve", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5, p2p_messages: 2 });
    driver.seedTmp({ agent_facts: 5 }, DEK); // export interrumpido a mitad
    await recoverInterruptedMigration(DB, DEK, driver);
    expect(await readCount("/fake/" + DB, DEK, "agent_facts")).toBe(5);
    expect(await readCount("/fake/" + DB, DEK, "p2p_messages")).toBe(2);
    expect(await driver.exists("/fake/nido_memory.db.migtmp")).toBe(false);
  });

  it("tmp con conteos distintos → no se promueve", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5 });
    driver.seedTmp({ agent_facts: 4 }, DEK); // divergencia de contenido
    await recoverInterruptedMigration(DB, DEK, driver);
    expect(await readCount("/fake/" + DB, DEK, "agent_facts")).toBe(5);
  });

  it("principal en claro + tmp bueno (misma huella) → promueve con el contenido", async () => {
    driver.seedPlaintext(DB, { agent_facts: 5 });
    const src = await driver.openDb("/fake/" + DB);
    await src.execAsync(
      `ATTACH DATABASE '/fake/nido_memory.db.migtmp' AS nido_enc KEY "x'${DEK}'";`,
    );
    await src.getAllAsync(SQLCIPHER_EXPORT_SQL);
    await src.closeAsync();
    await recoverInterruptedMigration(DB, DEK, driver);
    expect(driver.fileKind("/fake/" + DB)).toBe("encrypted");
    expect(await readCount("/fake/" + DB, DEK, "agent_facts")).toBe(5);
    expect(await driver.exists("/fake/nido_memory.db.migtmp")).toBe(false);
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(true);
  });

  it("principal cifrada + tmp bueno (misma huella) → promueve", async () => {
    driver.seedEncrypted(DB, DEK, { agent_facts: 3 });
    driver.seedTmp({ agent_facts: 3 }, DEK);
    await recoverInterruptedMigration(DB, DEK, driver);
    expect(driver.fileKind("/fake/" + DB)).toBe("encrypted");
    expect(await readCount("/fake/" + DB, DEK, "agent_facts")).toBe(3);
    expect(await driver.exists("/fake/nido_memory.db.migtmp")).toBe(false);
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(true);
  });

  it("principal cifrada ilegible con la DEK → fallo explícito, nada se toca, nunca silencioso", async () => {
    driver.seedEncrypted(DB, WRONG_DEK, { agent_facts: 3 });
    driver.seedTmp({ agent_facts: 3 }, DEK);
    await expect(recoverInterruptedMigration(DB, DEK, driver)).rejects.toThrow(
      /RECOVERY_REQUIRED/,
    );
    // Nada tocado: ni la principal, ni el temporal, ni marcador.
    expect(driver.fileKind("/fake/" + DB)).toBe("encrypted");
    expect(await readCount("/fake/" + DB, WRONG_DEK, "agent_facts")).toBe(3);
    expect(await driver.exists("/fake/nido_memory.db.migtmp")).toBe(true);
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(false);
    // Estado reintentable: sigue IN_PROGRESS para una futura intervención.
    await expect(getMigrationState(DB, DEK, driver)).resolves.toBe("MIGRATION_IN_PROGRESS");
  });

  it("kill-during-export de extremo a extremo: export real, rollback simulado, original intacto", async () => {
    driver.seedPlaintext(DB, { agent_facts: 7, p2p_messages: 11 });
    // 1. El export empieza de verdad vía ATTACH + sqlcipher_export.
    const src = await driver.openDb("/fake/" + DB);
    await src.execAsync(
      `ATTACH DATABASE '/fake/nido_memory.db.migtmp' AS nido_enc KEY "x'${DEK}'";`,
    );
    await src.getAllAsync(SQLCIPHER_EXPORT_SQL);
    await src.closeAsync();
    // 2. El kill a mitad deja el tmp vacío pero estructuralmente válido
    //    (SQLite revierte la transacción no confirmada al reabrir).
    driver.files.set("/fake/nido_memory.db.migtmp", {
      kind: "encrypted",
      dekHex: DEK,
      tables: new Map(),
    });
    await recoverInterruptedMigration(DB, DEK, driver);
    // 3. La principal nunca fue sustituida por el vacío.
    expect(await readCount("/fake/" + DB, DEK, "agent_facts")).toBe(7);
    expect(await readCount("/fake/" + DB, DEK, "p2p_messages")).toBe(11);
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(true);
  });

  it("marcador solo en éxito genuino; el fallo deja estado reintentable sin marcador", async () => {
    // Éxito genuino → marcador.
    driver.seedPlaintext(DB, { agent_facts: 1 });
    driver.seedTmp({ agent_facts: 1 }, DEK);
    await recoverInterruptedMigration(DB, DEK, driver);
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(true);

    // Fallo (principal ilegible) → sin marcador, tmp conservado, IN_PROGRESS.
    const d2 = new FakeDriver();
    d2.seedEncrypted(DB, WRONG_DEK, { agent_facts: 1 });
    d2.seedTmp({ agent_facts: 1 }, DEK);
    await expect(recoverInterruptedMigration(DB, DEK, d2)).rejects.toThrow(/RECOVERY_REQUIRED/);
    expect(await d2.exists("/fake/nido_memory.db.sqlcipher")).toBe(false);
    expect(await d2.exists("/fake/nido_memory.db.migtmp")).toBe(true);
    await expect(getMigrationState(DB, DEK, d2)).resolves.toBe("MIGRATION_IN_PROGRESS");
  });
});

describe("openEncryptedDatabase", () => {
  it("clave incorrecta → fail-closed", async () => {
    driver.files.set("/fake/" + DB, { kind: "encrypted", dekHex: DEK, tables: new Map() });
    await expect(openEncryptedDatabase(DB, WRONG_DEK, "test", driver)).rejects.toThrow(
      /no se pudo descifra/i,
    );
  });
});

describe("ensureEncryptedDatabase", () => {
  it("end-to-end: REQUIRED → migra → abre; segunda llamada usa COMPLETE", async () => {
    driver.seedPlaintext(DB, { agent_facts: 2, p2p_messages: 1 });
    const h = await ensureEncryptedDatabase(DB, "test", { driver, dekHex: DEK });
    const n = await h.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM "p2p_messages";`);
    expect(n?.n).toBe(1);
    await h.closeAsync();

    const h2 = await ensureEncryptedDatabase(DB, "test", { driver, dekHex: DEK });
    const m = await h2.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM "agent_facts";`);
    expect(m?.n).toBe(2);
    await h2.closeAsync();
    // El marcador sigue ahí: no se re-migró.
    expect(await driver.exists("/fake/nido_memory.db.sqlcipher")).toBe(true);
  });

  it("sin DEK (dev) → abre en claro sin migrar", async () => {
    driver.seedPlaintext(DB, { agent_facts: 1 });
    const h = await ensureEncryptedDatabase(DB, "test", { driver, dekHex: null });
    const n = await h.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM "agent_facts";`);
    expect(n?.n).toBe(1);
    await h.closeAsync();
    expect(driver.fileKind("/fake/" + DB)).toBe("plaintext");
  });
});

describe("constructores de SQL", () => {
  it("buildKeyPragmaSql usa formato x'hex'", () => {
    expect(buildKeyPragmaSql(DEK)).toBe(`PRAGMA key = "x'${DEK}'";`);
  });

  it("buildAttachEncryptedSql escapa comillas simples en la ruta", () => {
    const sql = buildAttachEncryptedSql("/fake/a'b.db.migtmp", DEK);
    expect(sql).toContain(`ATTACH DATABASE '/fake/a''b.db.migtmp' AS nido_enc KEY "x'${DEK}'";`);
  });

  it("las constantes SQL son las verificadas contra SQLCipher real", () => {
    expect(SQLCIPHER_EXPORT_SQL).toBe("SELECT sqlcipher_export('nido_enc');");
    expect(VERIFY_READ_SQL).toContain("sqlite_master");
    expect(INTEGRITY_CHECK_SQL).toBe("PRAGMA integrity_check;");
    expect(WAL_CHECKPOINT_SQL).toBe("PRAGMA wal_checkpoint(TRUNCATE);");
    expect(SCHEMA_SQL).toContain("sqlite_master");
  });
});

describe("verificación de forma del módulo SQLite en runtime (regresión 2026-10-06)", () => {
  // El build diagnóstico d830374 mostró en el dispositivo físico
  // "[seed-stage:getDb:openAndMigrate] undefined is not a function":
  // ensureEncryptedDatabase() terminaba pero el handle devuelto no exponía
  // execAsync en runtime. Estas pruebas fijan que una forma de módulo o de
  // handle incorrecta falle con un mensaje claro en las aserciones, en vez
  // de "undefined is not a function" tres llamadas más tarde.

  const goodModule = {
    openDatabaseAsync: async () => ({}),
    openDatabaseSync: () => ({}),
  };
  const goodHandle = {
    execAsync: async (_sql: string) => {},
    getAllAsync: async (_sql: string) => [],
    getFirstAsync: async (_sql: string) => null,
    closeAsync: async () => {},
  };
  const goodFs = {
    documentDirectory: "file:///docs/",
    getInfoAsync: async (_p: string) => ({ exists: false }),
    deleteAsync: async (_p: string) => {},
    moveAsync: async (_o: { from: string; to: string }) => {},
    writeAsStringAsync: async (_p: string, _c: string) => {},
  };

  it("assertSqliteModuleShape acepta un módulo con openDatabaseAsync", () => {
    expect(() => assertSqliteModuleShape(goodModule)).not.toThrow();
  });

  it("assertSqliteModuleShape rechaza un módulo sin openDatabaseAsync", () => {
    expect(() => assertSqliteModuleShape({})).toThrow(
      /openDatabaseAsync is undefined/,
    );
  });

  it("assertSqliteModuleShape rechaza el wrapper { default } de interop rota", () => {
    // Si el bundler resolviera ESM/CJS mal y dejara los exports bajo
    // .default, openDatabaseAsync no estaría en el primer nivel.
    expect(() =>
      assertSqliteModuleShape({ default: goodModule, __esModule: true }),
    ).toThrow(/Has \.default: true/);
  });

  it("assertSqliteModuleShape rechaza null/undefined", () => {
    expect(() => assertSqliteModuleShape(null)).toThrow(/shape mismatch/);
    expect(() => assertSqliteModuleShape(undefined)).toThrow(/shape mismatch/);
  });

  it("assertFileSystemShape acepta el módulo legacy completo", () => {
    expect(() => assertFileSystemShape(goodFs)).not.toThrow();
  });

  it("assertFileSystemShape rechaza funciones faltantes", () => {
    const { moveAsync: _dropped, ...rest } = goodFs;
    expect(() => assertFileSystemShape(rest)).toThrow(/missing functions: moveAsync/);
  });

  it("assertDbHandleShape acepta un handle con las 4 funciones", () => {
    expect(() => assertDbHandleShape(goodHandle, "test")).not.toThrow();
  });

  it("assertDbHandleShape rechaza un handle sin execAsync (el caso d830374)", () => {
    const { execAsync: _dropped, ...rest } = goodHandle;
    expect(() => assertDbHandleShape(rest, "test")).toThrow(
      /missing functions: execAsync/,
    );
  });

  it("assertDbHandleShape lista todas las funciones faltantes", () => {
    expect(() => assertDbHandleShape({}, "test")).toThrow(
      /missing functions: execAsync, getAllAsync, getFirstAsync, closeAsync/,
    );
  });

  it("assertDbHandleShape rechaza null/undefined", () => {
    expect(() => assertDbHandleShape(null, "test")).toThrow(/missing functions/);
  });
});
