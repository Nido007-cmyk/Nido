/**
 * §6 resto del paquete de arreglos del móvil: F-PC40 (consultas
 * de memoria en en/pt), F-PC43 (parentescos), F-PC44 («guarda /
 * guarde uma nota»), F-PC45 (contactos: verbos y separador),
 * F-PC46 (alias de conversión), F-PC47 (dieta y alergias) y
 * F-PC54 (llamada en pt: chama/disca).
 */
import { describe, expect, it } from "vitest";
import { extractImplicitFact, extractPeople, isMemoryQuery } from "./rememberRouter.js";
import { extractToolAction } from "./toolRouter.js";
import { extractContactAction } from "./contactRouter.js";
import { convertUnits } from "../tools/convert.js";

const NOW = new Date(2026, 10, 20, 9, 0, 0);

describe("F-PC40 · las consultas de memoria también existen en en/pt", () => {
  it("en: «remember when is my mom's birthday?» es consulta, no hecho", () => {
    expect(isMemoryQuery("remember when is my mom's birthday?")).toBe(true);
  });
  it("en: «when is the birthday of my brother?» es consulta", () => {
    expect(isMemoryQuery("when is the birthday of my brother?")).toBe(true);
  });
  it("pt: «lembra que dia é o aniversário da minha mãe?» es consulta", () => {
    expect(isMemoryQuery("lembra que dia é o aniversário da minha mãe?")).toBe(true);
  });
  it("pt: «qual é a data do aniversário?» es consulta", () => {
    expect(isMemoryQuery("qual é a data do aniversário da Ana?")).toBe(true);
  });
  it("pt: «quando é o aniversário do meu pai?» es consulta", () => {
    expect(isMemoryQuery("quando é o aniversário do meu pai?")).toBe(true);
  });
  it("la consulta no se guarda como hecho implícito", () => {
    expect(extractImplicitFact("when is the birthday of my brother?")).toBeNull();
  });
});

describe("F-PC43 · los parentescos que faltaban", () => {
  it("en: «my grandson is called Leo» crea a Leo como nieto", () => {
    const p = extractPeople("my grandson is called Leo");
    expect(p).toHaveLength(1);
    expect(p[0].name).toBe("Leo");
  });
  it("en: «my partner's name is Ana» crea a Ana", () => {
    const p = extractPeople("my partner's name is Ana");
    expect(p).toHaveLength(1);
    expect(p[0].name).toBe("Ana");
  });
  it("en: «my granddaughter is called Mia» crea a Mia", () => {
    expect(extractPeople("my granddaughter is called Mia")[0]?.name).toBe("Mia");
  });
  it("pt: «meu parceiro se chama Rui» crea a Rui", () => {
    const p = extractPeople("meu parceiro se chama Rui");
    expect(p).toHaveLength(1);
    expect(p[0].name).toBe("Rui");
  });
});

describe("F-PC47 · dieta, alergias y estado en su forma completa", () => {
  it("pt: «sou hipertenso» se guarda", () => {
    expect(extractImplicitFact("sou hipertenso")).not.toBeNull();
  });
  it("pt: «sou asmático» se guarda", () => {
    expect(extractImplicitFact("sou asmático")).not.toBeNull();
  });
  it("en: «I'm asthmatic» se guarda", () => {
    expect(extractImplicitFact("I'm asthmatic")).not.toBeNull();
  });
  it("en: «I'm hypertensive» se guarda", () => {
    expect(extractImplicitFact("I'm hypertensive")).not.toBeNull();
  });
  it("pt: «não como açúcar» se guarda", () => {
    expect(extractImplicitFact("não como açúcar")).not.toBeNull();
  });
  it("pt: «estou comprometido» se guarda", () => {
    expect(extractImplicitFact("estou comprometido")).not.toBeNull();
  });
  it("pt: «tenho quatro filhos» se guarda", () => {
    expect(extractImplicitFact("tenho quatro filhos")).not.toBeNull();
  });
});

describe("F-PC44 · «guarda/guarde uma nota» en pt", () => {
  it("«guarda uma nota: comprar pão» guarda la nota", () => {
    expect(extractToolAction("guarda uma nota: comprar pão", NOW)).toMatchObject({ kind: "noteSave", lang: "pt" });
  });
  it("«guarde uma nota dizendo reunião às dez» guarda la nota", () => {
    expect(extractToolAction("guarde uma nota dizendo reunião às dez", NOW)).toMatchObject({ kind: "noteSave", lang: "pt" });
  });
});

describe("F-PC45 · contactos: los verbos y el separador que faltaban", () => {
  it("pt: «me dá o contato da Ana» busca el contacto", () => {
    expect(extractContactAction("me dá o contato da Ana")).toMatchObject({ kind: "find", lang: "pt" });
  });
  it("pt: «pega o contato do João» busca el contacto", () => {
    expect(extractContactAction("pega o contato do João")).toMatchObject({ kind: "find", lang: "pt" });
  });
  it("pt: «escreve uma mensagem de texto para a Ana dizendo que chego tarde» separa en «dizendo que»", () => {
    const a = extractContactAction("escreve uma mensagem de texto para a Ana dizendo que chego tarde");
    expect(a).toMatchObject({ kind: "sms", lang: "pt" });
    if (a?.kind === "sms") expect(a.message).toBe("chego tarde");
  });
  it("en: «write a text to Ana saying I'm late» es sms con su cuerpo", () => {
    const a = extractContactAction("write a text to Ana saying I'm late");
    expect(a).toMatchObject({ kind: "sms", lang: "en" });
    if (a?.kind === "sms") expect(a.message).toBe("I'm late");
  });
});

describe("F-PC54 · la llamada en pt con chama/disca", () => {
  it("«chama a Ana» llama", () => {
    expect(extractContactAction("chama a Ana")).toMatchObject({ kind: "call", lang: "pt" });
  });
  it("«disque para o João» llama", () => {
    expect(extractContactAction("disque para o João")).toMatchObject({ kind: "call", lang: "pt" });
  });
});

describe("F-PC46 · los alias de conversión que faltaban", () => {
  it("«cups» convierte (2 cups a ml)", () => {
    expect(convertUnits(2, "cups", "ml").value).toBeCloseTo(473.176, 2);
  });
  it("la familia británica -re convierte (100 centimetres a m)", () => {
    expect(convertUnits(100, "centimetres", "m").value).toBe(1);
    expect(convertUnits(1, "kilometre", "m").value).toBe(1000);
    expect(convertUnits(1000, "millilitres", "l").value).toBe(1);
  });
  it("«days» convierte (2 days a h)", () => {
    expect(convertUnits(2, "days", "h").value).toBe(48);
  });
});
