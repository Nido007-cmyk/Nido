/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría 0.1.112, bloque 8: el motivo concreto de un respaldo inválido
 * llega a la persona en su idioma. Antes:
 *  - la ruta «Restaurar» mostraba v.reason, el texto interno en español,
 *    también a quien usa NIDO en inglés o portugués;
 *  - las rutas que lanzan BackupError("invalid") mostraban solo «el
 *    archivo no es un respaldo válido» en los tres idiomas, sin motivo.
 * El contrato no cambia: el código sigue siendo «invalid» y el mensaje
 * interno sigue en español; el motivo viaja aparte (detail/reasonCode).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/mock/",
  EncodingType: { UTF8: "utf8", Base64: "base64" },
  getInfoAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  readDirectoryAsync: vi.fn().mockResolvedValue([]),
}));

import * as FileSystem from "expo-file-system/legacy";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import pt from "../i18n/locales/pt.json";
import { backupErrorText, invalidBackupText } from "../ui/backupErrorText";
import { validateBackup } from "./backup";
import { BackupError, INVALID_REASONS } from "./backupErrors";

const LOCALES = { es, en, pt } as const;

function tFor(lang: keyof typeof LOCALES) {
  const fn = (key: string): string => {
    let cur: unknown = LOCALES[lang];
    for (const part of key.split(".")) {
      cur = (cur as Record<string, unknown> | undefined)?.[part];
    }
    return typeof cur === "string" ? cur : key;
  };
  return fn as unknown as Parameters<typeof backupErrorText>[1];
}

describe("bloque 8 (0.1.112): el motivo de un respaldo inválido, traducido", () => {
  it("cada motivo tiene texto en es, en y pt", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      const reasons = (LOCALES[lang] as { backup: { invalidReasons: Record<string, string> } }).backup.invalidReasons;
      expect(Object.keys(reasons).sort(), lang).toEqual([...INVALID_REASONS].sort());
    }
  });

  it("todo «valid: false» de backup.ts lleva su reasonCode", () => {
    const src = readFileSync(join(__dirname, "backup.ts"), "utf8");
    const blocks = src.split("valid: false").slice(1).map((b) => b.slice(0, 260));
    expect(blocks.length).toBeGreaterThan(15);
    for (const b of blocks) expect(b.split("}")[0]).toContain("reasonCode");
  });

  it("todo BackupError(\"invalid\") de backup.ts lleva su motivo", () => {
    const src = readFileSync(join(__dirname, "backup.ts"), "utf8");
    const calls = src.match(/new BackupError\("invalid",[^;]*;/g) ?? [];
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(c, c).toMatch(/,\s*(?:"[a-zA-Z]+"|\w+\.reasonCode)\);$/);
  });

  it("el error lanzado dice el motivo en el idioma de la app, no en español", () => {
    const e = new BackupError("invalid", "Backup inválido: Este respaldo es de una versión más nueva de NIDO.", "tooNew");
    const en_ = backupErrorText(e, tFor("en"), "backup.restoreFailed");
    expect(en_).toBe("The file isn't a valid backup. It's from a newer version of NIDO. Update NIDO to restore it.");
    expect(backupErrorText(e, tFor("pt"), "backup.restoreFailed")).toContain("versão mais nova");
    expect(backupErrorText(e, tFor("es"), "backup.restoreFailed")).toContain("versión más nueva");
    // Contrato: el código sigue siendo «invalid» y el mensaje interno no cambia.
    expect(e.code).toBe("invalid");
    expect(e.message).toMatch(/^Backup inválido: /);
  });

  it("sin motivo (errores viejos o desconocidos) queda el genérico localizado", () => {
    const e = new BackupError("invalid", "x");
    expect(backupErrorText(e, tFor("en"), "backup.restoreFailed")).toBe("The file isn't a valid backup.");
    expect(invalidBackupText(undefined, tFor("pt"))).toBe("O arquivo não é um backup válido.");
  });

  it("la validación devuelve el motivo como código", async () => {
    (FileSystem.getInfoAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ exists: false });
    expect((await validateBackup("/no/existe.db")).reasonCode).toBe("notFound");
    (FileSystem.getInfoAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ exists: true, size: 100 });
    expect((await validateBackup("/pequeno.db")).reasonCode).toBe("tooSmall");
    (FileSystem.getInfoAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ exists: true, size: 5000 });
    (FileSystem.readAsStringAsync as ReturnType<typeof vi.fn>).mockResolvedValue("{no es json");
    expect((await validateBackup("/r.nidobackup.json")).reasonCode).toBe("notJson");
    (FileSystem.readAsStringAsync as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ format: "otro", pad: "x".repeat(200) }));
    expect((await validateBackup("/r.nidobackup.json")).reasonCode).toBe("unknownFormat");
  });

  it("la pantalla ya no muestra el texto interno en español a un usuario en inglés", () => {
    const screen = readFileSync(join(__dirname, "../ui/ModelSetupScreen.tsx"), "utf8");
    expect(screen).not.toContain("v.reason ??");
    expect(screen).toContain("invalidBackupText(v.reasonCode, t)");
  });
});
