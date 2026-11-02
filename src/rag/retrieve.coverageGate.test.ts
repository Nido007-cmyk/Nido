/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La puerta de cobertura del Esencial (C-03): una pregunta concreta de una
 * familia, con su respuesta exacta dentro de una guía, no puede morir en la
 * puerta por no compartir palabras con el texto. La cura tiene dos piezas:
 * el prefijo de 5 letras (pure.lexicalPrefixOf) y las preguntas de familia
 * declaradas en cada guía (`questions:` del frontmatter y comentarios
 * `<!-- preguntas|questions: … -->` por apartado), que el empaquetador lleva
 * a la columna `keys` de los trozos. Esta batería congela las dos: corre la
 * puerta REAL (filterByTermCoverage) sobre las guías REALES, parseadas y
 * troceadas con el mismo código del empaquetador.
 *
 * Procedencia de las formulaciones: las marcadas «verbatim» salen tal cual
 * de la auditoría/preparación de C-03; el resto se reconstruyó sobre los
 * casos que esa preparación nombra, con fraseo de dictado real (la vara de
 * la casa para todo fixture). Las baterías de la preparación vivían fuera
 * del repo y se perdieron; esta es su reconstrucción asentada en disco.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chunkGuide, parseGuide } from "../../scripts/lib/knowledge-pack-lib.mjs";
import { buildLexicalQuery, filterByTermCoverage } from "./pure";

interface PackChunk {
  heading: string | null;
  body: string;
  questions?: string[];
}
interface PackGuide {
  title: string;
  questions?: string[];
  sections: Array<{ heading: string | null; text: string; questions?: string[] }>;
}
const parse = parseGuide as (text: string, name?: string) => PackGuide;
const chunk = chunkGuide as (g: PackGuide) => PackChunk[];

const packDir = fileURLToPath(new URL("../../knowledge-packs/nido-esencial", import.meta.url));

interface Guide {
  file: string;
  lang: string;
  title: string;
  questions: number;
  chunks: Array<{ title: string; body: string; keys: string }>;
}

const GUIDES: Guide[] = [];
for (const lang of ["es", "en"]) {
  for (const file of readdirSync(`${packDir}/${lang}`).filter((f) => f.endsWith(".md")).sort()) {
    const g = parse(readFileSync(`${packDir}/${lang}/${file}`, "utf8"), file);
    const chunks = chunk(g).map((c) => ({
      title: c.heading ? `${g.title} — ${c.heading}` : g.title,
      body: c.body,
      keys: (c.questions ?? []).join("\n"),
    }));
    const questions = chunks.reduce((n, c) => n + (c.keys ? c.keys.split("\n").length : 0), 0);
    GUIDES.push({ file, lang, title: g.title, questions, chunks });
  }
}

/** ¿Deja pasar la puerta a la guía esperada con esta pregunta? */
function passes(file: string, lang: string, q: string): boolean {
  const guide = GUIDES.find((g) => g.file === file && g.lang === lang);
  if (!guide) throw new Error(`guía no encontrada: ${lang}/${file}`);
  const lq = buildLexicalQuery(q);
  if (!lq) return false;
  return filterByTermCoverage(guide.chunks, lq.terms).length > 0;
}

/** Guías de un corpus que la puerta deja pasar con esta pregunta. */
function admitted(lang: string, q: string): string[] {
  const lq = buildLexicalQuery(q);
  if (!lq) return [];
  return GUIDES.filter((g) => g.lang === lang && filterByTermCoverage(g.chunks, lq.terms).length > 0).map((g) => g.title);
}

// [id, pregunta, fichero esperado] — batería limpia
const CLEAN: Array<[string, string, string, string]> = [
  // verbatim de la auditoría
  ["E1-fiebre39", "¿Qué hago si mi hijo tiene fiebre de 39 grados?", "es", "25-fiebre.md"],
  ["E2-paracetamol20", "¿Cuánto paracetamol le doy a un niño de 20 kilos?", "es", "25-fiebre.md"],
  ["E3-quemo", "¿Qué hago si me quemo con agua hirviendo?", "es", "08-quemaduras.md"],
  // reconstruidas sobre los casos nombrados por la preparación
  ["E4-ibuprofeno15", "¿Cuánto ibuprofeno le doy a un niño de 15 kilos?", "es", "25-fiebre.md"],
  ["E5-en-fever39", "What do I do if my child has a fever of 39 degrees?", "en", "25-fever.md"],
  ["E6-en-paracetamol", "How much paracetamol do I give a 20 kilo child?", "en", "25-fever.md"],
  ["E7-atraganta", "¿Qué hago si mi hijo se atraganta con un trozo de manzana?", "es", "05-atragantamiento.md"],
  ["E8-atragantando", "¿Qué hago si mi hijo se está atragantando y no puede toser?", "es", "05-atragantamiento.md"],
  ["E9-alacran", "¿Qué hago con una picadura de alacrán?", "es", "22-mordeduras-y-picaduras.md"],
  ["E10-serpiente", "¿Qué hago si me muerde una serpiente?", "es", "22-mordeduras-y-picaduras.md"],
  ["E11-rcp-nino", "¿Cómo hago RCP a un niño de 3 años?", "es", "03-rcp-ninos-y-bebes.md"],
  // controles que ya pasaban antes de C-03
  ["C1-heimlich", "maniobra de Heimlich", "es", "05-atragantamiento.md"],
  ["C2-hemorragia", "cómo paro una hemorragia fuerte", "es", "06-hemorragias-graves.md"],
  ["C3-dea", "dónde pongo los parches del desfibrilador", "es", "04-desfibrilador-dea.md"],
];

