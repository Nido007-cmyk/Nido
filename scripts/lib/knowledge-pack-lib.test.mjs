/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { chunkGuide, chunkIntro, cleanIntro, parseArgs, parseGuide, quantizeInt8, splitQuestions, validateFacts, vitalListPages } from "./knowledge-pack-lib.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cosineSimilarity, cosineSimilarityInt8 } from "../../src/rag/pure";

describe("parseArgs", () => {
  it("defaults to Vital Articles level 5", () => {
    expect(parseArgs([])).toMatchObject({ level: 5, id: "wiki-vital5", chunkChars: 600, maxChunks: 3, threads: 4 });
  });
  it("names custom builds and validates values", () => {
    expect(parseArgs(["--titles", "t.txt"])).toMatchObject({ id: "wiki-custom", titlesFile: "t.txt" });
    expect(parseArgs(["--level", "4", "--limit", "100"])).toMatchObject({ level: 4, id: "wiki-vital4", limit: 100 });
    expect(() => parseArgs(["--level", "3"])).toThrow(/4 or 5/);
    expect(() => parseArgs(["--id", "Bad Id"])).toThrow(/lowercase/);
    expect(() => parseArgs(["--threads", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown option/);
  });
});

describe("vitalListPages", () => {
  it("keeps list pages, drops the index, archives and alerts", () => {
    const pages = [
      "Wikipedia:Vital articles/Level 5",
      "Wikipedia:Vital articles/Level 5/Arts",
      "Wikipedia:Vital articles/Level 5/People/Writers and journalists",
      "Wikipedia:Vital articles/Level 5/Article alerts",
      "Wikipedia:Vital articles/Level 5/Article alerts/Archive 1",
      "Wikipedia:Vital articles/Level 4/History",
    ];
    expect(vitalListPages(pages, 5)).toEqual([
      "Wikipedia:Vital articles/Level 5/Arts",
      "Wikipedia:Vital articles/Level 5/People/Writers and journalists",
    ]);
  });
});

describe("chunking", () => {
  it("cleans whitespace and empty paragraphs", () => {
    expect(cleanIntro("  A  b.\n\n\nC   d.  ")).toBe("A b.\nC d.");
  });

  it("splits on sentence boundaries near the target, keeping at most maxChunks", () => {
    const sentence = "This sentence has exactly fifty characters in it. ";
    const text = sentence.repeat(40).trim();
    const chunks = chunkIntro(text, 200, 3);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
      expect(c.endsWith(".")).toBe(true);
    }
  });

  it("keeps a short introduction whole and drops fragments", () => {
    const intro = "Napoleon Bonaparte was a French military and political leader.";
    expect(chunkIntro(intro, 600, 3)).toEqual([intro]);
    expect(chunkIntro("Hi.", 600, 3)).toEqual([]);
  });
});

describe("int8 embeddings", () => {
  it("keep cosine similarity within a hair of the float vectors", () => {
    const dims = 384;
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
    const vectors = Float32Array.from({ length: dims * 3 }, rand);
    const { data, scales } = quantizeInt8(vectors, dims);
    expect(scales).toHaveLength(3);
    const query = Float32Array.from({ length: dims }, rand);
    for (let i = 0; i < 3; i++) {
      const exact = cosineSimilarity(query, vectors.subarray(i * dims, (i + 1) * dims));
      const bytes = new Uint8Array(data.buffer, data.byteOffset + i * dims, dims);
      expect(Math.abs(cosineSimilarityInt8(query, bytes) - exact)).toBeLessThan(0.01);
    }
  });
});

describe("parseArgs — embedding model and fixed build date", () => {
  it("bge by default, e5 on request", () => {
    expect(parseArgs([]).embedding).toBe("bge");
    expect(parseArgs(["--embedding", "e5"]).embedding).toBe("e5");
  });
  it("rejects unknown models and bad dates", () => {
    expect(() => parseArgs(["--embedding", "openai"])).toThrow(/bge or e5/);
    expect(() => parseArgs(["--built-at", "ayer"])).toThrow(/ISO/);
  });
  it("keeps a fixed build date", () => {
    expect(parseArgs(["--built-at", "2026-10-23T00:00:00Z"]).builtAt).toBe("2026-10-23T00:00:00Z");
  });
});

describe("NIDO guides (--guides)", () => {
  const md = (body) => `---\ntitle: Test\ncategory: Primeros auxilios\nlang: es\nsources: Cruz Roja\n---\n${body}`;

  it("parseGuide reads front matter and splits sections", () => {
    const g = parseGuide(md("Intro.\n## Qué hacer\n1. Llama.\n### Detalle\n- Uno"), "t.md");
    expect(g).toMatchObject({ title: "Test", lang: "es", sources: "Cruz Roja", category: "Primeros auxilios" });
    expect(g.sections.map((s) => s.heading)).toEqual(["", "Qué hacer", "Detalle"]);
  });

  it("parseGuide rejects guides without front matter, title, language or sources", () => {
    expect(() => parseGuide("## A\nb", "x.md")).toThrow(/front matter/);
    expect(() => parseGuide("---\nlang: es\nsources: x\n---\n## A\nb", "x.md")).toThrow(/title/);
    expect(() => parseGuide("---\ntitle: T\nsources: x\n---\n## A\nb", "x.md")).toThrow(/lang/);
    expect(() => parseGuide("---\ntitle: T\nlang: es\n---\n## A\nb", "x.md")).toThrow(/sources/);
    expect(() => parseGuide("---\ntitle: T\nlang: es\nsources: x\n---\n\n", "x.md")).toThrow(/empty/);
  });

  it("chunkGuide never cuts a line and labels each chunk with its section", () => {
    const steps = Array.from({ length: 40 }, (_, i) => `- Paso ${i} con algo de texto para que ocupe sitio.`).join("\n");
    const chunks = chunkGuide(parseGuide(md(`## Pasos\n${steps}`), "t.md"), 400);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.body.startsWith("Pasos\n")).toBe(true);
      for (const line of c.body.split("\n").slice(1)) expect(line).toMatch(/^- Paso \d+ con algo de texto para que ocupe sitio\.$/);
    }
    const all = chunks.flatMap((c) => c.body.split("\n").slice(1));
    expect(all).toEqual(steps.split("\n"));
  });

  it("chunkGuide folds short sections (intro, closing note) into a neighbour", () => {
    const long = "x".repeat(400);
    const chunks = chunkGuide(parseGuide(md(`Intro corta.\n## A\n${long}\n## B\n${long}\n## Importante\nBasado en la Cruz Roja.`), "t.md"));
    expect(chunks.map((c) => c.heading)).toEqual(["A", "B"]);
    expect(chunks[0].body.startsWith("Intro corta.")).toBe(true);
    expect(chunks[1].body.endsWith("Importante\nBasado en la Cruz Roja.")).toBe(true);
  });

  it("every guide in knowledge-packs/nido-esencial parses, cites sources and ends with its note", () => {
    const root = fileURLToPath(new URL("../../knowledge-packs/nido-esencial", import.meta.url));
    const langs = readdirSync(root).filter((d) => !d.includes("."));
    expect(langs).toContain("es");
    const titles = new Map();
    for (const lang of langs) {
      const files = readdirSync(join(root, lang)).filter((f) => f.endsWith(".md"));
      expect(files.length).toBeGreaterThan(40);
      for (const f of files) {
        const g = parseGuide(readFileSync(join(root, lang, f), "utf8"), f);
        expect(g.lang).toBe(lang);
        expect(g.sources.length).toBeGreaterThan(5);
        expect(g.sections.at(-1).heading).toMatch(/^(Importante|Important)$/);
        expect(chunkGuide(g).length).toBeGreaterThan(0);
        titles.set(`${lang}:${g.title}`, (titles.get(`${lang}:${g.title}`) ?? 0) + 1);
      }
    }
    for (const [t, n] of titles) expect(n, t).toBe(1);
  });
});

