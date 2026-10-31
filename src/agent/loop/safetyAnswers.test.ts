/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.55: respuestas fijas de seguridad. Lo que importa: que salten cuando
 * hay riesgo de vida, que NO salten en preguntas normales y que nunca se
 * invente un número de emergencia.
 */
import { describe, expect, it } from "vitest";
import { EMERGENCY_NUMBERS, matchSafetyAnswer } from "./safetyAnswers";

const kind = (t: string, l: "es" | "en" | "pt" = "es") => matchSafetyAnswer(t, l)?.kind ?? null;

describe("monóxido de carbono: aparato que quema combustible en un lugar cerrado", () => {
  it.each([
    ["¿Puedo usar el generador dentro del garaje si abro la puerta?", "es"],
    ["puedo poner la planta de luz en la cocina", "es"],
    ["¿Se puede prender el brasero en el cuarto para calentarnos?", "es"],
    ["dejo el carro encendido en el garaje para calentarlo", "es"],
    ["Can I run my generator in the garage?", "en"],
    ["is it ok to use a charcoal grill inside the tent", "en"],
    ["posso usar o gerador dentro de casa?", "pt"],
  ] as const)("«%s» → respuesta fija", (t, l) => {
    expect(kind(t, l)).toBe("co-hazard");
  });

  it("la respuesta dice que no, aunque se abran puertas y ventanas, y da la distancia de la CPSC", () => {
    const es = matchSafetyAnswer("¿puedo usar el generador en el garaje?", "es")!;
    expect(es.text.startsWith("No.")).toBe(true);
    expect(es.text).toMatch(/aunque abras puertas y ventanas/);
    expect(es.text).toMatch(/6 metros \(20 pies\)/);
    expect(es.text).toMatch(/CPSC y CDC/);
    expect(es.deterministic).toBe(true);
    const en = matchSafetyAnswer("can I run the generator in my garage", "en")!;
    expect(en.text).toMatch(/even with doors and windows open/);
    expect(en.text).toMatch(/20 feet/);
    const pt = matchSafetyAnswer("posso usar o gerador na garagem?", "pt")!;
    expect(pt.text).toMatch(/mesmo com portas e janelas abertas/);
  });

  it("síntomas o alarma: salir ya y llamar desde fuera", () => {
    expect(kind("tengo dolor de cabeza y el generador está prendido")).toBe("co-symptoms");
    expect(kind("la alarma de monoxido esta sonando")).toBe("co-symptoms");
    expect(kind("I feel dizzy and the generator is running", "en")).toBe("co-symptoms");
    expect(matchSafetyAnswer("la alarma de monoxido esta sonando", "es")!.text).toMatch(/aire libre ahora mismo/);
  });

  it.each([
    "¿cómo limpio la parrilla de la cocina?",
    "mi carro está en el garaje",
    "el motor hace ruido dentro",
    "que es un generador electrico",
    "¿puedo usar el generador afuera?",
    "hola",
    "recuérdame comprar carbón",
  ])("«%s» → no salta (sigue su camino normal)", (t) => {
    expect(kind(t)).toBeNull();
  });
});

