/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.105 (carril atragantamiento-01105) — la cáscara de cita: la foto
 * del dueño (Tab A9+, 2026-11-16, conversación crecida, base 0.1.104)
 * sirvió como respuesta a «Que hago si un niño se esta atragantando»
 * el texto literal «[1] Cauterization»: una cita y el TÍTULO de un
 * fragmento ajeno en inglés, sin un solo paso de ayuda, con veredicto
 * «grounded» y pie «1 del modelo sin fuente».
 *
 * Causa (b) medida en este carril: con la lista del juez reducida a
 * ESE fragmento solo (el ajuste de presupuesto de la conversación
 * crecida puede dejar un único superviviente diminuto), la frase
 * «Cauterization» tiene menos raíces juzgables que el mínimo y pasa
 * por la regla de frase corta como «del modelo sin fuente»; las
 * piernas de relevancia no la retiran porque, sola en la lista, ella
 * ES la referencia de relevancia; y la puerta final de la abstención
 * exige retiradas o abstención previa, así que el veredicto sale
 * «grounded» con la cáscara tal cual, y la sustitución por el texto
 * seguro de salud (que exige «unverified»/«abstained») no dispara.
 * Con la lista recuperada completa, en cambio, la pierna de
 * relevancia V6 sí la retira (control de abajo): el agujero es la
 * configuración de lista unitaria, no la pregunta ni la clase.
 *
 * Contrato fijado: una frase que es el eco del título de un fragmento
 * de la lista (cita y título, sin contenido del cuerpo) no es una
 * respuesta: se retira como cualquier frase sin fundamento, y si era
 * lo único servido, el turno cae a la abstención honesta (y en salud,
 * a la sustitución por el texto seguro que la pantalla ya aplica).
 * La regla es agnóstica de clase: vale para salud y para cualquier
 * otra pregunta. Las copias cortas FIELES del cuerpo (A3-03) no son
 * títulos y no se tocan.
 */
import { describe, it, expect } from "vitest";
import { verifyGroundedAnswer, type GroundingChunk } from "./grounding";
import { shouldSubstituteSafeText } from "../routing/emergencyGate";

const PREGUNTA = "Que hago si un niño se esta atragantando";

const CAUT: GroundingChunk = {
  title: "Cauterization",
  body: "Cautery can also mean the branding of a human. It is a practice that was once used to mark slaves or criminals.",
};

const GUIA: GroundingChunk = {
  title: "Atragantamiento por edades: bebés y niños — Si no sale o pierde el conocimiento",
  body:
    "Si no sale o pierde el conocimiento\n" +
    "- Llama a emergencias, túmbalo en el suelo y empieza la RCP. Cada vez que abras la vía aérea para respirar, mira si se ve el objeto.",
};

const AVERIA: GroundingChunk = {
  title: "Avería en carretera",
  body: "Enciende las luces de emergencia en cuanto notes el problema. Aparta el coche del carril y no te detengas en una curva.",
};

describe("cáscara 01105 — el eco del título no se sirve como respuesta", () => {
  it("EL CASO: «[1] Cauterization» contra su fragmento solo ya no sale «grounded»", () => {
    const r = verifyGroundedAnswer("[1] Cauterization", [CAUT], "es", PREGUNTA);
    expect(r.status).toBe("abstained");
    expect(r.removed).toBe(1);
    // Y la pantalla, con ese veredicto, sí sustituye por el texto
    // seguro de salud (la fuente que queda no es evidencia de salud).
    const sust = shouldSubstituteSafeText({
      sources: [CAUT] as never,
      grounding: r.status,
      provenance: r.sentences,
      isHealth: true,
      isEmergency: true,
      deepTurn: false,
    });
    expect(sust).toBe(true);
  });

  it("control: con la lista completa, la misma cáscara ya caía por relevancia (el agujero es la lista unitaria)", () => {
    const r = verifyGroundedAnswer("[1] Cauterization", [GUIA, CAUT], "es", PREGUNTA);
    expect(r.status).toBe("abstained");
  });

  it("control fiel: una frase real de la guía, citada, queda fundada", () => {
    const r = verifyGroundedAnswer(
      "Llama a emergencias, túmbalo en el suelo y empieza la RCP [1]",
      [GUIA],
      "es",
      PREGUNTA,
    );
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
  });

  it("control A3-03: la copia corta fiel del CUERPO no es un título y no se retira", () => {
    const nota: GroundingChunk = {
      title: "nota",
      body: "Tome el jarabe de 5 ml dos veces al día, después de comer.",
    };
    const r = verifyGroundedAnswer("La dosis es 5 ml.", [nota], "es", "¿Cuál es la dosis del jarabe?");
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
    expect(r.text).toBe("La dosis es 5 ml.");
  });

  it("eco + frase fundada: se retira el eco y queda la frase (veredicto «partial», la etiqueta de la casa para lo recortado)", () => {
    const r = verifyGroundedAnswer(
      "[1] Cauterization. Llama a emergencias, túmbalo en el suelo y empieza la RCP [2]",
      [CAUT, GUIA],
      "es",
      PREGUNTA,
    );
    expect(r.status).toBe("partial");
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain("Cauterization");
    expect(r.text).toContain("empieza la RCP");
  });

  it("agnóstico de clase: el eco del título fuera de salud también cae", () => {
    const r = verifyGroundedAnswer("[1] Avería en carretera", [AVERIA], "es", "Como cambio la llanta de un carro");
    expect(r.status).toBe("abstained");
    expect(r.removed).toBe(1);
  });
});
