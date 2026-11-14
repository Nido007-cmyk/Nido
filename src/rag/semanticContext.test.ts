/**
 * T-20 (0.1.99, núcleo del juez): el contexto semántico.
 *
 * Tres cosas se fijan aquí:
 *  1. ALINEACIÓN: el constructor trocea con las mismas funciones que
 *     el juez (splitSentences + splitClausesWithSep), en el mismo
 *     orden: la secuencia de textos que el constructor embebe es, una
 *     a una, la que el juez reconstruye al validar.
 *  2. DEGRADACIÓN DEL CONSTRUCTOR: sin motor residente, con perfil no
 *     multilingüe o con el motor fallando a mitad, no hay contexto
 *     (null) y el turno sigue como hoy.
 *  3. INVARIANCIA DEL JUEZ EN T-20: el juez acepta y valida el
 *     contexto, pero ninguna puerta lo lee todavía — con un contexto
 *     válido, con uno inválido (que se ignora entero) y sin contexto,
 *     el veredicto es idéntico en la muestra (abstención, cruzado y
 *     polisemia, las tres familias que las puertas de T-21 miran).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Motor falso determinista: el mismo texto produce el mismo vector
// (hash simple a 8 dimensiones, normalizado), y cada llamada queda
// registrada para fijar la secuencia exacta de textos incrustados.
const fake = vi.hoisted(() => {
  const state = {
    loaded: true,
    profileId: "multilingual-e5-small" as string,
    failAtCall: -1,
    calls: [] as { side: "query" | "passage"; text: string }[],
  };
  const vectorFor = (text: string): Float32Array => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const v = new Float32Array(8);
    let x = h >>> 0;
    for (let d = 0; d < 8; d++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      v[d] = (x % 2000) / 1000 - 1;
    }
    const norm = Math.hypot(...v) || 1;
    for (let d = 0; d < 8; d++) v[d] /= norm;
    return v;
  };
  const record = (side: "query" | "passage", text: string): Float32Array => {
    state.calls.push({ side, text });
    if (state.calls.length === state.failAtCall) throw new Error("motor caído a mitad");
    return vectorFor(text);
  };
  return { state, vectorFor, record };
});

vi.mock("./embed", () => ({
  embeddingEngine: {
    get isLoaded() {
      return fake.state.loaded;
    },
    get profile() {
      return { id: fake.state.profileId };
    },
    embedQuery: async (text: string) => fake.record("query", text),
    embedPassage: async (text: string) => fake.record("passage", text),
  },
}));

import { buildJudgeSemanticContext } from "./semanticContext";
import {
  splitClausesWithSep,
  splitSentences,
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding";
import { cosineSimilarity } from "./pure";

beforeEach(() => {
  fake.state.loaded = true;
  fake.state.profileId = "multilingual-e5-small";
  fake.state.failAtCall = -1;
  fake.state.calls = [];
});

const CHUNKS: GroundingChunk[] = [
  {
    title: "Cambiar la llanta del carro",
    body: "Para cambiar la llanta del carro, apaga el motor y pon el freno de mano. Afloja las tuercas con la llave de cruz, levanta el carro con el gato y coloca la llanta de repuesto.",
  },
  {
    title: "El banco del parque",
    body: "El banco del parque es un asiento largo de madera con respaldo. Sirve para sentarse a descansar y suele estar a la sombra de los árboles.",
  },
];

const ANSWER =
  "Apaga el motor y pon el freno de mano; luego afloja las tuercas con la llave de cruz, porque el carro debe estar firme.";

// ---------------------------------------------------------- troceador

describe("splitClausesWithSep (el troceo de cláusulas del contexto)", () => {
  it("marca subordinada solo la cláusula tras separador subordinante", () => {
    const out = splitClausesWithSep("Afloja las tuercas, porque el carro debe estar firme, pero no uses fuerza");
    expect(out.map((c) => c.text)).toEqual([
      "Afloja las tuercas",
      "el carro debe estar firme",
      "no uses fuerza",
    ]);
    expect(out.map((c) => c.subordinate)).toEqual([false, true, false]);
  });

  it("descarta los fragmentos de menos de 8 caracteres", () => {
    const out = splitClausesWithSep("Sí, apaga el motor y pon el freno de mano");
    expect(out.map((c) => c.text)).toEqual(["apaga el motor", "pon el freno de mano"]);
  });

  it("en portugués no corta por el artículo «o»", () => {
    const out = splitClausesWithSep("Segue o trilho até ao rio e depois descansa");
    expect(out.map((c) => c.text)).toEqual(["Segue o trilho até ao rio", "depois descansa"]);
  });
});

// ---------------------------------------------------------- alineación

describe("buildJudgeSemanticContext: alineación con el juez", () => {
  it("la secuencia incrustada es la que el juez reconstruye", async () => {
    const ctx = await buildJudgeSemanticContext({ answer: ANSWER, chunks: CHUNKS, query: "¿Cómo cambio la llanta?" });
    expect(ctx).not.toBeNull();
    expect(ctx!.profileId).toBe("multilingual-e5-small");

    // Frases y cláusulas de la respuesta: mismos conteos que el juez.
    const sentences = splitSentences(ANSWER);
    expect(ctx!.answerClauseVectors).toHaveLength(sentences.length);
    sentences.forEach((s, i) => {
      expect(ctx!.answerClauseVectors[i]).toHaveLength(splitClausesWithSep(s).length);
    });

    // Cláusulas de chunk: frases del cuerpo con la limpieza del juez.
    CHUNKS.forEach((c, i) => {
      const expected = splitSentences(c.body.trim())
        .map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim())
        .filter(Boolean)
        .flatMap((s) => splitClausesWithSep(s));
      expect(ctx!.chunkClauseVectors[i]).toHaveLength(expected.length);
    });

    // Sims pregunta→chunk: un valor por chunk, el coseno de los
    // vectores del motor falso sobre title + ". " + body.
    expect(ctx!.questionChunkSims).toHaveLength(CHUNKS.length);
    const q = fake.vectorFor("¿Cómo cambio la llanta?");
    CHUNKS.forEach((c, i) => {
      const expected = cosineSimilarity(q, fake.vectorFor(`${c.title}. ${c.body}`));
      expect(ctx!.questionChunkSims[i]).toBeCloseTo(expected, 6);
    });

    // La secuencia de textos del lado passage es exactamente la
    // esperada: por chunk, primero el chunk entero y luego sus
    // cláusulas en orden; al final, las cláusulas de la respuesta.
    const passageTexts = fake.state.calls.filter((c) => c.side === "passage").map((c) => c.text);
    const expectedPassage: string[] = [];
    for (const c of CHUNKS) {
      expectedPassage.push(`${c.title}. ${c.body}`);
      for (const s of splitSentences(c.body.trim())
        .map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim())
        .filter(Boolean)) {
        for (const cl of splitClausesWithSep(s)) expectedPassage.push(cl.text);
      }
    }
    for (const s of splitSentences(ANSWER)) {
      for (const cl of splitClausesWithSep(s)) expectedPassage.push(cl.text);
    }
    expect(passageTexts).toEqual(expectedPassage);
    expect(fake.state.calls.filter((c) => c.side === "query").map((c) => c.text)).toEqual(["¿Cómo cambio la llanta?"]);
  });
});

// ---------------------------------------------------------- degradación

describe("buildJudgeSemanticContext: degradación a sin contexto", () => {
  it("sin motor residente devuelve null", async () => {
    fake.state.loaded = false;
    expect(await buildJudgeSemanticContext({ answer: ANSWER, chunks: CHUNKS, query: "q" })).toBeNull();
  });

  it("con perfil no multilingüe devuelve null", async () => {
    fake.state.profileId = "bge-small-en";
    expect(await buildJudgeSemanticContext({ answer: ANSWER, chunks: CHUNKS, query: "q" })).toBeNull();
  });

  it("si el motor falla a mitad devuelve null, no un contexto a medias", async () => {
    fake.state.failAtCall = 3;
    expect(await buildJudgeSemanticContext({ answer: ANSWER, chunks: CHUNKS, query: "q" })).toBeNull();
  });

  it("sin chunks devuelve null", async () => {
    expect(await buildJudgeSemanticContext({ answer: ANSWER, chunks: [], query: "q" })).toBeNull();
  });
});

// ---------------------------------------------------------- invariancia

describe("verifyGroundedAnswer con contexto (T-20: se valida, no se lee)", () => {
  const FECHA = new Date("2026-11-14T12:00:00Z");
  const casos: { nombre: string; respuesta: string; pregunta: string; fuentes: GroundingChunk[]; lang: "es" | "en" | "pt" }[] = [
    {
      nombre: "abstención",
      pregunta: "¿Cómo cambio la llanta de mi carro?",
      fuentes: CHUNKS.slice(0, 1),
      respuesta: "No lo sé, las fuentes no lo mencionan.",
      lang: "es",
    },
    {
      nombre: "cruzado (guía en inglés, respuesta en español)",
      pregunta: "¿Cómo cambio la llanta de mi carro?",
      fuentes: [
        {
          title: "Changing a flat tyre",
          body: "To change the tyre, switch off the engine and set the handbrake. Loosen the nuts with the cross wrench, lift the car with the jack and fit the spare tyre.",
        },
      ],
      respuesta: "Para cambiar la llanta, enciende el motor y suelta el freno de mano antes de aflojar las tuercas.",
      lang: "es",
    },
    {
      nombre: "polisemia (la respuesta copia el sentido competidor)",
      pregunta: "¿De qué material es el banco del parque donde me siento?",
      fuentes: CHUNKS,
      respuesta: "En ese banco puedes abrir una cuenta de ahorros y pedir una tarjeta de débito para tus pagos.",
      lang: "es",
    },
  ];

  for (const caso of casos) {
    it(`veredicto idéntico con contexto válido, inválido y sin contexto: ${caso.nombre}`, async () => {
      const sin = verifyGroundedAnswer(caso.respuesta, caso.fuentes, caso.lang, caso.pregunta, FECHA);
      const ctx = await buildJudgeSemanticContext({ answer: caso.respuesta, chunks: caso.fuentes, query: caso.pregunta });
      expect(ctx).not.toBeNull();
      const conValido = verifyGroundedAnswer(caso.respuesta, caso.fuentes, caso.lang, caso.pregunta, FECHA, ctx!);
      expect(conValido).toEqual(sin);

      // Inválido por perfil: se ignora entero.
      const malPerfil = { ...ctx!, profileId: "bge-small-en" as const };
      expect(verifyGroundedAnswer(caso.respuesta, caso.fuentes, caso.lang, caso.pregunta, FECHA, malPerfil)).toEqual(sin);

      // Inválido por longitudes (falta un chunk): se ignora entero.
      const malLongitud = { ...ctx!, chunkClauseVectors: ctx!.chunkClauseVectors.slice(1) };
      expect(verifyGroundedAnswer(caso.respuesta, caso.fuentes, caso.lang, caso.pregunta, FECHA, malLongitud)).toEqual(sin);

      // Inválido por desalineación de cláusulas (falta una cláusula
      // de la primera frase): se ignora entero.
      const malClausulas = {
        ...ctx!,
        answerClauseVectors: ctx!.answerClauseVectors.map((porFrase, i) =>
          i === 0 ? porFrase.slice(1) : porFrase,
        ),
      };
      expect(verifyGroundedAnswer(caso.respuesta, caso.fuentes, caso.lang, caso.pregunta, FECHA, malClausulas)).toEqual(sin);

      // Inválido por una sim no finita: se ignora entero.
      const simsMal = Float32Array.from(ctx!.questionChunkSims);
      if (simsMal.length > 0) simsMal[0] = Number.NaN;
      const malSim = { ...ctx!, questionChunkSims: simsMal };
      expect(verifyGroundedAnswer(caso.respuesta, caso.fuentes, caso.lang, caso.pregunta, FECHA, malSim)).toEqual(sin);
    });
  }
});
