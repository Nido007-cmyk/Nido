/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría completa 2026-10-31 (F9-03): el cuerpo de las alertas de
// respaldo nunca es el mensaje interno crudo (nacido en español o
// inglés según el subsistema): con código, el texto localizado del
// código; sin código, el genérico localizado de la operación.

import { describe, it, expect } from "vitest";
import { backupErrorText } from "./backupErrorText";
import { BackupError } from "../security/backupErrors";
import es from "../i18n/locales/es.json";
import en from "../i18n/locales/en.json";
import pt from "../i18n/locales/pt.json";

// t de mentira con la semántica de react-i18next: devuelve la clave
// cuando no hay traducción, y el texto del locale cuando la hay.
function tOf(loc: unknown) {
  return (key: string): string => {
    let node: unknown = loc;
    for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
    return typeof node === "string" ? node : key;
  };
}

describe("backupErrorText (F9-03)", () => {
  it("con código conocido devuelve su texto localizado en el idioma de la UI", () => {
    const e = new BackupError("wrongKey", "mensaje interno en español");
    expect(backupErrorText(e, tOf(es), "backup.createFailed")).toBe(es.backup.errors.wrongKey);
    expect(backupErrorText(e, tOf(en), "backup.createFailed")).toBe(en.backup.errors.wrongKey);
    expect(backupErrorText(e, tOf(pt), "backup.createFailed")).toBe(pt.backup.errors.wrongKey);
  });

  it("sin código devuelve el genérico localizado, nunca el mensaje interno", () => {
    const e = new Error("raw internal detail: ENOENT at /data/user/0/...");
    for (const loc of [es, en, pt]) {
      const out = backupErrorText(e, tOf(loc), "backup.createFailed");
      expect(out).toBe((loc as typeof es).backup.createFailed);
      expect(out).not.toContain("ENOENT");
    }
    expect(backupErrorText("ni siquiera un Error", tOf(es), "backup.saveFailed")).toBe(es.backup.saveFailed);
  });
});