describe("números de emergencia: solo los comprobados", () => {
  it.each([
    ["¿Cuál es el número de emergencias en Cuba?", "es", /104 ambulancia, 105 bomberos y 106 policía/],
    ["numero de emergencia en mexico", "es", /911/],
    ["número de emergencias en República Dominicana", "es", /9-1-1/],
    ["numero de emergencia en españa", "es", /112/],
    ["what is the emergency number in Puerto Rico?", "en", /9-1-1/],
    ["qual é o número de emergência no Brasil?", "pt", /190 polícia, 192 SAMU e 193 bombeiros/],
  ] as const)("«%s»", (t, l, re) => {
    const h = matchSafetyAnswer(t, l)!;
    expect(h.kind).toBe("emergency-number");
    expect(h.text).toMatch(re);
    expect(h.text).toMatch(/Fuente|Source|Fonte/);
  });

  it("un país que no está comprobado: no se inventa", () => {
    const h = matchSafetyAnswer("what is the emergency number in Germany?", "en")!;
    expect(h.kind).toBe("emergency-number");
    expect(h.country).toBeUndefined();
    expect(h.text).toMatch(/won't guess/);
    expect(h.text).not.toMatch(/Germany, the emergency/);
  });

  it("sin país: pregunta cuál, y dice qué países están comprobados", () => {
    const h = matchSafetyAnswer("¿cuál es el número de emergencias?", "es")!;
    expect(h.text).toMatch(/¿En qué país estás\?/);
    expect(h.text).toMatch(/Cuba/);
    expect(matchSafetyAnswer("numero de emergencia en mi pais", "es")!.text).toMatch(/¿En qué país estás\?/);
  });

  it("cada país de la tabla trae su fuente y su número en los tres idiomas", () => {
    for (const e of EMERGENCY_NUMBERS) {
      expect(e.source.length).toBeGreaterThan(10);
      for (const l of ["es", "en", "pt"] as const) expect(e.numbers[l]).toMatch(/\d/);
    }
  });
});

// 2026-10-30 (prueba física): la pregunta llegó mezclada, tal como la
// escribió el dueño en su foto: «Numero de emergency in Japan?». Ninguna
// rama la casaba y la respuesta fija nunca disparaba.
describe("pregunta mezclada ES/PT + «emergency» (2026-10-30)", () => {
  it("«Numero de emergency in Japan?» entra y marca país no comprobado nombrado", () => {
    const h = matchSafetyAnswer("Numero de emergency in Japan?", "es")!;
    expect(h.kind).toBe("emergency-number");
    expect(h.country).toBeUndefined();
    expect(h.countryUnknown).toEqual({ asked: true });
    expect(h.text).not.toMatch(/\b(911|112|999)\b/);
  });

  it("«Telefone de emergency no Japão?» entra en portugués", () => {
    const h = matchSafetyAnswer("Telefone de emergency no Japão?", "pt")!;
    expect(h.kind).toBe("emergency-number");
    expect(h.countryUnknown).toEqual({ asked: true });
  });

  it("«Numero de emergency in Spain?» responde el número comprobado de España", () => {
    const h = matchSafetyAnswer("Numero de emergency in Spain?", "es")!;
    expect(h.kind).toBe("emergency-number");
    expect(h.country).toBe("Spain");
    expect(h.text).toMatch(/112/);
  });

  it("«emergency» sin la forma de pregunta de número no dispara la ruta", () => {
    expect(matchSafetyAnswer("this is my emergency contact", "en")).toBeNull();
    expect(matchSafetyAnswer("tengo una emergency en casa", "es")).toBeNull();
  });
});

describe("auditoría 0.1.55: «usa» como verbo no es Estados Unidos", () => {
  it("«el número de emergencias que se usa aquí» pregunta el país, no responde el 911", () => {
    const hit = matchSafetyAnswer("¿cuál es el número de emergencias que se usa aquí?", "es");
    expect(hit?.kind).toBe("emergency-number");
    expect(hit?.country).toBeUndefined();
  });

  it("Estados Unidos sigue respondiendo con su nombre", () => {
    expect(matchSafetyAnswer("número de emergencias en Estados Unidos", "es")?.country).toBe("the United States");
  });
});

describe("país sin número comprobado: lista de los packs (0.1.57)", () => {
  it("marca la respuesta para poder rehacerla con los países de los packs, sin cambiar el texto de la tabla", async () => {
    const { unknownCountryText } = await import("./safetyAnswers");
    const asked = matchSafetyAnswer("número de emergencias en Japón", "es")!;
    expect(asked.countryUnknown).toEqual({ asked: true });
    const which = matchSafetyAnswer("cuál es el número de emergencias", "es")!;
    expect(which.countryUnknown).toEqual({ asked: false });
    // Same fixed text as before for the built-in list.
    const names = EMERGENCY_NUMBERS.map((x) => x.label.es);
    expect(unknownCountryText("es", true, names)).toBe(asked.text);
    expect(unknownCountryText("es", false, names)).toBe(which.text);
    // A country the table knows is not "unknown".
    expect(matchSafetyAnswer("número de emergencias en México", "es")!.countryUnknown).toBeUndefined();
  });

  it("la cifra de países sale de la lista que llega, nunca de una constante", async () => {
    const { unknownCountryText } = await import("./safetyAnswers");
    expect(unknownCountryText("es", true, ["Chile"])).toContain("(1): Chile.");
    expect(unknownCountryText("es", true, ["A", "B", "C", "D", "E", "F", "G", "H"])).toContain("(8):");
    expect(unknownCountryText("en", true, ["Chile", "Peru"])).toContain("Countries checked so far (2):");
    expect(unknownCountryText("pt", true, ["Chile", "Peru", "Brasil"])).toContain("Países conferidos até agora (3):");
  });

  it("con la lista de los packs sigue sin adivinar y nombra todos los países", async () => {
    const { unknownCountryText } = await import("./safetyAnswers");
    const t = unknownCountryText("es", true, ["Argentina", "Chile", "Uruguay"]);
    expect(t).toContain("no lo voy a adivinar");
    expect(t).toContain("Países comprobados por ahora (3): Argentina, Chile, Uruguay.");
    expect(t).not.toMatch(/\b\d{3}\b/);
    expect(unknownCountryText("en", false, ["Chile"])).toBe("Which country are you in? I'll tell you the number.\n\nCountries checked so far (1): Chile.");
  });
});
