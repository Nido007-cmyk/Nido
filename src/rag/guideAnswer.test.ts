/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.59 — first aid answers word for word, and the negation guard. The
 * texts are the real NIDO Essentials ones seen on the tablet.
 */
import { describe, it, expect } from "vitest";
import { composeGuideAnswer, GUIDE_MAX_CHARS, isEssentialsChunk, pickGuideChunk } from "./guideAnswer";
import { closestSourceSentence, negationCount, verifyGroundedAnswer } from "./grounding";
import { buildLexicalQuery, countMatchedTerms } from "./pure";

const CHEST = `Qué hacer
1. Llama de inmediato al número de emergencias.
2. Que la persona deje de hacer esfuerzo. Siéntala semirrecostada, en la posición más cómoda.
3. Si es un adulto despierto, no es alérgico a la aspirina, no está sangrando y su médico no se lo ha prohibido: que mastique una aspirina para adultos (entre 162 y 325 mg, o 2 a 4 aspirinas infantiles de 81 mg) y la trague.
4. Si tiene medicación recetada para la angina (nitroglicerina), ayúdala a tomarla.`;

const chunk = (id: string, title: string, body: string, rawScore?: number, matchType: "lexical" | "semantic" | "hybrid" = "semantic") => ({
  chunkId: id, docId: id, title, body, score: 1, rawScore, matchType,
});

describe("respuesta desde la guía, sin modelo (0.1.59)", () => {
  it("solo los packs de NIDO Esencial", () => {
    expect(isEssentialsChunk("pack:nido-esencial:12")).toBe(true);
    expect(isEssentialsChunk("pack:nido-esencial-e5:12")).toBe(true);
    expect(isEssentialsChunk("pack:wiki-vital5:12")).toBe(false);
    expect(isEssentialsChunk("corpus-standard:1")).toBe(false);
  });

  it("el caso de la tablet: un trozo solo léxico (dolor de pecho) no gana a la guía de RCP", () => {
    const got = pickGuideChunk([
      chunk("pack:nido-esencial-e5:230", "Dolor de pecho e infarto — Qué hacer", CHEST, undefined, "lexical"),
      chunk("pack:nido-esencial-e5:10", "RCP (reanimación) en adultos y niños mayores — Respiraciones (solo si sabes hacerlas)", "Respiraciones\n- Si sabes hacerlas…", 0.89),
      chunk("pack:nido-esencial-e5:8", "RCP (reanimación) en adultos y niños mayores — Antes de empezar", "Antes de empezar\n- Comprueba que el lugar es seguro.", 0.89),
    ], "es");
    expect(got?.title).toMatch(/^RCP \(reanimación\) en adultos/);
  });

  it("si la mejor coincidencia no es de NIDO Esencial, o es floja, sigue el camino normal", () => {
    expect(pickGuideChunk([chunk("pack:wiki-vital5:1", "Heart", "The heart…", 0.9), chunk("pack:nido-esencial:5", "RCP", "…", 0.85)], "es")).toBeNull();
    expect(pickGuideChunk([chunk("pack:nido-esencial:5", "RCP", "Comprueba que el lugar es seguro.", 0.7)], "es")).toBeNull();
    expect(pickGuideChunk([chunk("pack:nido-esencial:5", "RCP", "…", undefined, "lexical")], "es")).toBeNull();
  });

  it("prefiere la guía en el idioma de quien pregunta cuando están igual de cerca", () => {
    const en = chunk("pack:nido-esencial-e5:300", "CPR for adults and older children — Before you start", "Before you start\n- Make sure the place is safe. Tap their shoulders and shout.", 0.9);
    const es = chunk("pack:nido-esencial-e5:8", "RCP (reanimación) en adultos y niños mayores — Antes de empezar", "Antes de empezar\n- Comprueba que el lugar es seguro. Toca sus hombros y háblale fuerte.", 0.89);
    expect(pickGuideChunk([en, es], "es")?.chunkId).toBe(es.chunkId);
    expect(pickGuideChunk([en, es], "en")?.chunkId).toBe(en.chunkId);
    expect(pickGuideChunk([en, es], "pt")?.chunkId).toBe(es.chunkId);
  });

  it("el texto sale tal cual: «no está sangrando» se mantiene, con la fuente y el aviso de llamar", () => {
    const text = composeGuideAnswer({ title: "Dolor de pecho e infarto", source: "NIDO — Dolor de pecho e infarto (basado en: AHA…)", parts: [{ id: 1, body: CHEST, used: true }] }, "es");
    expect(text).toContain("no es alérgico a la aspirina, no está sangrando y su médico no se lo ha prohibido");
    expect(text).toContain(CHEST);
    expect(text.split("\n")[0]).toBe("Guía «Dolor de pecho e infarto» de NIDO Esencial, tal como está escrita (sin modelo):");
    expect(text).toContain("Fuentes de la guía: NIDO — Dolor de pecho e infarto");
    expect(text).toContain("llama primero al número de emergencias");
  });

  it("si la guía es larga se corta entre apartados, nunca a mitad, y remite a «Abrir la guía completa»", () => {
    const part = (n: number) => ({ id: n, body: `Apartado ${n}\n${"x".repeat(1000)}.`, used: n === 1 });
    const text = composeGuideAnswer({ title: "Larga", source: "", parts: [part(1), part(2), part(3), part(4)] }, "en");
    expect(text).toContain("Apartado 1");
    expect(text).toContain("Apartado 2");
    expect(text).not.toContain("Apartado 3");
    expect(text.length).toBeLessThan(GUIDE_MAX_CHARS + 400);
    expect(text).toContain("Open the full guide");
  });
});

