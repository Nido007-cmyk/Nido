/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Ampliación de la capa de narración (tanda de narración,
 * familias F-CAIDA, F-SIGNOS y el residuo de F-NUM): el suceso
 * contado con su marcador de distancia (ayer, ontem, last week,
 * hace dos días, faz dois dias…) no declara la situación ni la
 * salud: ya pasó. La puerta solo vetaba los marcos históricos y,
 * en la cara de caída, un juego corto de marcadores (sin «ontem»
 * ni «outro dia» ni «faz…» portugués). La cura trae el veto de
 * narración por distancia a las dos caras — marcador ∧ verbo del
 * suceso en pasado ∧ ninguna ancla viva — con las exenciones de
 * la doctrina viva: progresivo en curso, inmovilidad en presente,
 * «acaba de», síntoma en presente. En la cara de salud el veto es
 * solo para el enunciado: la pregunta (de dosis, de qué hacer)
 * sigue declarando aunque cuente el pasado. Corpus de la tanda:
 * 2.758 frases; esta batería genera las mismas tablas de las
 * tres familias y las cobra enteras a nivel de ruta, más las
 * guardas vivas y las de salud.
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const rot = <T,>(arr: T[], i: number): T => arr[i % arr.length];
const modelSide = (t: string): boolean => {
  const r = deterministicAnswer({ id: "n", type: "emergencia", lang: "es", expected: "model-side", query: t });
  return r.route === "model" || r.route === "factual-refusal";
};

// ---------------------------------------------------------- F-NUM
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

