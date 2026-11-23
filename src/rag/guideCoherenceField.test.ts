/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Espejo §1, pieza B (H-LOOP-1/3): la puerta de coherencia de
 * guía, sobre el clúster real de cuatro guías del pack Esencial
 * (filas 191, 194, 207, 232, 233 y 261: títulos, cuerpos y
 * claves v2 tal cual viven en el pack).
 *
 * La escena es la de la pasada en vivo: sin pata semántica que
 * puntúe, la elección no elige y el turno cae a la ruta del
 * modelo; el modelo compone su respuesta DESDE LA GUÍA VECINA
 * (las frases reales que la pasada sirvió: la aspirina de 162 a
 * 325 mg del dolor de pecho para la pregunta de RCP; la parte
 * blanda de la nariz para la del sangrado) y el juez la deja
 * pasar con «grounded» porque cada frase SÍ descansa en una
 * fuente, solo que en la guía equivocada. La puerta corre tras
 * el juez, sobre su procedencia: si la pregunta tiene guía
 * ganadora por su identidad (su título y las preguntas que sus
 * claves declaran responder) y ninguna frase citada descansa en
 * ella, se sirve la ganadora tal cual.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "./retrieve.types";
import type { PackSourceDoc } from "./packSource";
import type { SentenceProvenance } from "./provenance";

const retrieveMock = vi.fn();
const readPackSourceMock = vi.fn();
vi.mock("./retrieve", () => ({
  retrieve: (...a: unknown[]) => retrieveMock(...a),
  activeRetrievalProfile: () => undefined,
}));
vi.mock("./packs", () => ({
  knowledgePacks: async () => [],
  resolvePackGuideByKey: async () => null,
  readPackSource: (...a: unknown[]) => readPackSourceMock(...a),
}));
vi.mock("../services/packImporter", () => ({ verifiedImportedPacks: async () => new Map() }));

import { coherenceSubstitute } from "./guideAnswerRun";

/** Fragmento real del pack, por su fila (título, cuerpo y claves v2 verbatim). */
function realChunk(id: number, title: string, body: string, keys?: string): RetrievedChunk {
  return {
    chunkId: `pack:nido-esencial:${id}`,
    docId: `pack:nido-esencial:${title}`,
    title,
    body,
    ...(keys ? { keys } : {}),
    source: "NIDO Esencial",
    score: 0,
    matchType: "lexical",
    sourceKind: "pack",
  } as RetrievedChunk;
}

