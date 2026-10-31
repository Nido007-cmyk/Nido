/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Emergencia primero y puerta léxica de salud (programa «Lo mejor de
 * la bounty», tanda 2; pieza 06 de la colección: Field Atlas,
 * Apache-2.0, y el patrón de puerta léxica de LabRat, MIT, descrito en
 * su README — implementación propia, ver ATTRIBUTION.md).
 *
 * Dos garantías que a NIDO le faltaban, verificadas en su código:
 *
 * 1. LO DE EMERGENCIA NO HACE COLA. Las rutas fijas (monóxido →
 *    números verificados de los packs → tabla de safetyAnswers)
 *    responden sin modelo al principio de send(), pero mientras otra
 *    respuesta se estaba generando el compositor se deshabilitaba y
 *    el botón de enviar era «detener»: una emergencia tecleada a mitad
 *    de generación no podía ni enviarse. `isEmergencyText` reconoce el
 *    texto con los MISMOS detectores puros de las rutas fijas, para
 *    que la pantalla ofrezca el envío de emergencia durante la
 *    generación; al tocarlo se detiene y se espera la generación en
 *    curso (la vía de stopAndAwaitGeneration) y el envío entra por la
 *    ruta fija, que pinta al instante y primero.
 *
 * 2. LA SALUD SIN GUÍA NO CAE A LA MEMORIA DEL MODELO. Si la pregunta
 *    es de salud (puerta léxica, no el juicio del modelo) y ningún
 *    pasaje recuperado es evidencia de salud, las salidas que dejaban
 *    texto del modelo en pie (sin fuentes, o «unverified» por lengua
 *    distinta, o el extracto de una fuente que no es de salud en la
 *    abstención) se sustituyen por el texto seguro fijo. Lo
 *    «grounded»/«partial» NO se toca: no es memoria del modelo, es
 *    texto verificado frase a frase contra sus fuentes.
 *
 * Evidencia de salud = un chunk de los packs cuyas guías son de salud
 * con fuentes verificadas: NIDO Esencial y NIDO Niños (primeros
 * auxilios) y NIDO Crisis (líneas de crisis). El id puede llevar el
 * sufijo de embeddings «-e5» (la convención de guideAnswer.ts).
 *
 * 3. LA EMERGENCIA VIVA CONTADA TAMBIÉN ES PUERTA (cierre de
 *    evaluaciones, 2026-10-31; hallazgo F-B1 de la evaluación ciega
 *    01, docs/BLIND_EVAL.md). La corrida 01 midió que las emergencias
 *    vivas sin pack caían al modelo: la puerta léxica conoce
 *    diagnósticos («ahogamiento») pero la gente cuenta el suceso
 *    («se está ahogando», «no puede respirar», alguien agarrándose
 *    el pecho, humo saliendo de la cocina). `isEmergencySituation`
 *    es esa otra cara de la puerta: signos tal cual se cuentan,
 *    gerundios y tercera persona incluidos, sin exigir señal de
 *    pregunta — quien lo cuenta no pregunta, pide ayuda. Donde la
 *    puerta de salud manda (sin fuentes, o sin evidencia de salud)
 *    manda también esta cara, y sirve el mismo texto seguro: con la
 *    guía instalada responde la guía por recuperación; sin ella,
 *    ninguna emergencia queda a la improvisación del modelo. La
 *    cura se mide contra un conjunto ciego FRESCO (corrida 02), no
 *    contra el conjunto 01 que la destapó (regla del sello).
 *
 * 4. EL PASADO NO ES UNA SITUACIÓN (arreglo F-B3, 2026-10-31;
 *    hallazgo de la corrida ciega 02). Una pregunta de historia
 *    sobre una enfermedad («Qual foi a febre espanhola de 1918 e
 *    quantas pessoas matou?») trae término de salud y señal de
 *    pregunta, y la puerta disparaba: los vetos solo cubrían el
 *    marco explícito «história de…». `hasHistoricalFrame` reconoce
 *    el marco histórico o cultural (siglos, muertes contadas,
 *    pandemias nombradas, novelas y películas, y el patrón año +
 *    verbo en pasado) y veta las DOS caras de la puerta: quien
 *    pregunta por el pasado no está en una situación de salud ni
 *    en una emergencia. La cura se mide contra un conjunto ciego
 *    FRESCO (corrida 03), no contra el conjunto 02 que la destapó.
 *
 * Puro, sin dependencias de UI, 100% testeable.
 */

