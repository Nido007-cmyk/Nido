/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { groundingBadge } from "./groundingBadge";
import es from "../../i18n/locales/es.json";
import en from "../../i18n/locales/en.json";
import pt from "../../i18n/locales/pt.json";

describe("groundingBadge (0.1.117)", () => {
  it("verde solo cuando la comprobación dio respaldo a todas las frases", () => {
    expect(groundingBadge("grounded", [], 2)).toEqual({ tone: "verified", key: "groundingBadge.verified" });
  });

  it("ámbar cuando se quitaron frases sin respaldo", () => {
    expect(groundingBadge("partial", undefined, 1)).toEqual({ tone: "partial", key: "groundingBadge.partial" });
  });

  it("nada en los estados que no son una comprobación con respaldo", () => {
    for (const g of ["abstained", "unverified", "skipped", undefined] as const) {
      expect(groundingBadge(g, [], 3)).toBeNull();
    }
  });

  it("una cifra que la fuente contradice apaga la franja", () => {
    expect(groundingBadge("grounded", [{ sourceSentence: "x" }], 2)).toBeNull();
    expect(groundingBadge("partial", [{ sourceSentence: "x" }], 2)).toBeNull();
  });

  it("sin fuentes no hay franja aunque el estado diga grounded", () => {
    expect(groundingBadge("grounded", [], 0)).toBeNull();
  });

  it("los textos existen en es, en y pt", () => {
    for (const loc of [es, en, pt] as Array<Record<string, any>>) {
      expect(typeof loc.groundingBadge.verified).toBe("string");
      expect(typeof loc.groundingBadge.partial).toBe("string");
    }
  });
});