function fnum(): string[] {
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

// -------------------------------------------------------- F-CAIDA
// Las tablas son las del corpus del acto 0, verbatim: mismos
// sujetos (con la primera persona «yo me caí» / «eu caí»),
// lugares y desenlaces.
const SUBJ_CAIDA_ES: Array<[string, string]> = [
  ["mi abuelo", "se cayó"], ["mi abuela", "se cayó"], ["mi padre", "se cayó"], ["mi madre", "se cayó"],
  ["mi vecino", "se cayó"], ["la vecina", "se cayó"], ["mi hijo", "se cayó"], ["una mujer", "se cayó"],
  ["un hombre", "se cayó"], ["yo", "me caí"],
];
const PLACE_ES = ["de la escalera", "en el baño", "de la bici", "en la calle", "por las escaleras", "en la cocina", "en el patio"];
const OUT_C_ES = ["", "pero ya está bien", "pero fue solo un susto", "y se levantó enseguida", "y no se hizo daño"];
const SUBJ_CAIDA_EN = ["my grandfather", "my grandmother", "my father", "my mother", "my neighbor", "my son", "a woman", "a man", "I"];
const PLACE_EN = ["down the stairs", "in the bathroom", "off his bike", "on the street", "in the kitchen", "in the garden"];
const OUT_C_EN = ["", "but he is fine now", "but it was just a scare", "and got up right away", "and was not hurt"];
const SUBJ_CAIDA_PT: Array<[string, string]> = [
  ["meu avô", "caiu"], ["minha avó", "caiu"], ["meu pai", "caiu"], ["minha mãe", "caiu"],
  ["meu vizinho", "caiu"], ["minha vizinha", "caiu"], ["meu filho", "caiu"], ["uma mulher", "caiu"],
  ["um homem", "caiu"], ["eu", "caí"],
];
const PLACE_PT = ["da escada", "no banheiro", "da bicicleta", "na rua", "na cozinha", "no quintal"];
const OUT_C_PT = ["", "mas já está bem", "mas foi só um susto", "e levantou logo", "e não se machucou"];

function fcaida(): string[] {
  const out: string[] = [];
  MARK_ES.forEach((m, i) => SUBJ_CAIDA_ES.forEach(([s, v], j) => out.push(`${cap(m)} ${s} ${v} ${rot(PLACE_ES, i + j)} ${rot(OUT_C_ES, i + j)}`)));
  MARK_ES.slice(0, 6).forEach((m, i) => SUBJ_CAIDA_ES.forEach(([s, v], j) => out.push(`${cap(s)} ${v} ${rot(PLACE_ES, i + j + 3)} ${m} ${rot(OUT_C_ES, j)}`)));
  MARK_EN.forEach((m, i) => SUBJ_CAIDA_EN.forEach((s, j) => out.push(`${cap(m)} ${s} fell ${rot(PLACE_EN, i + j)} ${rot(OUT_C_EN, i + j)}`)));
  MARK_EN.slice(0, 6).forEach((m, i) => SUBJ_CAIDA_EN.forEach((s, j) => out.push(`${cap(s)} fell ${rot(PLACE_EN, i + j + 3)} ${m} ${rot(OUT_C_EN, j)}`)));
  MARK_PT.forEach((m, i) => SUBJ_CAIDA_PT.forEach(([s, v], j) => out.push(`${cap(m)} ${s} ${v} ${rot(PLACE_PT, i + j)} ${rot(OUT_C_PT, i + j)}`)));
  MARK_PT.slice(0, 6).forEach((m, i) => SUBJ_CAIDA_PT.forEach(([s, v], j) => out.push(`${cap(s)} ${v} ${rot(PLACE_PT, i + j + 3)} ${m} ${rot(OUT_C_PT, j)}`)));
  return [...new Set(out.map((t) => t.trim()))];
}

// ------------------------------------------------------- F-SIGNOS
const SUBJ_SIG_ES = ["mi abuelo", "mi abuela", "mi padre", "mi madre", "mi vecino", "la vecina", "mi hijo", "una mujer", "un hombre", "mi hermano"];
const EV_ES = [
  "se desmayó", "tuvo un ataque al corazón", "le dio un infarto", "sangró mucho por un corte en la pierna",
  "se cortó la mano con un cuchillo", "se quemó la mano con agua hirviendo", "se atragantó con un hueso",
  "tuvo convulsiones", "se golpeó la cabeza contra la puerta", "estuvo sangrando por la nariz un rato",
];
const OUT_SIG_ES = ["", "y fue al hospital", "y ya está mejor", "pero se recuperó enseguida"];
const SUBJ_SIG_EN: Array<[string, string]> = [
  ["my grandfather", "his"], ["my grandmother", "her"], ["my father", "his"], ["my mother", "her"],
  ["my neighbor", "his"], ["my son", "his"], ["my daughter", "her"], ["a woman", "her"], ["a man", "his"], ["my brother", "his"],
];
const EV_EN = [
  "fainted", "had a heart attack", "bled a lot from a cut on the leg", "cut {h} hand with a knife",
  "burned {h} hand with boiling water", "choked on a bone", "had a seizure", "hit {h} head on the door",
  "had a nosebleed for a while",
];
const OUT_SIG_EN = ["", "and went to the hospital", "and is better now", "but recovered quickly"];
const SUBJ_SIG_PT = ["meu avô", "minha avó", "meu pai", "minha mãe", "meu vizinho", "minha vizinha", "meu filho", "uma mulher", "um homem", "meu irmão"];
const EV_PT = [
  "desmaiou", "teve um ataque cardíaco", "sangrou muito por um corte na perna", "cortou a mão com uma faca",
  "se queimou com água fervendo", "se engasgou com um osso", "teve uma convulsão", "bateu a cabeça na porta",
  "sangrou pelo nariz um tempo",
];
const OUT_SIG_PT = ["", "e foi ao hospital", "e já está melhor", "mas se recuperou logo"];

function fsignos(): string[] {
  const out: string[] = [];
  MARK_ES.forEach((m, i) => SUBJ_SIG_ES.forEach((s, j) => out.push(`${cap(m)} ${s} ${rot(EV_ES, i + j)} ${rot(OUT_SIG_ES, i + j)}`)));
  MARK_ES.slice(0, 6).forEach((m, i) => SUBJ_SIG_ES.forEach((s, j) => out.push(`${cap(s)} ${rot(EV_ES, i + j + 4)} ${m} ${rot(OUT_SIG_ES, j)}`)));
  MARK_EN.forEach((m, i) => SUBJ_SIG_EN.forEach(([s, h], j) => out.push(`${cap(m)} ${s} ${rot(EV_EN, i + j).replace("{h}", h)} ${rot(OUT_SIG_EN, i + j)}`)));
  MARK_EN.slice(0, 6).forEach((m, i) => SUBJ_SIG_EN.forEach(([s, h], j) => out.push(`${cap(s)} ${rot(EV_EN, i + j + 4).replace("{h}", h)} ${m} ${rot(OUT_SIG_EN, j)}`)));
  MARK_PT.forEach((m, i) => SUBJ_SIG_PT.forEach((s, j) => out.push(`${cap(m)} ${s} ${rot(EV_PT, i + j)} ${rot(OUT_SIG_PT, i + j)}`)));
  MARK_PT.slice(0, 6).forEach((m, i) => SUBJ_SIG_PT.forEach((s, j) => out.push(`${cap(s)} ${rot(EV_PT, i + j + 4)} ${m} ${rot(OUT_SIG_PT, j)}`)));
  return [...new Set(out.map((t) => t.trim()))];
}

// --------------------------------------------------------- GUARDAS
// Las guardas del corpus del acto 0, verbatim, menos las diez
// reclasificadas en la medición (no declaran en la punta por
// causas ajenas a la narración: la caída en curso sin desenlace
// no es forma de la cara de caída, la quemadura en presente
// en/pt tampoco, y «cuando haya un incendio…» va a la negativa
// factual en la base). Esas diez quedan nombradas en el cierre
// de la tanda, no escondidas. Se añaden las cuatro mixtas
// marcador + ancla viva, verificadas declarando en la punta.
const GUARDAS: string[] = [
  "se está desmayando ahora", "está sangrando mucho", "está teniendo un ataque al corazón",
  "suena la alarma de monóxido y me duele la cabeza", "hay un hombre desmayado en la calle",
  "llama al número de emergencias", "¿cuál es el número de emergencias?", "¿a qué número llamo si hay un incendio?",
  "número de emergencias", "mi abuelo se cayó y no se puede mover", "mi abuela se cayó en el baño y no se levanta",
  "hay una mujer inconsciente en la calle", "se está atragantando y no puede respirar", "estoy sangrando y no para",
  "quiero llamar al número de emergencias", "llamo al número de emergencias ahora mismo", "necesito el número de emergencias",
  "una persona se desmayó en la calle y no respira", "está convulsionando ahora", "le está dando un ataque en plena calle",
  "la sangre le sale a borbotones de la pierna", "si se cae mi abuelo llamo al número de emergencias",
  "¿qué número marco si hay un incendio?", "quiero saber el número de emergencias",
  "mi vecino se está quemando con agua hirviendo ahora", "se cortó la mano y está sangrando mucho ahora",
  "el detector de monóxido está sonando y me duele la cabeza", "hay olor a gas muy fuerte en la cocina ahora",
  "ayer se cayó y ahora no se puede mover", "ayer se desmayó y todavía está mareado",
  "he is fainting right now", "she is bleeding a lot", "he is having a heart attack",
  "the carbon monoxide alarm is going off and my head hurts", "call the emergency number", "what is the emergency number?",
  "my grandfather fell and cannot move", "there is a woman unconscious on the street", "he is choking and cannot breathe",
  "my father is clutching his chest", "I am bleeding and it won't stop", "I want to call the emergency number",
  "I am calling the emergency number right now", "he just fell and can't get up",
  "a person fainted on the street and is not breathing", "she is having a seizure now", "blood is spurting out of his leg",
  "if there is a fire I call the fire department", "when my grandfather falls I call the emergency number",
  "what number do I dial if there is a fire?", "I need the emergency number",
  "she cut her hand and is bleeding a lot now", "the monoxide detector is sounding and my head hurts",
  "yesterday he fell and now he cannot move",
  "ele está desmaiando agora", "ela está sangrando muito", "ele está tendo um ataque cardíaco",
  "o alarme de monóxido está tocando e minha cabeça dói", "liga para o número de emergência", "qual é o número de emergência?",
  "meu avô caiu e não consegue se mover", "tem uma mulher inconsciente na rua", "ele está se engasgando e não consegue respirar",
  "meu pai está segurando o peito", "estou sangrando e não para", "quero ligar para o número de emergência",
  "estou ligando para o número de emergência agora", "uma pessoa desmaiou na rua e não está respirando",
  "ela está tendo uma convulsão agora", "o sangue está espirrando da perna dele",
  "se tiver um incêndio eu ligo para os bombeiros", "qual número eu disco se tiver um incêndio?",
  "preciso do número de emergência", "ela cortou a mão e está sangrando muito agora",
  "o detector de monóxido está tocando e minha cabeça dói", "ontem ele caiu e agora não levanta",
];

const GUARDAS_SALUD: string[] = [
  "¿cuánto paracetamol le puedo dar a mi hijo?",
  "¿qué hago si mi abuelo se desmaya otra vez?",
  "ayer se desmayó, ¿qué debo hacer si pasa de nuevo?",
  "¿puedo tomar ibuprofeno con la presión alta?",
  "mi hijo tiene fiebre de 39, ¿qué hago?",
  "how much paracetamol can I give my child?",
  "what should I do if my grandfather faints again?",
  "he fainted yesterday, what should I do if it happens again?",
  "quanto paracetamol posso dar ao meu filho?",
  "o que devo fazer se meu avô desmaiar de novo?",
  "ontem ele desmaiou, o que faço se acontecer de novo?",
];

describe("puerta · el suceso contado con distancia no declara (F-CAIDA, F-SIGNOS, F-NUM)", () => {
  it("las caídas contadas van al modelo", () => {
    const fuera = fcaida().filter((t) => !modelSide(t));
    expect(fuera).toEqual([]);
  });
  it("los signos contados van al modelo", () => {
    const fuera = fsignos().filter((t) => !modelSide(t));
    expect(fuera).toEqual([]);
  });
  it("la llamada contada va al modelo también por la cara de salud", () => {
    const fuera = fnum().filter((t) => !modelSide(t));
    expect(fuera).toEqual([]);
  });
});

describe("puerta · la guarda manda", () => {
  it("todo suceso vivo sigue declarando su ruta fija", () => {
    const fuera = GUARDAS.filter((t) => modelSide(t));
    expect(fuera).toEqual([]);
  });
  it("la pregunta de salud sigue declarando aunque cuente el pasado", () => {
    const fuera = GUARDAS_SALUD.filter((t) => modelSide(t));
    expect(fuera).toEqual([]);
  });
});
