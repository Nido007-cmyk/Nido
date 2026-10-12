/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { BackupError, backupErrorCode } from "./backupErrors";
import { BiometricCancelled } from "./biometricGate";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import pt from "../i18n/locales/pt.json";

describe("backupErrors", () => {
  it("reads the code of a BackupError and keeps the message", () => {
    const e = new BackupError("wrongKey", "La clave no abre este respaldo.");
    expect(backupErrorCode(e)).toBe("wrongKey");
    expect(e.message).toBe("La clave no abre este respaldo.");
    expect(e).toBeInstanceOf(Error);
  });
  it("a cancelled unlock is authCancelled", () => {
    expect(backupErrorCode(new BiometricCancelled("x"))).toBe("authCancelled");
  });
  it("unknown errors have no code", () => {
    expect(backupErrorCode(new Error("boom"))).toBeNull();
    expect(backupErrorCode("boom")).toBeNull();
    expect(backupErrorCode(null)).toBeNull();
    expect(backupErrorCode({ code: "nope" })).toBeNull();
  });
  it("every code has a text in every language", () => {
    const codes = ["storage", "dbMissing", "noDbKey", "invalid", "rollback", "keyFormat", "noDeviceKey", "wrongKey", "authCancelled"];
    for (const loc of [es, en, pt] as Array<{ backup: { errors: Record<string, string> } }>) {
      for (const c of codes) expect(loc.backup.errors[c], c).toBeTruthy();
    }
  });
});