// [id, pregunta, fichero esperado] — batería humana (dictado real)
const HUMAN: Array<[string, string, string, string]> = [
  // verbatim de la preparación
  ["H4-sarten", "me quemo con la sartén qué me pongo", "es", "08-quemaduras.md"],
  ["H10-tylenol", "how much tylenol for a 40 pound kid", "en", "25-fever.md"],
  // dictado real, reconstruidas sobre las familias nombradas
  ["H1-bebe-fiebre", "mi bebé tiene fiebre y llora mucho, qué le doy", "es", "25-fiebre.md"],
  ["H2-aceite", "se quemó mi esposo con aceite hirviendo, qué hago", "es", "08-quemaduras.md"],
  ["H3-moneda", "mi hijo se tragó una moneda, qué hago", "es", "05-atragantamiento.md"],
  ["H5-abeja", "me picó una abeja y se me hincha la cara, qué hago", "es", "12-alergia-grave-anafilaxia.md"],
  ["H6-desmayo", "mi mamá se desmayó y no despierta, qué hago", "es", "11-shock-y-desmayos.md"],
  ["H7-sangre", "se cortó el dedo y le sale mucha sangre, qué hago", "es", "06-hemorragias-graves.md"],
  ["H8-cpr-baby", "how do i do cpr on a baby", "en", "03-cpr-children-and-babies.md"],
  ["H9-stove", "my daughter burned her hand on the stove", "en", "08-burns.md"],
  ["H12-suero", "cómo preparo suero casero para mi hijo con diarrea", "es", "26-diarrea-vomitos-y-suero-oral.md"],
];

// Puente portugués: la pregunta pt pasa contra la guía española (el corpus
// Esencial no tiene edición pt; las claves puente viven en es y en).
const PT_BRIDGE: Array<[string, string, string]> = [
  ["E5-pt-febre", "o que faço se meu filho tiver febre de 39 graus", "25-fiebre.md"],
  ["H13-pt-engasgo", "o que eu faço se meu filho engasgar com comida", "05-atragantamiento.md"],
];

describe("puerta de cobertura del Esencial (C-03)", () => {
  it("toda guía del pack lleva preguntas de familia en sus claves", () => {
    expect(GUIDES.length).toBe(116);
    for (const g of GUIDES) {
      expect(g.questions, `${g.lang}/${g.file} sin preguntas`).toBeGreaterThan(0);
    }
  });

  it("batería limpia: la pregunta concreta llega a su guía (14/14)", () => {
    for (const [id, q, lang, file] of CLEAN) {
      expect(passes(file, lang, q), `${id}: «${q}»`).toBe(true);
    }
  });

  it("batería humana: el dictado real llega a su guía (11/11)", () => {
    for (const [id, q, lang, file] of HUMAN) {
      expect(passes(file, lang, q), `${id}: «${q}»`).toBe(true);
    }
  });

  it("puente portugués: la pregunta pt llega a la guía española (2/2)", () => {
    for (const [id, q, file] of PT_BRIDGE) {
      expect(passes(file, "es", q), `${id}: «${q}»`).toBe(true);
    }
  });

  it("negativas: lo que no está en el corpus sigue sin respuesta", () => {
    // Precio declarado de P1 (medido en la preparación): «cambio» comparte
    // prefijo con «camb» de la guía de terremoto; es la ÚNICA admisión
    // tolerada. Si el prefijo se ensancha más, esto salta antes que el daño.
    expect(admitted("es", "¿Cómo cambio la rueda de un coche?")).toEqual(["Terremoto"]);
    expect(admitted("en", "¿Cómo cambio la rueda de un coche?")).toEqual([]);
    expect(admitted("es", "¿Quién escribió Don Quijote?")).toEqual([]);
    expect(admitted("en", "¿Quién escribió Don Quijote?")).toEqual([]);
    expect(admitted("es", "asdfghjkl qwerty")).toEqual([]);
    expect(admitted("en", "asdfghjkl qwerty")).toEqual([]);
    // Trinquete de H-A4-1 (recomendado por FV-1, que juzgó el precio
    // ACEPTADO): la familia N-3 — una pregunta sin guía en el corpus —
    // tolera exactamente estas cinco admisiones por tallos compartidos,
    // medidas por ADV4 y re-medidas por FV-1 (ficheros 25, 38, 41, 42 y
    // 49, en orden de fichero). La clase tolerada no puede crecer en
    // silencio: si una admisión nueva entra, esto salta antes que el daño.
    expect(admitted("es", "¿Cómo aumento las ventas de mi tienda?")).toEqual([
      "Fiebre en adultos y niños",
      "Tornados",
      "Incendio forestal",
      "Erupción volcánica y ceniza",
      "Refugio y mantener el calor corporal",
    ]);
  });
});
