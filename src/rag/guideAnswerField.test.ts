/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.87 — la regresión del campo real (dirimen del turno del gas,
 * 2026-11-09). La prueba de la pieza 1 de la 0.1.86 ejercía UN
 * fragmento inventado a 0,93, solo, sin competidores; en el campo
 * real el fragmento de la guía del gas compite dentro de su propio
 * pack contra su clúster de gas y monóxido (filas 127 a 143 del pack
 * en disco, ANEXO B), contra la guía de monóxido del Esencial
 * (fila 253) y contra la base integrada, con cosenos bge por debajo
 * de la vara heredada de 0,8. Este fichero ejercita la elección
 * sobre ese campo, con los títulos y cuerpos reales del pack, y la
 * pregunta exacta del dueño: «Que hago si huele a gas en mi casa?».
 */
import { describe, it, expect } from "vitest";
import { pickGuideChunk, type LiteralRouteContext } from "./guideAnswer";
import { buildGuidePickCandidates, GUIDE_PICK_CHUNKS } from "./guidePickCandidates";
import { ANSWER_CONTEXT_CHUNKS } from "./pure";
import { BGE_SMALL_EN_PROFILE, MULTILINGUAL_E5_SMALL_PROFILE, embeddingProfileForSha, BGE_SMALL_EN_SHA256, MULTILINGUAL_E5_SMALL_SHA256 } from "./embeddingProfile";
import type { RetrievedChunk } from "./retrieve.types";

const chunk = (id: string, title: string, body: string, rawScore?: number, matchType: "lexical" | "semantic" | "hybrid" = "semantic", score = 1): RetrievedChunk =>
  ({ chunkId: id, docId: id, title, body, score, rawScore, matchType }) as unknown as RetrievedChunk;

const SALVORA = "local-salvora-emergencias-casa";
const ROUTE: LiteralRouteContext = {
  importedVerifiedPackIds: new Set([SALVORA]),
  importedPackNames: new Map([[SALVORA, "SALVORA Home Emergencies: fire, gas, water and home safety"]]),
};

/** Cuerpo real de la fila 131 (ANEXO B, verbatim). */
const GAS_131_BODY = `Esta guía trata del gas natural que llega por tubería. Una fuga puede reconocerse por el olor, por el sonido y por la vista. La respuesta segura no es buscar su origen, sino salir a pie y llamar desde fuera.

Reconocer la fuga
Por el olor: un olor inusual, a petróleo o gaseoso. Los sistemas de distribución añaden mercaptano, una sustancia inofensiva, con un olor parecido al de un zorrillo, para que la fuga se pueda detectar.

Por el sonido: el volumen puede ir de un silbido suave a un rugido fuerte, según el tamaño de la fuga.

Por la vista: tierra despedida alrededor de la zona de la tubería, burbujas continuas en zonas mojadas o inundadas, y plantas muertas o descoloridas en medio de una zona de vegetación sana.`;

/**
 * El clúster español del propio pack (filas 127 a 143, títulos
 * reales del ANEXO B) con cosenos bge en la banda plausible que el
 * dirimen acota: pregunta española corta contra apartados largos de
 * una guía de hogar, por debajo de los 0,87–0,89 medidos en su día
 * con primeros auxilios del Esencial. El fragmento correcto (131)
 * es el mejor de su pack, sin llegar a la vara vieja.
 */
