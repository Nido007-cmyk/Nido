/**
 * T-26 (0.1.99): la banda del empate cruzado de idioma de la cirugía
 * de polos F-06 — regresión del hallazgo H-1 de la re-auditoría.
 *
 * H-1: con el contexto servido, la cirugía cortaba la cláusula FIEL
 * de matriz-a-348 («añade refrigerante solo con el motor frío»,
 * traducción palabra a palabra de «Add coolant only when the engine
 * is cold») porque la gemela de polo opuesto («…with the engine
 * hot», 0,8348) le ganaba a su lectura fiel (0,8248) por 0,0099: el
 * descuento del hueco de idioma ES↔EN, no una diferencia de verdad.
 * La batería no lo veía porque su vara es el marcador, y el marcador
 * de 348 vive en otra cláusula. La cura: si la lectura fiel es
 * casi-gemela (≥ tau) y su chunk es de otro idioma que la
 * respuesta, la opuesta debe ganar por SEM_POLE_XLANG_EPS (0,03).
 *
 * Este fichero fija las dos capas: la geometría REAL de la caza
 * (vectores e5 del fixture servido, vía contextoCaza0197) y el
 * MECANISMO con vectores hechos a mano de cosenos controlados
 * (el plano xy de nucleoSemantico.test.ts: rot(c) tiene coseno c
 * contra (1, 0)).
 */
