/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock expo-file-system/legacy
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/mock/",
  EncodingType: { UTF8: "utf8", Base64: "base64" },
  getInfoAsync: vi.fn(),
  copyAsync: vi.fn(),
  moveAsync: vi.fn(),
  readDirectoryAsync: vi.fn().mockResolvedValue([]),
  writeAsStringAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));

vi.mock("../privacy/keyManager", () => ({
  getDatabaseKeyHex: vi.fn().mockResolvedValue("ab".repeat(32)),
  applyDatabaseKey: vi.fn().mockResolvedValue(undefined),
}));

// 0.1.47: la copia del respaldo se abre para quitar los mensajes temporales.
const sqlx = vi.hoisted(() => ({ sql: [] as string[], failWith: null as string | null, allowOpen: false }));
vi.mock("expo-sqlite", () => ({
  // Solo se puede abrir en las pruebas de 0.1.47: el resto (p. ej. A5)
  // depende de que la apertura de prueba NO pueda completarse.
  openDatabaseAsync: async () => {
    if (!sqlx.allowOpen) return undefined; // como el stub global de vitest.setup
    return {
    execAsync: async (q: string) => {
      sqlx.sql.push(q);
      if (sqlx.failWith && q.startsWith("DELETE")) throw new Error(sqlx.failWith);
    },
    closeAsync: async () => {},
    };
  },
}));

vi.mock("./secureDatabase", () => ({
  WAL_CHECKPOINT_SQL: "PRAGMA wal_checkpoint(TRUNCATE);",
}));

vi.mock("./databaseManager", () => ({
  getDatabase: vi.fn().mockResolvedValue({ execAsync: vi.fn() }),
  closeDatabase: vi.fn().mockResolvedValue(undefined),
}));

// Auditoría 2026-10-31 (F3-03): la conexión de la base de conocimiento
// es la de rag/db; su checkpoint se registra aquí.
const kdbx = vi.hoisted(() => ({ sql: [] as string[], failWith: null as string | null, events: [] as string[] }));
vi.mock("../rag/db", () => ({
  getDb: async () => ({
    execAsync: async (q: string) => {
      kdbx.sql.push(q);
      kdbx.events.push("checkpoint-conocimiento");
      if (kdbx.failWith) throw new Error(kdbx.failWith);
    },
  }),
}));

import * as FileSystem from "expo-file-system/legacy";
import { validateBackup, exportDatabaseKey } from "./backup";

describe("backup.ts — validación (BK-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza archivo inexistente", async () => {
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: false });
    const r = await validateBackup("/no/existe.db");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("no existe");
  });

  it("rechaza archivo demasiado pequeño", async () => {
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 100 });
    const r = await validateBackup("/pequeno.db");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("pequeño");
  });

  it("rechaza archivo sin magic header SQLite (obsoleto - ahora usa trial-open)", async () => {
    // FIX 2026-10-09 (B13): el check de magic header se eliminó porque
    // SQLCipher cifra el header. Ahora se usa trial-open con el DEK.
    // Este test verifica que un archivo inválido sigue siendo rechazado
    // (por manifest corrupto, no por header).
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 5000 });
    (FileSystem.readAsStringAsync as any).mockResolvedValue("esto no es sqlite");
    const r = await validateBackup("/falso.db");
    expect(r.valid).toBe(false);
    // Ahora falla por manifest, no por header (el header ya no se verifica).
  });

  it("A5: rechaza un archivo que no se pudo verificar por ninguna vía", async () => {
    // Sin manifest, y la apertura de prueba no puede completarse en este
    // entorno (módulos nativos simulados). Antes este caso se ACEPTABA
    // (fail-open): cualquier archivo de más de 1 KB pasaba la validación y
    // podía sobrescribir la base viva.
    (FileSystem.getInfoAsync as any).mockImplementation(async (uri: string) => {
      if (uri.endsWith(".manifest.json")) return { exists: false };
      return { exists: true, size: 5000 };
    });
    (FileSystem.readAsStringAsync as any).mockResolvedValue("SQLite format 3\0 resto...");
    const r = await validateBackup("/sin-verificar.db");
    expect(r.valid).toBe(false);
    // Con la clave del teléfono disponible el motivo es "no se pudo
    // comprobar con la clave"; sin ella, "no se pudo verificar".
    expect(r.reason).toMatch(/verificar|comprobar/);
  });
});

describe("backup.ts — exportDatabaseKey", () => {
  it("retorna la clave en hex", async () => {
    const key = await exportDatabaseKey();
    expect(key).toBe("ab".repeat(32));
    expect(key.length).toBe(64);
  });
});

