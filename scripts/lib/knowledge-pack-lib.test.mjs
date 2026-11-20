/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { chunkGuide, chunkIntro, cleanIntro, daysSince, htmlToText, parseArgs, publishBuiltFileSync, quoteIsPresent, parseGuide, quantizeInt8, splitQuestions, tempSiblingPath, validateFacts, vitalListPages, writeFileAtomicSync } from "./knowledge-pack-lib.mjs";
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
    // F-PC78 (paquete de arreglos del móvil, §9.2): esta expectativa
    // fijaba el defecto — una introducción corta ENTERA (un solo
    // trozo, que es también el último) desaparecía del pack en
    // silencio. El último trozo siempre sobrevive al filtro.
    expect(chunkIntro("Hi.", 600, 3)).toEqual(["Hi."]);
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


describe("comprobación semanal de fuentes (0.1.55)", () => {
  it("encuentra la cita aunque la página cambie tildes, comillas, mayúsculas o entidades", () => {
    const html = "<html><script>var x='911'</script><p>Ante cualquier emergencia llama al&nbsp;9&#8209;1&#8209;1.</p><p>Polic&iacute;a:  911</p></html>";
    const text = htmlToText(html);
    expect(quoteIsPresent(text, "Ante cualquier emergencia llama al 9-1-1.")).toBe(true);
    expect(quoteIsPresent(text, "Policía: 911")).toBe(true);
    expect(quoteIsPresent("Call 911 or 118.", "Call 911 or 128.")).toBe(false);
  });

  it("no cuenta el texto de los scripts como contenido visible", () => {
    expect(quoteIsPresent(htmlToText("<script>Bomberos: 132</script><p>otra cosa</p>"), "Bomberos: 132")).toBe(false);
  });

  it("calcula los días desde la última comprobación", () => {
    expect(daysSince("2026-10-01", new Date("2026-10-28T12:00:00Z"))).toBe(27);
  });
});

