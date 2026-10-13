/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { classifyIntent } from "./intent";

describe("classifyIntent", () => {
  it("detecta memoria explícita", () => {
    expect(classifyIntent("recuerda que mi cumpleaños es en mayo")).toBe("recordar");
    expect(classifyIntent("acuérdate de que mi hermana se llama Ana")).toBe("recordar");
    expect(classifyIntent("no olvides que prefiero el té")).toBe("recordar");
    expect(classifyIntent("guarda esto en tu memoria: trabajo de noche")).toBe("recordar");
    expect(classifyIntent("a partir de ahora háblame de tú")).toBe("recordar");
  });

  it("distingue recordatorio (acción) de memoria", () => {
    // Infinitivo después de "recuerda/no olvides/acuérdate de" = acción
    expect(classifyIntent("recuerda comprar pan")).toBe("actuar");
    expect(classifyIntent("recuérdame comprar pan")).toBe("actuar");
    expect(classifyIntent("no olvides llamar al banco")).toBe("actuar");
    expect(classifyIntent("acuérdate de pagar la luz")).toBe("actuar");
    // C5-2026-10-06: "recuérdame que + cláusula" es MEMORIA, no acción
    expect(classifyIntent("recuérdame que tengo dentista mañana")).toBe("recordar");
    expect(classifyIntent("recuérdame que el cumpleaños de mi mamá es el 15 de marzo")).toBe("recordar");
    // Enclíticos: "guárdalo en tu memoria"
    expect(classifyIntent("guárdalo en tu memoria para que me avises")).toBe("recordar");
  });

  it("detecta acciones locales", () => {
    expect(classifyIntent("crea un recordatorio para mañana")).toBe("actuar");
    expect(classifyIntent("guarda una nota: ideas de regalo")).toBe("actuar");
    expect(classifyIntent("qué hora es")).toBe("actuar");
    expect(classifyIntent("abre la app de calendario")).toBe("actuar");
    expect(classifyIntent("lista mis notas")).toBe("actuar");
  });

  it("detecta acciones de Fase D (análisis de datos)", () => {
    expect(classifyIntent("analiza estos datos de ventas")).toBe("actuar");
    expect(classifyIntent("¿cuánto suman las ventas de enero?")).toBe("actuar");
    expect(classifyIntent("dame estadísticas de este csv")).toBe("actuar");
  });

  it("detecta acciones de Fase B (cálculo, calendario, contactos, llamadas, archivos)", () => {
    expect(classifyIntent("calcula 15% de 200 más 30")).toBe("actuar");
    expect(classifyIntent("¿cuánto es 2^10?")).toBe("actuar");
    expect(classifyIntent("convierte 5 millas a kilómetros")).toBe("actuar");
    expect(classifyIntent("agenda una cita mañana a las 10")).toBe("actuar");
    expect(classifyIntent("¿qué tengo el lunes?")).toBe("actuar");
    expect(classifyIntent("llama a mamá")).toBe("actuar");
    expect(classifyIntent("envíale un mensaje a Juan")).toBe("actuar");
    expect(classifyIntent("busca el contacto de Ana")).toBe("actuar");
    expect(classifyIntent("¿cuál es el teléfono de Pedro?")).toBe("actuar");
    expect(classifyIntent("lee este archivo y resúmelo")).toBe("actuar");
  });

  it("no confunde charla con acción en Fase B", () => {
    expect(classifyIntent("¿cómo se llama tu creador?")).toBe("conversar");
    expect(classifyIntent("háblame de la historia de México")).toBe("conversar");
    // «agenda» como sustantivo también va al agente: el agente responde
    // directo cuando ninguna herramienta encaja, así que es inofensivo.
    expect(classifyIntent("explícame cómo funciona una agenda")).toBe("actuar");
  });

  it("conversa por defecto", () => {
    expect(classifyIntent("hola, ¿cómo estás?")).toBe("conversar");
    expect(classifyIntent("explícame la fotosíntesis")).toBe("conversar");
    expect(classifyIntent("")).toBe("conversar");
    // 0.1.22: «mi color favorito es el azul» es un hecho implícito
    // (M2, 0.1.20) que el loop guarda; la puerta ahora lo deja pasar.
    // La expectativa anterior («conversar») fosilizaba el hueco de la
    // puerta: el extractor existía pero el chat nunca lo alcanzaba.
    expect(classifyIntent("mi color favorito es el azul")).toBe("recordar");
  });
});

// TOOLS-AUDIT 2026-10-11: evidencia física y cobertura es/en/pt.
describe("classifyIntent — contactos, llamadas, SMS, archivos (es/en/pt)", () => {
  it.each([
    "Find my cellphone contacts",
    "Busca el contacto Ruben",
    "Call",
    "call Ruben",
    "llama a Ana",
    "liga para a Ana",
    "procura o contato Ruben",
    "text Ana that I'm late",
    "what's Ana's number?",
    "read a file",
    "analisa o arquivo",
    "use the skill analiza-datos",
    "what do I have tomorrow",
    "minha agenda",
    "¿qué tengo el lunes?",
    "qué tengo mañana",
  ])("%p → actuar", (text) => {
    expect(classifyIntent(text)).toBe("actuar");
  });

  it.each([
    // Antes /qué tengo/ a secas mandaba esto a las herramientas.
    "¿qué tengo que hacer para aprender inglés?",
    "qué tengo que estudiar para el examen",
    "¿cómo se llama la capital de Francia?",
  ])("%p → conversar", (text) => {
    expect(classifyIntent(text)).toBe("conversar");
  });
});

