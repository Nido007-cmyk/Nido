/**
 * T-21 (0.1.99, núcleo del juez): las puertas semánticas, fijadas
 * puerta a puerta con contextos hechos a mano y vectores de
 * cosenos controlados. La batería de la caza (matriz-a/matriz-b/
 * polisemia/falsos-dictado) fija los veredictos con vectores e5
 * reales del GGUF servido; este fichero fija el MECANISMO: cada
 * puerta dispara donde debe y no dispara donde no debe, y sin
 * contexto (o con el perfil equivocado) el juez es el de T-19.
 *
 * Los vectores viven en el plano xy: rot(c) = (c, √(1−c²)) tiene
 * coseno c contra (1, 0). ORT = (0, 1) es ortogonal a (1, 0).
 */
import { describe, expect, it } from "vitest";
import {
  splitClausesWithSep,
  splitSentences,
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding";
import type { JudgeSemanticContext } from "./semanticContext";

const FECHA = new Date("2026-11-14T12:00:00Z");
const E1 = new Float32Array([1, 0, 0, 0]);
const ORT = new Float32Array([0, 1, 0, 0]);
const rot = (c: number) => new Float32Array([c, Math.sqrt(1 - c * c), 0, 0]);

/**
 * Construye un contexto válido asignando vectores por texto de
 * cláusula (el mismo troceo que el juez valida); lo no asignado
 * recibe `defecto`.
 */
function ctxDe(
  chunks: GroundingChunk[],
  answer: string,
  sims: number[],
  porClausula: Map<string, Float32Array>,
  defecto: Float32Array = E1,
): JudgeSemanticContext {
  const vec = (t: string) => porClausula.get(t) ?? defecto;
  const chunkClauseVectors = chunks.map((c) => {
    const ss = splitSentences(c.body.trim())
      .map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim())
      .filter(Boolean);
    return ss.flatMap((s) => splitClausesWithSep(s).map((cl) => vec(cl.text)));
  });
  const answerClauseVectors = splitSentences(answer.trim()).map((s) =>
    splitClausesWithSep(s).map((cl) => vec(cl.text)),
  );
  return {
    chunkClauseVectors,
    answerClauseVectors,
    questionChunkSims: Float32Array.from(sims),
    profileId: "multilingual-e5-small",
  };
}

const GUIA_LLANTA_EN: GroundingChunk = {
  title: "Changing a flat tyre",
  body: "To change the tyre, switch off the engine and set the handbrake. Loosen the nuts with the cross wrench, lift the car with the jack and fit the spare tyre.",
};

// ---------------------------------------------------------------- SUELO

describe("SUELO de cláusula sustantiva (T-21)", () => {
  const respuesta =
    "Para cambiar la llanta, pon música alta y baila alrededor del coche durante un buen rato.";
  const pregunta = "¿Cómo cambio la llanta de mi carro?";

  it("sin contexto se conserva: es el juez de T-19 (la invención cruzada no tiene vara)", () => {
    const r = verifyGroundedAnswer(respuesta, [GUIA_LLANTA_EN], "es", pregunta, FECHA);
    expect(r.text).toContain("pon música alta");
  });

  it("con contexto y ninguna cláusula sustantiva respaldada (máx-sim < 0,87), la retira", () => {
    // Fuentes en E1, cláusulas de la respuesta en ORT: coseno 0.
    const base = ctxDe([GUIA_LLANTA_EN], respuesta, [0.9], new Map(), E1);
    const ctx: JudgeSemanticContext = {
      ...base,
      answerClauseVectors: base.answerClauseVectors.map((porFrase) => porFrase.map(() => ORT)),
    };
    const r = verifyGroundedAnswer(respuesta, [GUIA_LLANTA_EN], "es", pregunta, FECHA, ctx);
    expect(r.text).not.toContain("pon música alta");
  });

  it("con una cláusula respaldada (máx-sim ≥ 0,87), no la toca", () => {
    const ctx = ctxDe([GUIA_LLANTA_EN], respuesta, [0.9], new Map(), E1);
    const r = verifyGroundedAnswer(respuesta, [GUIA_LLANTA_EN], "es", pregunta, FECHA, ctx);
    expect(r.text).toContain("pon música alta");
  });

  it("con el perfil equivocado el contexto se ignora entero y la frase se conserva", () => {
    const ctx = ctxDe([GUIA_LLANTA_EN], respuesta, [0.9], new Map(), ORT);
    const mal: JudgeSemanticContext = { ...ctx, profileId: "bge-small-en" };
    const r = verifyGroundedAnswer(respuesta, [GUIA_LLANTA_EN], "es", pregunta, FECHA, mal);
    expect(r.text).toContain("pon música alta");
  });
});

