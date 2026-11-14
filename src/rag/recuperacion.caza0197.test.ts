/**
 * CAZA 0.1.97 · eje RECUPERACIÓN REAL (CL-12) — sonda, SIN arreglos.
 *
 * Qué corre aquí: la búsqueda REAL de retrieve() en su rama léxica,
 * replicada con las funciones exactas de la casa sobre los datos reales:
 *  - corpus integrado: assets/corpus/{corpus,corpus-standard,corpus-full}.json
 *    indexado en FTS5 (node:sqlite, mismo patrón que retrieve.lexical.test.ts),
 *    con buildLexicalQuery + filterByTermCoverage + dropUnfoundedCorpus +
 *    normalizeCorpusScores de pure.ts, como en retrieve.ts › lexicalSearch.
 *  - packs empaquetados reales: assets/bundled-packs/nido-esencial.sqlite y
 *    nido-local.sqlite (variantes bge; las -e5 llevan el mismo texto con
 *    otros vectores y la app instala una variante por perfil), con la SQL
 *    y las puertas exactas de packs.ts › searchPacks (PACK_CANDIDATES=400).
 *  - fusión: fuseRetrievalResults + dedupeArticleCopies, como retrieve().
 *
 * Qué NO corre: la rama semántica. No hay ningún .gguf en el árbol
 * (assets/models/ no existe) y el motor nativo de embeddings no está en
 * vitest, así que no se puede incrustar la pregunta. retrieve() degrada
 * exactamente a esta rama léxica cuando el motor no está disponible
 * (F4-2026-10-06 en retrieve.ts). Los veredictos son de la rama léxica;
 * en el aparato, la rama semántica e5 podría rescatar algún «ausente».
 *
 * Los aciertos se definieron ANTES de correr, contra el inventario real
 * (guías del Esencial + artículos del corpus). «Avería en carretera» es
 * la guía sellada del producto para la llanta (fixture de
 * grounding.llanta0197.test.ts); vive en un pack importado que NO está
 * en este árbol, así que aquí su ausencia es lo esperable y se anota.
 */
/// <reference types="node" />
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildLexicalQuery,
  countMatchedTerms,
  filterByTermCoverage,
  dropUnfoundedCorpus,
  normalizeCorpusScores,
  fuseRetrievalResults,
} from "./pure";
import { dedupeArticleCopies } from "./dedupe";
import { guideTitleOf } from "./packSource";
import { BGE_SMALL_EN_PROFILE } from "./embeddingProfile";
import type { RetrievedChunk } from "./retrieve.types";

const TOPK = 6; // retrieve(query) por defecto
const LEXICAL_CANDIDATE_MULTIPLIER = 4; // retrieve.ts
const PACK_CANDIDATES = 400; // packs.ts

const fold = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------- corpus integrado (FTS5 en memoria, como retrieve.lexical.test) ----------
let corpusDb: DatabaseSync;
type CorpusRow = { chunk_id: string; title: string; body: string; source: string; rank: number };

function builtinLexical(query: string, limit: number): RetrievedChunk[] {
  const q = buildLexicalQuery(query);
  if (!q) return [];
  const rows = corpusDb
    .prepare(
      "SELECT chunk_id, title, body, source, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?",
    )
    .all(q.match, limit * LEXICAL_CANDIDATE_MULTIPLIER) as unknown as CorpusRow[];
  const gated = filterByTermCoverage(rows, q.terms, q.lang);
  const founded = dropUnfoundedCorpus(rows, gated, q.terms, {
    query,
    servedFromUser: gated.map(() => false),
  });
  return normalizeCorpusScores(
    founded.slice(0, limit).map((r) => ({
      chunkId: r.chunk_id,
      docId: r.chunk_id,
      title: r.title,
      body: r.body,
      sourceKind: "builtin" as const,
      termCoverage: q.terms.length > 0 ? countMatchedTerms(`${r.title} ${r.body}`, q.terms) / q.terms.length : undefined,
      score: -r.rank,
      matchType: "lexical" as const,
      // metadatos de la sonda (no van a la fusión, que solo lee score/title/body)
      ...( { __source: r.source } as object),
    })),
  ) as RetrievedChunk[];
}