describe("formato v2 de los packs (0.1.55)", () => {
  const guide = [
    "---",
    "title: Cuba: números",
    "lang: es",
    "sources: Consulado",
    "id: local-cuba",
    "region: CU",
    "verified: 2026-10-28",
    "questions: número de la ambulancia en Cuba | a qué número llamo en La Habana",
    "---",
    "En Cuba, el 104 es la ambulancia.",
    "<!-- preguntas: teléfono de emergencias cubano -->",
    "## Fases",
    "Fase de alarma: unas 24 horas.",
    "<!-- questions: what does the alarm phase mean -->",
  ].join("\n");

  it("lee id, región, fecha y preguntas, y las preguntas no aparecen en el texto", () => {
    const g = parseGuide(guide, "cu.md");
    expect(g).toMatchObject({ key: "local-cuba", region: "CU", verified: "2026-10-28" });
    expect(g.questions).toEqual(["número de la ambulancia en Cuba", "a qué número llamo en La Habana"]);
    expect(g.sections.map((s) => s.questions)).toEqual([["teléfono de emergencias cubano"], ["what does the alarm phase mean"]]);
    const chunks = chunkGuide(g);
    expect(chunks.map((c) => c.body).join("\n")).not.toMatch(/<!--|preguntas|questions/);
    expect(chunks[0].questions).toContain("número de la ambulancia en Cuba");
    expect(chunks.flatMap((c) => c.questions)).toContain("what does the alarm phase mean");
  });

  it("rechaza una región o una fecha mal escritas", () => {
    expect(() => parseGuide(guide.replace("region: CU", "region: Cuba"), "x.md")).toThrow(/ISO/);
    expect(() => parseGuide(guide.replace("verified: 2026-10-28", "verified: ayer"), "x.md")).toThrow(/YYYY-MM-DD/);
  });

  it("splitQuestions", () => {
    expect(splitQuestions(" a | | b ")).toEqual(["a", "b"]);
    expect(splitQuestions(undefined)).toEqual([]);
  });

  const region = { names: { es: "Cuba", en: "Cuba", pt: "Cuba" }, aliases: ["cuba"] };
  const fact = {
    key: "emergency.ambulance",
    region: "CU",
    value: "104",
    label: { es: "ambulancia", en: "ambulance", pt: "ambulância" },
    source: { title: "Consulado", url: "https://exteriores.gob.es/x", quote: "Ambulancia, 104", checked: "2026-10-27" },
  };

  it("validateFacts acepta un dato con su fuente, cita y fecha", () => {
    expect(validateFacts({ regions: { CU: region }, facts: [fact] }).facts).toHaveLength(1);
  });

  it("validateFacts rechaza un dato sin fuente, sin cita, con región desconocida o repetido", () => {
    const bad = (f) => () => validateFacts({ regions: { CU: region }, facts: [f] });
    expect(bad({ ...fact, source: { ...fact.source, quote: "" } })).toThrow(/quote/);
    expect(bad({ ...fact, source: { ...fact.source, url: "http://x" } })).toThrow(/https/);
    expect(bad({ ...fact, region: "XX" })).toThrow(/unknown region/);
    expect(bad({ ...fact, label: { es: "a", en: "b" } })).toThrow(/label.pt/);
    expect(() => validateFacts({ regions: { CU: region }, facts: [fact, fact] })).toThrow(/duplicated/);
    expect(() => validateFacts({ regions: { cu: region }, facts: [] })).toThrow(/ISO/);
    expect(() => validateFacts({ regions: { CU: { ...region, in: { es: "en Cuba" } } }, facts: [] })).toThrow(/in\.en/);
    expect(bad({ ...fact, note: { es: "solo en español" } })).toThrow(/note\.en/);
  });

  it("los datos de NIDO Local son válidos y cada uno cita su fuente oficial", () => {
    const file = fileURLToPath(new URL("../../knowledge-packs/nido-local/facts.json", import.meta.url));
    const { regions, facts } = validateFacts(JSON.parse(readFileSync(file, "utf8")), file);
    expect(Object.keys(regions).length).toBeGreaterThanOrEqual(20);
    for (const f of facts) {
      // A number the quote doesn't contain would be our claim, not the source's.
      const digits = f.value.replace(/\D/g, "");
      expect(f.source.quote.replace(/\D/g, "")).toContain(digits);
      expect(regions[f.region].in).toBeDefined();
    }
  });
});

