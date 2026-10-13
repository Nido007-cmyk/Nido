/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.33: puerta de regresión del COSTE del pre-router.
 *
 * El router determinista corre antes del modelo en cada mensaje (varias
 * veces por turno: ChatScreen clasifica, y el loop vuelve a clasificar y a
 * extraer). Hoy cuesta microsegundos, frente a cientos de ms del modelo;
 * el peligro real no es la suma de patrones sino UNA regex con coste
 * cuadrático o peor ante una entrada larga (se encontró una: una tira de
 * miles de dígitos en la calculadora). El chat admite hasta 4.000
 * caracteres; aquí se prueban entradas hostiles de ese tamaño con un
 * presupuesto holgado (un caso lineal tarda ~1 ms; el cuadrático tardaba
 * >100 ms en un PC).
 */
import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent";
import { extractToolAction } from "./toolRouter";
import { extractCalcAction, extractReminderAction, extractTimerAction } from "./actionRouter";
import { extractContactAction } from "./contactRouter";

const N = 4000; // maxLength del campo de chat
const HOSTILE: Array<[string, string]> = [
  ["letras", "a".repeat(N)],
  ["espacios", "recuérdame " + " ".repeat(N - 12) + "x"],
  ["dígitos", "cuánto es " + "1".repeat(N - 11) + "+"],
  ["dígitos sin gatillo", "1".repeat(N - 1) + "+"],
  ["paréntesis", "cuánto es " + "(".repeat(N - 11) + "1"],
  ["destinatario", "manda un mensaje a " + "Ana ".repeat((N - 30) / 4) + "que hola"],
  ["fechas", "recuérdame " + "mañana a las 9 ".repeat(Math.floor((N - 11) / 15))],
  ["moneda", "convierte " + "100 dólares ".repeat(Math.floor((N - 20) / 12)) + "a euros"],
  ["repetición", "recuérdame " + "cada ".repeat(Math.floor((N - 20) / 5)) + "lunes"],
  ["prosa", "Estoy pensando en cambiar de trabajo porque me estresa, ".repeat(Math.floor(N / 57))],
];
const EXTRACTORS: Array<[string, (s: string) => unknown]> = [
  ["classifyIntent", classifyIntent],
  ["extractToolAction", (s) => extractToolAction(s)],
  ["extractReminderAction", (s) => extractReminderAction(s)],
  ["extractCalcAction", extractCalcAction],
  ["extractTimerAction", extractTimerAction],
  ["extractContactAction", extractContactAction],
];
const BUDGET_MS = 60;

function medianMs(fn: () => void): number {
  fn(); // calentamiento
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    fn();
    runs.push(performance.now() - t0);
  }
  return runs.sort((a, b) => a - b)[1];
}

describe("coste del pre-router con entradas hostiles del tamaño máximo", () => {
  for (const [label, text] of HOSTILE) {
    it(`«${label}» (${text.length} caracteres) no se dispara en ningún extractor`, () => {
      for (const [name, fn] of EXTRACTORS) {
        const ms = medianMs(() => fn(text));
        expect(ms, `${name} tardó ${ms.toFixed(1)} ms`).toBeLessThan(BUDGET_MS);
      }
    });
  }

  it("la calculadora rechaza una «cuenta» de más de 120 caracteres sin evaluarla", () => {
    expect(extractCalcAction("cuánto es " + "1".repeat(200) + "+1")).toBeNull();
    // Una cuenta normal sigue funcionando.
    expect(extractCalcAction("cuánto es 245 * 38")?.result).toBe(9310);
  });
});