import { crisisQuestionKind, emergencyQuestionKind, foldText, type FactLang } from "../rag/packFacts";
import { parsePackChunkId } from "../rag/packSource";
import type { RetrievedChunk } from "../rag/retrieve";
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers";
import { allFrom, type SentenceProvenance } from "../rag/provenance";
import { splitSentences } from "../rag/grounding";

export type GateLang = FactLang;

// ------------------------------------------------- emergencia primero

/**
 * ¿Es este texto una emergencia para las rutas fijas? Los mismos
 * detectores que send() consulta al abrir: la tabla de seguridad
 * (monóxido y números de emergencia), la clase de pregunta de número
 * de emergencia de los packs y la clase de pregunta de crisis. Desde
 * el cierre de F-B1 también la emergencia viva contada
 * (`isEmergencySituation`): su respuesta es la guía por recuperación
 * o el texto seguro fijo, y tampoco debe hacer cola tras una
 * generación en curso.
 */
export function isEmergencyText(text: string, lang: GateLang): boolean {
  if (!text || text.trim().length === 0) return false;
  return (
    matchSafetyAnswer(text, lang) !== null ||
    emergencyQuestionKind(text) !== null ||
    crisisQuestionKind(text) ||
    isEmergencySituation(text)
  );
}

// ------------------------------------------------------- puerta de salud

/**
 * Términos de salud por lengua, ya plegados (minúsculas, sin acentos).
 * `w` = palabra entera; `p` = principio de palabra (familias: sangr-,
 * vomit-, engasg-). Listas revisables a propósito: la puerta es
 * léxica y sus errores se corrigen editando la lista, no el modelo.
 *
 * Al final de cada lista `w` va el campo de MEDICAMENTOS Y DOSIS
 * (cierre de F-B2, evaluación ciega 01: «¿qué dosis de paracetamol…?»
 * no traía ningún término y caía al modelo). Fuera a propósito, por
 * el casado por prefijo de `isHealthQuestion`: «pill»/«tablet» en
 * inglés atraparían «pillar»/«tabletop», «remedio» en portugués
 * atraparía el verbo «remediar» (arreglar una fuga) y «pastilla» en
 * español la «pastilla de jabón» — homógrafos que no son salud.
 */
const HEALTH_TERMS: Record<GateLang, { w: string[]; p: string[] }> = {
  es: {
    w: [
      "fiebre", "tos", "diarrea", "mareo", "mareos", "nauseas", "hemorragia", "fractura", "asma", "diabetes",
      "alergia", "embarazo", "embarazada", "intoxicacion", "envenenamiento", "mordedura", "picadura", "desmayo",
      "convulsion", "convulsiones", "ahogamiento", "insolacion", "hipotermia", "sobredosis", "erupcion",
      "infeccion", "gripe", "resfriado", "covid", "antibiotico", "antibioticos", "vacuna", "vacunas", "torniquete",
      "esguince", "urticaria", "anemia", "apendicitis", "neumonia", "bronquitis", "otitis", "conjuntivitis",
      "gastroenteritis", "deshidratacion", "parto", "rcp", "hipertension", "sarpullido", "electrocucion",
      "dolor de cabeza", "dolor de pecho", "dolor de espalda", "dolor abdominal", "dolor de muelas",
      "primeros auxilios", "golpe de calor", "presion arterial",
      "dosis", "dosificacion", "medicamento", "medicamentos", "medicacion", "medicina", "medicinas",
      "paracetamol", "ibuprofeno", "aspirina", "amoxicilina", "omeprazol", "metamizol", "miligramos",
    ],
    p: ["sangr", "vomit", "quemadur", "herid", "alergic", "diabetic", "atragant", "convuls", "desmay"],
  },
  en: {
    w: [
      "fever", "cough", "diarrhea", "dizziness", "nausea", "hemorrhage", "haemorrhage", "fracture", "asthma",
      "diabetes", "diabetic", "allergy", "pregnant", "pregnancy", "poisoning", "poisoned", "bite", "sting",
      "fainted", "fainting", "seizure", "seizures", "drowning", "heatstroke", "hypothermia", "overdose", "rash",
      "infection", "flu", "covid", "antibiotic", "antibiotics", "vaccine", "vaccines", "tourniquet", "sprain",
      "urticaria", "anemia", "appendicitis", "pneumonia", "bronchitis", "dehydration", "labour", "labor", "cpr",
      "hypertension", "electrocution", "headache", "toothache",
      "chest pain", "back pain", "abdominal pain", "first aid", "heat stroke", "blood pressure",
      "dose", "dosage", "medication", "medications", "medicine", "milligrams",
      "paracetamol", "acetaminophen", "ibuprofen", "aspirin", "amoxicillin",
    ],
    p: ["bleed", "vomit", "burn", "wound", "allerg", "chok", "convuls", "sangr"],
  },
  pt: {
    w: [
      "febre", "tosse", "diarreia", "tontura", "enjoo", "hemorragia", "fratura", "asma", "diabetes",
      "alergia", "gravidez", "gravida", "intoxicacao", "envenenamento", "mordida", "picada", "desmaio",
      "convulsao", "convulsoes", "afogamento", "insolacao", "hipotermia", "overdose", "erupcao", "infeccao",
      "gripe", "resfriado", "covid", "antibiotico", "antibioticos", "vacina", "vacinas", "torniquete",
      "entorse", "urticaria", "anemia", "apendicite", "pneumonia", "bronquite", "desidratacao", "parto",
      "hipertensao", "eletrocucao",
      "dor de cabeca", "dor no peito", "dor nas costas", "dor abdominal", "dor de dente",
      "primeiros socorros", "pressao arterial",
      "dose", "dosagem", "medicamento", "medicamentos",
      "paracetamol", "ibuprofeno", "aspirina", "dipirona", "amoxicilina", "miligramas",
    ],
    p: ["sangr", "vomit", "queimadur", "ferid", "alergic", "diabetic", "engasg", "convuls", "desmai"],
  },
};

