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
 * de emergencia de los packs y la clase de pregunta de crisis.
 */
export function isEmergencyText(text: string, lang: GateLang): boolean {
  if (!text || text.trim().length === 0) return false;
  return matchSafetyAnswer(text, lang) !== null || emergencyQuestionKind(text) !== null || crisisQuestionKind(text);
}

// ------------------------------------------------------- puerta de salud

/**
 * Términos de salud por lengua, ya plegados (minúsculas, sin acentos).
 * `w` = palabra entera; `p` = principio de palabra (familias: sangr-,
 * vomit-, engasg-). Listas revisables a propósito: la puerta es
 * léxica y sus errores se corrigen editando la lista, no el modelo.
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
  const hasTerm = ALL_TERMS.some(
    ({ w, p }) => w.some((t) => folded.includes(` ${t} `) || folded.includes(` ${t}`)) || p.some((t) => folded.includes(` ${t}`)),
  );
  if (!hasTerm) return false;
  return SITUATION_CUES.some((c) => folded.includes(c) || text.includes(c));
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
