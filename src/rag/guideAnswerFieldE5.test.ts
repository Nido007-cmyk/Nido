/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.88 — la regresión del campo entero de las fotos del dueño
 * (2026-11-09, tableta con la 0.1.87): la conversación con el cuento
 * ya generado y la pregunta del gas DOS veces seguidas, con la
 * búsqueda multilingüe activa (perfil e5) y el pack firmado de
 * SALVORA presente solo por palabras (sus vectores son bge: llega
 * sin coseno), el Esencial en su variante e5 puntuando, y un
 * fragmento ajeno como mejor global. La medición del dirimen
 * (research_notes/nido-gas-0.1.87-dirimen-2026-11-09.md) probó con
 * las funciones reales que la vía de palabras de la 0.1.87 no se
 * recorre jamás en ese turno: su primera línea devuelve null si
 * cualquier fragmento de la lista trae coseno. Los datos del pack
 * son los reales del sqlite del dueño (clúster 127 a 143: títulos,
 * cuerpos y keys v2), extraídos el 2026-11-09.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "./retrieve.types";
import type { PackSourceDoc } from "./packSource";
import { MULTILINGUAL_E5_SMALL_PROFILE, BGE_SMALL_EN_PROFILE, type EmbeddingProfile } from "./embeddingProfile";
import { buildLexicalQuery, contextualizeQuery, type ConversationHistory } from "./pure";

const retrieveMock = vi.fn();
const readPackSourceMock = vi.fn();
const verifiedImportedPacksMock = vi.fn();
let activeProfile: EmbeddingProfile = MULTILINGUAL_E5_SMALL_PROFILE;
vi.mock("./retrieve", () => ({
  retrieve: (...a: unknown[]) => retrieveMock(...a),
  activeRetrievalProfile: () => activeProfile,
}));
vi.mock("./packs", () => ({ readPackSource: (...a: unknown[]) => readPackSourceMock(...a) }));
vi.mock("../services/packImporter", () => ({
  verifiedImportedPacks: (...a: unknown[]) => verifiedImportedPacksMock(...a),
}));

import { answerFromGuide } from "./guideAnswerRun";

const QUESTION = "Que hago si huele a gas en mi casa?";
const SALVORA = "local-salvora-emergencias-casa";
const SALVORA_NAME = "SALVORA Home Emergencies: fire, gas, water and home safety";

function ch(title: string, body: string, extra: Partial<RetrievedChunk>): RetrievedChunk {
  return { title, body, score: 0, matchType: "lexical", ...extra } as RetrievedChunk;
}