import { describe, expect, it } from "vitest";
import {
  splitClausesWithSep,
  splitSentences,
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding";
import { contextoCaza0197 } from "./caza0197Contexto";
import type { JudgeSemanticContext } from "./semanticContext";

const FECHA = new Date("2026-11-14T12:00:00Z");

// ---------------------------------------------------------- geometría real

const GUIA_SOBRECALENTAMIENTO_EN: GroundingChunk[] = [
  {
    title: "Overheated engine",
    body: "If the engine overheats, switch off the engine and wait 30 minutes before opening the bonnet. Never open the radiator cap with the engine hot. The engine temperature should not go above 90 degrees in normal driving. Add coolant only when the engine is cold. This guide was reviewed on April 25, 2024.",
  },
  {
    title: "Canals of England",
    body: "The Kennet and Avon Canal is a waterway in southern England that runs for 90 kilometres through Wiltshire and Berkshire countryside.",
  },
];
const PREGUNTA_SOBRECALENTAMIENTO = "¿Qué hago si el motor del coche se sobrecalienta?";

const GUIA_LLANTA_ES: GroundingChunk = {
  title: "Cambio de llanta",
  body: "Para cambiar una llanta, apaga el motor y pon el freno de mano en un sitio seguro y plano. Afloja las tuercas media vuelta antes de levantar el coche con el gato. Nunca te pongas debajo del coche apoyado solo en el gato. El par recomendado para las tuercas es de 120 newtons. La rueda de repuesto temporal se usa a un máximo de 80 km por hora. La asistencia en carretera responde en el 900-555-0134 y las emergencias en el 112. Esta guía fue revisada el 3 de octubre de 2023.",
};
const PREGUNTA_LLANTA = "¿Cómo cambio la llanta de un carro en la carretera?";

describe("H-1 · la fiel de 348 y la familia F-06 con la geometría servida", () => {
  it("matriz-a-348 con contexto: la cláusula fiel ya no se corta", () => {
    const respuesta =
      "Apaga el motor y espera unos 30 minutos antes de abrir el capó, y añade refrigerante solo con el motor frío.";
    const ctx = contextoCaza0197("matriz-a-348");
    expect(ctx).toBeDefined();
    const r = verifyGroundedAnswer(respuesta, GUIA_SOBRECALENTAMIENTO_EN, "es", PREGUNTA_SOBRECALENTAMIENTO, FECHA, ctx);
    expect(r.text).toContain("espera unos 30 minutos");
    expect(r.text).toContain("añade refrigerante solo con el motor frío");
  });

  it("matriz-a-348 sin contexto: se conservaba y se conserva (control)", () => {
    const respuesta =
      "Apaga el motor y espera unos 30 minutos antes de abrir el capó, y añade refrigerante solo con el motor frío.";
    const r = verifyGroundedAnswer(respuesta, GUIA_SOBRECALENTAMIENTO_EN, "es", PREGUNTA_SOBRECALENTAMIENTO, FECHA);
    expect(r.text).toContain("añade refrigerante solo con el motor frío");
  });

  it("matriz-a-511: la cirugía sigue cortando SOLO la cláusula inventada", () => {
    const respuesta =
      "Afloja las tuercas media vuelta antes de levantar el coche con el gato y mantén el motor en marcha durante todo el cambio.";
    const r = verifyGroundedAnswer(respuesta, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA, contextoCaza0197("matriz-a-511"));
    expect(r.text).toContain("Afloja las tuercas media vuelta");
    expect(r.text).not.toContain("en marcha");
  });

  it("matriz-a-512: la cláusula del polo contrario sigue cayendo", () => {
    const respuesta =
      "Afloja las tuercas media vuelta antes de levantar el coche con el gato y mantén el motor en marcha durante todo el cambio.";
    const r = verifyGroundedAnswer(respuesta, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA, contextoCaza0197("matriz-a-512"));
    expect(r.text).not.toContain("mantén el motor en marcha");
  });

  it("matriz-a-527: sin lectura fiel (misma = 0) la banda no protege y la opuesta cae", () => {
    const respuesta =
      "Para cambiar la llanta, keep the engine running while you loosen the nuts in a safe flat place.";
    const r = verifyGroundedAnswer(respuesta, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA, contextoCaza0197("matriz-a-527"));
    expect(r.text).not.toContain("keep the engine running");
  });

  it("matriz-a-064: mismo idioma (PT↔PT) con gap 0,0232 < eps — la banda NO es universal y la inventada cae", () => {
    const guia: GroundingChunk = {
      title: "Queimaduras leves",
      body: "Lave a queimadura leve com água fria por 10 minutos, sem usar gelo. Não aplique manteiga nem pasta de dentes na queimadura. Se a queimadura for maior que 15 centímetros, procure atendimento médico. Cubra a área com uma gaze limpa e seca. Em caso de emergência ligue para o 112. Este guia foi revisto em 5 de maio de 2024.",
    };
    const respuesta = "Primeiro passe óleo de cozinha bem quente sobre a queimadura e depois aperte a pele com força.";
    const r = verifyGroundedAnswer(respuesta, [guia], "pt", "O que devo fazer se eu tiver uma queimadura leve na mão?", FECHA, contextoCaza0197("matriz-a-064"));
    expect(r.text).not.toContain("óleo de cozinha");
  });

  it("matriz-a-066: la banda lo protege en la cirugía, pero SUELO caza la frase igualmente", () => {
    const fuentes: GroundingChunk[] = [
      {
        title: "Minor burns",
        body: "Wash a minor burn with cold water for 10 minutes, without using ice. Do not apply butter or toothpaste to the burn. If the burn is larger than 15 centimetres, seek medical care. Cover the area with a clean, dry gauze. In an emergency call 112. This guide was reviewed on May 5, 2024.",
      },
      {
        title: "Lake District lakes",
        body: "The Lake District in Cumbria is famous for its waters, and Wastwater is the deepest of its 15 main lakes, set below the highest mountains in England.",
      },
    ];
    const respuesta = "Primeiro passe óleo de cozinha bem quente sobre a queimadura e depois aperte a pele com força.";
    const r = verifyGroundedAnswer(respuesta, fuentes, "pt", "O que devo fazer se eu tiver uma queimadura leve na mão?", FECHA, contextoCaza0197("matriz-a-066"));
    expect(r.text).not.toContain("óleo de cozinha");
  });

  it("matriz-a-360: cruzado pero con misma (0,7954) bajo tau — la banda exige fiel casi-gemela y el caso sigue cazado", () => {
    const respuesta = "Añade 35 ml de aceite al radiador mientras el motor está caliente.";
    const r = verifyGroundedAnswer(respuesta, GUIA_SOBRECALENTAMIENTO_EN, "es", PREGUNTA_SOBRECALENTAMIENTO, FECHA, contextoCaza0197("matriz-a-360"));
    expect(r.text).not.toContain("35 ml de aceite al radiador");
  });
});

// ---------------------------------------------------------- mecanismo

const E1 = new Float32Array([1, 0, 0, 0]);
const rot = (c: number) => new Float32Array([c, Math.sqrt(1 - c * c), 0, 0]);

/** Contexto con vectores por texto de cláusula; un texto sin asignar es un error del test. */
function ctxDe(
  chunks: GroundingChunk[],
  answer: string,
  sims: number[],
  porClausula: Map<string, Float32Array>,
): JudgeSemanticContext {
  const v = (t: string) => {
    const r = porClausula.get(t);
    if (!r) throw new Error(`sin vector asignado para la cláusula: ${t}`);
    return r;
  };
  const chunkClauseVectors = chunks.map((c) => {
    const ss = splitSentences(c.body.trim())
      .map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim())
      .filter(Boolean);
    return ss.flatMap((s) => splitClausesWithSep(s).map((cl) => v(cl.text)));
  });
  const answerClauseVectors = splitSentences(answer.trim()).map((s) =>
    splitClausesWithSep(s).map((cl) => v(cl.text)),
  );
  return {
    chunkClauseVectors,
    answerClauseVectors,
    questionChunkSims: Float32Array.from(sims),
    profileId: "multilingual-e5-small",
  };
}

