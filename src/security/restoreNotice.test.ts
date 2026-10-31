/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** Auditoría 2026-10-29: el aviso antes de restaurar dice de cuándo es y qué vuelve. */
import { describe, expect, it } from "vitest";
import es from "../i18n/locales/es.json";
import en from "../i18n/locales/en.json";
import pt from "../i18n/locales/pt.json";
import { formatBackupDate, restoreConfirmText } from "./restoreNotice";

function tOf(locale: unknown) {
  const backup = (locale as { backup: Record<string, unknown> }).backup;
  return (key: string, vars: Record<string, string> = {}) => {
    const raw = backup[key.replace(/^backup\./, "")];
    if (typeof raw !== "string") throw new Error(`falta ${key}`);
    return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  };
}

const info = (createdAt: string | null, appVersion: string | null = null) => ({
  createdAt,
  appVersion,
  version: 1,
  tooNew: false,
});

describe("aviso de restauración", () => {
  it("con fecha y versión", () => {
    const text = restoreConfirmText(tOf(es), info("2026-09-01T08:00:00.000Z", "0.1.59-alpha"), "es");
    expect(text).toMatch(/^Este respaldo es del .*2026 \(NIDO 0\.1\.59-alpha\)\./);
    expect(text).toContain("volverá");
    expect(text).toContain("siguen revocados");
  });

  it("sin manifest: el aviso genérico, que también dice qué vuelve", () => {
    for (const [loc, back] of [
      [es, "volverá"],
      [en, "will come back"],
      [pt, "voltará"],
    ] as const) {
      const text = restoreConfirmText(tOf(loc), undefined, "es");
      expect(text).toContain(back);
      expect(text).not.toContain("{{");
    }
  });

  it("los tres idiomas tienen las claves y ninguna queda sin rellenar", () => {
    for (const loc of [es, en, pt]) {
      const text = restoreConfirmText(tOf(loc), info("2026-09-01T08:00:00.000Z"), "en");
      expect(text).not.toContain("{{");
      // Sin versión en el manifest, {{made}} se expande a nada: no
      // puede quedar el resto "(NIDO …)" de restoreMadeWith. (La
      // auditoría F3-06 metió la prosa «identidad NIDO a NIDO» en
      // el texto, así que la guarda apunta al resto con paréntesis,
      // no a la palabra.)
      expect(text).not.toMatch(/\(NIDO/);
    }
  });

  it("una fecha rota no rompe el aviso", () => {
    expect(formatBackupDate("no-es-fecha", "es")).toBe("no-es-fech");
    expect(formatBackupDate("2026-09-01T08:00:00.000Z", "en")).toMatch(/2026/);
  });
});