/** La lista del turno e5: el clúster real del pack, sin coseno. */
// Los `score` de esta lista son el rango de la fusión en el turno
// real: la búsqueda del propio pack ordena sus fragmentos por su
// BM25 y la guía preguntada encabeza su clúster (la pregunta es la
// suya casi palabra por palabra en sus keys); el monóxido, vecino
// de tema, va detrás dentro del mismo pack.
const PACK_CLUSTER: RetrievedChunk[] = [
  ch("Mon\u00f3xido de carbono: detectores, prevenci\u00f3n y qu\u00e9 hacer si suena la alarma", "El mon\u00f3xido de carbono, o CO, es un gas sin olor y sin color que mata sin avisar. Lo producen al quemar combustible equipos tan comunes como las calderas de gas o de petr\u00f3leo, los generadores port\u00e1tiles y las parrillas de carb\u00f3n. Como no se puede ver ni oler, la protecci\u00f3n en casa depende de dos cosas: detectores que funcionen y una revisi\u00f3n anual de los equipos de combusti\u00f3n.", { chunkId: 'pack:local-salvora-emergencias-casa:127', score: 0.76, matchType: "lexical", keys: "\u00bfPor qu\u00e9 el mon\u00f3xido de carbono es tan peligroso si no se ve ni se huele?\n\u00bfD\u00f3nde van los detectores de CO y c\u00f3mo se mantienen?\n\u00bfQu\u00e9 equipos de casa hay que revisar cada a\u00f1o?\n\u00bfQu\u00e9 hago si suena la alarma de CO?" }),
  ch("Mon\u00f3xido de carbono: detectores, prevenci\u00f3n y qu\u00e9 hacer si suena la alarma \u2014 Detectores: d\u00f3nde van y c\u00f3mo cuidarlos", "Detectores: d\u00f3nde van y c\u00f3mo cuidarlos\nInstala detectores de CO con pila, o con pila de reserva, junto a cada zona de dormir de la casa.\n\nRevisa las pilas al cambiar la hora de los relojes cada primavera y cada oto\u00f1o, para comprobar que los detectores funcionan bien.\n\nReemplaza cada detector siguiendo las instrucciones del fabricante o cada 5 a\u00f1os, y pon un recordatorio en el tel\u00e9fono o en el calendario cuando lo compres y lo instales.\n\nValora un detector con lectura digital: adem\u00e1s de sonar, puede mostrar el nivel m\u00e1s alto de CO registrado en tu casa.", { chunkId: 'pack:local-salvora-emergencias-casa:128', score: 0.7, matchType: "lexical" }),
  ch("Mon\u00f3xido de carbono: detectores, prevenci\u00f3n y qu\u00e9 hacer si suena la alarma \u2014 Revisi\u00f3n anual y usos que nunca se hacen", "Revisi\u00f3n anual y usos que nunca se hacen\nHaz que un t\u00e9cnico cualificado revise cada a\u00f1o el sistema de calefacci\u00f3n, el calentador de agua y cualquier otro aparato de gas, petr\u00f3leo o carb\u00f3n.\n\nHaz revisar o limpiar la chimenea cada a\u00f1o: los residuos pueden bloquearla y hacer que el CO se acumule dentro de casa.\n\nNunca calientes la casa con el horno de gas. Nunca quemes carb\u00f3n dentro. Nunca uses dentro una estufa port\u00e1til de gas de camping.\n\nNunca dejes un coche o una camioneta en marcha dentro de un garaje pegado a la casa, ni siquiera con la puerta del garaje abierta.\n\nSi suena la alarma\nSi el detector suena, sal de casa de inmediato y llama al 911.\n\nSi sospechas una intoxicaci\u00f3n por CO y te sientes mareado, aturdido o con n\u00e1useas, busca atenci\u00f3n m\u00e9dica sin demora.", { chunkId: 'pack:local-salvora-emergencias-casa:129', score: 0.52, matchType: "lexical" }),
  ch("Mon\u00f3xido de carbono: detectores, prevenci\u00f3n y qu\u00e9 hacer si suena la alarma \u2014 Nota sobre los n\u00fameros de esta gu\u00eda", "Nota sobre los n\u00fameros de esta gu\u00eda\nLos n\u00fameros de tel\u00e9fono de esta gu\u00eda son de Estados Unidos. Si vives en otro pa\u00eds, busca el n\u00famero de emergencias y el centro de toxicolog\u00eda de tu pa\u00eds y tenlos guardados en el tel\u00e9fono.\n\nFuente\nCDC, Carbon Monoxide (CO) Poisoning Basics, y CDC, Prevention Guidelines: You Can Prevent Carbon Monoxide Exposure. Verificado el 7 de noviembre de 2026.", { chunkId: 'pack:local-salvora-emergencias-casa:130', score: 0.46, matchType: "lexical" }),
  ch("Fuga de gas: c\u00f3mo reconocerla y salir a tiempo \u2014 Reconocer la fuga", "Esta gu\u00eda trata del gas natural que llega por tuber\u00eda. Una fuga puede reconocerse por el olor, por el sonido y por la vista. La respuesta segura no es buscar su origen, sino salir a pie y llamar desde fuera.\n\nReconocer la fuga\nPor el olor: un olor inusual, a petr\u00f3leo o gaseoso. Los sistemas de distribuci\u00f3n a\u00f1aden mercaptano, una sustancia inofensiva, con un olor parecido al de un zorrillo, para que la fuga se pueda detectar.\n\nPor el sonido: el volumen puede ir de un silbido suave a un rugido fuerte, seg\u00fan el tama\u00f1o de la fuga.\n\nPor la vista: tierra despedida alrededor de la zona de la tuber\u00eda, burbujas continuas en zonas mojadas o inundadas, y plantas muertas o descoloridas en medio de una zona de vegetaci\u00f3n sana.", { chunkId: 'pack:local-salvora-emergencias-casa:131', score: 1.0, matchType: "lexical", keys: "\u00bfC\u00f3mo se reconoce una fuga de gas natural por el olor, el sonido y la vista?\n\u00bfQu\u00e9 no debo hacer nunca ante una sospecha de fuga?\n\u00bfDesde d\u00f3nde llamo y a qui\u00e9n aviso?\n\u00bfCu\u00e1ndo hay que llamar al 811?\nHuele mucho a huevo podrido en mi cocina y creo que es gas, \u00bfqu\u00e9 hago?\n\u00bfQu\u00e9 hago si siento un olor fuerte a gas en casa?" }),
  ch("Fuga de gas: c\u00f3mo reconocerla y salir a tiempo \u2014 Lo que no se hace", "Lo que no se hace\nNo provoques llamas ni ninguna fuente posible de ignici\u00f3n: no uses interruptores el\u00e9ctricos, no arranques veh\u00edculos ni equipos el\u00e9ctricos y no enciendas cerillas.\n\nNo uses el tel\u00e9fono ni el m\u00f3vil dentro de la zona. Si est\u00e1s en una casa o un negocio, no desenchufes aparatos de las tomas ni abras la puerta autom\u00e1tica del garaje.\n\nNo intentes manejar t\u00fa mismo las v\u00e1lvulas de la tuber\u00eda: podr\u00edas enviar m\u00e1s producto hacia la fuga o causar otro incidente.\n\nNo busques el origen del olor ni de la fuga.", { chunkId: 'pack:local-salvora-emergencias-casa:132', score: 0.88, matchType: "lexical" }),
  ch("Fuga de gas: c\u00f3mo reconocerla y salir a tiempo \u2014 Salir y llamar desde fuera", "Salir y llamar desde fuera\nSal de la zona a pie de inmediato. Intenta dirigir a las dem\u00e1s personas para que salgan tambi\u00e9n, e intenta mantenerte a contraviento.\n\nDesde un lugar seguro, llama al 911. Despu\u00e9s avisa a la compa\u00f1\u00eda de la tuber\u00eda o a tu n\u00famero local de respuesta a emergencias, si lo conoces, y da tu nombre y el lugar.", { chunkId: 'pack:local-salvora-emergencias-casa:133', score: 0.94, matchType: "lexical" }),
  ch("Fuga de gas: c\u00f3mo reconocerla y salir a tiempo \u2014 Antes de excavar y una opci\u00f3n en casa", "Antes de excavar y una opci\u00f3n en casa\nLlama al 811 unos d\u00edas antes de cualquier proyecto de excavaci\u00f3n en casa. La llamada te conecta con los operadores locales, que marcar\u00e1n la posici\u00f3n aproximada de las l\u00edneas enterradas de gas natural y de otros servicios cerca de donde vas a excavar.\n\nSi vives cerca de una tuber\u00eda, la PHMSA sugiere hablar con la compa\u00f1\u00eda sobre buenos h\u00e1bitos de seguridad, incluido el uso de detectores dom\u00e9sticos de gas.\n\nNota sobre los n\u00fameros de esta gu\u00eda\nLos n\u00fameros de tel\u00e9fono de esta gu\u00eda son de Estados Unidos. Si vives en otro pa\u00eds, busca el n\u00famero de emergencias y el centro de toxicolog\u00eda de tu pa\u00eds y tenlos guardados en el tel\u00e9fono.\n\nFuente\nPHMSA, Pipeline Leak Recognition and What To Do, y PHMSA, National Safe Digging Month. Verificado el 7 de noviembre de 2026.", { chunkId: 'pack:local-salvora-emergencias-casa:134', score: 0.82, matchType: "lexical" }),
  ch("Generadores port\u00e1tiles: usarlos sin que el mon\u00f3xido entre en casa", "El escape de un generador contiene mon\u00f3xido de carbono, un veneno que no se puede ver ni oler. Usado en un espacio cerrado, un generador puede producir niveles altos de CO en minutos.", { chunkId: 'pack:local-salvora-emergencias-casa:135', score: 0.64, matchType: "lexical", keys: "\u00bfD\u00f3nde puede funcionar un generador port\u00e1til y a qu\u00e9 distancia de la casa?\n\u00bfPor qu\u00e9 no vale usarlo en el garaje con la puerta abierta?\n\u00bfC\u00f3mo se reposta y d\u00f3nde se guarda la gasolina?\n\u00bfPor qu\u00e9 no debo enchufar el generador a una toma de la casa?" }),
  ch("Cortar la luz, el agua y el gas: d\u00f3nde est\u00e1n las llaves y c\u00f3mo se cierran", "En un desastre te pueden indicar que cortes los servicios de tu casa. La FEMA pide que todos los miembros de la familia sepan cerrar el gas, el agua y la luz antes de que llegue ese momento, y que el recorrido se aprenda con calma, no durante la emergencia.", { chunkId: 'pack:local-salvora-emergencias-casa:140', score: 0.58, matchType: "lexical", keys: "\u00bfD\u00f3nde est\u00e1 la llave principal del agua y c\u00f3mo se comprueba?\n\u00bfC\u00f3mo se cierra el gas en el contador?\n\u00bfQui\u00e9n puede volver a abrir el gas?\n\u00bfC\u00f3mo se corta la luz en el tablero?\nSe rompi\u00f3 una tuber\u00eda, \u00bfd\u00f3nde cierro el agua de la casa?\n\u00bfD\u00f3nde est\u00e1 la llave de paso para cerrar el agua si se revienta una tuber\u00eda?" }),
];