describe("publicación atómica del constructor (bounty, tanda 8)", () => {
  it("escribir atómico deja el contenido y ningún temporal; y republicar reemplaza", async () => {
    const { mkdtempSync, readFileSync, existsSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nido-atomic-"));
    try {
      const dest = join(dir, "pack.sqlite.json");
      writeFileAtomicSync(dest, "{\"v\":1}\n");
      expect(readFileSync(dest, "utf8")).toBe("{\"v\":1}\n");
      expect(existsSync(tempSiblingPath(dest))).toBe(false);
      writeFileAtomicSync(dest, "{\"v\":2}\n");
      expect(readFileSync(dest, "utf8")).toBe("{\"v\":2}\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("publicar un construido renombra el temporal y la edición anterior sobrevive hasta ese instante", async () => {
    const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nido-atomic-"));
    try {
      const dest = join(dir, "pack.sqlite");
      writeFileSync(dest, "EDICIÓN BUENA");
      const tmp = tempSiblingPath(dest);
      writeFileSync(tmp, "EDICIÓN NUEVA A MITAD");
      // La construcción en curso no ha tocado la edición buena:
      expect(readFileSync(dest, "utf8")).toBe("EDICIÓN BUENA");
      publishBuiltFileSync(tmp, dest);
      expect(readFileSync(dest, "utf8")).toBe("EDICIÓN NUEVA A MITAD");
      expect(existsSync(tmp)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// AMPLIACIÓN (paquete de arreglos del móvil, §9): la batería de
// F-PC77 a F-PC84, nacida contra esta misma biblioteca en PC
// (40 rojos allí) y cobrada aquí contra la copia del móvil, que
// era idéntica al byte. Tras la cura, las dos copias dejan de
// ser idénticas a propósito y con esta causa.
// ============================================================
import path from "node:path";
const guide = (meta, body = "Texto de introducción de la guía.") =>
  `---\n${meta}\n---\n${body}\n`;
const META = "title: Título\nlang: es\nsources: Fuente oficial";

const validDoc = () => ({
  regions: {
    ES: {
      names: { es: "España", en: "Spain", pt: "Espanha" },
      aliases: ["España", "Spain"],
    },
  },
  facts: [
    {
      key: "emergency.phone",
      region: "ES",
      value: "112",
      label: { es: "Emergencias", en: "Emergency", pt: "Emergência" },
      source: {
        title: "Fuente oficial",
        url: "https://example.com/oficial",
        quote: "Civil: 110",
        checked: "2026-03-01",
      },
    },
  ],
});

describe("F-PC77 · quantizeInt8 — la referencia lanza como el producto", () => {
  it("1 · un componente NaN lanza /non-finite/", () => {
    expect(() => quantizeInt8([0.5, Number.NaN], 2)).toThrow(/non-finite/);
  });
  it("2 · un componente Infinity lanza /non-finite/", () => {
    expect(() => quantizeInt8([Infinity, 0.5], 2)).toThrow(/non-finite/);
  });
  it("3 · 5 componentes con dims 2 lanzan /whole number/", () => {
    expect(() => quantizeInt8([1, 2, 3, 4, 5], 2)).toThrow(/whole number/);
  });
  it("4 · dims 1,5 lanza /dims/", () => {
    expect(() => quantizeInt8([1, 2, 3], 1.5)).toThrow(/dims/);
  });
  it("5 · dims 0 lanza /dims/ con su mensaje, no el RangeError crudo", () => {
    expect(() => quantizeInt8([1, 2], 0)).toThrow(/dims/);
  });
  it("6 · control: valores conocidos [0.5, -1, 0] con dims 3", () => {
    const { data, scales } = quantizeInt8([0.5, -1, 0], 3);
    expect(Array.from(data)).toEqual([64, -127, 0]);
    expect(scales).toHaveLength(1);
    expect(scales[0]).toBeCloseTo(1 / 127, 6);
  });
  it("7 · control: lote de dos vectores [3, 0, 0, -4] con dims 2", () => {
    const { data, scales } = quantizeInt8([3, 0, 0, -4], 2);
    expect(Array.from(data)).toEqual([127, 0, 0, -127]);
    expect(scales).toHaveLength(2);
  });
  it("8 · control: vector cero con escala 1 y lote vacío sin datos ni escalas", () => {
    const zero = quantizeInt8([0, 0], 2);
    expect(Array.from(zero.data)).toEqual([0, 0]);
    expect(zero.scales[0]).toBe(1);
    const empty = quantizeInt8([], 2);
    expect(empty.data).toHaveLength(0);
    expect(empty.scales).toHaveLength(0);
  });
});

describe("F-PC78 · chunkIntro — el último trozo no se filtra", () => {
  it("1 · una introducción de un solo enunciado corto sobrevive", () => {
    expect(chunkIntro("X is a village in Y.")).toEqual(["X is a village in Y."]);
  });
  it("2 · el cierre corto tras un trozo largo se conserva, con el objetivo por defecto", () => {
    const long = `${"a".repeat(650)}.`;
    const chunks = chunkIntro(`${long}\nClosing fact.`);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toBe("Closing fact.");
  });
  it("3 · el cierre aislado como trozo propio con objetivo 100 se conserva", () => {
    const s1 = `${"a".repeat(59)}.`;
    const s2 = `${"b".repeat(94)}.`;
    const chunks = chunkIntro(`${s1}\n${s2}\nClosing fact.`, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toBe("Closing fact.");
  });
  it("4 · control: el trozo intermedio residual corto sigue filtrado", () => {
    const s1 = `${"a".repeat(199)}.`;
    const mid = `${"m".repeat(29)}.`;
    const s2 = `${"b".repeat(199)}.`;
    const chunks = chunkIntro(`${s1}\n${mid}\n${s2}`, 210);
    expect(chunks).toHaveLength(2);
    expect(chunks.some((c) => c.includes("mmm"))).toBe(false);
  });
  it("5 · control: una introducción de solo espacios devuelve []", () => {
    expect(chunkIntro("   \n  ")).toEqual([]);
  });
  it("6 · control: dos enunciados largos dan dos trozos de 40 o más", () => {
    const s1 = `${"a".repeat(349)}.`;
    const s2 = `${"b".repeat(349)}.`;
    const chunks = chunkIntro(`${s1}\n${s2}`);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.length >= 40)).toBe(true);
  });
});

describe("F-PC79 · parseGuide — las preguntas sin texto lanzan, no se reatribuyen", () => {
  it("1 · un apartado con solo su comentario de preguntas, con introducción previa, lanza", () => {
    const md = guide(
      META,
      "Texto de la introducción.\n\n## A\n<!-- preguntas: ¿Pregunta de A? -->",
    );
    expect(() => parseGuide(md)).toThrow(/declares questions but has no text/);
  });
  it("2 · un apartado con solo preguntas seguido de otro con texto, sin apartado anterior, lanza", () => {
    const md = guide(
      META,
      "## A\n<!-- preguntas: ¿Pregunta de A? -->\n\n## B\nTexto de B con su contenido.",
    );
    expect(() => parseGuide(md)).toThrow(/declares questions but has no text/);
  });
  it("3 · control: un encabezado final vacío sin preguntas no nace y no lanza", () => {
    const md = guide(
      META,
      "Texto de la introducción.\n\n## A\nTexto de A.\n\n## Final",
    );
    const g = parseGuide(md);
    expect(g.sections).toHaveLength(2);
  });
  it("4 · control: un apartado con texto y preguntas conserva sus preguntas", () => {
    const md = guide(
      META,
      "Texto de la introducción.\n\n## A\nTexto de A.\n<!-- preguntas: ¿Pregunta de A? -->",
    );
    const g = parseGuide(md);
    const a = g.sections.find((s) => s.heading === "A");
    expect(a.questions).toEqual(["¿Pregunta de A?"]);
  });
  it("5 · control de corpus: las 243 guías reales parsean sin lanzar y el facts.json real valida", () => {
    const root = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "knowledge-packs",
    );
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".md") && e.name !== "README.md") files.push(p);
      }
    };
    walk(root);
    expect(files).toHaveLength(243);
    let sections = 0;
    let sectionQuestions = 0;
    let guideQuestions = 0;
    const keys = new Set();
    for (const f of files) {
      const g = parseGuide(readFileSync(f, "utf8"), path.basename(f));
      sections += g.sections.length;
      sectionQuestions += g.sections.reduce((n, s) => n + s.questions.length, 0);
      guideQuestions += g.questions.length;
      if (g.key) keys.add(g.key);
    }
    expect(sections).toBe(1203);
    expect(sectionQuestions).toBe(216);
    expect(guideQuestions).toBe(1140);
    expect(keys.size).toBe(81);
    const facts = JSON.parse(
      readFileSync(path.join(root, "nido-local", "facts.json"), "utf8"),
    );
    const checked = validateFacts(facts);
    expect(Object.keys(checked.regions)).toHaveLength(69);
    expect(checked.facts).toHaveLength(155);
  });
});

describe("F-PC80 · fechas reales — un solo ayudante para los cuatro sitios", () => {
  it("1 · verified 2026-02-30 en una guía lanza /verified/", () => {
    expect(() => parseGuide(guide(`${META}\nverified: 2026-02-30`))).toThrow(/verified/);
  });
  it("2 · verified 9999-99-99 lanza /verified/", () => {
    expect(() => parseGuide(guide(`${META}\nverified: 9999-99-99`))).toThrow(/verified/);
  });
  it("3 · verified 2026-02-29 (no bisiesto) lanza /verified/", () => {
    expect(() => parseGuide(guide(`${META}\nverified: 2026-02-29`))).toThrow(/verified/);
  });
  it("4 · control: verified 2024-02-29 (bisiesto) parsea y la fecha sale", () => {
    const g = parseGuide(guide(`${META}\nverified: 2024-02-29`));
    expect(g.verified).toBe("2024-02-29");
  });
  it("5 · control: verified 2026-11-07 parsea", () => {
    const g = parseGuide(guide(`${META}\nverified: 2026-11-07`));
    expect(g.verified).toBe("2026-11-07");
  });
  it("6 · source.checked 2026-02-30 en un hecho válido lanza /source.checked/", () => {
    const doc = validDoc();
    doc.facts[0].source.checked = "2026-02-30";
    expect(() => validateFacts(doc)).toThrow(/source.checked/);
  });
  it("7 · --built-at 2026-02-30 lanza /built-at/", () => {
    expect(() => parseArgs(["--built-at", "2026-02-30"])).toThrow(/built-at/);
  });
  it("8 · control: --built-at 2026-03-05 se acepta y sale en las opciones", () => {
    expect(parseArgs(["--built-at", "2026-03-05"]).builtAt).toBe("2026-03-05");
  });
  it("9 · control: --built-at not-a-date lanza, como ya lanzaba", () => {
    expect(() => parseArgs(["--built-at", "not-a-date"])).toThrow(/built-at/);
  });
  it("10 · daysSince de 9999-99-99 lanza /daysSince/", () => {
    expect(() => daysSince("9999-99-99", new Date("2026-03-05T00:00:00Z"))).toThrow(/daysSince/);
  });
  it("11 · daysSince de 2026-02-30 lanza /daysSince/, no cuenta desde la fecha rodada", () => {
    expect(() => daysSince("2026-02-30", new Date("2026-03-05T00:00:00Z"))).toThrow(/daysSince/);
  });
  it("12 · control: daysSince de 2026-03-01 al 2026-03-05 devuelve 4", () => {
    expect(daysSince("2026-03-01", new Date("2026-03-05T00:00:00Z"))).toBe(4);
  });
});

describe("F-PC81 · validateFacts — el contenedor mal formado lanza y el texto se valida como texto", () => {
  it("1 · facts como cadena lanza /facts must be an array/", () => {
    const doc = validDoc();
    doc.facts = "no-es-una-lista";
    expect(() => validateFacts(doc)).toThrow(/facts must be an array/);
  });
  it("2 · facts como objeto lanza /facts must be an array/", () => {
    const doc = validDoc();
    doc.facts = { key: "emergency.phone" };
    expect(() => validateFacts(doc)).toThrow(/facts must be an array/);
  });
  it("3 · el documento es un array []: lanza /not an object/", () => {
    expect(() => validateFacts([])).toThrow(/not an object/);
  });
  it("4 · el documento es {}: lanza /facts must be an array/", () => {
    expect(() => validateFacts({})).toThrow(/facts must be an array/);
  });
  it("5 · regions como array [] lanza /regions must be an object/", () => {
    const doc = validDoc();
    doc.regions = [];
    expect(() => validateFacts(doc)).toThrow(/regions must be an object/);
  });
  it("6 · aliases [123, \"\"] lanza /aliases/", () => {
    const doc = validDoc();
    doc.regions.ES.aliases = [123, ""];
    expect(() => validateFacts(doc)).toThrow(/aliases/);
  });
  it("7 · names.es 123 lanza /names.es/", () => {
    const doc = validDoc();
    doc.regions.ES.names.es = 123;
    expect(() => validateFacts(doc)).toThrow(/names\.es/);
  });
  it("8 · label.en 42 lanza /label.en/", () => {
    const doc = validDoc();
    doc.facts[0].label.en = 42;
    expect(() => validateFacts(doc)).toThrow(/label\.en/);
  });
  it("9 · source.url \"https://\" sin anfitrión lanza /source.url/", () => {
    const doc = validDoc();
    doc.facts[0].source.url = "https://";
    expect(() => validateFacts(doc)).toThrow(/source\.url/);
  });
  it("10 · source.url \"https:// not a url\" lanza /source.url/", () => {
    const doc = validDoc();
    doc.facts[0].source.url = "https:// not a url";
    expect(() => validateFacts(doc)).toThrow(/source\.url/);
  });
  it("11 · control: el documento sintético válido entero valida con 1 región y 1 hecho", () => {
    const checked = validateFacts(validDoc());
    expect(Object.keys(checked.regions)).toHaveLength(1);
    expect(checked.facts).toHaveLength(1);
  });
  it("12 · control: un hecho sin source lanza, como ya lanzaba", () => {
    const doc = validDoc();
    delete doc.facts[0].source;
    expect(() => validateFacts(doc)).toThrow(/source/);
  });
});

describe("F-PC82 · quoteIsPresent — presencia por secuencia de tokens y cita vacía rechazada", () => {
  it("1 · «Civil: 110» dentro de «Civil: 1100» está ausente", () => {
    expect(quoteIsPresent("Civil: 1100", "Civil: 110")).toBe(false);
  });
  it("2 · «emergency 911» dentro de «emergency 9110» está ausente", () => {
    expect(quoteIsPresent("emergency 9110", "emergency 911")).toBe(false);
  });
  it("3 · la cita \"---\" está ausente en todas partes", () => {
    expect(quoteIsPresent("completely unrelated page text", "---")).toBe(false);
  });
  it("4 · la cita vacía está ausente en todas partes", () => {
    expect(quoteIsPresent("any page", "")).toBe(false);
  });
  it("5 · un hecho válido con source.quote \"---\" lanza /source.quote/ en su validación", () => {
    const doc = validDoc();
    doc.facts[0].source.quote = "---";
    expect(() => validateFacts(doc)).toThrow(/source\.quote/);
  });
  it("6 · control: la cita exacta con otra puntuación y caso está presente", () => {
    expect(quoteIsPresent("Civil: 110, según la fuente oficial", "CIVIL: 110,")).toBe(true);
  });
  it("7 · control: la cita como tokens enteros dentro de una página larga está presente", () => {
    const page =
      "Lorem ipsum dolor sit amet, el teléfono de emergencias es el 112 en toda la Unión Europea, y también el texto que sigue después.";
    expect(quoteIsPresent(page, "el teléfono de emergencias es el 112")).toBe(true);
  });
  it("8 · control: la cita ausente de la página no está presente", () => {
    expect(quoteIsPresent("una página cualquiera con otro texto", "cita que no aparece")).toBe(false);
  });
});

describe("F-PC83 · htmlToText — la entidad fuera de rango no cae la comprobación y el bloque sin cerrar no es texto", () => {
  it("1 · \"a &#x110000; b\" no lanza y el texto trae a y b", () => {
    const text = htmlToText("a &#x110000; b");
    expect(text).toContain("a");
    expect(text).toContain("b");
  });
  it("2 · \"a &#9999999999; b\" no lanza y el texto trae a y b", () => {
    const text = htmlToText("a &#9999999999; b");
    expect(text).toContain("a");
    expect(text).toContain("b");
  });
  it("3 · un <script> sin cerrar no vierte su contenido en el texto visible", () => {
    const text = htmlToText("visible <script>var secret=1;");
    expect(text).toContain("visible");
    expect(text).not.toContain("secret");
  });
  it("4 · control: un script bien cerrado se retira y el texto de alrededor queda", () => {
    const text = htmlToText("before <script>var x=1;</script> after");
    expect(text).toContain("before");
    expect(text).toContain("after");
    expect(text).not.toContain("var x");
  });
  it("5 · control: &eacute; se pliega a «e»", () => {
    expect(htmlToText("caf&eacute;")).toBe("cafe");
  });
  it("6 · control: &#65; es «A»", () => {
    expect(htmlToText("&#65;")).toBe("A");
  });
});

describe("F-PC84 · parseGuide — idioma de la lista cerrada, clave duplicada como error e id estricto", () => {
  it("1 · lang xx-long lanza /lang/", () => {
    expect(() => parseGuide(guide("title: T\nlang: xx-long\nsources: S"))).toThrow(/lang/);
  });
  it("2 · lang 123 lanza /lang/", () => {
    expect(() => parseGuide(guide("title: T\nlang: 123\nsources: S"))).toThrow(/lang/);
  });
  it("3 · lang ES en mayúsculas lanza /lang/", () => {
    expect(() => parseGuide(guide("title: T\nlang: ES\nsources: S"))).toThrow(/lang/);
  });
  it("4 · title declarado dos veces lanza /duplicated/", () => {
    expect(() =>
      parseGuide(guide("title: Uno\ntitle: Dos\nlang: es\nsources: S")),
    ).toThrow(/duplicated/);
  });
  it("5 · id BAD ID WITH SPACES!! lanza /id/", () => {
    expect(() => parseGuide(guide(`${META}\nid: BAD ID WITH SPACES!!`))).toThrow(/id/);
  });
  it("6 · control: lang es, en y pt parsean y el idioma sale", () => {
    for (const lang of ["es", "en", "pt"]) {
      const g = parseGuide(guide(`title: T\nlang: ${lang}\nsources: S`));
      expect(g.lang).toBe(lang);
    }
  });
  it("7 · control: id local-cuba parsea y key es esa", () => {
    const g = parseGuide(guide(`${META}\nid: local-cuba`));
    expect(g.key).toBe("local-cuba");
  });
  it("8 · control: una guía sin id sale con key vacía", () => {
    const g = parseGuide(guide(META));
    expect(g.key).toBe("");
  });
});