const CLUSTER_127_143: Array<[number, string, number]> = [
  [127, "Monóxido de carbono: detectores, prevención y qué hacer si suena la alarma", 0.71],
  [128, "Monóxido de carbono: detectores, prevención y qué hacer si suena la alarma — Detectores: dónde van y cómo cuidarlos", 0.68],
  [129, "Monóxido de carbono: detectores, prevención y qué hacer si suena la alarma — Revisión anual y usos que nunca se hacen", 0.66],
  [130, "Monóxido de carbono: detectores, prevención y qué hacer si suena la alarma — Nota sobre los números de esta guía", 0.62],
  [131, "Fuga de gas: cómo reconocerla y salir a tiempo — Reconocer la fuga", 0.76],
  [132, "Fuga de gas: cómo reconocerla y salir a tiempo — Lo que no se hace", 0.74],
  [133, "Fuga de gas: cómo reconocerla y salir a tiempo — Salir y llamar desde fuera", 0.73],
  [134, "Fuga de gas: cómo reconocerla y salir a tiempo — Antes de excavar y una opción en casa", 0.67],
  [135, "Generadores portátiles: usarlos sin que el monóxido entre en casa", 0.7],
  [136, "Generadores portátiles: usarlos sin que el monóxido entre en casa — Solo fuera, lejos de la casa", 0.69],
  [137, "Generadores portátiles: usarlos sin que el monóxido entre en casa — Solo fuera, lejos de la casa", 0.65],
  [138, "Generadores portátiles: usarlos sin que el monóxido entre en casa — Repostar y guardar el combustible", 0.63],
  [139, "Generadores portátiles: usarlos sin que el monóxido entre en casa — Conectarlo sin retroalimentación", 0.61],
  [140, "Cortar la luz, el agua y el gas: dónde están las llaves y cómo se cierran", 0.72],
  [141, "Cortar la luz, el agua y el gas: dónde están las llaves y cómo se cierran — Antes de la emergencia: localiza las tres llaves", 0.68],
  [142, "Cortar la luz, el agua y el gas: dónde están las llaves y cómo se cierran — El gas: con llave y un cuarto de vuelta", 0.7],
  [143, "Cortar la luz, el agua y el gas: dónde están las llaves y cómo se cierran — El agua y la luz", 0.64],
];

const clusterChunks = (): RetrievedChunk[] =>
  CLUSTER_127_143.map(([id, title, score]) =>
    chunk(`pack:${SALVORA}:${id}`, title, id === 131 ? GAS_131_BODY : `${title}\nTexto del apartado.`, score),
  );

/** El competidor más peligroso: la guía de monóxido del Esencial, fila 253 (cuerpo real, ANEXO B). */
const ESENCIAL_253 = chunk(
  "pack:nido-esencial:253",
  "Intoxicaciones, venenos y monóxido de carbono — Monóxido de carbono (CO)",
  `Monóxido de carbono (CO)
Es un gas que no se ve ni se huele. Lo producen estufas, braseros, calentadores de gas, generadores y coches en lugares cerrados. Mata a muchas personas tras los desastres y en invierno.
Signos: dolor de cabeza, mareo, náuseas, cansancio, confusión. Suele afectar a varias personas (y mascotas) de la misma casa a la vez, y mejoran al salir.
1. Sal al aire libre de inmediato y saca a todos. Abre puertas y ventanas si no te retrasa.
2. Llama al número de emergencias.
3. Si alguien no responde, saca a la persona al aire libre si puedes hacerlo sin riesgo y empieza la RCP si no respira.`,
  0.75,
);

/** Un fragmento semántico de la base integrada que compite por encima de todos. */
const BUILTIN_TOP = chunk("builtin:art-991", "El gas natural en la vivienda", "Artículo de la base integrada sobre el gas.", 0.82);

