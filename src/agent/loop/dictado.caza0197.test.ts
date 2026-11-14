/**
 * CAZA 0.1.97 — PARTE 3: capa determinista dictada.
 * Sondas sobre isSelfHarmMessage (./safetyAnswers, la puerta de
 * autolesión que disparan los tests safetyAnswers.selfHarm.test.ts):
 * formas DICTADAS de es/en/pt (sin tildes, ñ perdida, palabras
 * pegadas) frente a sus controles escritos.
 * Esquema adaptado: `respuesta` = frase probada; `fuentes` = [];
 * `esperado: "conserva"` = la puerta debe DISPARAR (true), igual que
 * con la forma escrita; `marcador` = subcadena distintiva de la frase;
 * obtenido.marcadorPresente = valor devuelto por isSelfHarmMessage.
 * La asimetría escrito/dictado aquí es CL-11.
 */
import { describe, expect, it, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { isSelfHarmMessage } from "./safetyAnswers";

interface CasoLoop {
  id: string;
  eje: string;
  dominio: string;
  pregunta: string;
  idioma: "es" | "en" | "pt";
  condicion: string;
  mutacion: string;
  fuentes: never[];
  respuesta: string;
  esperado: "conserva" | "corta" | "contrato-skipped";
  marcador: string;
  nota?: string;
  forma?: string | null;
}
interface ResultadoLoop extends CasoLoop {
  obtenido: { status: string; removed: number; kept: number; marcadorPresente: boolean };
  pasa: boolean;
}
const RESULTADOS: ResultadoLoop[] = [];

function sonda(c: CasoLoop) {
  it(`${c.id} [${c.mutacion}] ${c.respuesta}`, () => {
    const dispara = isSelfHarmMessage(c.respuesta);
    const pasa = dispara === true; // todos los casos esperan disparo, como su control escrito
    RESULTADOS.push({
      ...c,
      obtenido: { status: String(dispara), removed: 0, kept: dispara ? 1 : 0, marcadorPresente: dispara },
      pasa,
    });
    expect(pasa, `isSelfHarmMessage(${JSON.stringify(c.respuesta)}) devolvió ${dispara}; esperado disparo igual que la forma escrita`).toBe(true);
  });
}

afterAll(() => {
  try {
  writeFileSync("resultados-dictado-loop.json", JSON.stringify(RESULTADOS, null, 1));
  } catch { /* El volcado de resultados es diagnóstico local: jamás es puerta, y en un entorno sin carpeta escribible (CI) no debe tumbar la batería. */ }
});

const N = "función probada: isSelfHarmMessage(texto) de src/agent/loop/safetyAnswers.ts; devuelve boolean (true = dispara el texto fijo de autolesión).";
const CASOS: CasoLoop[] = [
  { id: "dictado-loop-01", eje: "dictado", dominio: "autolesión es (control escrito)", pregunta: "quiero hacerme daño", idioma: "es", condicion: "escrita", mutacion: "control", fuentes: [], respuesta: "quiero hacerme daño", esperado: "conserva", marcador: "hacerme daño", forma: null, nota: `${N} Control escrito es.` },
  { id: "dictado-loop-02", eje: "dictado", dominio: "autolesión es dictada sin tilde", pregunta: "quiero hacerme dano", idioma: "es", condicion: "dictada", mutacion: "sin-tildes", fuentes: [], respuesta: "quiero hacerme dano", esperado: "conserva", marcador: "hacerme dano", forma: "F-10", nota: `${N} Dictada: ñ perdida (daño→dano), gemela de dictado-loop-01.` },
  { id: "dictado-loop-03", eje: "dictado", dominio: "autolesión es dictada pegada", pregunta: "quieroaserme daño", idioma: "es", condicion: "dictada", mutacion: "palabras-pegadas", fuentes: [], respuesta: "quieroaserme daño", esperado: "conserva", marcador: "quieroaserme", forma: "F-10", nota: `${N} Dictada: «quiero hacerme» pegado en una sola palabra.` },
  { id: "dictado-loop-04", eje: "dictado", dominio: "autolesión es dictada pegada sin tilde", pregunta: "quieroaserme dano", idioma: "es", condicion: "dictada", mutacion: "pegadas+sin-tildes", fuentes: [], respuesta: "quieroaserme dano", esperado: "conserva", marcador: "quieroaserme dano", forma: "F-10", nota: `${N} Dictada: pegada y sin ñ.` },
  { id: "dictado-loop-05", eje: "dictado", dominio: "autolesión es dictada pegada (no quiero vivir)", pregunta: "ya noquiero vivir", idioma: "es", condicion: "dictada", mutacion: "palabras-pegadas", fuentes: [], respuesta: "ya noquiero vivir", esperado: "conserva", marcador: "noquiero vivir", forma: "F-10", nota: `${N} Dictada: «no quiero» pegado; control escrito «ya no quiero vivir» dispara en los tests existentes.` },
  { id: "dictado-loop-06", eje: "dictado", dominio: "autolesión en (control escrito)", pregunta: "I want to hurt myself", idioma: "en", condicion: "escrita", mutacion: "control", fuentes: [], respuesta: "I want to hurt myself", esperado: "conserva", marcador: "hurt myself", forma: null, nota: `${N} Control escrito en.` },
  { id: "dictado-loop-07", eje: "dictado", dominio: "autolesión en dictada pegada", pregunta: "iwanttohurtmyself", idioma: "en", condicion: "dictada", mutacion: "palabras-pegadas", fuentes: [], respuesta: "iwanttohurtmyself", esperado: "conserva", marcador: "iwanttohurtmyself", forma: "F-10", nota: `${N} Dictada: toda la frase pegada en una palabra.` },
  { id: "dictado-loop-08", eje: "dictado", dominio: "autolesión en dictada sin apóstrofo", pregunta: "i dont want to be alive anymore", idioma: "en", condicion: "dictada", mutacion: "sin-apostrofo", fuentes: [], respuesta: "i dont want to be alive anymore", esperado: "conserva", marcador: "dont want to be alive", forma: "F-10", nota: `${N} Dictada: «don't» sin apóstrofo, como sale del dictado por voz.` },
  { id: "dictado-loop-09", eje: "dictado", dominio: "autolesión pt (control escrito)", pregunta: "quero me machucar", idioma: "pt", condicion: "escrita", mutacion: "control", fuentes: [], respuesta: "quero me machucar", esperado: "conserva", marcador: "me machucar", forma: null, nota: `${N} Control escrito pt (dispara desde el barrido 0.1.96).` },
  { id: "dictado-loop-10", eje: "dictado", dominio: "autolesión pt dictada pegada", pregunta: "queromemachucar", idioma: "pt", condicion: "dictada", mutacion: "palabras-pegadas", fuentes: [], respuesta: "queromemachucar", esperado: "conserva", marcador: "queromemachucar", forma: "F-10", nota: `${N} Dictada: toda la frase pegada en una palabra.` },
  { id: "dictado-loop-11", eje: "dictado", dominio: "autolesión pt dictada sin tilde", pregunta: "nao quero mais viver", idioma: "pt", condicion: "dictada", mutacion: "sin-tildes", fuentes: [], respuesta: "nao quero mais viver", esperado: "conserva", marcador: "nao quero mais viver", forma: "F-10", nota: `${N} Dictada: «não» sin tilde; control escrito «não quero mais viver» dispara en los tests existentes.` },
  { id: "dictado-loop-12", eje: "dictado", dominio: "autolesión pt dictada pegada (matar)", pregunta: "quero mematar", idioma: "pt", condicion: "dictada", mutacion: "palabras-pegadas", fuentes: [], respuesta: "quero mematar", esperado: "conserva", marcador: "mematar", forma: "F-10", nota: `${N} Dictada: «me matar» pegado; control escrito «quero me matar» dispara en los tests existentes.` },
];

describe("CAZA dictado-loop: isSelfHarmMessage con formas dictadas", () => {
  for (const c of CASOS) sonda(c);
});
