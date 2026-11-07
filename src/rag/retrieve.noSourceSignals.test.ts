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

  it("A8-03 (C-05b): «¿Qué hago si no me llega el correo de confirmación?» pide un procedimiento, no el dato: la señal B no retira lo que la puerta sirve", () => {
    // La adversaria-8 lo demostró sobre el pack publicado: la puerta
    // sirve 1 (Brasil: las alertas por SMS casan llega+confirmacion) y
    // el marco ancho de la señal B («¿Qué…?» + el tipo de pasada) lo
    // retiraba. El tipo va mencionado, no preguntado: con el veto de
    // procedimiento la conducta vuelve a ser la de la base.
    const { gated, founded } = packSearch(local, "¿Qué hago si no me llega el correo de confirmación?");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(gated.length);
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

  it("resto nombrado A4-02: «¿Cuánto cuesta una ambulancia?» sigue admitiendo 4 fragmentos de 4 guías (las señales no lo cazan, por diseño)", () => {
    // Medido por la adversaria-4 y re-medido en esta tanda: «cuanto» lo
    // siembran las llaves questions: y «cuesta» entra por el cuerpo en su
    // acepción de dificultad; no hay término a df 0 en su pool (la señal
    // A no se forma) y «cuesta» no es el término de tipo «precio» (la
    // señal B no lo cubre). La fixture fija el resto: estirar la señal
    // para cazarlo sería otra decisión, no esta cura.
    // Re-medido el 2026-11-07 tras el re-cotejo IFRC/ERC 2025 (suelo
    // knowledge-packs-v15): el resto pasa de 5 a 4 sin tocar el código de
    // recuperación. La guía 12 (alergia grave) reescribió la frase del
    // aguijón según IFRC 2025 («ráspalo con algo plano… no lo pinces») y
    // su troceado cambió: «cuanto» quedó en el trozo nuevo de «Picaduras
    // de abeja» y «cuesta» en el de «Qué hacer», así que ningún fragmento
    // de esa guía cubre ya los dos términos y la puerta la deja fuera.
    const q = "¿Cuánto cuesta una ambulancia?";
    const { gated, founded, served } = packSearch(esencial, q);
    expect(gated.length).toBe(4);
    expect(founded.length).toBe(gated.length);
    expect(served.map((r) => r.title.split(" — ")[0])).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Shock"),
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

  it("A8-01 (C-05b): «¿A qué correo…?» cae exactamente como su gemela «¿Cuál es el correo…?»", () => {
    // Construcción de la adversaria-8 (pierna del dispositivo, pool < 8:
    // la señal A queda descartada como causa): un fragmento de la casa
    // que casa solicitud+visa pasa la puerta. Con la gemela cae por la
    // señal B (correo a df 0); con la forma «a qué» el marco no se
    // formaba y el fragmento se servía — la única diferencia es la
    // palabra inicial.
    const docs = [
      {
        title: "Solicitud de la visa",
        body: "La solicitud de la visa se manda con el pasaporte y la foto en la ventanilla.",
        user: false,
      },
    ];
    const db = deviceDb(docs);
    const gemela = deviceSearch(db, docs, "¿Cuál es el correo para la solicitud de la visa?");
    expect(gemela.gated.length).toBe(1);
    expect(gemela.served).toEqual([]);
    const aQue = deviceSearch(db, docs, "¿A qué correo mando la solicitud de la visa?");
    expect(aQue.gated.length).toBe(1);
    expect(aQue.served).toEqual([]);
  });

  it("A8-02 (C-05b): bajo dictado (abridor y el tipo en la segunda oración) la señal B alcanza la pregunta de dato como en T2", () => {
    // La misma construcción sobre un solo estado: el fragmento de la
    // casa casa los términos del tema (consulado, España, La Habana,
    // trámite) sin nombrar el tipo. Con la forma T2 al inicio cae; con
    // el dictado («Oye,…» y «Necesito la dirección…» en la segunda
    // oración) el marco anclado al inicio de la cadena no lo alcanzaba
    // y el fragmento se servía.
    const docs = [
      {
        title: "Consulado de España en La Habana",
        body: "El consulado de España en La Habana atiende el trámite de la visa; la cita queda registrada donde indica la oficina y se pide cuando necesito renovar.",
        user: false,
      },
    ];
    const db = deviceDb(docs);
    const t2 = deviceSearch(db, docs, "¿Cuál es la dirección del consulado de España en La Habana?");
    expect(t2.gated.length).toBe(1);
    expect(t2.served).toEqual([]);
    const dictada = deviceSearch(db, docs, "Oye, ¿dónde queda eso? Necesito la dirección del consulado de España en La Habana, es para un trámite.");
    expect(dictada.gated.length).toBe(1);
    expect(dictada.served).toEqual([]);
  });
});

describe("C-05c · la familia del veto sobre el pack real (Local): «¿Qué + verbo…?» no pide el dato", () => {
  // A9-01 (adversaria-9 sobre C-05b): el veto de procedimiento de C-05b
  // enumeraba los verbos que conocía ({hago, hacer, debo, puedo, tengo…})
  // y la familia de la pregunta de suceso/procedimiento con el tipo de
  // pasada es más ancha que la lista: con «pasa», «ocurre», «sucede»,
  // «debería» y «hay» la puerta servía y la señal B lo retiraba todo,
  // exactamente el daño de A8-03 con otro verbo. Las cinco formas,
  // literales del §3 del encargo, medidas sobre la base de arranque
  // (b38564c): puerta 2/1/1/1/1, fundados 0 en las cinco.
  it("A9-01 §3.1: «¿Qué pasa si no me llega el correo de confirmación?» — puerta 2, fundados 2 (Brasil SMS y México ciclones no caen)", () => {
    const { gated, founded } = packSearch(local, "¿Qué pasa si no me llega el correo de confirmación?");
    expect(gated.length).toBe(2);
    expect(founded.length).toBe(2);
  });

  it("A9-01 §3.2: «¿Qué ocurre si no me llega el correo de confirmación?» — puerta 1, fundados 1", () => {
    const { gated, founded } = packSearch(local, "¿Qué ocurre si no me llega el correo de confirmación?");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(1);
  });

  it("A9-01 §3.3: «¿Qué sucede si no me llega el correo de confirmación?» — puerta 1, fundados 1", () => {
    const { gated, founded } = packSearch(local, "¿Qué sucede si no me llega el correo de confirmación?");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(1);
  });

  it("A9-01 §3.4: «¿Qué debería hacer si no me llega el correo de confirmación?» — puerta 1, fundados 1 (la obligación en condicional también es la familia)", () => {
    const { gated, founded } = packSearch(local, "¿Qué debería hacer si no me llega el correo de confirmación?");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(1);
  });

  it("A9-01 §3.5: «¿Qué hay que hacer si no me llega el correo de confirmación?» — puerta 1, fundados 1 (la obligación impersonal también)", () => {
    const { gated, founded } = packSearch(local, "¿Qué hay que hacer si no me llega el correo de confirmación?");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(1);
  });

  // La batería de familia del §5 del encargo, en su pierna de pack real:
  // formas generadas por la regla de la clase (suceso y modo en
  // condicional, obligación no enumerada) con la cláusula del correo.
  // Sobre la base medían puerta 1 y fundados 0: la regla estructural las
  // cubre sin haberlas visto, o no es la clase.
  const familiaPack: Array<[string, number]> = [
    ["¿Qué pasaría si no me llega el correo de confirmación?", 1],
    ["¿Qué ocurriría si no me llega el correo de confirmación?", 1],
    ["¿Qué sucedería si no me llega el correo de confirmación?", 1],
    ["¿Qué tendría que hacer si no me llega el correo de confirmación?", 1],
    ["¿Qué habría que hacer si no me llega el correo de confirmación?", 1],
    ["¿Qué haría si no me llega el correo de confirmación?", 1],
    ["¿Qué se haría si no me llega el correo de confirmación?", 1],
  ];
  for (const [q, puerta] of familiaPack) {
    it(`familia (pack): «${q}» — puerta ${puerta}, fundados = puerta`, () => {
      const { gated, founded } = packSearch(local, q);
      expect(gated.length).toBe(puerta);
      expect(founded.length).toBe(gated.length);
    });
  }

  // Dictado real (regla permanente de la casa): la forma sin signos ni
  // mayúscula y la de la letra duplicada miden como sus gemelas limpias
  // (§3.1 y §3.2) tras la cura — sobre la base coincidían con ellas en
  // el desenlace de la señal (las dos caían), así que la cláusula doble
  // del juego las juzga por su gemela.
  it("dictado 7.8: «qué pasa si no me llega el correo de confirmación» (sin signos) — puerta 2, fundados 2, como su gemela limpia", () => {
    const { gated, founded } = packSearch(local, "qué pasa si no me llega el correo de confirmación");
    expect(gated.length).toBe(2);
    expect(founded.length).toBe(2);
  });

  it("dictado 7.10: «¿Qué ocurrre si no me llega el correo de confirmación?» (letra duplicada) — puerta 1, fundados 1, como su gemela limpia", () => {
    const { gated, founded } = packSearch(local, "¿Qué ocurrre si no me llega el correo de confirmación?");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(1);
  });

  // Resto de ruido nombrado en la base (cláusula doble del juego,
  // familia 7): la cortesía «Disculpe,…» y la cola «Es que estoy
  // esperando un trámite» ya difieren de su gemela limpia EN LA PUERTA
  // sobre la base de arranque (puerta 0: el término añadido rompe la
  // cobertura), así que no hay fragmento que la señal pueda retirar ni
  // hoy ni tras la cura; la fixture fija fundada = puerta y el resto
  // queda asentado aquí, no contra la cura.
  it("dictado 7.7 (resto de ruido de puerta, medido en la base): «Disculpe, ¿qué sucede si no me llega el correo de confirmación?» — puerta 0, fundados = puerta", () => {
    const { gated, founded } = packSearch(local, "Disculpe, ¿qué sucede si no me llega el correo de confirmación?");
    expect(gated.length).toBe(0);
    expect(founded.length).toBe(gated.length);
  });

  it("dictado 7.9 (resto de ruido de puerta, medido en la base): «Oye, ¿qué ocurre si no me llega el correo de confirmación? Es que estoy esperando un trámite.» — puerta 0, fundados = puerta", () => {
    const { gated, founded } = packSearch(local, "Oye, ¿qué ocurre si no me llega el correo de confirmación? Es que estoy esperando un trámite.");
    expect(gated.length).toBe(0);
    expect(founded.length).toBe(gated.length);
  });

  // Controles de la familia sobre el pack real: desenlaces medidos sobre
  // la base de arranque que la cura no puede mover en ninguna dirección.
  it("control 3.1: «¿Qué dirección es la del consulado de España en La Habana?» cae como su gemela T2 (puerta 2, fundados 0): el tipo tras «qué» con su cópula ES el dato", () => {
    const { gated, founded } = packSearch(local, "¿Qué dirección es la del consulado de España en La Habana?");
    expect(gated.length).toBe(2);
    expect(founded.length).toBe(0);
  });

  it("control 4.3 (el asma limita la cura por el otro lado): «¿Qué hago si a mi hijo le cuesta respirar?» — 9 por la puerta, 9 tras la señal, la guía de asma en cabeza", () => {
    const { gated, founded, served } = packSearch(esencial, "¿Qué hago si a mi hijo le cuesta respirar?");
    expect(gated.length).toBe(9);
    expect(founded.length).toBe(9);
    expect(served[0].title).toContain("asma");
  });

  it("control 4.2 (el viento): «¿Cuál es la dirección del viento durante un huracán?» — en Esencial la B calla (4 fundados, huracanes en cabeza); en Local el tipo falta de verdad y cae por diseño", () => {
    const es = packSearch(esencial, "¿Cuál es la dirección del viento durante un huracán?");
    expect(es.founded.length).toBe(4);
    expect(es.served[0].title).toContain("Huracanes");
    const lo = packSearch(local, "¿Cuál es la dirección del viento durante un huracán?");
    expect(lo.gated.length).toBe(1);
    expect(lo.founded.length).toBe(0);
  });

  it("control 2.18: «No me llegó el correo de confirmación. ¿Qué procede?» — el modo en segunda frase no funda la señal (puerta 1, fundados 1)", () => {
    const { gated, founded } = packSearch(local, "No me llegó el correo de confirmación. ¿Qué procede?");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(1);
  });

  it("control 7.1 (gemela pt del núcleo): «O que acontece se o e-mail de confirmação não chegar?» sirve como en la base (puerta 1, fundados 1): la cura española no toca el portugués", () => {
    const { gated, founded } = packSearch(local, "O que acontece se o e-mail de confirmação não chegar?");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(1);
  });

  it("control 7.2 (pt, obligación): «O que devo fazer se o e-mail de confirmação não chegar?» — fundados = puerta, como en la base", () => {
    const { gated, founded } = packSearch(local, "O que devo fazer se o e-mail de confirmação não chegar?");
    expect(gated.length).toBe(6);
    expect(founded.length).toBe(gated.length);
  });

  it("control 7.3 (pt, necesidad dictada): «Preciso do endereço do consulado da Espanha em Havana.» cae como en la base (puerta 1, fundados 0): su desenlace es el de su marco, no el de esta cura", () => {
    const { gated, founded } = packSearch(local, "Preciso do endereço do consulado da Espanha em Havana.");
    expect(gated.length).toBe(1);
    expect(founded.length).toBe(0);
  });

  it("atribución (C-05c, 2.3 del juego): «¿Qué sigue si no me llega la dirección del hotel?» cae por la señal A y no por el veto: sin query cae igual, porque el tema no está en Local («hotel» y «dirección» a df 0 en su pool de 12)", () => {
    // La adversaria la trae en su familia 2 con desenlace fundados =
    // puerta; medida al cierre, su caída es de la señal A (la forma de
    // D2: términos ausentes del pool y ningún servido casa un término
    // discriminativo), que esta tanda no toca y que en la base caía
    // igual. La prueba de atribución es la de exclusión de la serie:
    // sin query la señal B no puede formarse y el corpus cae lo mismo;
    // con la cura, la señal B ya no se funda sobre esta forma (en la
    // base el veto enumerado tampoco la cubría: caía por las dos).
    const q = "¿Qué sigue si no me llega la dirección del hotel?";
    const { pool, gated, founded, terms } = packSearch(local, q);
    expect(gated.length).toBe(4);
    expect(founded.length).toBe(0);
    expect(dropUnfoundedCorpus(pool, gated, terms, {})).toEqual([]);
  });

  it("controles 7.4/7.5/7.6 (en, sin exposición en esta superficie): fundados = puerta = 0, como en la base", () => {
    for (const q of [
      "What happens if the confirmation email doesn't arrive?",
      "What should I do if the confirmation email doesn't arrive?",
      "I need the address of the consulate of Spain in Havana.",
    ]) {
      const { gated, founded } = packSearch(local, q);
      expect(gated.length).toBe(0);
      expect(founded.length).toBe(gated.length);
    }
  });
});