/** El fragmento de monóxido del Esencial (variante e5, con coseno). */
const ESSENTIALS_CO = ch(
  "Intoxicaciones, venenos y monóxido de carbono — Monóxido de carbono (CO)",
  "El monóxido de carbono es un gas invisible e inodoro que se produce al quemar combustible. Los síntomas son dolor de cabeza, mareo y náusea.",
  { chunkId: "pack:nido-esencial-e5:253", score: 0.9, rawScore: 0.85, matchType: "semantic" },
);
/** Un fragmento ajeno con el mejor coseno del turno. */
const FOREIGN_BEST = ch(
  "Nota general de mantenimiento del hogar",
  "Revisa cada año las instalaciones de la casa y guarda los manuales de los aparatos.",
  { chunkId: "corpus:base:1", score: 0.95, rawScore: 0.91, matchType: "semantic" },
);

/** La guía real de la fuga de gas, como la lee readPackSource. */
const GAS_DOC: PackSourceDoc = {
  title: "Fuga de gas: cómo reconocerla y salir a tiempo",
  source: "SALVORA PACKS — Fuga de gas: cómo reconocerla y salir a tiempo (basado en: PHMSA, Pipeline Leak Recognition and What To Do, y PHMSA, National Safe Digging Month)",
  parts: [
    { id: 131, body: "Esta gu\u00eda trata del gas natural que llega por tuber\u00eda. Una fuga puede reconocerse por el olor, por el sonido y por la vista. La respuesta segura no es buscar su origen, sino salir a pie y llamar desde fuera.\n\nReconocer la fuga\nPor el olor: un olor inusual, a petr\u00f3leo o gaseoso. Los sistemas de distribuci\u00f3n a\u00f1aden mercaptano, una sustancia inofensiva, con un olor parecido al de un zorrillo, para que la fuga se pueda detectar.\n\nPor el sonido: el volumen puede ir de un silbido suave a un rugido fuerte, seg\u00fan el tama\u00f1o de la fuga.\n\nPor la vista: tierra despedida alrededor de la zona de la tuber\u00eda, burbujas continuas en zonas mojadas o inundadas, y plantas muertas o descoloridas en medio de una zona de vegetaci\u00f3n sana.", used: true },
    { id: 132, body: "Lo que no se hace\nNo provoques llamas ni ninguna fuente posible de ignici\u00f3n: no uses interruptores el\u00e9ctricos, no arranques veh\u00edculos ni equipos el\u00e9ctricos y no enciendas cerillas.\n\nNo uses el tel\u00e9fono ni el m\u00f3vil dentro de la zona. Si est\u00e1s en una casa o un negocio, no desenchufes aparatos de las tomas ni abras la puerta autom\u00e1tica del garaje.\n\nNo intentes manejar t\u00fa mismo las v\u00e1lvulas de la tuber\u00eda: podr\u00edas enviar m\u00e1s producto hacia la fuga o causar otro incidente.\n\nNo busques el origen del olor ni de la fuga.", used: false },
    { id: 133, body: "Salir y llamar desde fuera\nSal de la zona a pie de inmediato. Intenta dirigir a las dem\u00e1s personas para que salgan tambi\u00e9n, e intenta mantenerte a contraviento.\n\nDesde un lugar seguro, llama al 911. Despu\u00e9s avisa a la compa\u00f1\u00eda de la tuber\u00eda o a tu n\u00famero local de respuesta a emergencias, si lo conoces, y da tu nombre y el lugar.", used: false },
    { id: 134, body: "Antes de excavar y una opci\u00f3n en casa\nLlama al 811 unos d\u00edas antes de cualquier proyecto de excavaci\u00f3n en casa. La llamada te conecta con los operadores locales, que marcar\u00e1n la posici\u00f3n aproximada de las l\u00edneas enterradas de gas natural y de otros servicios cerca de donde vas a excavar.\n\nSi vives cerca de una tuber\u00eda, la PHMSA sugiere hablar con la compa\u00f1\u00eda sobre buenos h\u00e1bitos de seguridad, incluido el uso de detectores dom\u00e9sticos de gas.\n\nNota sobre los n\u00fameros de esta gu\u00eda\nLos n\u00fameros de tel\u00e9fono de esta gu\u00eda son de Estados Unidos. Si vives en otro pa\u00eds, busca el n\u00famero de emergencias y el centro de toxicolog\u00eda de tu pa\u00eds y tenlos guardados en el tel\u00e9fono.\n\nFuente\nPHMSA, Pipeline Leak Recognition and What To Do, y PHMSA, National Safe Digging Month. Verificado el 7 de noviembre de 2026.", used: false },
  ],
};
const CO_DOC: PackSourceDoc = {
  title: "Monóxido de carbono: detectores, prevención y qué hacer si suena la alarma",
  source: "SALVORA PACKS",
  parts: [
    { id: 127, body: "El mon\u00f3xido de carbono, o CO, es un gas sin olor y sin color que mata sin avisar. Lo producen al quemar combustible equipos tan comunes como las calderas de gas o de petr\u00f3leo, los generadores port\u00e1tiles y las parrillas de carb\u00f3n. Como no se puede ver ni oler, la protecci\u00f3n en casa depende de dos cosas: detectores que funcionen y una revisi\u00f3n anual de los equipos de combusti\u00f3n.", used: true },
  ],
};