const CH_191 = realChunk(
  191,
  "RCP (reanimación) en adultos y niños mayores",
  "Si una persona se desploma, no responde y no respira normal (o solo boquea), su corazón probablemente se ha parado. Cada minuto sin RCP baja mucho la posibilidad de sobrevivir. Empezar rápido es lo más importante: no tengas miedo de hacerlo \"mal\"; no hacer nada es peor.",
  "cómo hacer rcp a un adulto\nmi padre se desplomó y no respira, qué hago\na qué ritmo se hacen las compresiones en el pecho\ncuántas compresiones y cuántas respiraciones en la rcp\nuna persona no responde y no respira, qué hago",
);
const CH_194 = realChunk(
  194,
  "RCP (reanimación) en adultos y niños mayores — Respiraciones (solo si sabes hacerlas)",
  "Respiraciones (solo si sabes hacerlas)\n- Si estás entrenado y dispuesto: 30 compresiones y 2 respiraciones, y repite.\n- Para respirar: inclina la cabeza hacia atrás y eleva el mentón, tapa la nariz, sella tu boca sobre la suya y sopla 1 segundo hasta ver que el pecho sube.\n- Si no sabes o no quieres, haz solo compresiones sin parar: en adultos funciona bien.",
);
const CH_207 = realChunk(
  207,
  "Hemorragias graves: cómo parar la sangre — Pasos",
  "Una persona puede morir desangrada en pocos minutos. Una hemorragia es grave si la sangre sale a chorro o sin parar, si empapa la ropa o los vendajes, o si la persona se marea, se pone pálida o confusa. Actúa de inmediato.\n\nPasos\n1. Llama (o que llamen) al número de emergencias.\n2. Ponte guantes o una bolsa de plástico si los tienes; si no, no esperes.\n3. Presión directa: aprieta fuerte sobre la herida con una gasa, tela limpia o, si no hay nada, con la mano. Aprieta con las dos manos y el peso del cuerpo.\n4. No quites la tela aunque se empape: pon más encima y sigue apretando sin parar.\n5. Mantén la presión hasta que llegue ayuda. La herida puede volver a sangrar si sueltas.",
  "cómo paro una hemorragia fuerte\nle sale mucha sangre de la pierna y no para\nse cortó el dedo y le sale mucha sangre, qué hago\ncómo se pone un torniquete y dónde\ncuánto tiempo se aprieta una herida que sangra\ncomo paro uma hemorragia forte\nestá saindo muito sangue da perna, o que faço",
);
const CH_232 = realChunk(
  232,
  "Dolor de pecho e infarto — Signos",
  "En un infarto, cada minuto cuenta. No esperes a ver si se pasa.\n\nSignos\n- Dolor, presión u opresión en el pecho que dura más de unos minutos o va y viene.\n- Dolor que se extiende al brazo (sobre todo el izquierdo), la mandíbula, el cuello, la espalda o el estómago.\n- Falta de aire, sudor frío, náuseas, mareo.\n- En mujeres, personas mayores y diabéticos los signos pueden ser más vagos: cansancio extremo, náuseas, falta de aire sin dolor claro.",
  "le duele el pecho, será un infarto\nqué hago si creo que alguien tiene un infarto\ncuánta aspirina se da en un dolor de pecho\nel dolor de pecho se le va al brazo, qué hago\no que faço se sentir dor no peito\ndor no peito pode ser infarto, o que faço",
);
const CH_233 = realChunk(
  233,
  "Dolor de pecho e infarto — Qué hacer",
  "Qué hacer\n1. Llama de inmediato al número de emergencias.\n2. Que la persona deje de hacer esfuerzo. Siéntala semirrecostada, en la posición más cómoda.\n3. Si es un adulto despierto, no es alérgico a la aspirina, no está sangrando y su médico no se lo ha prohibido: que mastique una aspirina para adultos (entre 162 y 325 mg, o 2 a 4 aspirinas infantiles de 81 mg) y la trague.\n4. Si tiene medicación recetada para la angina (nitroglicerina), ayúdala a tomarla.\n5. Afloja la ropa, tranquilízala y no la dejes sola.\n6. Si dejan de responder y no respiran normal, empieza la RCP y pide un desfibrilador.\n\nImportante\nBasado en las directrices de la AHA, la Cruz Roja Americana y la Cruz Roja Canadiense. No lleves a la persona en coche si puedes esperar a una ambulancia: los equipos de emergencia empiezan el tratamiento por el camino.",
);
const CH_261 = realChunk(
  261,
  "Sangrado de nariz, ojos, dientes y oídos — Sangrado de nariz",
  "Sangrado de nariz\n1. Siéntate y echa la cabeza un poco hacia delante (no hacia atrás: la sangre iría a la garganta).\n2. Aprieta la parte blanda de la nariz con los dedos, sin soltar, durante 15 minutos seguidos. Respira por la boca.\n3. Escupe la sangre que llegue a la boca.\n4. Busca atención médica si no para tras 15 minutos de presión continua, si fue por un golpe fuerte en la cabeza, o si la persona toma anticoagulantes y sangra mucho.",
  "cómo paro una hemorragia de nariz\nle entró algo en el ojo, qué hago\nse le cayó un diente de un golpe, se puede salvar\ncuánto tiempo aprieto la nariz si le sangra\ncomo paro um sangramento no nariz\nentrou alguma coisa no olho dele, o que faço",
);

const CPR_DOC: PackSourceDoc = {
  title: "RCP (reanimación) en adultos y niños mayores",
  source: "NIDO Esencial — RCP (reanimación) en adultos y niños mayores",
  parts: [
    { id: 191, body: CH_191.body, used: true },
    { id: 194, body: CH_194.body, used: false },
  ],
};
const BLEED_DOC: PackSourceDoc = {
  title: "Hemorragias graves: cómo parar la sangre",
  source: "NIDO Esencial — Hemorragias graves: cómo parar la sangre",
  parts: [{ id: 207, body: CH_207.body, used: true }],
};
const DOCS: Record<string, PackSourceDoc> = {
  "pack:nido-esencial:191": CPR_DOC,
  "pack:nido-esencial:194": CPR_DOC,
  "pack:nido-esencial:207": BLEED_DOC,
};

/** La composición real de la pasada desde el fragmento 233 (dolor de pecho). */
const CHEST_SENTENCES: SentenceProvenance[] = [
  "Llama de inmediato al número de emergencias.",
  "Que la persona deje de hacer esfuerzo.",
  "Siéntala semirrecostada, en la posición más cómoda.",
  "Si es un adulto despierto, no es alérgico a la aspirina, no está sangrando y su médico no se lo ha prohibido: que mastique una aspirina para adultos (entre 162 y 325 mg, o 2 a 4 aspirinas infantiles de 81 mg) y la trague.",
  "Si tiene medicación recetada para la angina (nitroglicerina), ayúdala a tomarla.",
  "Afloja la ropa, tranquilízala y no la dejes sola.",
].map((text) => ({ text, origin: { kind: "source", n: 3, support: 1 } as const }));

