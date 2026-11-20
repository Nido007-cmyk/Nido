/**
 * F-PC39/52/53 en el móvil (paquete de arreglos, §6.1 a §6.3):
 * los síntomas de monóxido en portugués («fraqueza», el tallo
 * «desmai-», «tonto» por el tallo «tont»), el puente de la
 * alarma «de monóxido» en pt, el interior «porch»/«varanda» y
 * el aparato de solo-síntomas «aquecedor de agua».
 */
import { describe, expect, it } from "vitest";
import { matchSafetyAnswer } from "./safetyAnswers.js";

const kind = (t: string, l: "es" | "en" | "pt" = "es") => matchSafetyAnswer(t, l)?.kind ?? null;

describe("F-PC39 · síntomas de monóxido en portugués", () => {
  it("«fraqueza» con aparato de solo-síntomas dispara la cara de síntomas", () => {
    expect(kind("Estou com fraqueza e a caldeira está ligada", "pt")).toBe("co-symptoms");
  });
  it("«desmaiou» con aparato de solo-síntomas dispara la cara de síntomas", () => {
    expect(kind("Ele desmaiou e a caldeira está acesa", "pt")).toBe("co-symptoms");
  });
  it("«estou tonto» casa por el tallo, no solo «tontura»", () => {
    expect(kind("Estou tonto e a caldeira está ligada", "pt")).toBe("co-symptoms");
  });
  it("la alarma pt trae el puente «de monóxido»", () => {
    expect(kind("O alarme de monóxido está tocando", "pt")).toBe("co-symptoms");
  });
});

describe("F-PC52 · el interior «porch» y «varanda»", () => {
  it("generador en el porch es peligro de monóxido", () => {
    expect(kind("Can I run the generator on the porch?", "en")).toBe("co-hazard");
  });
  it("gerador na varanda é perigo de monóxido", () => {
    expect(kind("Posso ligar o gerador na varanda?", "pt")).toBe("co-hazard");
  });
});

describe("F-PC53 · «aquecedor de agua», aparato de solo-síntomas", () => {
  it("con síntoma, dispara la cara de síntomas", () => {
    expect(kind("Estou com dor de cabeça e o aquecedor de água está ligado", "pt")).toBe("co-symptoms");
  });
  it("sin síntoma, el aparato de solo-síntomas no dispara ninguna cara de monóxido", () => {
    expect(kind("Posso usar o aquecedor de água no porão?", "pt")).not.toBe("co-hazard");
    expect(kind("Posso usar o aquecedor de água no porão?", "pt")).not.toBe("co-symptoms");
  });
});