/** La conversación de la foto: el cuento primero, la pregunta después. */
const HISTORY: ConversationHistory = {
  turns: [
    { role: "user", text: "Cuéntame un cuento sobre un zorro" },
    { role: "assistant", text: "Había una vez un zorro que vivía junto a un faro y cada noche miraba el mar." },
  ],
} as ConversationHistory;

describe("0.1.88 — el turno del gas con búsqueda multilingüe (campo de las fotos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeProfile = MULTILINGUAL_E5_SMALL_PROFILE;
    verifiedImportedPacksMock.mockResolvedValue(new Map([[SALVORA, { name: SALVORA_NAME }]]));
    retrieveMock.mockResolvedValue([FOREIGN_BEST, ESSENTIALS_CO, ...PACK_CLUSTER]);
    readPackSourceMock.mockImplementation(async (chunkId: string) =>
      chunkId.endsWith(":127") || chunkId.endsWith(":128") || chunkId.endsWith(":129") || chunkId.endsWith(":130") ? CO_DOC : GAS_DOC,
    );
  });

  it("la contextualización deja la pregunta tal cual con el cuento delante", () => {
    expect(contextualizeQuery(QUESTION, HISTORY)).toBe(QUESTION);
    expect(buildLexicalQuery(QUESTION)?.terms).toHaveLength(3);
  });

  it("las DOS preguntas seguidas abren la guía del gas, literal y con el nombre del pack", async () => {
    for (let turn = 1; turn <= 2; turn++) {
      const retrievalQuery = contextualizeQuery(QUESTION, HISTORY);
      const out = await answerFromGuide(QUESTION, "es", retrievalQuery);
      expect(out.answer, `turno ${turn}`).not.toBeNull();
      expect(out.answer!.text).toContain("Fuga de gas: cómo reconocerla y salir a tiempo");
      expect(out.answer!.text).toContain(SALVORA_NAME);
      expect(out.answer!.text).toContain("salir a pie");
      expect(out.answer!.text).not.toContain("problemas de salud");
      expect(out.answer!.chunks[0].chunkId).toBe(`pack:${SALVORA}:131`);
    }
    expect(retrieveMock).toHaveBeenCalledTimes(2);
  });

  it("con el perfil bge y los cosenos del campo de la 0.1.87, la misma guía sale por coseno", async () => {
    activeProfile = BGE_SMALL_EN_PROFILE;
    const cosines: Record<number, number> = { 127: 0.71, 128: 0.68, 129: 0.66, 130: 0.62, 131: 0.76, 132: 0.74, 133: 0.73, 134: 0.67, 135: 0.7, 140: 0.65 };
    const withCosines = PACK_CLUSTER.map((c) => {
      const id = Number(c.chunkId.split(":").pop());
      return { ...c, rawScore: cosines[id], matchType: "semantic" as const };
    });
    retrieveMock.mockResolvedValue(withCosines);
    const out = await answerFromGuide(QUESTION, "es", QUESTION);
    expect(out.answer).not.toBeNull();
    expect(out.answer!.chunks[0].chunkId).toBe(`pack:${SALVORA}:131`);
  });

  it("un segundo pack verificado, de otro nombre y firmante, abre su guía por palabras igual", async () => {
    const OTHER = "local-guias-del-norte";
    verifiedImportedPacksMock.mockResolvedValue(new Map([
      [SALVORA, { name: SALVORA_NAME }],
      [OTHER, { name: "Guías del Norte" }],
    ]));
    const fire = ch(
      "Plan de escape en caso de incendio: dibujarlo, practicarlo y salir en dos minutos — Dibujar el plan",
      "Dibuja el plano de tu casa con dos salidas por habitación y un punto de encuentro fuera.",
      { chunkId: `pack:${OTHER}:92`, score: 0.8, keys: "¿Cómo se hace un plan de escape en caso de incendio?" },
    );
    retrieveMock.mockResolvedValue([FOREIGN_BEST, ESSENTIALS_CO, fire]);
    readPackSourceMock.mockResolvedValue({
      title: "Plan de escape en caso de incendio: dibujarlo, practicarlo y salir en dos minutos",
      source: "Guías del Norte",
      parts: [{ id: 92, body: fire.body, used: true }],
    } as PackSourceDoc);
    const out = await answerFromGuide("¿Cómo se hace un plan de escape en caso de incendio?", "es");
    expect(out.answer).not.toBeNull();
    expect(out.answer!.text).toContain("Guías del Norte");
    expect(out.answer!.chunks[0].chunkId).toBe(`pack:${OTHER}:92`);
  });

  it("la pregunta en inglés abre la guía inglesa del mismo pack por palabras", async () => {
    const enCluster: RetrievedChunk[] = [
  ch("Gas Leak: How to Recognize It and Get Out in Time \u2014 Recognizing the leak", "This guide is about natural gas delivered by pipeline. A leak can be recognized by smell, by sound and by sight. The safe response is not to look for where it comes from, but to leave the area by foot and call from outside.\n\nRecognizing the leak\nBy smell: an unusual smell, a petroleum odor or a gaseous odor. Distribution systems add mercaptan, a harmless chemical with a skunk like odor, to make a leak easier to detect.\n\nBy sound: the volume can range from a quiet hissing to a loud roar, depending on the size of the leak.\n\nBy sight: blowing dirt around a pipeline area, continuous bubbling in wet or flooded areas, and dead or discolored plants in an otherwise healthy area of vegetation.", { chunkId: 'pack:local-salvora-emergencias-casa:45', score: 0.6, matchType: "lexical", keys: "How can a natural gas leak be recognized by smell, sound and sight?\nWhat must I never do when I suspect a leak?\nWhere do I call from and who do I notify?\nWhen should I call 811?" }),
  ch("Gas Leak: How to Recognize It and Get Out in Time \u2014 What not to do", "What not to do\nDo not cause any flame or any potential source of ignition: do not use electrical switches, do not start motor vehicles or electrical equipment, and do not light a match.\n\nDo not use a telephone or cell phone inside the area. If you are inside a home or business, do not pull plugs from electrical outlets or open an automatic garage door.\n\nDo not attempt to operate any pipeline valves yourself: you may inadvertently route more product to the leak or cause a secondary incident.\n\nDo not try to locate the source of the odor or leak.", { chunkId: 'pack:local-salvora-emergencias-casa:46', score: 0.6, matchType: "lexical" }),
  ch("Gas Leak: How to Recognize It and Get Out in Time \u2014 Leave and call from outside", "Leave and call from outside\nLeave the area by foot immediately. Try to direct other individuals to leave the area too, and try to stay upwind.\n\nFrom a safe location, call 911. Then notify the pipeline company or your local emergency response number, if known, and give your name and the location.", { chunkId: 'pack:local-salvora-emergencias-casa:47', score: 0.6, matchType: "lexical" }),
  ch("Gas Leak: How to Recognize It and Get Out in Time \u2014 Before digging, and one option at home", "Before digging, and one option at home\nCall 811 a few days before any home digging project. The call connects you to your local underground utility operators, who will mark the approximate location of buried natural gas lines and other buried utilities near where you plan to dig.\n\nIf you live near a pipeline, PHMSA suggests talking with the company about good safety habits, including the use of home gas detectors.\n\nA note on the numbers in this guide\nThe phone numbers in this guide are for the United States. If you live in another country, look up your country's emergency number and poison center number and keep them saved in your phone.\n\nSource\nPHMSA, Pipeline Leak Recognition and What To Do, and PHMSA, National Safe Digging Month. Checked on November 7, 2026.", { chunkId: 'pack:local-salvora-emergencias-casa:48', score: 0.6, matchType: "lexical" }),
    ];
    retrieveMock.mockResolvedValue([FOREIGN_BEST, ESSENTIALS_CO, ...enCluster]);
    readPackSourceMock.mockResolvedValue(GAS_DOC);
    const out = await answerFromGuide("What do I do if I smell gas in my house?", "en");
    expect(out.answer).not.toBeNull();
    expect(out.answer!.chunks[0].chunkId).toBe(`pack:${SALVORA}:45`);
  });
});