describe("0.1.87 · la elección sobre el campo real del turno del gas", () => {
  it("el fragmento correcto gana a su clúster y al Esencial aunque el mejor global no sea literal", () => {
    const field = [...clusterChunks(), ESENCIAL_253, BUILTIN_TOP];
    const pick = pickGuideChunk(field, "es", ROUTE, { profile: BGE_SMALL_EN_PROFILE, query: "Que hago si huele a gas en mi casa?" });
    expect(pick?.["chunkId"]).toBe(`pack:${SALVORA}:131`);
  });

  it("la vara es del perfil de embeddings, no la constante heredada: con e5 la misma banda NO basta", () => {
    // Las escalas de e5 viven mucho más arriba (sus pisos medidos son
    // 0,81/0,84): un literal a 0,76 en e5 es ruido de fondo, no guía.
    const field = [...clusterChunks(), ESENCIAL_253];
    expect(pickGuideChunk(field, "es", ROUTE, { profile: MULTILINGUAL_E5_SMALL_PROFILE, query: "Que hago si huele a gas en mi casa?" })).toBeNull();
  });

  it("sin perfil declarado, la vara por defecto es la de bge (el comportamiento previo de la casa)", () => {
    expect(embeddingProfileForSha(null)).toBe(BGE_SMALL_EN_PROFILE);
    expect(embeddingProfileForSha(BGE_SMALL_EN_SHA256).guideMinScore).toBeLessThan(0.8);
    expect(embeddingProfileForSha(MULTILINGUAL_E5_SMALL_SHA256).guideMinScore).toBeGreaterThan(
      embeddingProfileForSha(BGE_SMALL_EN_SHA256).guideMinScore,
    );
  });

  it("el margen declarado sigue vetando: un literal muy por debajo del mejor global no se sirve", () => {
    const weak = chunk(`pack:${SALVORA}:131`, "Fuga de gas: cómo reconocerla y salir a tiempo — Reconocer la fuga", GAS_131_BODY, 0.62);
    const strong = chunk("builtin:art-7", "Tema ajeno muy cercano", "Otro texto.", 0.97);
    expect(pickGuideChunk([weak, strong], "es", ROUTE, { profile: BGE_SMALL_EN_PROFILE, query: "Que hago si huele a gas en mi casa?" })).toBeNull();
  });

  it("la guía del Esencial sigue saliendo como antes en su banda medida (0,87–0,89)", () => {
    const cpr = chunk("pack:nido-esencial:8", "RCP (reanimación) en adultos y niños mayores — Antes de empezar", "Antes de empezar\n- Comprueba que el lugar es seguro.", 0.88);
    expect(pickGuideChunk([cpr], "es", ROUTE, { profile: BGE_SMALL_EN_PROFILE, query: "¿Cómo hago la RCP a un adulto?" })?.["chunkId"]).toBe(cpr.chunkId);
  });

  it("sin el registro verificado, el mismo campo sigue cerrado (la identidad no basta)", () => {
    const field = [...clusterChunks(), ESENCIAL_253, BUILTIN_TOP];
    // Sin ruta: el único literal elegible es el del Esencial, y su
    // 0,75 no alcanza la vara de su perfil.
    expect(pickGuideChunk(field, "es", undefined, { profile: BGE_SMALL_EN_PROFILE, query: "Que hago si huele a gas en mi casa?" })).toBeNull();
  });
});

describe("0.1.87 · la elección mira una lista más ancha que el contexto del prompt", () => {
  it("el barajado pone primero el topK del prompt y después el de elección, sin duplicar", () => {
    const wide = Array.from({ length: GUIDE_PICK_CHUNKS }, (_, i) => chunk(`builtin:w${i}`, `Tema ${i}`, "x", 0.5));
    const prompt = wide.slice(0, ANSWER_CONTEXT_CHUNKS);
    const merged = buildGuidePickCandidates(prompt, wide);
    expect(merged).toHaveLength(GUIDE_PICK_CHUNKS);
    expect(merged.slice(0, Number(ANSWER_CONTEXT_CHUNKS))).toEqual(prompt);
    expect(new Set(merged.map((c) => c.chunkId)).size).toBe(GUIDE_PICK_CHUNKS);
  });

  it("si la lista ancha es la misma que la del prompt, el barajado no añade nada", () => {
    const prompt = [chunk("a:1", "A", "x", 0.5), chunk("a:2", "B", "x", 0.4)];
    expect(buildGuidePickCandidates(prompt, prompt)).toEqual(prompt);
  });

  it("una guía fuera del corte de 4 pero dentro del de elección se puede servir", () => {
    // El fragmento del gas quedó en el puesto 6 de la fusión: el
    // corte del prompt lo vetaba aunque la recuperación lo encontró.
    const noise = [0.86, 0.85, 0.84, 0.83, 0.82].map((s, i) => chunk(`builtin:n${i}`, `Ruido ${i}`, "x", s));
    const gas = chunk(`pack:${SALVORA}:131`, "Fuga de gas: cómo reconocerla y salir a tiempo — Reconocer la fuga", GAS_131_BODY, 0.76);
    const wide = [...noise, gas];
    const candidates = buildGuidePickCandidates(wide.slice(0, ANSWER_CONTEXT_CHUNKS), wide);
    const pick = pickGuideChunk(candidates, "es", ROUTE, { profile: BGE_SMALL_EN_PROFILE, query: "Que hago si huele a gas en mi casa?" });
    expect(pick?.["chunkId"]).toBe(gas.chunkId);
  });
});
