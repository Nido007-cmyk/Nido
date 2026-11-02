/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  answerMemoryQuery,
  factHasDatumInstance,
  isGenericMemoryQuestionShape,
  isMemoryStyleQuery,
  memoryGateHit,
  memoryProbeWitness,
  questionDatumClasses,
  scoreMemoryFacts,
  type MemoryQueryData,
} from "./memoryQuery";

const MEM: MemoryQueryData = {
  facts: [
    { content: "Me llamo Ruben", category: "general" },
    { content: "mi coche es un Toyota", category: "general" },
    { content: "mi cumpleaños es el 3 de mayo", category: "event" },
    { content: "el cumpleaños de mi mamá es el 15 de marzo", category: "event" },
    { content: "mi color favorito es el azul", category: "preference" },
    { content: "vivo en Tucson", category: "general" },
  ],
  people: [{ name: "Marta", relationship: "mamá" }],
};

describe("0.1.20 (M1) — consultas de memoria deterministas", () => {
  it("nombre de una persona por parentesco, con sinónimo", () => {
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", MEM, "es")).toBe("Tu mamá se llama Marta.");
    expect(answerMemoryQuery("¿cómo se llama mi madre?", MEM, "es")).toBe("Tu madre se llama Marta.");
  });

  it("nombre propio", () => {
    expect(answerMemoryQuery("¿cómo me llamo?", MEM, "es")).toBe("Te llamas Ruben.");
    expect(answerMemoryQuery("what's my name?", MEM, "en")).toBe("Your name is Ruben.");
  });

  it("cumpleaños de una persona y el propio, con fecha formateada", () => {
    expect(answerMemoryQuery("¿cuándo es el cumpleaños de mi mamá?", MEM, "es")).toContain("15 de marzo");
    expect(answerMemoryQuery("¿cuándo es mi cumpleaños?", MEM, "es")).toContain("3 de mayo");
    expect(answerMemoryQuery("when is my birthday?", MEM, "en")).toContain("May 3");
  });

  it("0.1.24 (H-13): la respuesta EN de cumpleaños de un familiar empieza en mayúscula", () => {
    // La plantilla EN pone {{who}} al inicio («{{who}}'s birthday is
    // on…») y el llamador pasaba «your mom»: la frase salía en
    // minúscula. ES/PT ponen el «who» tras «de»: minúscula correcta.
    const en = answerMemoryQuery("when is my mom's birthday?", MEM, "en");
    expect(en).toMatch(/^Your mom's birthday is on /);
    expect(answerMemoryQuery("¿cuándo es el cumpleaños de mi mamá?", MEM, "es")).toMatch(/^El cumpleaños de tu mamá/);
  });

  it("búsqueda genérica en hechos", () => {
    expect(answerMemoryQuery("¿cuál es mi color favorito?", MEM, "es")).toContain("mi color favorito es el azul");
    expect(answerMemoryQuery("¿qué coche tengo?", MEM, "es")).toContain("Toyota");
    expect(answerMemoryQuery("¿dónde vivo?", MEM, "es")).toContain("Tucson");
  });

  it("resumen «¿qué sabes de mí?»", () => {
    const r = answerMemoryQuery("¿qué sabes de mí?", MEM, "es");
    expect(r).toContain("Marta");
    expect(r).toContain("Toyota");
  });

  it("sin el dato: honesto, sin inventar ni citar fuentes", () => {
    expect(answerMemoryQuery("¿cómo se llama mi papá?", MEM, "es")).toContain("Todavía no me has contado eso");
    expect(answerMemoryQuery("¿cuál es mi banco?", MEM, "es")).toContain("Todavía no me has contado eso");
  });

  it("cruce de idiomas: persona guardada en español, pregunta en inglés", () => {
    expect(answerMemoryQuery("what's my mom's name?", MEM, "en")).toBe("Your mom's name is Marta.");
  });

  it("preguntas que NO son de memoria: null (sigue el flujo normal)", () => {
    expect(answerMemoryQuery("¿cómo se llama la capital de Francia?", MEM, "es")).toBeNull();
    expect(answerMemoryQuery("¿cuál es la capital de Francia?", MEM, "es")).toBeNull();
    expect(answerMemoryQuery("¿qué hora es?", MEM, "es")).toBeNull();
    expect(answerMemoryQuery("cuéntame un chiste", MEM, "es")).toBeNull();
  });

  it("memoria vacía: honesto", () => {
    const empty: MemoryQueryData = { facts: [], people: [] };
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", empty, "es")).toContain("Todavía no me has contado eso");
    expect(answerMemoryQuery("¿qué sabes de mí?", empty, "es")).toContain("Todavía no me has contado eso");
  });
});

// Batería trilingüe 0.1.20 (directiva del usuario: probar en los TRES
// idiomas; el portugués no lo había probado en dispositivo). Huecos
// cazados: la puerta de primera persona no reconocía el «I» inglés;
// «favorito/favorite» estaban como stopwords y la búsqueda genérica se
// quedaba sin términos; «car»/«cor» (3 letras) quedaban fuera.
describe("batería trilingüe: consultas genéricas EN/PT", () => {
  const en: MemoryQueryData = {
    facts: [
      { content: "my car is a Toyota", category: "general" },
      { content: "my favorite color is blue", category: "preference" },
      { content: "I live in Tucson", category: "general" },
    ],
    people: [],
  };
  const pt: MemoryQueryData = {
    facts: [
      { content: "meu carro é um Toyota", category: "general" },
      { content: "minha cor favorita é azul", category: "preference" },
      { content: "moro em Tucson", category: "general" },
    ],
    people: [],
  };
  it("EN: coche, favorito y casa responden desde lo guardado", () => {
    expect(answerMemoryQuery("what car do I have?", en, "en")).toContain("Toyota");
    expect(answerMemoryQuery("what's my favorite color?", en, "en")).toContain("blue");
    expect(answerMemoryQuery("where do I live?", en, "en")).toContain("Tucson");
  });
  it("PT: carro, cor favorita e moradia respondem do guardado", () => {
    expect(answerMemoryQuery("qual carro eu tenho?", pt, "pt")).toContain("Toyota");
    expect(answerMemoryQuery("qual é minha cor favorita?", pt, "pt")).toContain("azul");
    expect(answerMemoryQuery("onde moro?", pt, "pt")).toContain("Tucson");
  });
  it("ES: el favorito también pasa por la búsqueda genérica", () => {
    const es: MemoryQueryData = {
      facts: [{ content: "mi color favorito es el azul", category: "preference" }],
      people: [],
    };
    expect(answerMemoryQuery("¿cuál es mi color favorito?", es, "es")).toContain("azul");
  });
});

// 0.1.23: la sonda de la puerta (ChatScreen) reutiliza la puntuación de
// la rama genérica. Una sola fuente: scoreMemoryFacts elige el hecho
// que la rama 5 cita Y alimenta memoryGateHit, para que puerta y
// respuesta nunca discrepen. Umbral aprobado: score >= 2, o score == 1
// cuando la pregunta tiene un único término de contenido.
describe("Pieza 4 (resto de ADV-M1) — la forma fusionada también pasa la puerta genérica", () => {
  const MEM_MAMA = { facts: [{ content: "Tu mamá se llama Marta.", category: "general" }], people: [] };
  it("isGenericMemoryQuestionShape des-fusiona: «¿cómo se llama mima?» es forma genérica", () => {
    expect(isGenericMemoryQuestionShape("¿Cómo se llama mima?")).toBe(true);
    expect(isGenericMemoryQuestionShape("¿Cómo se llama mi mamá?")).toBe(true);
  });
  it("memoryGateHit puntúa la pregunta des-fusionada: «mamá» es el término de contenido", () => {
    // «cómo» y «llama» son stopwords: sin des-fusionar, «mima» no casa
    // con nada (score 0); des-fusionada, «mamá» es el único término y
    // la puerta entra por su regla de término único.
    expect(memoryGateHit("¿Cómo se llama mima?", MEM_MAMA)).toBe(true);
    expect(scoreMemoryFacts(MEM_MAMA, "¿Cómo se llama mima?")).toMatchObject({ score: 1, tokenCount: 1 });
    expect(scoreMemoryFacts(MEM_MAMA, "¿Cómo se llama mi mamá?")).toMatchObject({ score: 1, tokenCount: 1 });
  });
  it("la vía principal no se mueve: la respuesta sigue citando el hecho", () => {
    expect(answerMemoryQuery("¿Cómo se llama mi mamá?", MEM_MAMA, "es")).toBe("Tu mamá se llama Marta.");
    expect(answerMemoryQuery("¿Cómo se llama mima?", MEM_MAMA, "es")).toBe("Tu mamá se llama Marta.");
  });
});

describe("0.1.23 — scoreMemoryFacts / memoryGateHit / forma genérica", () => {
  it("scoreMemoryFacts devuelve el mejor hecho, su score y el conteo de términos", () => {
    expect(scoreMemoryFacts(MEM, "¿cuál es mi color favorito?")).toEqual({
      fact: "mi color favorito es el azul",
      score: 2,
      tokenCount: 2,
    });
    expect(scoreMemoryFacts(MEM, "¿dónde vivo?")).toEqual({
      fact: "vivo en Tucson",
      score: 1,
      tokenCount: 1,
    });
    expect(scoreMemoryFacts(MEM, "¿qué coche tengo?")).toEqual({
      fact: "mi coche es un Toyota",
      score: 1,
      tokenCount: 1,
    });
  });

  it("sin coincidencia: fact null y score 0; stopwords y tokens cortos no cuentan", () => {
    const r = scoreMemoryFacts(MEM, "¿qué dice mi documento sobre la renovación?");
    expect(r.fact).toBeNull();
    expect(r.score).toBe(0);
    expect(r.tokenCount).toBe(3); // dice, documento, renovacion
    // «tengo» es stopword y «qué» también: solo queda «coche».
    expect(scoreMemoryFacts(MEM, "¿qué coche tengo?").tokenCount).toBe(1);
  });

  it("memoryGateHit: score 2 entra; score 1 con término único entra", () => {
    expect(memoryGateHit("¿cuál es mi color favorito?", MEM)).toBe(true);
    expect(memoryGateHit("¿dónde vivo?", MEM)).toBe(true);
    expect(memoryGateHit("¿qué coche tengo?", MEM)).toBe(true);
  });

  it("memoryGateHit: score 1 con varios términos NO entra (documentos/charla a salvo)", () => {
    // El hecho comparte UN término («documento») con la pregunta de la
    // guía, pero la pregunta trae 3 términos: no es hit de puerta.
    const mem: MemoryQueryData = {
      facts: [{ content: "mi documento importante es azul", category: "general" }],
      people: [],
    };
    expect(scoreMemoryFacts(mem, "¿qué dice mi documento sobre la renovación?").score).toBe(1);
    expect(memoryGateHit("¿qué dice mi documento sobre la renovación?", mem)).toBe(false);
    expect(memoryGateHit("¿qué tengo que hacer para aprender inglés?", MEM)).toBe(false);
  });

  it("memoryGateHit: score 0 o memoria vacía, no entra", () => {
    expect(memoryGateHit("¿cuál es mi color favorito?", { facts: [], people: [] })).toBe(false);
    expect(memoryGateHit("¿cuál es mi banco?", MEM)).toBe(false);
  });

  it("isGenericMemoryQuestionShape: interrogativa + primera persona (el guardia de la rama 5)", () => {
    for (const q of [
      "¿cuál es mi color favorito?",
      "¿dónde vivo?",
      "¿qué coche tengo?",
      "What's my favorite color?",
      "Where do I live?",
      "What car do I have?",
      "Qual é a minha cor favorita?",
      "Onde eu moro?",
      // La forma SÍ caza las frases de documentos y de charla: lo que
      // las rechaza es el hit, no la forma (diseño §3).
      "¿qué dice mi documento sobre la renovación?",
      "¿qué tengo que hacer para aprender inglés?",
    ]) {
      expect(isGenericMemoryQuestionShape(q)).toBe(true);
    }
    for (const q of [
      "Mi color favorito es el verde", // afirmación, no pregunta
      "¿cuál es la capital de Francia?", // pregunta sin primera persona
      "¿qué hora es?",
      "cuéntame un chiste",
      "",
    ]) {
      expect(isGenericMemoryQuestionShape(q)).toBe(false);
    }
  });
});

describe("0.1.41 — «Que sabes de mi ?» con espacio antes del signo (prueba física)", () => {
  const mem = { facts: [{ content: "Mi cumpleaños es el 3 de mayo", category: "event" }, { content: "Soy vegetariano", category: "preference" }], preferences: [], people: [], recentLog: [] } as never;
  it.each(["Que sabes de mi ?", "qué recuerdas de mí", "Cuando es mi cumpleaños ?"])("%s", (q) => {
    expect(isMemoryStyleQuery(q)).toBe(true);
    expect(answerMemoryQuery(q, mem, "es")).toBeTruthy();
  });
});

describe("ADV2-09 — el testigo de la sonda exige el dato en el hecho (batería medida de la preparación)", () => {
  const memOf = (facts: string[]): MemoryQueryData => ({
    facts: facts.map((content) => ({ content, category: "general" })),
    people: [],
  });

  it("W1–W6: el hecho nombra el tema pero no contiene el dato — no hay testigo", () => {
    // W1 (hit fuerte): el hecho habla de la clínica y del hermano, sin horario.
    expect(
      memoryProbeWitness("¿Qué horario tiene la clínica donde trabaja mi hermano?", memOf(["Mi hermano trabaja en la clínica San Rafael"])),
    ).toBe(false);
    // W2 (cobertura): el hecho del cajón dice «horario» y no contiene ninguna hora.
    expect(
      memoryProbeWitness("¿Cuál es el horario de la clínica?", memOf(["Guardo el horario de la clínica en el cajón de la cocina"])),
    ).toBe(false);
    // W3: la tarjeta nombrada sin su número.
    expect(
      memoryProbeWitness("¿Cuál es el número de la tarjeta?", memOf(["El número de la tarjeta está en el papel del cajón"])),
    ).toBe(false);
    // W4 (EN): «clinic hours» en el cajón, sin horas.
    expect(
      memoryProbeWitness("What are the opening hours of the clinic?", memOf(["I keep the clinic hours in the kitchen drawer"])),
    ).toBe(false);
    // W5 (PT): «horário» na gaveta, sem hora nenhuma.
    expect(
      memoryProbeWitness("Qual é o horário da clínica?", memOf(["Guardo o horário da clínica na gaveta da cozinha"])),
    ).toBe(false);
    // W6: la clave nombrada sin la clave.
    expect(
      memoryProbeWitness("¿Cuál es la clave del wifi?", memOf(["La clave del wifi está en un papel en la cocina"])),
    ).toBe(false);
  });

  it("G1–G3: la exención de H-06 queda donde el diseño la dejó", () => {
    // G1: sin clase de dato pedida, el testigo no cambia (fixture H-06).
    expect(
      memoryProbeWitness("¿Qué le compré a mi esposa el año pasado?", memOf(["Le compré una pulsera a mi esposa el año pasado"])),
    ).toBe(true);
    // G2: cumpleaños con la fecha (mes nombrado) en el hecho.
    expect(
      memoryProbeWitness("¿Cuándo es el cumpleaños de mi mamá?", memOf(["El cumpleaños de mi mamá es el 15 de marzo"])),
    ).toBe(true);
    // G3: la clave pedida y la clave (dígitos) en el hecho.
    expect(
      memoryProbeWitness("¿Cuál es la clave del wifi?", memOf(["La clave del wifi está apuntada en un papel: 4829"])),
    ).toBe(true);
  });

  it("el mismo hecho con el dato dentro sí gana el testigo (la instancia, por clase)", () => {
    // Hora como H:MM y como rango, en las tres lenguas de la casa.
    expect(factHasDatumInstance("La clínica atiende de 8:00 a 18:00", "time")).toBe(true);
    expect(factHasDatumInstance("The clinic is open from 9 to 5", "time")).toBe(true);
    expect(factHasDatumInstance("A clínica abre das 8 às 18", "time")).toBe(true);
    expect(factHasDatumInstance("La cita es a las 12 pm", "time")).toBe(true);
    // Número como corrida de dígitos con separadores.
    expect(factHasDatumInstance("El número de la tarjeta es 1234-5678", "number")).toBe(true);
    expect(factHasDatumInstance("El teléfono de la clínica es 520-555-0147", "number")).toBe(true);
    // Fecha como mes, como ISO y como d/m; un año suelto no es fecha.
    expect(factHasDatumInstance("Mi cumpleaños es el 3 de mayo", "date")).toBe(true);
    expect(factHasDatumInstance("La cita quedó para 2026-11-10", "date")).toBe(true);
    expect(factHasDatumInstance("La revisión es el 10/11", "date")).toBe(true);
    expect(factHasDatumInstance("Eso pasó en 2026", "date")).toBe(false);
    // La palabra de la clase nunca es la instancia.
    expect(factHasDatumInstance("Guardo el horario en el cajón", "time")).toBe(false);
    expect(factHasDatumInstance("El número está en el papel", "number")).toBe(false);
  });

  it("las clases pedidas se leen de la pregunta, cerradas y trilingües", () => {
    expect(questionDatumClasses("¿Cuál es el horario de la clínica?")).toEqual(["time"]);
    expect(questionDatumClasses("¿Cuál es el número de la tarjeta?")).toEqual(["number"]);
    expect(questionDatumClasses("¿Cuándo es el cumpleaños de mi mamá?")).toEqual(["date"]);
    expect(questionDatumClasses("What are the opening hours?")).toEqual(["time"]);
    expect(questionDatumClasses("Qual é o horário da clínica?")).toEqual(["time"]);
    expect(questionDatumClasses("¿Qué le compré a mi esposa el año pasado?")).toEqual([]);
    expect(questionDatumClasses("¿Dónde está la clave del wifi?")).toEqual(["number"]);
  });
});

describe("ADV3 — el testigo de la sonda exige TODAS las clases pedidas", () => {
  const memOf = (facts: string[]): MemoryQueryData => ({
    facts: facts.map((content) => ({ content, category: "general" })),
    people: [],
  });

  it("R1: horario + teléfono pedidos, el hecho solo trae el horario — no hay testigo", () => {
    expect(
      memoryProbeWitness("¿Cuál es el horario y el teléfono de la clínica?", memOf(["El horario de la clínica es de 9 a 18."])),
    ).toBe(false);
  });

  it("R2: fecha + número pedidos, el hecho solo trae el número — no hay testigo", () => {
    expect(
      memoryProbeWitness("¿Cuándo vence el número de socio?", memOf(["Su número de socio es el 12345."])),
    ).toBe(false);
  });

  it("R3 (en): hours + phone asked, the fact only brings the hours — no witness", () => {
    expect(
      memoryProbeWitness("What are the clinic's hours and phone number?", memOf(["The clinic is open from 9 to 5."])),
    ).toBe(false);
  });

  it("control: las dos clases en el mismo hecho (horario y teléfono) — el testigo SÍ exime", () => {
    expect(
      memoryProbeWitness(
        "¿Cuál es el horario y el teléfono de la clínica?",
        memOf(["El horario de la clínica es de 9 a 18 y su teléfono es el 520-555-0147."]),
      ),
    ).toBe(true);
  });

  it("control: las dos clases en el mismo hecho (número y fecha) — el testigo SÍ exime", () => {
    expect(
      memoryProbeWitness("¿Cuándo vence el número de socio?", memOf(["El número de socio 12345 vence el 10 de noviembre."])),
    ).toBe(true);
  });
});

// G-M1-R1 (post-0.1.69, cruce de Grok): la forma «¿cuál es el nombre
// de mi X?» no tenía patrón en español (su gemela inglesa entró en la
// 0.1.34) y la ficha de persona no puntúa en la rama genérica: con el
// nombre guardado SOLO como ficha, la respuesta era «no me lo has
// contado» teniéndolo. La cura mete la forma (y su espejo portugués)
// en REL_NAME_Q_RES: la pregunta entra en la rama 1 y la ficha se
// sirve por findPersonByRel, con la misma respuesta que da el hecho.
describe("G-M1-R1 — «¿cuál es el nombre de mi X?» entra en la ruta de nombre (es/pt)", () => {
  const CARD: MemoryQueryData = { facts: [], people: [{ name: "Ana", relationship: "mamá" }] };
  const FACT: MemoryQueryData = {
    facts: [{ content: "Mi mamá se llama Ana", category: "general" }],
    people: [],
  };

  it("la puerta reconoce la forma: isMemoryStyleQuery en es y en pt", () => {
    expect(isMemoryStyleQuery("¿cuál es el nombre de mi mamá?")).toBe(true);
    expect(isMemoryStyleQuery("qual é o nome da minha mãe?")).toBe(true);
  });

  it("con el nombre SOLO como ficha: sirve la ficha, no el «no me lo has contado»", () => {
    expect(answerMemoryQuery("¿cuál es el nombre de mi mamá?", CARD, "es")).toBe("Tu mamá se llama Ana.");
    expect(answerMemoryQuery("qual é o nome da minha mãe?", CARD, "pt")).toBe("Sua mãe se chama Ana.");
  });

  it("con el nombre como hecho: la misma respuesta que da la forma canónica", () => {
    expect(answerMemoryQuery("¿cuál es el nombre de mi mamá?", FACT, "es")).toBe("Tu mamá se llama Ana.");
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", FACT, "es")).toBe("Tu mamá se llama Ana.");
  });

  it("variantes reales: fusionada, dictada sin signos y con cortesía", () => {
    expect(answerMemoryQuery("¿cuál es el nombre de mima?", CARD, "es")).toBe("Tu mamá se llama Ana.");
    expect(answerMemoryQuery("cual es el nombre de mi mama", CARD, "es")).toBe("Tu mama se llama Ana.");
    expect(answerMemoryQuery("¿cuál es el nombre de mi mamá, por favor?", CARD, "es")).toBe("Tu mamá se llama Ana.");
  });

  it("guardias: sin el dato en ningún almacenamiento, honesto; lo que no es memoria sigue null", () => {
    const empty: MemoryQueryData = { facts: [], people: [] };
    expect(answerMemoryQuery("¿cuál es el nombre de mi mamá?", empty, "es")).toContain("Todavía no me has contado eso");
    expect(answerMemoryQuery("¿cuál es el nombre de mi papá?", CARD, "es")).toContain("Todavía no me has contado eso");
    expect(answerMemoryQuery("¿cuál es el nombre de la capital de Francia?", CARD, "es")).toBeNull();
  });
});

// B9 (barrido «revisa todo», clase 1 · ALTA): avô y avó pliegan a la
// misma forma («avo») y los dos grupos de REL_GROUPS la contienen:
// findPersonByRel devolvía el primer match y, guardado el abuelo
// antes que la abuela, «minha avó» servía el nombre del abuelo como
// si fuera la abuela. Sonda del barrido: MQ37.
describe("B9 — colisión avô/avó: la forma acentuada manda sobre el pliegue", () => {
  const BOTH: MemoryQueryData = {
    facts: [],
    people: [
      { name: "José", relationship: "avô" },
      { name: "María", relationship: "avó" },
    ],
  };

  it("preguntando por la abuela sirve a la abuela, no al abuelo guardado antes (MQ37)", () => {
    expect(answerMemoryQuery("como se chama minha avó?", BOTH, "pt")).toBe("Sua avó se chama María.");
  });

  it("preguntando por el abuelo sirve al abuelo", () => {
    const r = answerMemoryQuery("qual é o nome do meu avô?", BOTH, "pt");
    expect(r).toContain("José");
    expect(r).not.toContain("María");
  });

  it("sin abuela guardada, la pregunta por la abuela es honesta: no sirve al abuelo", () => {
    const onlyGrandpa: MemoryQueryData = { facts: [], people: [{ name: "José", relationship: "avô" }] };
    expect(answerMemoryQuery("como se chama minha avó?", onlyGrandpa, "pt")).toContain("Você ainda não me contou isso");
  });

  it("suelo: la abuela sola sirve bien (R2-18) y el español no se mueve", () => {
    const onlyGrandma: MemoryQueryData = { facts: [], people: [{ name: "María", relationship: "avó" }] };
    expect(answerMemoryQuery("como se chama minha avó?", onlyGrandma, "pt")).toBe("Sua avó se chama María.");
    const es: MemoryQueryData = { facts: [], people: [{ name: "Pedro", relationship: "abuelo" }] };
    expect(answerMemoryQuery("¿cómo se llama mi abuelo?", es, "es")).toBe("Tu abuelo se llama Pedro.");
    expect(answerMemoryQuery("¿cómo se llama mi abuela?", es, "es")).toContain("Todavía no me has contado eso");
  });
});

// B8 (barrido «revisa todo», clase 1 · MEDIA-ALTA; semilla 2 de la
// adversaria de G-M1-R1): la extracción del nombre dentro del hecho
// buscaba el literal «se llama»: quien dictó su memoria en pt («se
// chama») o en en («name is») guardó el dato y la app le decía que
// no se lo había contado, en ninguna dirección. Sondas MQ33–MQ36;
// suelo MQ31/MQ32 (el hecho es sirve a es y a en).
describe("B8 — el hecho dictado en pt o en en se sirve por la rama de nombre", () => {
  const PT_FACT: MemoryQueryData = {
    facts: [{ content: "minha mãe se chama Maria", category: "general" }],
    people: [],
  };
  const EN_FACT: MemoryQueryData = {
    facts: [{ content: "my mom's name is Ana", category: "general" }],
    people: [],
  };
  const ES_FACT: MemoryQueryData = {
    facts: [{ content: "Mi mamá se llama Ana", category: "general" }],
    people: [],
  };

  it("hecho pt, pregunta pt canónica y por la forma nueva (MQ33/MQ34)", () => {
    expect(answerMemoryQuery("como se chama minha mãe?", PT_FACT, "pt")).toBe("Sua mãe se chama Maria.");
    expect(answerMemoryQuery("qual é o nome da minha mãe?", PT_FACT, "pt")).toBe("Sua mãe se chama Maria.");
  });

  it("hecho en, pregunta en y pregunta es (MQ35/MQ36)", () => {
    expect(answerMemoryQuery("what's my mom's name?", EN_FACT, "en")).toBe("Your mom's name is Ana.");
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", EN_FACT, "es")).toBe("Tu mamá se llama Ana.");
  });

  it("hecho en con «is called»", () => {
    const called: MemoryQueryData = {
      facts: [{ content: "my uncle is called Peter", category: "general" }],
      people: [],
    };
    expect(answerMemoryQuery("what's my uncle's name?", called, "en")).toBe("Your uncle's name is Peter.");
  });

  it("suelo: el hecho es sirve a es y a en como hoy (MQ31/MQ32)", () => {
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", ES_FACT, "es")).toBe("Tu mamá se llama Ana.");
    expect(answerMemoryQuery("what's my mom's name?", ES_FACT, "en")).toBe("Your mom's name is Ana.");
  });
});

// B1+B2 (barrido «revisa todo», clase 1 · MEDIA): SELF se quedó sin
// la forma que G-M1-R1 dio a REL — «¿cuál es mi nombre?» y «what is
// my name?» (sin contraer) caían al modelo teniendo el hecho
// guardado. Sondas MQ15/MQ38/IN01 y MQ17/MQ39; suelo MQ14/MQ16 (las
// canónicas «¿cómo me llamo?» / «what's my name?»).
describe("B1+B2 — SELF: «cuál es mi nombre» es y «what is my name» en", () => {
  const ME: MemoryQueryData = {
    facts: [{ content: "Me llamo Ruben", category: "general" }],
    people: [],
  };

  it("la forma es sirve el nombre y la puerta la reconoce (MQ15/MQ38)", () => {
    expect(answerMemoryQuery("¿cuál es mi nombre?", ME, "es")).toBe("Te llamas Ruben.");
    expect(isMemoryStyleQuery("¿cuál es mi nombre?")).toBe(true);
    expect(answerMemoryQuery("cual es mi nombre", ME, "es")).toBe("Te llamas Ruben.");
  });

  it("la forma en sin contraer sirve el nombre y la puerta la reconoce (MQ17/MQ39)", () => {
    expect(answerMemoryQuery("what is my name?", ME, "en")).toBe("Your name is Ruben.");
    expect(isMemoryStyleQuery("what is my name?")).toBe(true);
  });

  it("suelo: las canónicas no se mueven y sin el dato la respuesta es la honesta", () => {
    expect(answerMemoryQuery("¿cómo me llamo?", ME, "es")).toBe("Te llamas Ruben.");
    expect(answerMemoryQuery("what's my name?", ME, "en")).toBe("Your name is Ruben.");
    const empty: MemoryQueryData = { facts: [], people: [] };
    expect(answerMemoryQuery("¿cuál es mi nombre?", empty, "es")).toContain("Todavía no me has contado eso");
    expect(answerMemoryQuery("what is my name?", empty, "en")).toContain("You haven't told me that yet");
  });
});