/** La composición real de la pasada desde el fragmento 261 (sangrado de nariz). */
const NOSE_SENTENCES: SentenceProvenance[] = [
  "Siéntate y echa la cabeza un poco hacia delante (no hacia atrás: la sangre iría a la garganta).",
  "Aprieta la parte blanda de la nariz con los dedos, sin soltar, durante 15 minutos seguidos.",
  "Respira por la boca.",
  "Escupe la sangre que llegue a la boca.",
].map((text) => ({ text, origin: { kind: "source", n: 1, support: 1 } as const }));

/** La lista de la escena 1: el clúster entero; la 233 es la fuente [3]. */
const SCENE1_SOURCES: RetrievedChunk[] = [CH_191, CH_194, CH_233, CH_232, CH_207, CH_261];
/** La escena 2: la 261 abre la lista y es la fuente [1]. */
const SCENE2_SOURCES: RetrievedChunk[] = [CH_261, CH_207, CH_191, CH_233, CH_232, CH_194];

beforeEach(() => {
  vi.clearAllMocks();
  retrieveMock.mockResolvedValue(SCENE1_SOURCES);
  readPackSourceMock.mockImplementation(async (chunkId: string) => DOCS[chunkId] ?? null);
});

describe("espejo §1 pieza B · la puerta de coherencia de guía, sobre el clúster real", () => {
  it("la composición desde la vecina sale sustituida por la guía de la pregunta, en las dos escenas de la pasada", async () => {
    // Escena 1: RCP preguntada, dolor de pecho compuesto.
    const rcp = await coherenceSubstitute({
      query: "¿Cómo hago la RCP a un adulto?",
      lang: "es",
      sources: SCENE1_SOURCES,
      sentences: CHEST_SENTENCES,
      status: "grounded",
    });
    expect(rcp).not.toBeNull();
    expect(rcp?.text).toContain("RCP (reanimación) en adultos y niños mayores");
    expect(rcp?.text).toContain("30 compresiones y 2 respiraciones");
    expect(rcp?.text).not.toContain("162 y 325");
    expect(rcp?.chunks.length).toBeGreaterThan(0);
    expect(rcp?.chunks.every((c) => c.title.startsWith("RCP (reanimación)"))).toBe(true);

    // Escena 2: hemorragia preguntada, nariz compuesta.
    retrieveMock.mockResolvedValue(SCENE2_SOURCES);
    const sangre = await coherenceSubstitute({
      query: "¿Cómo paro una hemorragia grave?",
      lang: "es",
      sources: SCENE2_SOURCES,
      sentences: NOSE_SENTENCES,
      status: "partial",
    });
    expect(sangre).not.toBeNull();
    expect(sangre?.text).toContain("Hemorragias graves: cómo parar la sangre");
    expect(sangre?.text).toContain("Presión directa: aprieta fuerte sobre la herida");
    expect(sangre?.text).not.toContain("parte blanda de la nariz");
    expect(sangre?.chunks.every((c) => c.title.startsWith("Hemorragias graves"))).toBe(true);
  });

  it("la guarda de la ganadora: si la composición descansa en la guía de la pregunta, no se toca", async () => {
    const r = await coherenceSubstitute({
      query: "¿Qué hago si me duele mucho el pecho?",
      lang: "es",
      sources: SCENE1_SOURCES,
      sentences: CHEST_SENTENCES,
      status: "grounded",
    });
    expect(r).toBeNull();
  });

  it("la guarda sin ganadora: una pregunta sin guía en el clúster no se toca", async () => {
    const r = await coherenceSubstitute({
      query: "¿Cuál es la capital de Francia?",
      lang: "es",
      sources: SCENE1_SOURCES,
      sentences: CHEST_SENTENCES,
      status: "grounded",
    });
    expect(r).toBeNull();
  });

  it("fuera de «grounded»/«partial» la puerta no gobierna: el veredicto que no dejó texto verificado no se sustituye", async () => {
    const r = await coherenceSubstitute({
      query: "¿Cómo hago la RCP a un adulto?",
      lang: "es",
      sources: SCENE1_SOURCES,
      sentences: CHEST_SENTENCES,
      status: "unverified",
    });
    expect(r).toBeNull();
  });
});
