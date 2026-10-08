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
    expect(classifyIntent("mi color favorito es el azul")).toBe("conversar");
  });
});