/** Contextos que vetan la puerta: historia y metáforas conocidas. */
const HEALTH_EXCLUSIONS = [
  "historia de",
  "historia del",
  "history of",
  "historia do",
  "historia da",
  "fiebre del oro",
  "gold fever",
  "febre do ouro",
];

/**
 * Marcos históricos o culturales, ya plegados (arreglo F-B3, punto 4
 * de la cabecera): la pregunta es SOBRE el pasado de una enfermedad
 * o de la salud — siglos y épocas, muertes contadas, pandemias y
 * plagas nombradas, guerras mundiales, novelas y películas — y no
 * sobre una situación presente. Frases, como todo el léxico de la
 * casa: un marco nuevo se añade aquí, no al modelo. La comparación
 * se hace sobre el texto con espacios a ambos lados, así que un
 * marco al principio de la frase también veta (los vetos antiguos
 * exigían un espacio delante y dejaban pasar «Historia de…» a secas
 * al abrir la pregunta).
 */
const HISTORY_FRAMES = [
  "historia de", "historia del", "historia sobre", "en la historia", "a lo largo de la historia",
  "siglo", "murieron", "fallecieron", "cuantas personas murieron", "cuantos murieron",
  "gripe espanola", "peste negra", "peste bubonica", "en aquella epoca", "antiguamente",
  "en la antiguedad", "primera guerra mundial", "segunda guerra mundial",
  "en una novela", "en la novela", "en una pelicula",
  "history of", "history about", "in history", "throughout history",
  "century", "how many people died", "how many died", "people died",
  "spanish flu", "black death", "bubonic plague", "in those days", "back then",
  "in ancient times", "first world war", "second world war",
  "in a novel", "in the novel", "in a film", "in the film", "in a movie", "in the movie",
  "historia do", "historia da", "na historia", "ao longo da historia",
  "seculo", "morreram", "quantas pessoas morreram", "quantos morreram", "pessoas morreram",
  "gripe espanhola", "peste bubonica", "naquela epoca", "antigamente",
  "na antiguidade", "primeira guerra mundial", "segunda guerra mundial",
  "num romance", "no romance", "num filme", "no filme",
];

/**
 * Verbos en pasado que, junto a un año, cuentan el suceso como
 * pasado («a pandemia de gripe de 1957 afetou…»): el año solo no
 * veta — una situación presente puede nombrar un año («tengo
 * fiebre desde 2023») — pero año + pasado sí es marco histórico.
 */
const HISTORY_PAST_MARKERS = [
  " fue ", " foi ", " was ", " were ", " died", " happened",
  " murieron", " fallecieron", " morreram",
  " afetou", " afecto", " passou", " paso ", " ocorreu", " ocurrio",
  " causou", " causo ", " deixou", " dejo ", " comecou", " comenzo",
  " terminou", " termino ", " acabou", " acabo ",
];

const PAST_YEAR = /\b(1[0-9]{3}|20[0-2][0-9])\b/;

