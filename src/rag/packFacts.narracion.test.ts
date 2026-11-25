/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Ampliación de la capa de narración (tanda de narración, familia
 * F-NUM): la llamada contada en pasado no pregunta por el número
 * en ninguna de las dos caras (la de los packs y la tabla fija).
 * La capa original (causas C y D de DIAG-A) solo reconocía el
 * pretérito plegado a presente («llamó» → «llamo») más un enlace
 * de relato: «ayer llamé al número de emergencias» no casaba
 * ninguna señal («llamé» se pliega a «llame» y «ayer» no era
 * enlace) y recibía la tabla. La ampliación trae las formas
 * plegadas enteras del pretérito de los verbos de llamada en las
 * tres lenguas y los marcadores de tiempo como clase de enlace;
 * la estructura (pasado ∧ enlace) y el mando de la forma
 * interrogativa no cambian. Corpus de la tanda: 1.478 frases
 * F-NUM generadas por marcador × persona × verbo × objeto; esta
 * batería genera las mismas tablas y las cobra enteras.
 */
import { describe, it, expect } from "vitest";
import { emergencyQuestionKind, isNarratedEventText } from "./packFacts";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const rot = <T,>(arr: T[], i: number): T => arr[i % arr.length];

const MARK_ES = ["ayer", "anoche", "anteayer", "esta mañana", "la semana pasada", "el mes pasado", "el año pasado", "hace un rato", "hace dos días", "hace una semana", "el otro día", "el lunes pasado"];
const SUBJ_ES: Array<[string, string, string]> = [
  ["yo", "llamé", "marqué"], ["mi abuelo", "llamó", "marcó"], ["mi abuela", "llamó", "marcó"],
  ["mi padre", "llamó", "marcó"], ["mi madre", "llamó", "marcó"], ["mi vecino", "llamó", "marcó"],
  ["la vecina", "llamó", "marcó"], ["un testigo", "llamó", "marcó"], ["el bombero", "llamó", "marcó"],
  ["mi hijo", "llamó", "marcó"], ["una mujer", "llamó", "marcó"], ["mi hermano", "llamó", "marcó"],
  ["los vecinos", "llamaron", "marcaron"], ["mi hermana", "llamó", "marcó"],
];
const OBJ_ES = ["al número de emergencias", "a la policía", "a los bomberos", "una ambulancia", "al 911", "al número de la policía", "al número de emergencias"];

const MARK_EN = ["yesterday", "last night", "the day before yesterday", "this morning", "last week", "last month", "last year", "two days ago", "a while ago", "the other day", "on monday"];
const SUBJ_EN = ["I", "my grandfather", "my grandmother", "my father", "my mother", "my neighbor", "my neighbour", "a witness", "the firefighter", "my son", "a woman", "my brother", "the neighbors", "my sister"];
const OBJ_EN = ["the emergency number", "the police", "the fire department", "an ambulance", "911", "the emergency services"];

const MARK_PT = ["ontem", "ontem à noite", "anteontem", "esta manhã", "na semana passada", "no mês passado", "no ano passado", "faz dois dias", "há dois dias", "no outro dia", "na segunda passada"];
const SUBJ_PT: Array<[string, string, string]> = [
  ["eu", "liguei", "disquei"], ["meu avô", "ligou", "discou"], ["minha avó", "ligou", "discou"],
  ["meu pai", "ligou", "discou"], ["minha mãe", "ligou", "discou"], ["meu vizinho", "ligou", "discou"],
  ["minha vizinha", "ligou", "discou"], ["uma testemunha", "ligou", "discou"], ["o bombeiro", "ligou", "discou"],
  ["meu filho", "ligou", "discou"], ["uma mulher", "ligou", "discou"], ["meu irmão", "ligou", "discou"],
  ["os vizinhos", "ligaram", "discaram"], ["minha irmã", "ligou", "discou"],
];
const OBJ_PT = ["para o número de emergência", "para a polícia", "para os bombeiros", "para uma ambulância", "o 190", "para o número da polícia", "para os serviços de emergência"];