describe("backup.ts — nombre del backup de conocimiento (A2)", () => {
  it("createBackup, el bundle y la restauración usan el mismo nombre", async () => {
    const { knowledgeBackupUriFor, createPortableBundle } = await import("./backup");
    expect(knowledgeBackupUriFor("/mock/nido-backup-X.db")).toBe("/mock/nido-backup-X.knowledge.db");
    expect(knowledgeBackupUriFor("/mock/sin-extension")).toBe("/mock/sin-extension.knowledge.db");

    vi.clearAllMocks();
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 5000 });
    (FileSystem.readAsStringAsync as any).mockImplementation(async (uri: string) => {
      if (uri.endsWith(".manifest.json")) return JSON.stringify({ sha256: "aa", dekFingerprint: "bb" });
      if (uri === "/mock/nido-backup-X.knowledge.db") return "KNOWLEDGE_BASE64";
      return "DB_BASE64";
    });
    await createPortableBundle("/mock/nido-backup-X.db");
    const written = (FileSystem.writeAsStringAsync as any).mock.calls[0];
    expect(written[0]).toBe("/mock/nido-backup-X.nidobackup.json");
    expect(JSON.parse(written[1]).knowledge).toBe("KNOWLEDGE_BASE64");
  });
});

describe("backup.ts — restaurar con la clave del respaldo (A1)", () => {
  it("normalizeBackupKey acepta 64 hex con espacios o mayúsculas y rechaza lo demás", async () => {
    const { normalizeBackupKey } = await import("./backup");
    const key = "ab".repeat(32);
    expect(normalizeBackupKey(key)).toBe(key);
    expect(normalizeBackupKey(` ${key.toUpperCase().slice(0, 32)} \n${key.slice(32)} `)).toBe(key);
    expect(normalizeBackupKey(key.slice(1))).toBeNull();
    expect(normalizeBackupKey(`${key}0`)).toBeNull();
    expect(normalizeBackupKey("zz".repeat(32))).toBeNull();
    expect(normalizeBackupKey("")).toBeNull();
  });

  it("una clave mal formada se rechaza antes de tocar ningún archivo", async () => {
    const { restoreBackupWithKey } = await import("./backup");
    vi.clearAllMocks();
    await expect(restoreBackupWithKey("/mock/b.db", "no-es-una-clave")).rejects.toThrow(/64 caracteres/);
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  });
});

describe("backup.ts — auditoría ofensiva 2026-10-12 (0.1.29)", () => {
  it("B-1: con clave en el teléfono, un manifest correcto NO basta si no se pudo abrir el archivo", async () => {
    vi.clearAllMocks();
    // El manifest «cuadra» (SHA recalculado por el atacante), pero la
    // apertura de prueba no llega a ejecutarse en este entorno.
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 5000 });
    (FileSystem.readAsStringAsync as any).mockImplementation(async (uri: string) =>
      uri.endsWith(".manifest.json") ? JSON.stringify({ sha256: "x", dekFingerprint: "y" }) : "BASURA",
    );
    const r = await validateBackup("/fabricado.db");
    expect(r.valid).toBe(false);
  });

  it("B-1: sin clave en el teléfono, restaurar se niega antes de tocar nada", async () => {
    const km = await import("../privacy/keyManager");
    (km.getDatabaseKeyHex as any).mockResolvedValueOnce(null);
    vi.clearAllMocks();
    const { restoreBackup } = await import("./backup");
    await expect(restoreBackup("/mock/b.db")).rejects.toMatchObject({ code: "noDeviceKey" });
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it("B-3: los archivos extraídos de un bundle se borran aunque la restauración falle", async () => {
    vi.clearAllMocks();
    (FileSystem.readAsStringAsync as any).mockImplementation(async (uri: string) =>
      uri.endsWith(".nidobackup.json")
        ? JSON.stringify({ format: "nidobackup", version: 1, manifest: {}, db: "AAAA", knowledge: "BBBB" })
        : "BASURA",
    );
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 5000 });
    const { restoreBackup } = await import("./backup");
    await expect(restoreBackup("/mock/x.nidobackup.json")).rejects.toBeTruthy();
    const deleted = (FileSystem.deleteAsync as any).mock.calls.map((c: unknown[]) => c[0]);
    expect(deleted).toEqual(
      expect.arrayContaining(["/mock/restored.db", "/mock/restored.db.manifest.json", "/mock/restored.knowledge.db"]),
    );
  });
});