/**
 * El aparejo de 348 reducido a su geometría: guía EN sin negaciones
 * (para que ninguna otra puerta dispare: TIE2 no tiene gemela negada
 * que leer, TRAS no tiene raíces negadas, N8 no tiene segundo chunk)
 * con la cláusula caliente y la fría; respuesta ES con una cláusula
 * ancla a similitud 1 (SUELO no puede con la frase) y la cláusula
 * fiel del refrigerante con la misma/opp que el test fije.
 */
const GUIA_CALOR_EN: GroundingChunk = {
  title: "Overheated engine",
  body: "Let the engine stay hot during the test. Add coolant only when the engine is cold.",
};
const RESPUESTA_FIEL_ES =
  "Apaga el motor y espera a que el motor se enfríe, y añade refrigerante solo con el motor frío.";
const PREGUNTA_CALOR = "¿Qué hago si el motor del coche se sobrecalienta?";

function aparejo348(misma: number, opp: number): JudgeSemanticContext {
  // La cláusula fiel en rot(misma) contra la fría en E1; la caliente
  // se coloca al ángulo que deja su coseno contra la fiel en opp.
  const thetaFiel = Math.acos(misma);
  const thetaCaliente = thetaFiel - Math.acos(opp);
  const caliente = new Float32Array([Math.cos(thetaCaliente), Math.sin(thetaCaliente), 0, 0]);
  return ctxDe(
    [GUIA_CALOR_EN],
    RESPUESTA_FIEL_ES,
    [0.9],
    new Map<string, Float32Array>([
      ["Let the engine stay hot during the test", caliente],
      ["Add coolant only", E1],
      ["the engine is cold", E1],
      ["Apaga el motor", E1],
      ["espera a que el motor se enfríe", E1],
      ["añade refrigerante solo con el motor frío", rot(misma)],
    ]),
  );
}

describe("La banda del empate cruzado, fijada por geometría", () => {
  it("el aparejo trocea como el mapa espera", () => {
    const clausulasGuia = splitSentences(GUIA_CALOR_EN.body).flatMap((s) =>
      splitClausesWithSep(s).map((c) => c.text),
    );
    expect(clausulasGuia).toEqual([
      "Let the engine stay hot during the test",
      "Add coolant only",
      "the engine is cold",
    ]);
    const clausulasRespuesta = splitSentences(RESPUESTA_FIEL_ES).flatMap((s) =>
      splitClausesWithSep(s).map((c) => c.text),
    );
    expect(clausulasRespuesta).toEqual([
      "Apaga el motor",
      "espera a que el motor se enfríe",
      "añade refrigerante solo con el motor frío",
    ]);
  });

  it("cruzado con el gap de 348 (opp 0,8348 / misma 0,8248): la fiel se queda", () => {
    const ctx = aparejo348(0.8248, 0.8348);
    const r = verifyGroundedAnswer(RESPUESTA_FIEL_ES, [GUIA_CALOR_EN], "es", PREGUNTA_CALOR, FECHA, ctx);
    expect(r.text).toContain("añade refrigerante solo con el motor frío");
  });

  it("cruzado con gap 0,06 (opp 0,8848 / misma 0,8248): la opuesta gana de verdad y la cláusula cae", () => {
    const ctx = aparejo348(0.8248, 0.8848);
    const r = verifyGroundedAnswer(RESPUESTA_FIEL_ES, [GUIA_CALOR_EN], "es", PREGUNTA_CALOR, FECHA, ctx);
    // Corte de cláusula, no de frase: lo fiel se queda servido.
    expect(r.text).toContain("Apaga el motor");
    expect(r.text).not.toContain("añade refrigerante");
  });

  it("cruzado con la misma bajo tau (0,7954, la de 360): no hay fiel casi-gemela que proteger y la cláusula cae", () => {
    const ctx = aparejo348(0.7954, 0.8563);
    const r = verifyGroundedAnswer(RESPUESTA_FIEL_ES, [GUIA_CALOR_EN], "es", PREGUNTA_CALOR, FECHA, ctx);
    expect(r.text).toContain("Apaga el motor");
    expect(r.text).not.toContain("añade refrigerante");
  });
});
