/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chunkGuide, parseGuide } from "../../scripts/lib/knowledge-pack-lib.mjs";
import {
  buildLexicalQuery,
  countMatchedTerms,
  dropUnfoundedCorpus,
  filterByTermCoverage,
  type LexicalTerm,
} from "./pure";

/**
 * C-05: la caída honesta sin fuente. La recuperación léxica servía un
 * vecino plausible (fragmentos que solo comparten las palabras genéricas
 * de la pregunta, o una mención de procedencia) y la caída a «sin
 * fuentes» de ChatScreen —que exige cero fragmentos— nunca se alcanzaba.
 * La cura son dos señales de presencia por corpus en pure.ts
 * (dropUnfoundedCorpus), tras la puerta de cobertura: la señal A (el
 * corpus no contiene el tema: hay términos a df 0 y ningún servido casa
 * un término discriminativo) y la señal B (el tipo de dato pedido no
 * existe en el corpus: dirección/correo/precio a df 0, con exención del
 * corpus del usuario).
 *
 * Las superficies son réplicas fieles validadas: los packs se construyen
 * parseando y troceando las guías reales del repo con el código del
 * empaquetador (scripts/lib/knowledge-pack-lib.mjs) sobre un FTS5 real
 * (node:sqlite), y el pipeline es el de packs.ts (MATCH con tope 400 →
 * puerta → señal → corte). Sobre el pack publicado v9 la réplica de
 * Local reproduce cifra a cifra las sondas del diseño (D2: pool 22,
 * puerta sirve 6; T2: pool 7, puerta sirve 2; Cuba: pool 85; México:
 * pool 88), medido el 2026-11-01 sobre el tip de la tanda.
 */

interface Guide {
  title: string;
}
interface GuideChunk {
  heading: string | null;
  body: string;
  questions?: string[];
}
const parse = parseGuide as (text: string, name?: string) => Guide;
const chunk = chunkGuide as (g: Guide) => GuideChunk[];

interface Row {
  title: string;
  body: string;
  keys: string;
  rank: number;
}

function packDb(pack: string, langs: string[]): DatabaseSync {
  const dir = fileURLToPath(new URL(`../../knowledge-packs/${pack}`, import.meta.url));
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(title, body, keys)");
  const insert = db.prepare("INSERT INTO chunks_fts (title, body, keys) VALUES (?, ?, ?)");
  for (const lang of langs) {
    for (const file of readdirSync(`${dir}/${lang}`).filter((f) => f.endsWith(".md")).sort()) {
      const g = parse(readFileSync(`${dir}/${lang}/${file}`, "utf8"), file);
      for (const c of chunk(g)) {
        insert.run(c.heading ? `${g.title} — ${c.heading}` : g.title, c.body, (c.questions ?? []).join("\n"));
      }
    }
  }
  return db;
}

function ftsPool(db: DatabaseSync, match: string): Row[] {
  return db
    .prepare("SELECT title, body, keys, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 400")
    .all(match) as unknown as Row[];
}

/** El pipeline léxico de packs.ts con la señal de C-05 tras la puerta. */
function packSearch(db: DatabaseSync, query: string, limit = 12) {
  const lq = buildLexicalQuery(query);
  if (!lq) return { pool: [] as Row[], gated: [] as Row[], founded: [] as Row[], served: [] as Row[], terms: [] as LexicalTerm[] };
  const pool = ftsPool(db, lq.match);
  const gated = filterByTermCoverage(pool, lq.terms);
  const founded = dropUnfoundedCorpus(pool, gated, lq.terms, { query });
  const served = founded.slice(0, limit);
  return { pool, gated, founded, served, terms: lq.terms };
}

const matchedForms = (r: Row, terms: LexicalTerm[]) =>
  terms.filter((t) => countMatchedTerms(`${r.title} ${r.body} ${r.keys}`, [t]) > 0).map((t) => t.forms[0]);

const local = packDb("nido-local", ["es", "en", "pt"]);
const esencial = packDb("nido-esencial", ["es", "en"]);

describe("C-05 · la caída honesta contra Local (sin Esencial)", () => {
  it("D2: la puerta sirve 6 vecinos genéricos y la señal A hace caer el corpus entero", () => {
    const q = "¿Cómo se prepara el suero oral en casa?";
    const { gated, served, terms } = packSearch(local, q);
    // El defecto, fijado: 6 fragmentos que solo casan {prepara, casa}.
    expect(gated.length).toBe(6);
    expect(gated.every((r) => matchedForms(r, terms).join(",") === "prepara,casa")).toBe(true);
    // La cura: el corpus cae a cero y ChatScreen alcanza su texto seguro.
    expect(served).toEqual([]);
  });

  it("T2: la mención de procedencia no es fuente de la dirección; la señal B hace caer el corpus", () => {
    const { gated, served } = packSearch(local, "¿Cuál es la dirección del consulado de España en La Habana?");
    expect(gated.length).toBe(2);
    expect(served).toEqual([]);
  });

  it("control Cuba: el vecino que SÍ es la respuesta sigue sirviéndose, con los 3 términos en cabeza", () => {
    const { gated, founded, served, terms } = packSearch(local, "¿Cuál es el número de emergencias en Cuba?");
    expect(founded.length).toBe(gated.length);
    expect(served.length).toBeGreaterThan(0);
    expect(matchedForms(served[0], terms)).toEqual(["numero", "emergencias", "cuba"]);
  });

  it("control México: ídem, 3 términos en cabeza y ninguna señal se forma", () => {
    const { gated, founded, served, terms } = packSearch(local, "¿Cuál es el número de emergencias en México?");
    expect(founded.length).toBe(gated.length);
    expect(served.length).toBeGreaterThan(0);
    expect(matchedForms(served[0], terms)).toEqual(["numero", "emergencias", "mexico"]);
  });

  it("caso borde declarado: «¿qué hago en una emergencia?» no forma la señal y la conducta de hoy no cambia", () => {
    // Con la guarda de ≥ 3 términos la señal A no se forma (la pregunta
    // deja un solo término, «emergencia»): la caída ahí sería decisión
    // editorial, no de esta señal. La fixture documenta la conducta.
    const { gated, founded, terms } = packSearch(local, "¿qué hago en una emergencia?");
    expect(terms.length).toBe(1);
    expect(gated.length).toBeGreaterThan(0);
    expect(founded.length).toBe(gated.length);
  });
});