function narradas(): string[] {
  const out: string[] = [];
  MARK_ES.forEach((m, i) => SUBJ_ES.forEach(([s, vl], j) => out.push(`${cap(m)} ${s} ${vl} ${rot(OBJ_ES, i + j)}`)));
  MARK_ES.slice(0, 8).forEach((m, i) => SUBJ_ES.forEach(([s, vl], j) => out.push(`${cap(s)} ${vl} ${rot(OBJ_ES, i + j + 2)} ${m}`)));
  MARK_ES.slice(0, 8).forEach((m, i) => SUBJ_ES.forEach(([s, , vm], j) => out.push(`${cap(m)} ${s} ${vm} ${rot(OBJ_ES, i + j + 4)}`)));
  MARK_ES.slice(0, 6).forEach((m, i) => SUBJ_ES.forEach(([s, vl], j) => out.push(`${cap(m)} ${s} ${vl} ${rot(OBJ_ES, i + j + 1)} y contó lo que había pasado`)));
  SUBJ_ES.forEach(([s, vl], j) => out.push(`${cap(s)} ${vl} ${rot(OBJ_ES, j + 3)} cuando vio el humo`));
  SUBJ_ES.forEach(([s, vl], j) => out.push(`${cap(s)} ${vl} ${rot(OBJ_ES, j + 5)} después del accidente`));
  MARK_EN.forEach((m, i) => SUBJ_EN.forEach((s, j) => out.push(`${cap(m)} ${s} called ${rot(OBJ_EN, i + j)}`)));
  MARK_EN.slice(0, 8).forEach((m, i) => SUBJ_EN.forEach((s, j) => out.push(`${cap(s)} called ${rot(OBJ_EN, i + j + 2)} ${m}`)));
  MARK_EN.slice(0, 8).forEach((m, i) => SUBJ_EN.forEach((s, j) => out.push(`${cap(m)} ${s} dialed ${rot(OBJ_EN, i + j + 4)}`)));
  MARK_EN.slice(0, 6).forEach((m, i) => SUBJ_EN.forEach((s, j) => out.push(`${cap(m)} ${s} called ${rot(OBJ_EN, i + j + 1)} and told them what had happened`)));
  SUBJ_EN.forEach((s, j) => out.push(`${cap(s)} called ${rot(OBJ_EN, j + 3)} after the accident`));
  MARK_PT.forEach((m, i) => SUBJ_PT.forEach(([s, vl], j) => out.push(`${cap(m)} ${s} ${vl} ${rot(OBJ_PT, i + j)}`)));
  MARK_PT.slice(0, 8).forEach((m, i) => SUBJ_PT.forEach(([s, vl], j) => out.push(`${cap(s)} ${vl} ${rot(OBJ_PT, i + j + 2)} ${m}`)));
  MARK_PT.slice(0, 8).forEach((m, i) => SUBJ_PT.forEach(([s, , vm], j) => out.push(`${cap(m)} ${s} ${vm} ${rot(OBJ_PT, i + j + 4)}`)));
  MARK_PT.slice(0, 6).forEach((m, i) => SUBJ_PT.forEach(([s, vl], j) => out.push(`${cap(m)} ${s} ${vl} ${rot(OBJ_PT, i + j + 1)} e contou o que tinha acontecido`)));
  SUBJ_PT.forEach(([s, vl], j) => out.push(`${cap(s)} ${vl} ${rot(OBJ_PT, j + 3)} depois do acidente`));
  return [...new Set(out)];
}

describe("capa de narración ampliada · la llamada contada no pregunta (F-NUM)", () => {
  it("la frase medida de la alineación: «ayer llamé al número de emergencias»", () => {
    expect(isNarratedEventText("ayer llamé al número de emergencias")).toBe(true);
    expect(emergencyQuestionKind("ayer llamé al número de emergencias")).toBeNull();
  });

  it("las tablas generadas enteras: la capa las reconoce y la cara del número no pregunta", () => {
    const frases = narradas();
    const fuera: string[] = [];
    for (const t of frases) {
      if (!isNarratedEventText(t) || emergencyQuestionKind(t) !== null) fuera.push(t);
    }
    expect(fuera).toEqual([]);
  });
});

describe("capa de narración ampliada · guardas del número", () => {
  const PREGUNTAS: Array<[string, string]> = [
    ["¿Cuál es el número de emergencias?", "general"],
    ["¿A qué número llamo si hay un incendio?", "fire"],
    ["¿Qué número marco para una ambulancia?", "ambulance"],
    ["Número de bomberos", "fire"],
    ["llamo al número de emergencias ahora mismo", "general"],
    ["quiero llamar al número de emergencias", "general"],
    ["mañana llamo al número de emergencias", "general"],
    ["ayer no pude llamar, necesito el número de emergencias", "general"],
    ["si se cae mi abuelo llamo al número de emergencias", "general"],
    ["what is the emergency number?", "general"],
    ["I am calling the emergency number right now", "general"],
    ["qual é o número de emergência?", "general"],
    ["quero ligar para o número de emergência", "general"],
  ];
  for (const [q, kind] of PREGUNTAS) {
    it(`sigue preguntando: ${q}`, () => {
      expect(isNarratedEventText(q)).toBe(false);
      expect(emergencyQuestionKind(q)).toBe(kind);
    });
  }
});