// ---------- packs reales ----------
interface PackHandle {
  catalogId: string;
  db: DatabaseSync;
  langByChunk: Map<number, string>;
}
let packHandles: PackHandle[] = [];

function packLexical(pack: PackHandle, query: string, limit: number): RetrievedChunk[] {
  const q = buildLexicalQuery(query);
  if (!q) return [];
  type Row = { id: number; title: string; body: string; keys: string; rank: number };
  const rows = pack.db
    .prepare(
      `SELECT c.id, c.title, c.body, c.keys, bm25(chunks_fts) AS rank
       FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
       WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(q.match, PACK_CANDIDATES) as unknown as Row[];
  const gated = filterByTermCoverage(rows, q.terms, q.lang);
  const founded = dropUnfoundedCorpus(rows, gated, q.terms, { query });
  const packChunks = founded.slice(0, limit).map((r) => ({
    chunkId: `pack:${pack.catalogId}:${r.id}`,
    docId: `pack:${pack.catalogId}:${r.title}`,
    title: r.title,
    body: r.body,
    keys: r.keys,
    sourceKind: "pack" as const,
    termCoverage: q.terms.length > 0 ? countMatchedTerms(r.keys ? `${r.title} ${r.body} ${r.keys}` : `${r.title} ${r.body}`, q.terms) / q.terms.length : undefined,
    score: -r.rank,
    matchType: "lexical" as const,
  }));
  return normalizeCorpusScores(packChunks) as RetrievedChunk[];
}

// ---------- búsqueda completa (retrieve() sin rama semántica) ----------
interface Traido {
  titulo: string;
  guia: string;
  idioma: string | null;
  origen: string;
}
const langOfChunk = new Map<string, string>();

function buscar(pregunta: string): { guias: Traido[]; crudos: string[] } {
  const limit = TOPK * 2;
  const builtin = builtinLexical(pregunta, limit);
  const packLex: RetrievedChunk[] = [];
  for (const p of packHandles) packLex.push(...packLexical(p, pregunta, limit));
  const fused = fuseRetrievalResults([...builtin, ...packLex], [], TOPK, undefined, BGE_SMALL_EN_PROFILE.minSimilarity);
  const deduped = dedupeArticleCopies(fused);
  const guias: Traido[] = [];
  const seen = new Set<string>();
  for (const c of deduped) {
    const guia = c.chunkId.startsWith("pack:") ? guideTitleOf(c.title) : c.title;
    const key = fold(guia);
    if (seen.has(key)) continue;
    seen.add(key);
    let idioma: string | null = langOfChunk.get(c.chunkId) ?? null;
    if (!idioma && !c.chunkId.startsWith("pack:")) {
      const src = (c as unknown as { __source?: string }).__source ?? "";
      idioma = /(es|en|pt)\.wikipedia/.exec(src)?.[1] ?? null;
    }
    guias.push({ titulo: c.title, guia, idioma, origen: c.chunkId.startsWith("pack:") ? c.chunkId.split(":")[1] : "corpus" });
    if (guias.length >= 3) break;
  }
  return { guias, crudos: deduped.slice(0, 3).map((c) => c.title) };
}

// ---------- batería: esperado definido ANTES de correr ----------
interface CasoRec {
  pregunta: string;
  idioma: "es" | "en" | "pt";
  esperado: { sentido: string; documento: string | null };
  /** Patrones (plegados) sobre el título de la guía que cuentan como acierto de sentido. */
  acierto: string[];
  notaPre: string;
}

const CASOS: CasoRec[] = [
  { pregunta: "¿cómo cambio la llanta de mi carro?", idioma: "es", esperado: { sentido: "neumático", documento: "Avería en carretera" }, acierto: ["averia en carretera", "flat tire", "flat tyre"], notaPre: "La guía sellada vive en un pack importado ausente de este árbol; en el árbol lo más cercano es «Accidente de tráfico», que no enseña a cambiar la rueda." },
  { pregunta: "¿cómo abro una cuenta en el banco?", idioma: "es", esperado: { sentido: "dinero/banca", documento: "Dinero (corpus)" }, acierto: ["dinero", "money", "dinheiro"], notaPre: "" },
  { pregunta: "¿dónde me siento, hay un banco libre?", idioma: "es", esperado: { sentido: "asiento", documento: null }, acierto: [], notaPre: "No existe documento de mobiliario/asiento en el inventario: lo honesto es ausente." },
  { pregunta: "¿qué significa corriente en un enchufe?", idioma: "es", esperado: { sentido: "electricidad", documento: "Electricidad (corpus)" }, acierto: ["electricidad", "electricity", "eletricidade"], notaPre: "" },
  { pregunta: "¿cómo siembro una planta en una maceta?", idioma: "es", esperado: { sentido: "ser vivo", documento: "Fotosíntesis / Árbol / Agricultura (corpus)" }, acierto: ["fotosintesis", "photosynthesis", "fotossintese", "arbol", "tree", "arvore", "flor", "flower", "agricultura", "agriculture", "zea mays", "maiz", "milho"], notaPre: "Acierto por sentido: vale cualquier artículo de planta/ser vivo (p. ej. Zea mays); el sentido competidor sería planta industrial o planta del pie." },
  { pregunta: "¿tienes la carta del restaurante?", idioma: "es", esperado: { sentido: "menú", documento: null }, acierto: [], notaPre: "No existe documento de menú/restaurante: lo honesto es ausente." },
  { pregunta: "¿qué cola pega madera?", idioma: "es", esperado: { sentido: "pegamento", documento: null }, acierto: [], notaPre: "No existe documento de pegamentos: lo honesto es ausente." },
  { pregunta: "¿cómo afilo la sierra?", idioma: "es", esperado: { sentido: "herramienta", documento: null }, acierto: [], notaPre: "No existe documento de herramientas: lo honesto es ausente." },
  { pregunta: "¿por qué se apaga la vela con el viento?", idioma: "es", esperado: { sentido: "cera/candela", documento: null }, acierto: [], notaPre: "No existe documento sobre velas de cera: lo honesto es ausente." },
  { pregunta: "¿cómo cargo la batería del móvil?", idioma: "es", esperado: { sentido: "energía", documento: "Electricidad (corpus, sentido débil)" }, acierto: ["electricidad", "electricity", "eletricidade", "bateria", "battery"], notaPre: "Acierto débil: no hay guía de baterías; Electricidad es el sentido correcto aunque no el procedimiento." },
  { pregunta: "¿de dónde sale el agua de la fuente?", idioma: "es", esperado: { sentido: "manantial/agua", documento: "Agua / Ciclo hidrológico (corpus, sentido débil)" }, acierto: ["ciclo hidrologico", "water cycle", "agua", "water"], notaPre: "Acierto débil por familia de sentido (agua), no hay artículo de manantiales." },
  { pregunta: "¿cómo pago la cuenta de la luz?", idioma: "es", esperado: { sentido: "factura", documento: null }, acierto: [], notaPre: "No existe documento de facturación: lo honesto es ausente. «Electricidad» sería otro tema del mismo campo." },
  { pregunta: "how do I open a bank account?", idioma: "en", esperado: { sentido: "money", documento: "Money (corpus)" }, acierto: ["money", "dinero", "dinheiro"], notaPre: "" },
  { pregunta: "how do I charge my phone?", idioma: "en", esperado: { sentido: "electric", documento: "Electricity (corpus, sentido débil)" }, acierto: ["electricity", "electricidad", "eletricidade", "battery", "bateria"], notaPre: "Acierto débil, como la versión en español." },
  { pregunta: "what is a river bank?", idioma: "en", esperado: { sentido: "river (orilla)", documento: "artículos de ríos (corpus)" }, acierto: ["river", "nile", "nilo", "amazon", "mississippi", "misisipi"], notaPre: "El competidor es bank=dinero: si corona Money/Dinero es el sentido equivocado clásico." },
  { pregunta: "¿como troco a vela do carro?", idioma: "pt", esperado: { sentido: "vela de ignição (coche)", documento: null }, acierto: [], notaPre: "Pregunta en portugués (sin acentuar, como llega dictada). No hay guía de bujías/mantenimiento de coche en el árbol: lo honesto es ausente; traer la vela de cera o fuego sería el sentido equivocado." },
  { pregunta: "como abro uma conta no banco?", idioma: "pt", esperado: { sentido: "dinheiro", documento: "Dinheiro (corpus)" }, acierto: ["dinheiro", "money", "dinero"], notaPre: "" },
  { pregunta: "onde fica a rede de dormir?", idioma: "pt", esperado: { sentido: "hamaca", documento: null }, acierto: [], notaPre: "No hay documento de hamacas: lo honesto es ausente. El competidor es rede=red/internet." },
  { pregunta: "¿cómo cambio una llanta pinchada?", idioma: "es", esperado: { sentido: "neumático", documento: "Avería en carretera" }, acierto: ["averia en carretera", "flat tire", "flat tyre"], notaPre: "Matriz: misma guía esperada que la polisémica de llanta." },
  { pregunta: "¿qué hago si huele a gas en la cocina?", idioma: "es", esperado: { sentido: "fuga de gas (seguridad)", documento: "Intoxicaciones, venenos y monóxido de carbono (Esencial, en el árbol); la guía «Fuga de gas» de SALVORA no está en este árbol" }, acierto: ["monoxido", "monox", "carbon monoxide", "fuga de gas", "gas leak", "intoxicaciones", "poisoning", "intoxica"], notaPre: "" },
  { pregunta: "¿cuánto paracetamol le doy a mi hijo?", idioma: "es", esperado: { sentido: "dosis infantil / fiebre", documento: "Fiebre en adultos y niños (Esencial)" }, acierto: ["fiebre", "fever", "febre"], notaPre: "La guía de fiebre es el documento del sentido correcto en el árbol." },
  { pregunta: "¿cómo descongelo un pollo?", idioma: "es", esperado: { sentido: "seguridad alimentaria", documento: "Comida en emergencias / Higiene (Esencial, sentido débil)" }, acierto: ["comida en emergencias", "food in emergencies", "higiene", "hygiene"], notaPre: "Acierto débil: no hay guía de descongelación; el artículo del pollo (Gallus) sería otro tema." },
  { pregunta: "¿qué hago si mi perro comió chocolate?", idioma: "es", esperado: { sentido: "intoxicación veterinaria", documento: "Intoxicaciones, venenos y monóxido de carbono (Esencial)" }, acierto: ["intoxicaciones", "poisoning", "intoxica", "monoxido", "monox"], notaPre: "La guía «Intoxicaciones, venenos y monóxido de carbono» SÍ está en el Esencial de este árbol: si sale ausente es fallo de recuperación, no de inventario. El artículo del perro (Canis familiaris) solo sería tema parcial, no la emergencia." },
  { pregunta: "¿cuándo vence mi trámite?", idioma: "es", esperado: { sentido: "fecha personal (sin fuente posible)", documento: null }, acierto: [], notaPre: "Pregunta de dato personal: ningún corpus puede traerla; lo honesto es ausente." },
];

interface ResultadoRec extends CasoRec {
  traido: Traido[];
  traidoCrudo: string[];
  veredicto: "top1" | "top3" | "ausente" | "sentido-equivocado";
  nota: string;
}
const RESULTADOS: ResultadoRec[] = [];

beforeAll(() => {
  corpusDb = new DatabaseSync(":memory:");
  corpusDb.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED, title, body, source UNINDEXED)");
  const insert = corpusDb.prepare("INSERT INTO chunks_fts (chunk_id, title, body, source) VALUES (?, ?, ?, ?)");
  const corpusDir = join(__dirname, "../../assets/corpus");
  for (const file of ["corpus.json", "corpus-standard.json", "corpus-full.json"]) {
    const docs = JSON.parse(readFileSync(join(corpusDir, file), "utf8")) as Array<{ title: string; body: string; source: string }>;
    docs.forEach((d, i) => insert.run(`${file}:${i}`, d.title, d.body, d.source ?? ""));
  }
  const packsDir = join(__dirname, "../../assets/bundled-packs");
  for (const [catalogId, file] of [["nido-esencial", "nido-esencial.sqlite"], ["nido-local", "nido-local.sqlite"]] as const) {
    const db = new DatabaseSync(join(packsDir, file), { readOnly: true });
    const langByChunk = new Map<number, string>();
    const rows = db.prepare("SELECT c.id AS id, g.lang AS lang FROM chunks c LEFT JOIN guides g ON g.id = c.guide").all() as unknown as Array<{ id: number; lang: string | null }>;
    for (const r of rows) if (r.lang) langByChunk.set(r.id, r.lang);
    packHandles.push({ catalogId, db, langByChunk });
    for (const [id, lang] of langByChunk) langOfChunk.set(`pack:${catalogId}:${id}`, lang);
  }
}, 120_000);

describe("CAZA 0197 · recuperación real (rama léxica de retrieve + packs)", () => {
  for (const c of CASOS) {
    it(`${c.pregunta}`, () => {
      const { guias, crudos } = buscar(c.pregunta);
      const esAcierto = (g: Traido) => c.acierto.some((p) => fold(g.guia).includes(p));
      let veredicto: ResultadoRec["veredicto"];
      if (guias.length === 0) veredicto = "ausente";
      else if (esAcierto(guias[0])) veredicto = "top1";
      else if (guias.slice(0, 3).some(esAcierto)) veredicto = "top3";
      else veredicto = "sentido-equivocado";
      const notas: string[] = [];
      if (c.notaPre) notas.push(c.notaPre);
      if (veredicto === "ausente" && c.acierto.length === 0) notas.push("Sin fuentes tras las puertas: caída honesta (no hay documento del sentido).");
      if (veredicto === "sentido-equivocado") notas.push(`El top trae «${guias[0].guia}», no el sentido esperado (${c.esperado.sentido}).`);
      RESULTADOS.push({ ...c, traido: guias, traidoCrudo: crudos, veredicto, nota: notas.join(" ") });
      expect(Array.isArray(guias)).toBe(true);
    }, 30_000);
  }
});

afterAll(() => {
  const totales = { preguntas: RESULTADOS.length, top1: 0, top3: 0, ausente: 0, sentidoEquivocado: 0 };
  for (const r of RESULTADOS) {
    if (r.veredicto === "top1") totales.top1++;
    else if (r.veredicto === "top3") totales.top3++;
    else if (r.veredicto === "ausente") totales.ausente++;
    else totales.sentidoEquivocado++;
  }
  writeFileSync(
    "/home/hatch/workspace/nido-0197-caza/resultados-recuperacion.json",
    JSON.stringify(
      {
        meta: {
          eje: "recuperacion",
          clase: "CL-12",
          viabilidad: "parcial",
          alcance:
            "Rama léxica REAL de retrieve() (corpus integrado FTS5 + packs empaquetados nido-esencial/nido-local, puertas y fusión de la casa). Rama semántica NO ejecutable en esta máquina: no hay ningún .gguf en el árbol (assets/models/ no existe) ni motor nativo en vitest; retrieve() degrada a esta misma rama léxica sin motor. Los packs importados (SALVORA, con «Avería en carretera» y «Fuga de gas») no están en el árbol y no se pudieron buscar.",
          totales,
        },
        casos: RESULTADOS,
      },
      null,
      1,
    ),
  );
});
