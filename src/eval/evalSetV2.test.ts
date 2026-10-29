/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Los casos de la evaluación v2 no pueden prometer nada que no exista: cada
 * guía citada es el inicio de un único título real del pack, cada región
 * existe en NIDO Local y cada frase exigida a una guía está en ella.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EVAL_SET_V2 } from "./evalSetV2";

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

function guides(lang: "es" | "en"): { title: string; text: string }[] {
  const dir = root(`knowledge-packs/nido-esencial/${lang}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const text = readFileSync(`${dir}/${f}`, "utf8");
      const title = /^title:\s*(.+)$/m.exec(text)?.[1].trim() ?? "";
      return { title, text };
    });
}
const GUIDES = [...guides("es"), ...guides("en")];
const REGIONS = Object.keys(
  (JSON.parse(readFileSync(root("knowledge-packs/nido-local/facts.json"), "utf8")) as { regions: Record<string, unknown> }).regions,
);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

describe("evaluación v2: los casos son verdad", () => {
  it("ids únicos", () => {
    const ids = EVAL_SET_V2.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runners y grupos válidos", () => {
    for (const c of EVAL_SET_V2) {
      expect(["ci-router", "ci-safety", "pack-retrieval+device", "device"]).toContain(c.runner);
      expect(["es", "en", "pt"]).toContain(c.lang);
    }
  });

  const guideCases = EVAL_SET_V2.filter((c) => c.expect.route?.startsWith("guide:"));
  it.each(guideCases.map((c) => [c.id, c] as const))("%s: la guía existe y es una sola", (_id, c) => {
    const prefix = c.expect.route!.slice("guide:".length);
    const matches = GUIDES.filter((g) => g.title.startsWith(prefix));
    expect(matches.length, `«${prefix}»`).toBe(1);
    if (c.group === "first-aid") {
      for (const s of c.expect.mustContain ?? []) expect(fold(matches[0].text)).toContain(fold(s));
    }
  });

  it("cada región de los casos existe en NIDO Local", () => {
    for (const c of EVAL_SET_V2) if (c.expect.region) expect(REGIONS).toContain(c.expect.region);
  });
});