describe("0.1.22 — la puerta consulta los detectores del loop (evidencia física Tab A9+)", () => {
  // v0.1.21 en dispositivo: «Mi mama se llama Marta» (chat nuevo) caía al
  // conocimiento y citaba «Lista (Madrid Metro)». Causa raíz: ChatScreen
  // solo entra al loop si classifyIntent dice recordar/actuar, y el
  // clasificador no consultaba los extractores de personas, nombre
  // propio, hechos, consultas de memoria ni temporizador — solo calc,
  // contactos y herramientas. Las frases de abajo son las físicas.
  it.each([
    // Personas (ES/EN/PT), con y sin acento.
    "Mi mama se llama Marta",
    "Mi mamá se llama Marta",
    "Mis hijos se llaman Leo y Max",
    "My mom's name is Marta",
    "Minha mãe se chama Marta",
    // Nombre propio.
    "Yo me llamo Ruben",
    "Mi nombre es Ruben",
    "My name is Ruben",
    "Meu nome é Ruben",
    "Eu me chamo Ruben",
    // Hechos implícitos (fail-closed, anclados).
    "Mi cumpleaños es el 5 de mayo",
    "My birthday is May 5",
    "Meu aniversário é 5 de maio",
    "Vivo en Tucson",
    "I live in Tucson",
    "Moro em Tucson",
    "Mi perro se llama Rocky",
    "Mi coche es un Toyota",
    "My car is a Toyota",
    // Gatillo que solo vivía en el extractor («guarda que…», M3).
    "guarda que mañana tengo dentista",
    // Consultas de memoria: se responden desde lo guardado.
    "¿Cómo se llama mi mamá?",
    "What's my mom's name?",
    "Como se chama minha mãe?",
    "¿Cómo me llamo?",
    "What's my name?",
    "Qual é o meu nome?",
    "¿Cuándo es el cumpleaños de mi mamá?",
    "¿Cuándo es mi cumpleaños?",
    "When is my birthday?",
    "Quando é o meu aniversário?",
    "¿Qué sabes de mí?",
    "What do you know about me?",
    "O que você sabe sobre mim?",
  ])("%p → recordar", (text) => {
    expect(classifyIntent(text)).toBe("recordar");
  });

  it.each([
    // Temporizador: el extractor lo resolvía dentro del loop, pero la
    // puerta nunca lo consultaba («conversar» en la sonda 0.1.21).
    "Pon un temporizador de 2 minutos",
    "Temporizador de 2 minutos",
    "Set a timer for 2 minutes",
    "Timer for 5 minutes",
    "Põe um temporizador de 2 minutos",
    // El extractor de recordatorios la reclama antes que la consulta de
    // memoria (mismo orden que el pre-router del loop); entra igual.
    "recuérdame la fecha de mi aniversario",
  ])("%p → actuar", (text) => {
    expect(classifyIntent(text)).toBe("actuar");
  });

  it.each([
    // Sin ancla personal no hay memoria: el conocimiento sigue su ruta.
    "La capital de Francia es París",
    "¿Quién escribió Don Quijote?",
    "¿Cómo se llama la capital de España?",
    "¿Quién es Marta?",
    "Cuéntame un cuento",
    "El cielo es azul",
    // Narrativa con palabras de tiempo: no es recordatorio.
    "Mañana voy al mercado",
    "En una hora salgo de casa",
    "El tren sale en una hora",
    // Preguntas genéricas en primera persona (rama 5 de
    // answerMemoryQuery): ambiguas con preguntas sobre documentos
    // («¿qué dice mi documento sobre…?», guía) — se quedan en el chat
    // a propósito; la puerta solo abre a las formas inequívocas.
    "¿Cuál es mi color favorito?",
    "¿Dónde vivo?",
    "What car do I have?",
  ])("%p → conversar", (text) => {
    expect(classifyIntent(text)).toBe("conversar");
  });

  it("la condición de entrada de ChatScreen deja pasar las frases físicas", () => {
    // ChatScreen: agentIntent === "recordar" || agentIntent === "actuar".
    for (const text of [
      "Mi mama se llama Marta",
      "Mi mamá se llama Marta",
      "Yo me llamo Ruben",
      "¿Cómo se llama mi mamá?",
      "Mi cumpleaños es el 5 de mayo",
      "Pon un temporizador de 2 minutos",
    ]) {
      expect(["recordar", "actuar"]).toContain(classifyIntent(text));
    }
  });
});

describe("0.1.14 — intenciones en portugués y cuentas", () => {
  it("cuentas válidas siempre a la calculadora", () => {
    expect(classifyIntent("what is (100 + 50) * 2")).toBe("actuar");
    expect(classifyIntent("quanto é 245 * 38")).toBe("actuar");
    expect(classifyIntent("what is love")).toBe("conversar");
  });
  it("me lembra de → acción; lembre que / me lembra que → memoria", () => {
    expect(classifyIntent("me lembra de comprar leite em 2 horas")).toBe("actuar");
    expect(classifyIntent("lembre que minha cor favorita é azul")).toBe("recordar");
    expect(classifyIntent("me lembra que o aniversário da Ana é em maio")).toBe("recordar");
    expect(classifyIntent("não esqueça que tenho dentista na sexta")).toBe("recordar");
  });
});
