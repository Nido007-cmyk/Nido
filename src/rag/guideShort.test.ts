/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.60 (caso AT-04 de la evaluación v2): pedir un resumen de una guía de
 * primeros auxilios no hace que un modelo la reescriba (regla R1 de la
 * constitución). Se muestra su primera parte tal cual.
 */
import { describe, expect, it } from "vitest";
import {
  GUIDE_SHORT_MAX_CHARS,
  composeGuideAnswer,
  composeShortGuideAnswer,
  stripShortRequest,
  wantsShortGuide,
} from "./guideAnswer";
import type { PackSourceDoc } from "./packSource";

const RCP: PackSourceDoc = {
  title: "RCP (reanimación) en adultos y niños mayores",
  source: "NIDO — RCP (basado en: AHA 2025; Cruz Roja)",
  parts: [
    { id: 1, used: false, body: "Si una persona se desploma, no responde y no respira normal, su corazón probablemente se ha parado." },
    { id: 2, used: false, body: "Antes de empezar\n- Comprueba que el lugar es seguro.\n- Toca sus hombros y háblale fuerte." },
    { id: 3, used: true, body: "Compresiones en el pecho\n1. Tumba a la persona boca arriba.\n2. Pon el talón de una mano en el centro del pecho.\n5. Ritmo: 100 a 120 por minuto." },
    { id: 4, used: false, body: "Respiraciones (solo si sabes hacerlas)\n- 30 compresiones y 2 respiraciones." },
    { id: 5, used: false, body: "Cuándo parar\n- Cuando llegue un desfibrilador." },
  ],
};

describe("¿pide una versión corta?", () => {
  it.each([
    "resúmeme la guía de RCP",
    "dame un resumen de qué hacer si alguien se atraganta",
    "versión corta de la guía de quemaduras",
    "summarize the CPR guide",
    "CPR in a few words",
    "resuma o guia de RCP",
    "versão curta: o que fazer numa queimadura",
  ])("%s → sí", (q) => expect(wantsShortGuide(q)).toBe(true));

  it.each(["cómo hago RCP a un adulto", "how do I do CPR", "se está atragantando"])("%s → no", (q) =>
    expect(wantsShortGuide(q)).toBe(false),
  );

  it("se busca por el tema, sin la petición de resumen", () => {
    expect(stripShortRequest("resúmeme la guía de RCP")).toBe("la guía de RCP");
    expect(stripShortRequest("summarize the CPR guide")).toBe("the CPR guide");
  });
});

describe("versión corta: el principio de la guía, tal cual", () => {
  const out = composeShortGuideAnswer(RCP, "es");

  it("llega hasta el primer paso a paso numerado, incluido", () => {
    expect(out).toContain(RCP.parts[0].body);
    expect(out).toContain(RCP.parts[1].body);
    expect(out).toContain(RCP.parts[2].body);
    expect(out).not.toContain("30 compresiones");
    expect(out).not.toContain("Cuándo parar");
  });

  it("cada parte mostrada es literal (ninguna reescrita)", () => {
    const shown = RCP.parts.filter((p) => out.includes(p.body));
    expect(shown.length).toBe(3);
  });

  it("dice que es solo el principio, enlaza la guía completa y manda llamar primero", () => {
    expect(out).toMatch(/^Versión corta de la guía «RCP/);
    expect(out).toContain("la guía completa es la referencia");
    expect(out).toContain("Fuentes de la guía: NIDO — RCP");
    expect(out.trim().endsWith("llama primero al número de emergencias.")).toBe(true);
  });

  it("sin paso a paso en las tres primeras partes: las dos primeras", () => {
    const doc: PackSourceDoc = { ...RCP, parts: [RCP.parts[0], RCP.parts[1], RCP.parts[3], RCP.parts[2]] };
    const o = composeShortGuideAnswer(doc, "en");
    expect(o).toContain(RCP.parts[1].body);
    expect(o).not.toContain(RCP.parts[3].body);
    expect(o).toMatch(/^Short version of the NIDO Essentials guide/);
  });

  it("nunca pasa del tope salvo con la primera parte, y corta entre partes", () => {
    const long = "x".repeat(GUIDE_SHORT_MAX_CHARS);
    const doc: PackSourceDoc = { ...RCP, parts: [{ id: 1, used: true, body: long }, RCP.parts[2]] };
    const o = composeShortGuideAnswer(doc, "pt");
    expect(o).toContain(long);
    expect(o).not.toContain("Compresiones en el pecho");
  });

  it("composeGuideAnswer con short usa la versión corta; sin short, la de siempre", () => {
    expect(composeGuideAnswer(RCP, "es", { short: true })).toBe(out);
    expect(composeGuideAnswer(RCP, "es")).toContain("Cuándo parar");
  });
});