describe("backup.ts — auditoría completa 2026-10-31 (F3-03): respaldos consolidados o en voz alta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlx.sql = [];
    sqlx.failWith = null;
    sqlx.allowOpen = true;
    kdbx.sql = [];
    kdbx.failWith = null;
    kdbx.events = [];
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 5000 });
  });

  it("si el checkpoint de la base principal falla, no hay respaldo", async () => {
    const dm = await import("./databaseManager");
    (dm.getDatabase as any).mockResolvedValueOnce({
      execAsync: async () => {
        throw new Error("checkpoint boom");
      },
    });
    const { createBackup } = await import("./backup");
    await expect(createBackup("/mock/nido-backup-T.db")).rejects.toThrow(/consolidar la base/);
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  });

  it("el conocimiento se consolida con su conexión antes de copiarse", async () => {
    (FileSystem.copyAsync as any).mockImplementation(async (args: { from: string }) => {
      if (args.from.endsWith("nido_knowledge.db")) kdbx.events.push("copia-conocimiento");
    });
    const { createBackup } = await import("./backup");
    await createBackup("/mock/nido-backup-T.db");
    expect(kdbx.sql).toContain("PRAGMA wal_checkpoint(TRUNCATE);");
    expect(kdbx.events.indexOf("checkpoint-conocimiento")).toBeGreaterThanOrEqual(0);
    expect(kdbx.events.indexOf("checkpoint-conocimiento")).toBeLessThan(
      kdbx.events.indexOf("copia-conocimiento"),
    );
  });

  it("si el checkpoint del conocimiento falla, el respaldo falla en voz alta", async () => {
    kdbx.failWith = "knowledge boom";
    const { createBackup } = await import("./backup");
    try {
      await expect(createBackup("/mock/nido-backup-T.db")).rejects.toThrow(/base de conocimiento/);
    } finally {
      kdbx.failWith = null;
    }
  });
});

describe("backup.ts — 0.1.47: los mensajes temporales no van en los respaldos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlx.sql = [];
    sqlx.failWith = null;
    sqlx.allowOpen = true;
    (FileSystem.getInfoAsync as any).mockResolvedValue({ exists: true, size: 5000 });
  });

  it("borra los temporales de la COPIA y la compacta", async () => {
    const { createBackup } = await import("./backup");
    await createBackup("/mock/nido-backup-T.db");
    expect(sqlx.sql).toContain("DELETE FROM p2p_messages WHERE ttl_sec > 0;");
    expect(sqlx.sql).toContain("VACUUM;");
    expect(sqlx.sql.indexOf("PRAGMA secure_delete = ON;")).toBeLessThan(sqlx.sql.indexOf("VACUUM;"));
  });

  it("una base anterior sin la columna se respalda igual", async () => {
    sqlx.failWith = "no such column: ttl_sec";
    const { createBackup } = await import("./backup");
    await expect(createBackup("/mock/nido-backup-T.db")).resolves.toBe("/mock/nido-backup-T.db");
  });

  it("si no se puede limpiar, no hay respaldo (y la copia se borra)", async () => {
    sqlx.failWith = "disk I/O error";
    const { createBackup } = await import("./backup");
    await expect(createBackup("/mock/nido-backup-T.db")).rejects.toThrow(/preparar el respaldo/);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith("/mock/nido-backup-T.db", { idempotent: true });
  });
});

describe("backup.ts — auditoría completa 2026-10-31 (F3-04): restaurar sin dejar la base a medias", () => {
  const backupUri = "/mock/nido-backup-T.db";
  const dbPath = "/mock/SQLite/nido_memory.db";

  beforeEach(() => {
    vi.clearAllMocks();
    sqlx.sql = [];
    sqlx.failWith = null;
    sqlx.allowOpen = true; // la apertura de prueba debe poder pasar
    (FileSystem.getInfoAsync as any).mockImplementation(async (uri: string) => {
      if (uri.endsWith(".manifest.json")) return { exists: false };
      if (uri.endsWith(".knowledge.db")) return { exists: false };
      return { exists: true, size: 5000 };
    });
    (FileSystem.copyAsync as any).mockResolvedValue(undefined);
    (FileSystem.moveAsync as any).mockResolvedValue(undefined);
    (FileSystem.deleteAsync as any).mockResolvedValue(undefined);
    (FileSystem.readDirectoryAsync as any).mockResolvedValue([]);
  });

  afterEach(() => {
    sqlx.allowOpen = false;
  });

  it("si la copia de seguridad previa falla, se aborta sin tocar la base viva", async () => {
    (FileSystem.copyAsync as any).mockImplementation(async (args: { from: string; to: string }) => {
      if (args.to.includes(".pre-restore-")) throw new Error("sin espacio");
    });
    const { restoreBackup } = await import("./backup");
    await expect(restoreBackup(backupUri)).rejects.toThrow(/copia de la base actual/);
    const copies = (FileSystem.copyAsync as any).mock.calls.map((c: any[]) => c[0]);
    expect(copies.some((c: any) => c.to === dbPath)).toBe(false);
    expect(FileSystem.moveAsync).not.toHaveBeenCalled();
  });

  it("el reemplazo es por temporal y renombrado, nunca copia directa sobre la base viva", async () => {
    const { restoreBackup } = await import("./backup");
    await expect(restoreBackup(backupUri)).resolves.toBeUndefined();
    const moves = (FileSystem.moveAsync as any).mock.calls.map((c: any[]) => c[0]);
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toBe(dbPath);
    expect(moves[0].from).toContain("nido-restore-");
    const copies = (FileSystem.copyAsync as any).mock.calls.map((c: any[]) => c[0]);
    expect(copies.some((c: any) => c.to === dbPath)).toBe(false);
    expect(copies.some((c: any) => String(c.to).includes("nido-restore-"))).toBe(true);
  });
});