describe("guarda de negaciones en las respuestas del modelo (0.1.59)", () => {
  const MODEL = "1. Llama de inmediato al número de emergencias [1]. 3. Si es un adulto despierto, no es alérgico a la aspirina, está sangrando y su médico no se lo ha prohibido: que mastique una aspirina para adultos (entre 162 y 325 mg, o 2 a 4 aspirinas infantiles de 81 mg) y la trague.";

  it("cuenta negaciones en los tres idiomas", () => {
    expect(negationCount("no es alérgico, no está sangrando y su médico no se lo ha prohibido")).toBe(3);
    expect(negationCount("Do not use ice. Don't pop blisters. Never leave them alone.")).toBe(3);
    expect(negationCount("Não use gelo e nunca deixe a pessoa sem ajuda.")).toBe(3);
    expect(negationCount("Nota: anota la hora.")).toBe(0);
  });

  it("encuentra la frase de la fuente que corresponde", () => {
    const src = closestSourceSentence("Si es un adulto despierto, no es alérgico a la aspirina, está sangrando", CHEST.split("\n"));
    expect(src).toContain("no está sangrando");
  });

  it("el caso de la tablet: la frase con la negación perdida se cambia por la de la guía, palabra por palabra", () => {
    const r = verifyGroundedAnswer(MODEL, [{ title: "Dolor de pecho e infarto — Qué hacer", body: CHEST }], "es");
    expect(r.text).toContain("no está sangrando");
    expect(r.text).not.toMatch(/aspirina, está sangrando/);
  });

  it("una frase que conserva sus negaciones no se toca", () => {
    const ok = "Que la persona deje de hacer esfuerzo y no la dejes sola.";
    const src = [{ title: "Dolor de pecho", body: "Afloja la ropa, tranquilízala y no la dejes sola. Que la persona deje de hacer esfuerzo." }];
    expect(verifyGroundedAnswer(ok, src, "es").text).toContain("no la dejes sola");
  });
});

describe("búsqueda por palabras de las guías rápidas (0.1.59)", () => {
  it("«¿Cómo hago la RCP a un adulto?»: sin «hago», y «adulto» encuentra «adultos»", () => {
    const q = buildLexicalQuery("¿Cómo hago la RCP a un adulto?")!;
    expect(q.terms.map((t) => t.forms[0])).toEqual(["rcp", "adulto"]);
    expect(q.match).toContain('"adult"*');
    expect(countMatchedTerms("RCP (reanimación) en adultos y niños mayores", q.terms)).toBe(2);
  });

  it("«atraganta» encuentra «Atragantamiento»; «o que faço» no cuenta como tema", () => {
    const es = buildLexicalQuery("¿Qué hago si alguien se atraganta?")!;
    expect(es.terms.map((t) => t.forms[0])).toEqual(["atraganta"]);
    expect(countMatchedTerms("Atragantamiento en adultos, niños y bebés", es.terms)).toBe(1);
    const pt = buildLexicalQuery("O que faço com uma queimadura?")!;
    expect(pt.terms.map((t) => t.forms[0])).toEqual(["queimadura"]);
  });
});