describe("C-05 · la señal es por corpus (Esencial no cae con Local)", () => {
  it("D2 con Esencial: la guía 26 es la respuesta y su corpus no cae", () => {
    const { gated, founded, served } = packSearch(esencial, "¿Cómo se prepara el suero oral en casa?");
    expect(founded.length).toBe(gated.length);
    expect(served.some((r) => r.title.includes("suero oral"))).toBe(true);
  });

  it("resto nombrado A4-02: «¿Cuánto cuesta una ambulancia?» sigue admitiendo 5 fragmentos de las mismas 5 guías (las señales no lo cazan, por diseño)", () => {
    // Medido por la adversaria-4 y re-medido en esta tanda: «cuanto» lo
    // siembran las llaves questions: y «cuesta» entra por el cuerpo en su
    // acepción de dificultad; no hay término a df 0 en su pool (la señal
    // A no se forma) y «cuesta» no es el término de tipo «precio» (la
    // señal B no lo cubre). La fixture fija el resto: estirar la señal
    // para cazarlo sería otra decisión, no esta cura.
    const q = "¿Cuánto cuesta una ambulancia?";
    const { gated, founded, served } = packSearch(esencial, q);
    expect(gated.length).toBe(5);
    expect(founded.length).toBe(gated.length);
    expect(served.map((r) => r.title.split(" — ")[0])).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Shock"),
        expect.stringContaining("Alergia"),
        expect.stringContaining("Intoxicaciones"),
        expect.stringContaining("Tsunami"),
        expect.stringContaining("Incendio"),
      ])
    );
  });
});

describe("C-05 · la pierna del dispositivo: exención del usuario y guarda de pool", () => {
  interface DRow extends Row {
    user: boolean;
  }
  function deviceDb(docs: Array<{ title: string; body: string; user: boolean }>): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(title, body)");
    const insert = db.prepare("INSERT INTO chunks_fts (title, body) VALUES (?, ?)");
    docs.forEach((d) => insert.run(d.title, d.body));
    return db;
  }
  function deviceSearch(db: DatabaseSync, docs: Array<{ title: string; user: boolean }>, query: string) {
    const lq = buildLexicalQuery(query)!;
    const raw = db
      .prepare("SELECT title, body, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 192")
      .all(lq.match) as Array<{ title: string; body: string; rank: number }>;
    const pool: DRow[] = raw.map((r) => ({ ...r, keys: "", user: docs.some((d) => d.user && d.title === r.title) }));
    const gated = filterByTermCoverage(pool, lq.terms);
    const served = dropUnfoundedCorpus(pool, gated, lq.terms, {
      query,
      servedFromUser: gated.map((r) => r.user),
    });
    return { pool, gated, served };
  }

  it("T2 con documento del usuario que trae la dirección sin la palabra «dirección»: sirve, por la exención", () => {
    const docs = [
      {
        title: "Consulado de España en La Habana (nota guardada)",
        body: "Consulado de España, Calle Zanja 123, La Habana. Atiende con cita previa desde las nueve.",
        user: true,
      },
      {
        title: "Fases ante ciclones",
        body: "Según el Consulado de España en La Habana, desde un teléfono móvil se marca un 7 delante.",
        user: false,
      },
    ];
    const db = deviceDb(docs);
    const { gated, served } = deviceSearch(db, docs, "¿Cuál es la dirección del consulado de España en La Habana?");
    expect(gated.length).toBeGreaterThan(0);
    expect(served.length).toBe(gated.length);
    expect(served.some((r) => r.user)).toBe(true);
  });

  it("pregunta legítima sobre pool pequeño de usuario: la guarda pool < 8 no dispara", () => {
    const docs = [
      { title: "Pan casero", body: "El pan se prepara en casa con harina y agua.", user: true },
      { title: "La casa de la playa", body: "La casa queda frente al mar.", user: true },
      { title: "Notas de cocina", body: "El domingo se prepara en casa el almuerzo.", user: true },
    ];
    const db = deviceDb(docs);
    const { pool, gated, served } = deviceSearch(db, docs, "¿Cómo se prepara el suero oral en casa?");
    expect(pool.length).toBeLessThan(8);
    expect(gated.length).toBe(2);
    expect(served.length).toBe(gated.length);
  });
});