describe("0.1.88 — la RCP del Esencial sigue literal con la vía de palabras abierta", () => {
  it("el Esencial e5 con coseno gana como siempre, con el pack importado sin coseno en la lista", async () => {
    activeProfile = MULTILINGUAL_E5_SMALL_PROFILE;
    verifiedImportedPacksMock.mockResolvedValue(new Map([[SALVORA, { name: SALVORA_NAME }]]));
    const rcp = ch(
      "RCP (reanimación) en adultos y niños mayores — Antes de empezar",
      "Antes de empezar\n- Comprueba que el lugar es seguro.\n- Comprueba si la persona responde.",
      { chunkId: "pack:nido-esencial-e5:8", score: 0.97, rawScore: 0.89, matchType: "semantic" },
    );
    retrieveMock.mockResolvedValue([rcp, ...PACK_CLUSTER]);
    readPackSourceMock.mockResolvedValue({
      title: "RCP (reanimación) en adultos y niños mayores",
      source: "NIDO",
      parts: [{ id: 8, body: rcp.body, used: true }],
    } as PackSourceDoc);
    const out = await answerFromGuide("¿Cómo hago la RCP a un adulto?", "es");
    expect(out.answer).not.toBeNull();
    expect(out.answer!.text).toContain("RCP (reanimación) en adultos");
    expect(out.answer!.chunks[0].chunkId).toBe("pack:nido-esencial-e5:8");
  });
});