/** ¿Lleva el texto (ya plegado) un marco histórico o cultural? */
function hasHistoricalFrame(folded: string): boolean {
  const hay = ` ${folded} `;
  if (HISTORY_FRAMES.some((x) => hay.includes(` ${x} `))) return true;
  return PAST_YEAR.test(folded) && HISTORY_PAST_MARKERS.some((m) => hay.includes(m));
}

/**
 * Señales de que el texto PREGUNTA o CUENTA una situación (la puerta
 * no se cierra sobre un tema suelto: «fiebre amarilla» a secas sigue
 * su camino; «mi hijo tiene fiebre» o «¿qué es la fiebre?» no).
 */
const SITUATION_CUES = [
  "?", "¿",
  " mi ", " me ", " tengo ", " sufro ", " duele ", " que hago ", " como trat", " como cur", " ayuda ",
  " my ", " i have ", " i feel ", " hurts ", " what should ", " how do i ", " how to treat ",
  " meu ", " minha ", " estou ", " sinto ", " doi ", " o que fazer ", " como trat",
];

const ALL_TERMS: Array<{ w: string[]; p: string[] }> = Object.values(HEALTH_TERMS);

/**
 * ¿Pregunta (o cuenta) el texto algo de salud? Léxico puro: un
 * término de salud en cualquier lengua de la casa (la gente mezcla),
 * una señal de pregunta o situación, y ningún veto de contexto.
 */
export function isHealthQuestion(text: string): boolean {
  if (!text) return false;
  const folded = foldText(text);
  if (folded.trim().length === 0) return false;
  if (HEALTH_EXCLUSIONS.some((x) => folded.includes(` ${x} `) || folded.includes(` ${x}`))) return false;
  if (hasHistoricalFrame(folded)) return false;
  const hasTerm = ALL_TERMS.some(
    ({ w, p }) => w.some((t) => folded.includes(` ${t} `) || folded.includes(` ${t}`)) || p.some((t) => folded.includes(` ${t}`)),
  );
  if (!hasTerm) return false;
  return SITUATION_CUES.some((c) => folded.includes(c) || text.includes(c));
}

// -------------------------------------------- situación de emergencia

/**
 * Signos de una emergencia VIVA, contados tal cual se ven, ya
 * plegados. Frases, no temas: cada entrada describe el suceso en
 * curso (respiración que falta, atragantamiento o ahogamiento en
 * gerundio, inconsciencia, el pecho agarrado, humo o fuego en un
 * lugar, un sangrado que no para). Las formas con contracción
 * inglesa van en su forma plegada («can t breathe» es lo que queda
 * de "can't breathe" tras plegar). Listas revisables, como las de
 * salud: un signo nuevo se añade aquí, no al modelo.
 */
const EMERGENCY_SIGNS: Record<GateLang, string[]> = {
  es: [
    "no puede respirar", "no pueden respirar", "no respira", "no respiran", "sin respirar",
    "dejo de respirar", "paro de respirar",
    "se esta ahogando", "esta ahogandose", "ahogandose", "se ahoga",
    "se esta atragantando", "atragantandose",
    "esta inconsciente", "quedo inconsciente", "no responde",
    "se agarra el pecho", "agarrandose el pecho", "se aprieta el pecho",
    "humo saliendo", "saliendo humo", "sale humo", "hay humo", "hay fuego",
    "salen llamas", "saliendo llamas", "esta ardiendo",
    "sangrando mucho", "no para de sangrar", "esta convulsionando",
  ],
  en: [
    "not breathing", "is not breathing", "stopped breathing", "no longer breathing",
    "can t breathe", "cant breathe", "cannot breathe",
    "is choking", "choking on", "started choking", "is drowning",
    "clutching his chest", "clutching her chest", "clutching my chest", "clutching their chest",
    "is unconscious", "was unconscious", "found unconscious", "not responding", "lost consciousness",
    "smoke coming", "smoke pouring", "full of smoke", "there is a fire", "there s a fire",
    "house on fire", "kitchen on fire", "building on fire", "car on fire", "room on fire",
    "bleeding a lot", "bleeding heavily", "won t stop bleeding",
  ],
  pt: [
    "nao esta respirando", "nao respira", "nao respiram", "parou de respirar", "sem respirar",
    "deixou de respirar",
    "esta engasgando", "engasgando", "engasgou",
    "esta inconsciente", "ficou inconsciente", "nao responde",
    "segurando o peito", "apertando o peito", "mao no peito",
    "fumaca saindo", "saindo fumaca", "tem fogo", "pegando fogo", "em chamas", "saindo chamas",
    "sangrando muito", "nao para de sangrar", "esta convulsionando",
  ],
};

