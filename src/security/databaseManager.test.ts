/**
 * Tests de persistencia unificada - DatabaseManager.
 *
 * Verifica:
 * 1. safeJsonParse no crashea con datos corruptos (H-5)
 * 2. La arquitectura unificada está correctamente documentada
 * 3. Los stores usan el DatabaseManager (no conexiones independientes)
 *
 * NOTA: Los tests de integración SQLite real viven en los tests
 * existentes de cada store. Este archivo verifica las garantías
 * del refactor a nivel de diseño.
 */

import { describe, it, expect } from "vitest";
import { safeJsonParse, getDatabaseEpoch } from "./databaseManager";
import * as fs from "fs";
import * as path from "path";

describe("safeJsonParse - no crashea con datos corruptos (H-5)", () => {
  it("parsea JSON válido", () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(["a", "b"]);
    expect(safeJsonParse('{"x":1}', {})).toEqual({ x: 1 });
  });

  it("retorna fallback con JSON corrupto", () => {
    expect(safeJsonParse("not json {{{", [])).toEqual([]);
    expect(safeJsonParse("", "fallback")).toBe("fallback");
    expect(safeJsonParse(null, [])).toEqual([]);
  });

  it("retorna fallback con undefined", () => {
    expect(safeJsonParse(undefined as any, "def")).toBe("def");
  });

  it("maneja arrays corruptos en allowed_tools", () => {
    // Caso real: scheduled_tasks.allowed_tools corrupto
    const corrupt = "{invalid json";
    const result = safeJsonParse<string[]>(corrupt, []);
    expect(result).toEqual([]);
  });
});

describe("Arquitectura unificada - verificación estática", () => {
  const srcDir = path.join(__dirname, "..");

  it("taskStore usa DatabaseManager (no getDb local)", () => {
    const content = fs.readFileSync(
      path.join(srcDir, "agent/scheduled/taskStore.ts"),
      "utf-8"
    );
    expect(content).toContain("from \"../../security/databaseManager\"");
    expect(content).not.toContain("async function getDb()");
    expect(content).not.toContain("let db: SQLite.SQLiteDatabase | null = null;");
    expect(content).not.toContain("let writeQueue");
  });

  it("learnedSkillStore usa DatabaseManager", () => {
    const content = fs.readFileSync(
      path.join(srcDir, "agent/skills/learnedSkillStore.ts"),
      "utf-8"
    );
    expect(content).toContain("from \"../../security/databaseManager\"");
    expect(content).not.toContain("async function getDb()");
  });

  it("knowledgeGraphStore usa DatabaseManager", () => {
    const content = fs.readFileSync(
      path.join(srcDir, "agent/memory/knowledgeGraphStore.ts"),
      "utf-8"
    );
    expect(content).toContain("from \"../../security/databaseManager\"");
    expect(content).not.toContain("async function getDb()");
  });

  it("DatabaseManager exporta las funciones necesarias", async () => {
    const dm = await import("./databaseManager");
    expect(typeof dm.getDatabase).toBe("function");
    expect(typeof dm.writeTransaction).toBe("function");
    expect(typeof dm.closeDatabase).toBe("function");
    expect(typeof dm.wipeDatabase).toBe("function");
    expect(typeof dm.safeJsonParse).toBe("function");
    expect(typeof dm.getDatabaseEpoch).toBe("function");
  });

  it("close*Store son no-op (delegan al manager)", () => {
    const taskStore = fs.readFileSync(
      path.join(srcDir, "agent/scheduled/taskStore.ts"),
      "utf-8"
    );
    expect(taskStore).toContain("@deprecated");
    expect(taskStore).toContain("closeDatabase() del DatabaseManager");
  });
});

describe("Garantías de seguridad preservadas", () => {
  it("DatabaseManager no tiene fallback a plaintext", async () => {
    const content = fs.readFileSync(
      path.join(__dirname, "databaseManager.ts"),
      "utf-8"
    );
    // No debe haber .catch(() => null) en getDatabaseKeyHex
    expect(content).not.toMatch(/getDatabaseKeyHex\(\)\.catch\(\(\) => null\)/);
    // Debe propagar el error (fail-closed)
    expect(content).toContain("Fail-closed");
  });

  it("Usa wipe gate centralizado", async () => {
    const content = fs.readFileSync(
      path.join(__dirname, "databaseManager.ts"),
      "utf-8"
    );
    expect(content).toContain("getWipeGate()");
  });

  it("Usa epoch para invalidar handles", async () => {
    const content = fs.readFileSync(
      path.join(__dirname, "databaseManager.ts"),
      "utf-8"
    );
    expect(content).toContain("DbLifecycleEndedError");
    expect(content).toContain("currentEpoch");
  });
});