// ---------------------------------------------------------------- TIE2

describe("TIE2 gemela negada con casi-empate (T-21)", () => {
  const guia: GroundingChunk = {
    title: "Changing a flat tyre",
    body: "To change the tyre, lift the car with the jack first. Do not loosen the nuts before lifting the car. Fit the spare tyre and tighten the nuts in a star pattern.",
  };
  const respuesta = "Afloja las tuercas de la rueda antes de levantar el coche.";
  const pregunta = "¿Cómo cambio la llanta de mi carro?";
  // La cláusula de la respuesta (el troceo la deja entera) contra:
  // su gemela negada a mn y la mejor positiva a mp.
  const vectores = (mn: number, mp: number) =>
    new Map<string, Float32Array>([
      ["Afloja las tuercas de la rueda antes de levantar el coche", E1],
      ["Do not loosen the nuts before lifting the car", rot(mn)],
      ["tighten the nuts in a star pattern", rot(mp)],
    ]);

  it("dispara: gemela negada ≥ 0,82 y a ≤ 0,05 de la positiva, en chunk de otro idioma", () => {
    const ctx = ctxDe([guia], respuesta, [0.9], vectores(0.9, 0.88), ORT);
    const r = verifyGroundedAnswer(respuesta, [guia], "es", pregunta, FECHA, ctx);
    expect(r.text).not.toContain("Afloja las tuercas");
  });

  it("no dispara si la gemela positiva gana por más de eps (0,05)", () => {
    const ctx = ctxDe([guia], respuesta, [0.9], vectores(0.9, 0.99), ORT);
    const r = verifyGroundedAnswer(respuesta, [guia], "es", pregunta, FECHA, ctx);
    expect(r.text).toContain("Afloja las tuercas");
  });

  it("no dispara si la gemela negada no alcanza tau (0,82)", () => {
    // mp = 0,88 mantiene la cláusula sobre el suelo: solo falta tau.
    const ctx = ctxDe([guia], respuesta, [0.9], vectores(0.8, 0.88), ORT);
    const r = verifyGroundedAnswer(respuesta, [guia], "es", pregunta, FECHA, ctx);
    expect(r.text).toContain("Afloja las tuercas");
  });
});

// ---------------------------------------------------------------- N8

describe("N8 relevancia semántica pregunta→chunk (T-21)", () => {
  const guiaTema: GroundingChunk = {
    title: "Seasons",
    body: "Spring starts in March, when the days get warmer and flowers bloom.",
  };
  const guiaCompetidora: GroundingChunk = {
    title: "Pen parts",
    // «start» también en el competidor: así la presencia de la
    // pregunta empata entre chunks y V6 (la relevancia léxica de
    // T-19) no se arma; la única vara que puede retirar la frase
    // del competidor es N8, que es lo que este test fija.
    body: "The spring inside a pen is a metal coil that pushes the tip out when you press the start button.",
  };
  const respuesta = "Spring starts in March. The spring inside a pen is a metal coil that pushes the tip out.";
  const pregunta = "When does spring start?";

  it("dispara: el chunk del tema gana con margen y la frase se apoya en el competidor", () => {
    const ctx = ctxDe([guiaTema, guiaCompetidora], respuesta, [0.88, 0.82], new Map(), E1);
    const r = verifyGroundedAnswer(respuesta, [guiaTema, guiaCompetidora], "en", pregunta, FECHA, ctx);
    expect(r.text).toContain("Spring starts in March");
    expect(r.text).not.toContain("metal coil");
  });

  it("no dispara si el margen pregunta→chunk es < 0,02", () => {
    const ctx = ctxDe([guiaTema, guiaCompetidora], respuesta, [0.85, 0.84], new Map(), E1);
    const r = verifyGroundedAnswer(respuesta, [guiaTema, guiaCompetidora], "en", pregunta, FECHA, ctx);
    expect(r.text).toContain("metal coil");
  });
});

// ---------------------------------------------------------------- TRAS-tema

