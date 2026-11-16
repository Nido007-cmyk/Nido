/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.103 (foto del dueño, Tab A9+, 2026-11-15 19:15 MST): recién
 * instalada la 0.1.103, en la MISMA conversación crecida de las fotos
 * del desfondado, «Como cambio la llanta de un carro» (tono «Conciso y
 * directo») murió antes de responder: «Algo salió mal. Detalle
 * técnico: NIDO: system prompt excede el presupuesto (530 tokens
 * estimados > máximo 512). Reduce el system prompt o sube
 * maxSystemTokens.»
 *
 * Causa probada: el resumen de la conversación — que el propio app
 * genera en segundo plano cuando los mensajes salen de la ventana
 * literal y guarda por sesión — viaja DENTRO del mensaje de sistema.
 * El núcleo fijo (personalidad + instrucción de no actuar + la de
 * ceñirse a las fuentes) ya estima 490 de los 512 que el tope
 * maxSystemTokens (nCtx/2) deja en la ventana de 1024 de su tableta:
 * cualquier resumen almacenado lo supera, la guarda de presupuesto
 * solo sabe recortar historial y el turno muere en el lanzamiento,
 * igual en cada reintento (el resumen guardado no cambia). La
 * conversación queda inutilizable.
 *
 * Esta regresión fija la clase «guarda de presupuesto fail-closed
 * sobre un componente fijo que crece sin tope»: el sistema va ENTERO
 * siempre (nunca truncado en silencio); lo que cede es el historial,
 * y el turno solo muere cuando el núcleo irreducible no cabe en la
 * ventana ni con la reserva en el suelo.
 */
import { describe, it, expect } from "vitest";
import { assembleChatMessages } from "./pure";
import { defaultTokenCounter } from "../agent/loop/contextBudget";
import { getPersonality } from "../constants/personalities";
import type { RetrievedChunk } from "./retrieve";

const GUIA_LLANTA =
  "Para cambiar la llanta de un carro, apaga el motor y pon el freno de estacionamiento en una superficie plana y firme. " +
  "Afloja las tuercas de la rueda con la llave de cruz sin quitarlas del todo. " +
  "Coloca el gato en el punto de apoyo indicado por el fabricante y levanta el carro hasta que la rueda quede libre. " +
  "Quita las tuercas y la llanta dañada, coloca la refacción y aprieta las tuercas en cruz, primero a mano y luego con la llave ya con el carro en el suelo.";

function chunk(body: string, id: string): RetrievedChunk {
  return {
    chunkId: id,
    docId: id,
    title: id,
    body,
    score: 1,
    matchType: "hybrid",
  } as unknown as RetrievedChunk;
}

// Los turnos de sus fotos, tal como quedaron asentados en la sesión:
// la llanta inventada de la 0.1.102 y el atragantamiento inventado.
const TURNOS_SU_TAB = [
  { role: "user" as const, text: "Como cambio la llanta de un carro" },
  {
    role: "assistant" as const,
    text: "Para cambiar la llanta de un carro, primero asegúrate de que el motor esté en marcha.",
  },
  { role: "user" as const, text: "Como cambio la llanta de un carro" },
  {
    role: "assistant" as const,
    text:
      "Para cambiar la llanta de un carro, primero asegúrate de tener las herramientas adecuadas. " +
      "Luego, apaga el vehículo y desenchufa la batería si es necesario. " +
      "Después, desliza la llave del radiador hacia abajo para liberarla. " +
      "Finalmente, retira la llanta vieja y coloca la nueva en su lugar.",
  },
  { role: "user" as const, text: "Que hago si un niño se esta atragantando" },
  {
    role: "assistant" as const,
    text:
      "Si un niño se atraganta, primero asegúrate de que esté tranquilo y relajado. Luego, haz lo siguiente: " +
      "1. Sólo si es seguro para ti, acuéstate al lado del niño. " +
      "2. Mantén la respiración calmada. " +
      "3. Si el niño continúa atragantándose o parece mareado, llama a un profesional de la salud inmediatamente.",
  },
];

// El resumen que el aparato guarda de esa conversación (2-3 puntos,
// como lo genera summarizeConversation): es el componente que crece.
const RESUMEN_SU_TAB =
  "- El usuario preguntó cómo cambiar la llanta de un carro y el asistente le explicó los pasos.\n" +
  "- El usuario preguntó qué hacer si un niño se está atragantando y el asistente le dio indicaciones.\n" +
  "- El usuario usa un tono conciso y directo.";

const PREGUNTA = "Como cambio la llanta de un carro";

function escenarioDelDueno(nCtx: number) {
  const personality = getPersonality("succinct");
  return assembleChatMessages(
    PREGUNTA,
    [chunk(GUIA_LLANTA, "guia-llanta")],
    personality.systemPrompt,
    { summary: RESUMEN_SU_TAB, turns: TURNOS_SU_TAB },
    personality.styleReminder,
    false,
    { nCtx, reserveGeneration: 512 }
  );
}

describe("0.1.103 · el resumen dentro del sistema no mata el turno (foto del dueño)", () => {
  it("su escenario exacto a 1024: el sistema supera el tope de 512 y el turno se ensambla igual", () => {
    const msgs = escenarioDelDueno(1024);
    const system = msgs[0];
    expect(system.role).toBe("system");
    // La precondición de la foto: el sistema compuesto SÍ supera el
    // tope que mataba el turno (512 a nCtx 1024).
    expect(defaultTokenCounter(system.content)).toBeGreaterThan(512);
    // El resumen viaja ENTERO: degradar no es truncar el sistema.
    expect(system.content).toContain("Summary of earlier conversation:");
    expect(system.content).toContain("atragantando");
    // Y el turno existe: sistema + (historial recortado) + pregunta.
    expect(msgs[msgs.length - 1].role).toBe("user");
    expect(msgs[msgs.length - 1].content).toContain(PREGUNTA);
  });

  it("control: el mismo escenario en ventana normal (2048) se ensambla como siempre", () => {
    const msgs = escenarioDelDueno(2048);
    expect(msgs[0].role).toBe("system");
    expect(msgs[msgs.length - 1].content).toContain(PREGUNTA);
  });

  it("control irreducible: un resumen que ni con la reserva en el suelo cabe sigue muriendo en la guarda física", () => {
    const personality = getPersonality("succinct");
    const resumenEnorme = "resumen ".repeat(600); // ~1.650 tokens estimados de resumen
    expect(() =>
      assembleChatMessages(
        PREGUNTA,
        [chunk(GUIA_LLANTA, "guia-llanta")],
        personality.systemPrompt,
        { summary: resumenEnorme, turns: TURNOS_SU_TAB },
        personality.styleReminder,
        false,
        { nCtx: 1024, reserveGeneration: 512 }
      )
    ).toThrow(/sin siquiera historial/);
  });
});