/**
 * Contextos que vetan la cara de emergencia: marcos de ficción o
 * ensayo y metáforas asentadas. La emergencia real no se presenta
 * como «historia sobre…» ni se ahoga «en un vaso de agua».
 */
const EMERGENCY_VETOES = [
  ...HEALTH_EXCLUSIONS,
  "historia sobre", "cuento sobre", "cuento de", "novela sobre", "poema sobre",
  "story about", "essay about", "poem about", "novel about",
  "conto sobre", "poema sobre",
  "en un vaso de agua", "en deudas", "in debt", "em dividas",
];

const ALL_SIGNS: string[] = Object.values(EMERGENCY_SIGNS).flat();

/**
 * ¿Cuenta el texto una emergencia viva en curso? Léxico puro de
 * signos: basta UN signo (el suceso ES la situación; no se exige
 * señal de pregunta) y ningún veto de contexto. Ver la cabecera,
 * punto 3: donde manda la puerta de salud manda también esta cara,
 * con el mismo texto seguro.
 */
export function isEmergencySituation(text: string): boolean {
  if (!text) return false;
  const folded = foldText(text);
  if (folded.trim().length === 0) return false;
  if (EMERGENCY_VETOES.some((x) => folded.includes(` ${x} `) || folded.includes(` ${x}`))) return false;
  if (hasHistoricalFrame(folded)) return false;
  return ALL_SIGNS.some((t) => folded.includes(` ${t} `) || folded.includes(` ${t}`));
}

// ------------------------------------------------------- texto seguro

const HEALTH_SAFE_TEXT: Record<GateLang, string> = {
  es:
    "Esto es una pregunta de salud y en este teléfono no hay ninguna guía verificada de NIDO que la responda, " +
    "así que prefiero no contestar de memoria: un consejo de salud inventado puede hacer daño.\n\n" +
    "Si es una urgencia (dolor en el pecho, dificultad para respirar, un sangrado que no para, pérdida de " +
    "conciencia), llama ahora mismo al número de emergencias o pide a alguien que llame.\n\n" +
    "Las guías oficiales de primeros auxilios de NIDO Esencial se guardan en el teléfono al descargar el pack " +
    "en Biblioteca › Packs: con él, estas preguntas se responden con la guía delante, sin conexión.",
  en:
    "This is a health question and this phone holds no verified NIDO guide that answers it, so I'd rather " +
    "not answer from memory: made-up health advice can do harm.\n\n" +
    "If this is an emergency (chest pain, trouble breathing, bleeding that won't stop, loss of " +
    "consciousness), call your emergency number right now or ask someone to call.\n\n" +
    "The official first-aid guides of NIDO Essentials live on the phone once you download the pack in " +
    "Library › Packs: with it, these questions are answered with the guide in front, no connection needed.",
  pt:
    "Isto é uma pergunta de saúde e neste telefone não há nenhum guia verificado do NIDO que a responda, " +
    "por isso prefiro não responder de memória: um conselho de saúde inventado pode fazer mal.\n\n" +
    "Se for uma urgência (dor no peito, dificuldade para respirar, um sangramento que não para, perda de " +
    "consciência), ligue agora mesmo para o número de emergência ou peça a alguém que ligue.\n\n" +
    "Os guias oficiais de primeiros socorros do NIDO Essencial ficam guardados no telefone ao baixar o " +
    "pacote em Biblioteca › Pacotes: com ele, estas perguntas são respondidas com o guia à frente, sem conexão.",
};

/** El texto seguro fijo al que cae la pregunta de salud sin guía. */
export function healthSafeText(lang: GateLang): string {
  return HEALTH_SAFE_TEXT[lang];
}

/** La procedencia del texto seguro: texto fijo de NIDO, frase a frase. */
export function healthSafeProvenance(text: string): SentenceProvenance[] {
  return allFrom(text, { kind: "fixed" }, splitSentences);
}

// ------------------------------------------------- evidencia de salud

/** Los packs cuyas guías son de salud con fuentes verificadas (ver cabecera). */
const HEALTH_PACK_IDS = new Set(["nido-esencial", "nido-ninos", "nido-crisis"]);

/** ¿Trae la recuperación algún pasaje de un pack de salud? */
export function hasHealthEvidence(chunks: readonly RetrievedChunk[]): boolean {
  return chunks.some((c) => {
    const ref = parsePackChunkId(c.chunkId);
    return !!ref && HEALTH_PACK_IDS.has(ref.packId.replace(/-e5$/, ""));
  });
}