describe("TRAS-tema trasplante con ámbito de tema (T-21)", () => {
  const ruido: GroundingChunk = {
    title: "River Severn",
    body: "The River Severn is the longest river in Great Britain, at 220 miles. It rises in Plynlimon in Wales and flows through Shropshire, emptying into the Bristol Channel.",
  };
  const guia: GroundingChunk = {
    title: "Picadura de medusa",
    body: "Enjuaga la picadura con agua de mar y retira los tentáculos con pinzas. No uses agua dulce ni orina sobre la picadura, porque pueden empeorar el dolor.",
  };
  // La frase de b-099 parafraseada con contención < 75 % contra la
  // cláusula prohibida: así la cirugía léxica (que en la rama
  // principal cortaría la copia volteada) no la toca y la única
  // vara que puede retirarla es TRAS-tema.
  const respuesta = "Lo mejor para calmar la picadura en la playa es orina y agua dulce.";

  it("dispara: la frase trasplanta lo que la guía solo dice bajo negación, fuera del tema de la pregunta", () => {
    const ctx = ctxDe([ruido, guia], respuesta, [0.5, 0.9], new Map(), E1);
    const r = verifyGroundedAnswer(respuesta, [ruido, guia], "es", "¿Qué hago si me pica una medusa?", FECHA, ctx);
    expect(r.text).not.toContain("orina y agua dulce");
  });

  it("no dispara si la frase trae su propia negación gobernante (la prohibición fiel se conserva)", () => {
    const fiel = "No uses orina ni agua dulce sobre la picadura.";
    const ctx = ctxDe([ruido, guia], fiel, [0.5, 0.9], new Map(), E1);
    const r = verifyGroundedAnswer(fiel, [ruido, guia], "es", "¿Qué hago si me pica una medusa?", FECHA, ctx);
    expect(r.text).toContain("No uses orina");
  });

  // El ámbito de tema (solape ≥ 2 absuelve) no se fija aquí: con la
  // pregunta sobre el tema, el caso cae en la rama principal y las
  // piernas léxicas (apoyo, cirugía de copia volteada) lo resuelven
  // antes que TRAS, así que un control unitario no aislaría la
  // puerta. El ámbito queda fijado donde el diseño lo midió: en la
  // batería, matriz-a-514 se conserva con contexto (sin el ámbito,
  // TRAS lo rompía) y matriz-b-099 sale por TRAS-tema.
});

// ---------------------------------------------------------------- polos F-06

describe("Cirugía semántica de polos F-06 (T-21)", () => {
  const guia: GroundingChunk = {
    title: "Cambiar una llanta",
    body: "Apaga el motor y pon el freno de mano antes de empezar. Afloja las tuercas media vuelta antes de levantar el coche con el gato.",
  };
  const pregunta = "¿Cómo cambio la llanta de mi carro?";

  it("corta la cláusula del polo contrario y conserva la fiel (el caso 512)", () => {
    const respuesta =
      "Afloja las tuercas media vuelta antes de levantar el coche con el gato y mantén el motor en marcha durante todo el cambio.";
    const ctx = ctxDe(
      [guia],
      respuesta,
      [0.9],
      new Map<string, Float32Array>([
        ["mantén el motor en marcha durante todo el cambio", rot(0.91)],
        ["Apaga el motor", E1],
      ]),
      E1,
    );
    // La cláusula opuesta debe mirar a «Apaga el motor» (E1 girado):
    // su vector rot(0,91) tiene coseno 0,91 contra E1 y ~0 contra el
    // resto de cláusulas fuente (todas en E1 salvo esa: ver ctxDe).
    const r = verifyGroundedAnswer(respuesta, [guia], "es", pregunta, FECHA, ctx);
    expect(r.text).toContain("Afloja las tuercas");
    expect(r.text).not.toContain("en marcha");
  });

  it("la lectura fiel protege: si la mejor gemela del MISMO polo empata a la opuesta, no corta", () => {
    // Sin la protección (opp > misma, estricto), esta pierna rompía
    // las fieles 061/062/063 en el prototipo medido: la cláusula
    // fiel con polo cuya gemela del mismo polo empata a la opuesta
    // se queda entera. Todos los vectores en E1: la gemela del
    // mismo polo («Enciende las luces…») y la opuesta («Apaga el
    // motor») empatan a 1,0 contra la cláusula de la respuesta.
    const guia2: GroundingChunk = {
      title: "Cambiar una llanta",
      body: "Apaga el motor y pon el freno de mano antes de empezar. Enciende las luces de emergencia al detenerte.",
    };
    const respuesta = "Enciende las luces de emergencia al detenerte en el arcén.";
    const ctx = ctxDe([guia2], respuesta, [0.9], new Map(), E1);
    const r = verifyGroundedAnswer(respuesta, [guia2], "es", pregunta, FECHA, ctx);
    expect(r.text).toContain("luces de emergencia");
  });
});
