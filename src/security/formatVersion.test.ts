/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  checkFormatVersion,
  FormatVersionError,
  KnowledgeDbVersionError,
  MemoryDbVersionError,
  SettingsVersionError,
  InstallJournalVersionError,
  KNOWLEDGE_DB_SCHEMA_VERSION,
  MEMORY_DB_SCHEMA_VERSION,
  SETTINGS_FORMAT_VERSION,
  INSTALL_JOURNAL_VERSION,
} from "./formatVersion";

/** Error de prueba con formatId fijo. */
class TestVersionError extends FormatVersionError {
  constructor(found: unknown, reason: string) {
    super("test-format", found, 1, reason);
    this.name = "TestVersionError";
  }
}

function check(found: unknown, extra: { allowMissingAs?: number } = {}): number {
  return checkFormatVersion({
    formatId: "test-format",
    found,
    supportedMajor: 1,
    ErrorClass: TestVersionError,
    ...extra,
  });
}

describe("checkFormatVersion", () => {
  it("accepts the supported major as a number", () => {
    expect(check(1)).toBe(1);
  });

  it("accepts the supported major as a numeric string (DBs store TEXT)", () => {
    expect(check("1")).toBe(1);
    expect(check(" 1 ")).toBe(1);
  });

  it("rejects a newer major with a named, greppable error", () => {
    let caught: unknown;
    try {
      check(2);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TestVersionError);
    expect(caught).toBeInstanceOf(FormatVersionError);
    const err = caught as Error;
    expect(err.name).toBe("TestVersionError");
    expect(err.message).toContain("test-format");
    expect(err.message).toContain("2");
    expect(err.message).toContain("newer");
  });

  it("rejects an older major", () => {
    expect(() => check(0)).toThrowError(TestVersionError);
  });

  it("rejects missing without grandfathering", () => {
    expect(() => check(undefined)).toThrowError(/missing/);
    expect(() => check(null)).toThrowError(/missing/);
  });

  it("grandfathers missing when allowMissingAs is set", () => {
    expect(check(undefined, { allowMissingAs: 1 })).toBe(1);
    expect(check(null, { allowMissingAs: 1 })).toBe(1);
    // …pero un valor corrupto presente sigue fallando cerrado.
    expect(() => check("banana", { allowMissingAs: 1 })).toThrowError(TestVersionError);
  });

  it("rejects corrupt values", () => {
    const bad = ["banana", "", "   ", "1.5", "v1", 1.5, NaN, true, false, {}, [], ["1"]];
    for (const v of bad) {
      expect(() => check(v), `should reject ${JSON.stringify(v)}`).toThrowError(TestVersionError);
    }
  });

  it("every named error carries its format id and is greppable", () => {
    const cases = [
      [KnowledgeDbVersionError, "nido_knowledge.db", "KnowledgeDbVersionError"],
      [MemoryDbVersionError, "nido_memory.db", "MemoryDbVersionError"],
      [SettingsVersionError, "settings.json", "SettingsVersionError"],
      [InstallJournalVersionError, "nido-install-state.json", "InstallJournalVersionError"],
    ] as const;
    for (const [Cls, id, name] of cases) {
      const err = new Cls(99, "probe");
      expect(err).toBeInstanceOf(FormatVersionError);
      expect(err.name).toBe(name);
      expect(err.message).toContain(id);
      expect(err.message).toContain("99");
      expect(err.formatId).toBe(id);
      expect(err.found).toBe(99);
    }
  });

  it("all supported majors are 1 in L1", () => {
    expect(KNOWLEDGE_DB_SCHEMA_VERSION).toBe(1);
    expect(MEMORY_DB_SCHEMA_VERSION).toBe(1);
    expect(SETTINGS_FORMAT_VERSION).toBe(1);
    expect(INSTALL_JOURNAL_VERSION).toBe(1);
  });
});
