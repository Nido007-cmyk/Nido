/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  detectTextLang,
  honestAbstention,
  isAbstention,
  isFactualQuestion,
  noSourcesAnswer,
  sentenceSupport,
  splitSentences,
  stripInvalidCitations,
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding";

// Texto REAL de la fuente que el RAG recuperó en la tablet (81%):
// assets/corpus/corpus.json, entrada "Photosynthesis" (Wikipedia, CC BY-SA).
const PHOTOSYNTHESIS: GroundingChunk = {
  title: "Photosynthesis",
  body:
    "Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, " +
    "such as most plants, algae and cyanobacteria, convert light energy—typically from sunlight—into the chemical " +
    "energy necessary to fuel their metabolism. The term photosynthesis usually refers to oxygenic photosynthesis, " +
    "a process that releases oxygen as a byproduct of water splitting. Photosynthetic organisms store the converted " +
    "chemical energy within the bonds of intracellular organic compounds, typically carbohydrates like sugars, " +
    "starches, phytoglycogen and cellulose. When needing to use this stored energy, an organism's cells then " +
    "metabolize the organic compounds through cellular respiration. Photosynthesis plays a critical role in " +
    "producing and maintaining the oxygen content of the Earth's atmosphere, and it supplies most of the " +
    "biological energy necessary for complex life on Earth.",
};

// Segunda fuente (77%): resumen del artículo "Chloroplast".
const CHLOROPLAST: GroundingChunk = {
  title: "Chloroplast",
  body:
    "A chloroplast is a type of organelle known as a plastid that conducts photosynthesis mostly in plant and " +
    "algal cells. Chloroplasts have a high concentration of chlorophyll pigments which capture the energy from " +
    "sunlight and convert it to chemical energy and release oxygen.",
};

const SOURCES = [PHOTOSYNTHESIS, CHLOROPLAST];

// Respuesta reconstruida de la evidencia física (Qwen2.5-0.5B, v0.1.6).
const HALLUCINATED =
  "Photosynthesis is the process by which plants convert light energy into chemical energy [1]. " +
  "Plants absorb sunlight in a process called phototropism. " +
  "The light is transported to the roots. " +
  "Water is absorbed by the leaves. " +
  "In conclusion, photosynthesis is just a small part of the broader process of photosynthesis.";

describe("verifyGroundedAnswer — evidencia de la fotosíntesis", () => {
  const r = verifyGroundedAnswer(HALLUCINATED, SOURCES, "en");

  it("quita las 4 afirmaciones inventadas y conserva la respaldada", () => {
    expect(r.status).toBe("partial");
    expect(r.removed).toBe(4);
    expect(r.kept).toBe(1);
  });

  it.each(["phototropism", "roots", "absorbed by the leaves", "broader process"])(
    "la respuesta final ya no dice %p",
    (bad) => {
      expect(r.text).not.toContain(bad);
    },
  );

  it("conserva lo que sí dice la fuente, con su cita, y avisa de lo quitado", () => {
    expect(r.text).toContain("convert light energy into chemical energy [1]");
    expect(r.text).toContain("I removed 4 sentence(s) that the offline sources don't support.");
  });

  it("cada frase inventada, por separado, no tiene respaldo suficiente", () => {
    // Una respuesta de una sola frase inventada → abstención honesta.
    for (const s of [
      "Plants absorb sunlight in a process called phototropism.",
      "The light is transported to the roots.",
      "Water is absorbed by the leaves.",
    ]) {
      expect(verifyGroundedAnswer(s, SOURCES, "en").status).toBe("abstained");
    }
  });
});

describe("verifyGroundedAnswer — paráfrasis fieles NO se castigan", () => {
  it.each([
    "Photosynthesis converts light energy into chemical energy.",
    "It releases oxygen as a byproduct of water splitting.",
    "Plants, algae and cyanobacteria use photosynthesis to convert sunlight into chemical energy.",
    "Chloroplasts contain chlorophyll pigments that capture energy from sunlight.",
    "The stored energy is used later through cellular respiration.",
  ])("%p → grounded", (sentence) => {
    const r = verifyGroundedAnswer(sentence, SOURCES, "en");
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
  });

  it("añade la cita de la fuente que respalda cada frase (enlace afirmación → fuente)", () => {
    const r = verifyGroundedAnswer(
      "Photosynthesis releases oxygen as a byproduct. Chloroplasts have a high concentration of chlorophyll pigments.",
      SOURCES,
      "en",
    );
    expect(r.text).toBe(
      "Photosynthesis releases oxygen as a byproduct [1]. Chloroplasts have a high concentration of chlorophyll pigments [2].",
    );
  });

  it("frases cortas sin contenido juzgable se dejan tal cual", () => {
    const r = verifyGroundedAnswer("Sure! Photosynthesis converts light energy into chemical energy [1].", SOURCES, "en");
    expect(r.status).toBe("grounded");
    expect(r.text.startsWith("Sure!")).toBe(true);
  });
});

describe("verifyGroundedAnswer — adversarial: las fuentes NO tienen la respuesta", () => {
  it("respuesta de memoria sobre otro tema → 'no lo sé' + extracto literal citado", () => {
    const r = verifyGroundedAnswer("France won the 2018 World Cup in Russia.", [PHOTOSYNTHESIS], "es");
    expect(r.status).toBe("abstained");
    expect(r.text).toContain("No lo sé con certeza");
    expect(r.text).not.toContain("France");
    expect(r.text).toContain("Esto es lo que sí dice la fuente «Photosynthesis»:");
    expect(r.text).toContain("Photosynthesis is a system of biological processes");
    expect(r.text).toMatch(/\[1\]$/);
  });

  it("el modelo dice no saber → abstención honesta (en / pt)", () => {
    const en = verifyGroundedAnswer("The sources don't mention who won the World Cup.", [PHOTOSYNTHESIS], "en");
    expect(en.status).toBe("abstained");
    expect(en.text.startsWith("I don't know for sure")).toBe(true);
    const pt = verifyGroundedAnswer("Não sei.", [PHOTOSYNTHESIS], "pt");
    expect(pt.status).toBe("abstained");
    expect(pt.text.startsWith("Não sei com certeza")).toBe(true);
  });

  it("'no lo sé' + invento detrás → se descarta el invento", () => {
    const r = verifyGroundedAnswer("I don't know. But France won the 2018 World Cup in Russia.", [PHOTOSYNTHESIS], "en");
    expect(r.status).toBe("abstained");
    expect(r.text).not.toContain("France");
  });

  it("todas las frases inventadas → abstención, nunca respuesta vacía", () => {
    const r = verifyGroundedAnswer(
      "The light is transported to the roots. Water is absorbed by the leaves.",
      SOURCES,
      "en",
    );
    expect(r.status).toBe("abstained");
    expect(r.text.length).toBeGreaterThan(0);
  });
});

describe("verifyGroundedAnswer — idioma distinto al de las fuentes", () => {
  it("respuesta en español con fuentes en inglés: no se inventa un veredicto léxico", () => {
    const r = verifyGroundedAnswer(
      "La fotosíntesis convierte la energía de la luz en energía química y libera oxígeno [1].",
      SOURCES,
      "es",
    );
    expect(r.status).toBe("unverified");
    expect(r.text).toContain("libera oxígeno [1]");
  });

  it("…pero una cifra que no está en las fuentes sí se detecta (las cifras no tienen idioma)", () => {
    const r = verifyGroundedAnswer(
      "La fotosíntesis convierte la luz en energía química [1]. Apareció hace 3500 millones de años en los océanos.",
      SOURCES,
      "es",
    );
    expect(r.status).toBe("unverified");
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain("3500");
    expect(r.text).toContain("Quité 1 frase(s)");
  });
});

describe("verifyGroundedAnswer — casos límite", () => {
  it("sin fuentes o respuesta vacía → skipped", () => {
    expect(verifyGroundedAnswer("Hola", [], "es").status).toBe("skipped");
    expect(verifyGroundedAnswer("   ", SOURCES, "es").status).toBe("skipped");
  });
  it("modelos razonadores (<think>) no se tocan", () => {
    const text = "<think>hmm</think>Photosynthesis is magic.";
    expect(verifyGroundedAnswer(text, SOURCES, "en")).toMatchObject({ status: "skipped", text });
  });
  it("quita citas a fuentes que no existen", () => {
    expect(stripInvalidCitations("A [1]. B [7]. C [0]. D [2].", 2)).toBe("A [1]. B. C. D [2].");
  });
});

describe("piezas internas", () => {
  it("splitSentences respeta citas y abreviaturas numéricas", () => {
    expect(splitSentences("Uno [1]. Dos. ¿Tres? 4 cuatro.")).toEqual(["Uno [1].", "Dos.", "¿Tres?", "4 cuatro."]);
  });
  it("detectTextLang distingue en / es / pt y no adivina con poco texto", () => {
    expect(detectTextLang("The term photosynthesis usually refers to the process that is used by plants")).toBe("en");
    expect(detectTextLang("La fotosíntesis es el proceso que usan las plantas para obtener energía")).toBe("es");
    expect(detectTextLang("A fotossíntese é o processo que as plantas usam para obter energia não")).toBe("pt");
    expect(detectTextLang("Hola")).toBeNull();
  });
  it("isAbstention reconoce el 'no lo sé' en los 3 idiomas", () => {
    for (const s of [
      "No lo sé.",
      "Las fuentes no mencionan eso.",
      "I don't know.",
      "The context does not mention it.",
      "Não sei.",
      "As fontes não falam disso.",
    ]) {
      expect(isAbstention(s)).toBe(true);
    }
    expect(isAbstention("Photosynthesis converts light.")).toBe(false);
  });
  it("sentenceSupport mide la fracción respaldada", () => {
    const sets = [new Set(["photosy", "light", "energy"])];
    const s = sentenceSupport("Photosynthesis uses light energy and magic dust.", sets);
    expect(s.total).toBe(5);
    expect(s.novel).toBe(2);
    expect(s.bestChunk).toBe(0);
  });
});

describe("isFactualQuestion / noSourcesAnswer (el 'no lo sé' antes de generar)", () => {
  it.each([
    "¿Qué es la fotosíntesis?",
    "quién fue Simón Bolívar",
    "¿Cuántos huesos tiene el cuerpo humano?",
    "What is photosynthesis?",
    "Who invented the telephone?",
    "how many moons does Mars have",
    "O que é fotossíntese?",
    "Quem descobriu o Brasil?",
  ])("%p es de hechos", (q) => {
    expect(isFactualQuestion(q)).toBe(true);
  });

  it.each([
    "escribe un poema sobre el mar",
    "write a short story about a cat",
    "what is your opinion on pizza",
    "cuéntame un chiste",
    "hola",
    "traduce 'gato' al inglés",
    "resume este texto",
  ])("%p NO es de hechos (el modelo puede contestar)", (q) => {
    expect(isFactualQuestion(q)).toBe(false);
  });

  it("R-06-P3: «qué día» y «qué fecha» SÍ son preguntas de hechos (la cita de la ronda)", () => {
    // Ejecutado en el diagnóstico R-06: antes de esta forma, la pregunta
    // exacta de la ronda daba false y ni el «no lo sé» habría disparado.
    expect(isFactualQuestion("¿Qué día y a qué hora es la cita?")).toBe(true);
    expect(isFactualQuestion("¿Qué día es hoy?")).toBe(true);
    expect(isFactualQuestion("¿Qué fecha es la cita?")).toBe(true);
    // Una orden con «día» no se vuelve pregunta de hechos por la forma nueva.
    expect(isFactualQuestion("pon la cita el martes")).toBe(false);
    expect(isFactualQuestion("apunta el día de la cita en el calendario")).toBe(false);
  });

  it("respuesta honesta sin fuentes en los 3 idiomas", () => {
    expect(noSourcesAnswer("es")).toContain("prefiero no inventar");
    expect(noSourcesAnswer("en")).toContain("rather not make up");
    expect(noSourcesAnswer("pt")).toContain("prefiro não inventar");
  });
});

// ---------------------------------------------------------------
// Programa bounty, tanda 1: post-chequeo de cifras (evidenceNumbers).
// Una cifra inventada tumba la frase aunque sus palabras estén
// apoyadas; el redondeo honesto (26,5 por 26,52; 16,4 millones por
// 16.431.599) no se toca, en la misma lengua y entre lenguas.

const CITY_ES: GroundingChunk = {
  title: "San Aurelio",
  body:
    "San Aurelio se fundó en 1804 junto al río Claro. El censo contó 16.431.599 habitantes: " +
    "más de 16 millones de personas en el área metropolitana. La dosis habitual del jarabe " +
    "es 26,52 miligramos por toma.",
};

const CITY_EN: GroundingChunk = {
  title: "San Aurelio",
  body:
    "San Aurelio was founded in 1804 by the Claro river. The census counted 16,431,599 " +
    "inhabitants in the metropolitan area. The usual dose of the syrup is 26.52 milligrams.",
};

// ---------------------------------------------------------------
// Ronda física 0.1.68, R-04: el documento REAL de la ronda (Clínica
// San Rafael; el mismo texto en es/en/pt — la fuente está en
// ~/workspace/your_files/prueba-ocr-0168/) entra como UN solo chunk.
// La recuperación fue correcta; el modelo copió el bloque portugués
// y el verificador lo sirvió sellado: su noción de idioma era por
// chunk y el estado «sin verificar» no tenía consecuencia.

const DOC_ES =
  "Su cita es el martes 10 de noviembre de 2026 a las 9:30 de la mañana, en la sala 214, segundo piso. " +
  "Traiga su tarjeta y la lista de medicamentos. " +
  "Tome el jarabe de 5 ml dos veces al día, después de comer. " +
  "Para cambiar la cita llame al 520-555-0147.";
const DOC_EN =
  "Your appointment is on Tuesday, November 10, 2026 at 9:30 in the morning, in room 214, second floor. " +
  "Bring your card and your medication list. " +
  "Take 5 ml of the syrup twice a day, after meals. " +
  "To change the appointment call 520-555-0147.";
const DOC_PT =
  "A sua consulta é na terça-feira, 10 de novembro de 2026 às 9:30 da manhã, na sala 214, segundo andar. " +
  "Traga o seu cartão e a lista de medicamentos. " +
  "Tome 5 ml do xarope duas vezes ao dia, depois das refeições. " +
  "Para mudar a consulta ligue para 520-555-0147.";

const DOC_TRILINGUE: GroundingChunk = {
  title: "documento-prueba-ocr",
  body: `CLÍNICA SAN RAFAEL. ESPAÑOL — Recordatorio de cita. ${DOC_ES} ENGLISH — Appointment reminder. ${DOC_EN} PORTUGUÊS — Lembrete de consulta. ${DOC_PT}`,
};

const PT_JARABE = "Tome 5 ml do xarope duas vezes ao dia, depois das refeições.";
const ES_JARABE = "Tome el jarabe de 5 ml dos veces al día, después de comer.";

describe("R-04 — idioma por frase (el documento trilingüe de la ronda)", () => {
  it("copia literal portuguesa, pregunta en español ⇒ sale la gemela española, verbatim y citada", () => {
    const r = verifyGroundedAnswer(PT_JARABE, [DOC_TRILINGUE], "es");
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
    expect(r.text).toBe("Tome el jarabe de 5 ml dos veces al día, después de comer [1].");
    expect(r.sentences?.[0].origin.kind).toBe("source");
  });

  it("el híbrido REAL del aparato («dos veces» en español dentro de la frase portuguesa) también se sustituye", () => {
    // La respuesta exacta de la tablet: «Tome 5 ml dos veces ao dia,
    // depois das refeições» — ni siquiera es la frase portuguesa pura.
    const r = verifyGroundedAnswer("Tome 5 ml dos veces ao dia, depois das refeições.", [DOC_TRILINGUE], "es");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("Tome el jarabe de 5 ml dos veces al día, después de comer [1].");
    expect(r.text).not.toContain("refeições");
  });

  it("simétrico: copia española con pregunta en portugués ⇒ sale la gemela portuguesa (no se «corrige» hacia el español)", () => {
    const r = verifyGroundedAnswer(ES_JARABE, [DOC_TRILINGUE], "pt");
    expect(r.status).toBe("grounded");
    expect(r.text).toBe("Tome 5 ml do xarope duas vezes ao dia, depois das refeições [1].");
  });

  it("sin gemela en el idioma de la pregunta ⇒ la copia se retira y manda la abstención honesta", () => {
    const sinEs: GroundingChunk = {
      title: "documento-prueba-ocr",
      body: `ENGLISH — Appointment reminder. ${DOC_EN} PORTUGUÊS — Lembrete de consulta. ${DOC_PT}`,
    };
    const r = verifyGroundedAnswer(PT_JARABE, [sinEs], "es");
    expect(r.status).toBe("abstained");
    expect(r.text).not.toContain("xarope");
    expect(r.text).toContain("No lo sé con certeza");
  });

  it("la respuesta española correcta sobre el chunk mixto queda intacta (sin regresión)", () => {
    const r = verifyGroundedAnswer(ES_JARABE, [DOC_TRILINGUE], "es");
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
    expect(r.text).toBe("Tome el jarabe de 5 ml dos veces al día, después de comer [1].");
  });

  it("rama de lengua cruzada: la copia que vive en las fuentes se retira (sin gemela) o se sustituye (con gemela)", () => {
    // Fuentes con veredicto claro en inglés (la fotosíntesis) + la frase
    // portuguesa como chunk propio: la respuesta en portugués cae en la
    // rama cruzada y la copia SÍ se puede juzgar ahí.
    const ptChunk: GroundingChunk = { title: "documento-prueba-ocr", body: PT_JARABE };
    const sinGemela = verifyGroundedAnswer(PT_JARABE, [PHOTOSYNTHESIS, ptChunk], "es");
    expect(sinGemela.status).toBe("abstained");
    expect(sinGemela.text).not.toContain("xarope");

    const esChunk: GroundingChunk = { title: "documento-prueba-ocr", body: ES_JARABE };
    const conGemela = verifyGroundedAnswer(PT_JARABE, [PHOTOSYNTHESIS, ptChunk, esChunk], "es");
    expect(conGemela.status).toBe("grounded");
    expect(conGemela.text).toBe("Tome el jarabe de 5 ml dos veces al día, después de comer [3].");
  });

  it("el extracto de la abstención prefiere las frases del idioma de la pregunta", () => {
    const ptPrimero: GroundingChunk = {
      title: "documento-prueba-ocr",
      body: `PORTUGUÊS — Lembrete de consulta. ${DOC_PT} ESPAÑOL — Recordatorio de cita. ${DOC_ES}`,
    };
    const es = honestAbstention([ptPrimero], "es");
    expect(es).toContain("Su cita es el martes 10 de noviembre de 2026");
    expect(es).not.toContain("terça-feira");
    const pt = honestAbstention([ptPrimero], "pt");
    expect(pt).toContain("A sua consulta é na terça-feira");
  });
});

// ---------------------------------------------------------------
// Ronda física 0.1.68, R-05: la pregunta del teléfono contra el
// documento de la ronda. En la sesión real la recuperación mezcló el
// documento con la guía de crisis (de ahí salían «teléfono»,
// «número» y «emergencia» para que el apoyo por unión aprobara la
// frase falsa); la fixture reproduce esa mezcla.

const CRISIS: GroundingChunk = {
  title: "Línea de crisis",
  body:
    "Si estás en crisis, llama al teléfono de ayuda de la línea de crisis. " +
    "El número de emergencia en México es 911. " +
    "También puedes llamar a la línea de crisis y prevención del suicidio al 988.",
};

const FALSE_TELEFONO = "El teléfono para cambiar la cita es el número de emergencia.";
const PREGUNTA_TELEFONO = "¿Qué teléfono aparece para cambiar la cita?";

describe("R-05 — la regla del dato pedido (el teléfono de la ronda)", () => {
  it("la falsedad sin cifras se sustituye por la frase fuente que trae el número", () => {
    const r = verifyGroundedAnswer(FALSE_TELEFONO, [DOC_TRILINGUE, CRISIS], "es", PREGUNTA_TELEFONO);
    expect(r.text).toContain("520-555-0147");
    expect(r.text).not.toContain("número de emergencia");
    expect(r.status).toBe("grounded");
    expect(r.sentences?.[0].origin.kind).toBe("source");
  });

  it("regresión: la respuesta que SÍ da el número queda intacta (y no se sustituye por la gemela portuguesa)", () => {
    const r = verifyGroundedAnswer(
      "El teléfono para cambiar la cita es el 520-555-0147.",
      [DOC_TRILINGUE, CRISIS],
      "es",
      PREGUNTA_TELEFONO,
    );
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
    expect(r.text).toContain("El teléfono para cambiar la cita es el 520-555-0147");
    expect(r.text).not.toContain("ligue");
  });

  it("la respuesta sin dato ni afirmación («Traiga su tarjeta…») queda intacta", () => {
    const r = verifyGroundedAnswer(
      "Traiga su tarjeta y la lista de medicamentos.",
      [DOC_TRILINGUE, CRISIS],
      "es",
      PREGUNTA_TELEFONO,
    );
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
    expect(r.text).toContain("Traiga su tarjeta y la lista de medicamentos");
  });

  it("sin cifra temática en la evidencia, la regla NO actúa (la doble condición es su seguro)", () => {
    // La evidencia da el vocabulario para que la frase pase el apoyo,
    // pero no trae cifra alguna: afirmar sin dar no se puede corregir
    // con una frase fuente que no existe, y la regla se queda quieta.
    const sinCifras: GroundingChunk = {
      title: "Clínica San Rafael",
      body:
        "Para cambiar la cita, el teléfono de la clínica atiende de lunes a viernes. " +
        "El número de emergencia interno se marca en recepción.",
    };
    const r = verifyGroundedAnswer(FALSE_TELEFONO, [sinCifras], "es", PREGUNTA_TELEFONO);
    expect(r.text).toContain("número de emergencia");
  });

  it("sin pregunta (llamadas antiguas de 3 argumentos), la regla tampoco actúa", () => {
    const r = verifyGroundedAnswer(FALSE_TELEFONO, [DOC_TRILINGUE, CRISIS], "es");
    expect(r.text).toContain("número de emergencia");
  });

  it("rama de lengua cruzada: con fuentes solo en inglés, la frase falsa se sustituye por la que trae el número", () => {
    const soloEn: GroundingChunk = { title: "documento-prueba-ocr", body: DOC_EN };
    const r = verifyGroundedAnswer(FALSE_TELEFONO, [soloEn], "es", PREGUNTA_TELEFONO);
    expect(r.text).toContain("520-555-0147");
    expect(r.text).not.toContain("número de emergencia");
    expect(r.status).toBe("grounded");
  });
});

// ---------------------------------------------------------------
// Revisión adversaria de la cadena, H-02: la cura de R-05 podía
// entregar EL DATO EQUIVOCADO con sello «grounded». La bonificación
// de forma telefónica (+3) se activaba ante cualquier pregunta con
// «número», y a «¿Cuál es el número de la tarjeta?» la sustitución
// trajo el teléfono de la clínica como si fuera el de la tarjeta.
// La sonda de la adversaria, como fixture permanente: el dato
// pedido y el dato entregado han de ser el mismo tipo de dato.

const DOC_TARJETA: GroundingChunk = {
  title: "documento-prueba-ocr",
  body:
    "Tarjeta del paciente. El número de la tarjeta se consulta en recepción. " +
    "La línea de atención atiende de lunes a viernes. " +
    "Termina en 4417, como se lee en el reverso. " +
    "Para cambiar la cita llame al 520-555-0147. " +
    "El número de emergencia es el 911.",
};

const DOC_TARJETA_EN: GroundingChunk = {
  title: "documento-prueba-ocr",
  body:
    "Patient card. The card number can be checked at reception. " +
    "The helpline is open Monday to Friday. " +
    "It ends in 4417, as printed on the back. " +
    "To change the appointment call 520-555-0147. " +
    "The emergency number is 911.",
};

const DOC_TARJETA_PT: GroundingChunk = {
  title: "documento-prueba-ocr",
  body:
    "Cartão do paciente. O número do cartão consulta-se na receção. " +
    "A linha de atendimento funciona de segunda a sexta. " +
    "Termina em 4417, como se lê no verso. " +
    "Para mudar a consulta ligue para 520-555-0147. " +
    "O número de emergência é o 911.",
};

describe("Adversaria H-02 — el dato entregado es el dato pedido, o no hay sustitución", () => {
  it("la sonda de la adversaria: «¿Cuál es el número de la tarjeta?» NO recibe el teléfono de la clínica", () => {
    const r = verifyGroundedAnswer(
      "El número de la tarjeta es el número de la línea.",
      [DOC_TARJETA],
      "es",
      "¿Cuál es el número de la tarjeta?",
    );
    expect(r.text).not.toContain("520-555-0147");
    expect(r.text).not.toContain("Para cambiar la cita llame");
    expect(r.sentences?.some((s) => s.origin.kind === "source" && s.text.includes("520-555-0147"))).toBe(false);
  });

  it("gemela en inglés: «What is the card number?» tampoco recibe el teléfono", () => {
    const r = verifyGroundedAnswer(
      "The card number is the helpline number.",
      [DOC_TARJETA_EN],
      "en",
      "What is the card number?",
    );
    expect(r.text).not.toContain("520-555-0147");
    expect(r.text).not.toContain("To change the appointment call");
  });

  it("gemela en portugués: «Qual é o número do cartão?» tampoco recibe el teléfono", () => {
    const r = verifyGroundedAnswer(
      "O número do cartão é o número da linha.",
      [DOC_TARJETA_PT],
      "pt",
      "Qual é o número do cartão?",
    );
    expect(r.text).not.toContain("520-555-0147");
    expect(r.text).not.toContain("Para mudar a consulta ligue");
  });

  it("la señal genérica SÍ desbloquea el dato que comparte el tema sustantivo (el número de emergencias)", () => {
    const emergencias: GroundingChunk = {
      title: "Línea de ayuda",
      body: "El número de emergencia en México es 911. La línea de ayuda atiende siempre.",
    };
    const r = verifyGroundedAnswer(
      "El número de emergencias es el número de la línea.",
      [emergencias],
      "es",
      "¿Cuál es el número de emergencias?",
    );
    expect(r.text).toContain("911");
    expect(r.text).not.toContain("número de la línea");
    expect(r.status).toBe("grounded");
  });

  it("la señal telefónica específica sigue sustituyendo en inglés (pregunta de teléfono de verdad)", () => {
    // Como en la sesión de la ronda, la recuperación mezcla el
    // documento con la guía de crisis: de ahí sale el vocabulario
    // (phone/number/emergency) que sostiene la frase falsa.
    const crisisEn: GroundingChunk = {
      title: "Crisis line",
      body:
        "If you are in crisis, call the helpline phone. " +
        "The emergency number in Mexico is 911. " +
        "You can also call the crisis and suicide prevention line at 988.",
    };
    const soloEn: GroundingChunk = { title: "documento-prueba-ocr", body: DOC_EN };
    const r = verifyGroundedAnswer(
      "The phone number to change the appointment is the emergency number.",
      [soloEn, crisisEn],
      "en",
      "What is the phone number to change the appointment?",
    );
    expect(r.text).toContain("520-555-0147");
    expect(r.text).not.toContain("emergency number");
    expect(r.status).toBe("grounded");
  });

  it("la señal telefónica específica sigue sustituyendo en portugués", () => {
    // La cópula presente portuguesa («é») se pliega a «e» y queda
    // fuera de DATUM_COPULA_RE a propósito (es la conjunción); la
    // gemela usa «foi», la cópula que la RE sí cubre.
    const crisisPt: GroundingChunk = {
      title: "Linha de crise",
      body:
        "Se estiver em crise, ligue para o telefone de ajuda da linha de crise. " +
        "O número de emergência no México é 911. " +
        "Também pode ligar para a linha de crise e prevenção do suicídio no 988.",
    };
    const soloPt: GroundingChunk = { title: "documento-prueba-ocr", body: DOC_PT };
    const r = verifyGroundedAnswer(
      "O telefone para mudar a consulta foi o número de emergência.",
      [soloPt, crisisPt],
      "pt",
      "Qual é o telefone para mudar a consulta?",
    );
    expect(r.text).toContain("520-555-0147");
    expect(r.text).not.toContain("número de emergência");
    expect(r.status).toBe("grounded");
  });
});

describe("verifyGroundedAnswer — post-chequeo de cifras (bounty, tanda 1)", () => {
  it("un año inventado tumba la frase aunque el apoyo léxico la pasaba", () => {
    const r = verifyGroundedAnswer("San Aurelio se fundó en 1904 junto al río Claro.", [CITY_ES], "es");
    expect(r.text).not.toContain("1904");
    expect(r.removed).toBe(1);
    // Era la única frase juzgable: queda la abstención honesta.
    expect(r.status).toBe("abstained");
  });

  it("un recuento inventado también cae", () => {
    const r = verifyGroundedAnswer(
      "San Aurelio se fundó en 1804 junto al río Claro. El censo contó 20 millones de habitantes en el área metropolitana.",
      [CITY_ES],
      "es",
    );
    expect(r.status).toBe("partial");
    expect(r.removed).toBe(1);
    expect(r.text).toContain("1804");
    expect(r.text).not.toContain("20 millones");
  });

  it("el redondeo honesto y la escala se conservan", () => {
    const r = verifyGroundedAnswer(
      "La dosis habitual del jarabe es 26,5 miligramos por toma. El censo contó 16,4 millones de habitantes en el área metropolitana.",
      [CITY_ES],
      "es",
    );
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
    expect(r.text).toContain("26,5");
    expect(r.text).toContain("16,4 millones");
  });

  it("entre lenguas: «16,4 millones» ya no cae contra «16,431,599» (falso positivo retirado)", () => {
    const r = verifyGroundedAnswer(
      "San Aurelio se fundó en 1804 junto al río Claro. El censo contó 16,4 millones de habitantes en el área metropolitana.",
      [CITY_EN],
      "es",
    );
    expect(r.status).toBe("unverified");
    expect(r.removed).toBe(0);
    expect(r.text).toContain("16,4 millones");
  });

  it("entre lenguas: la cifra inventada sigue cayendo", () => {
    const r = verifyGroundedAnswer(
      "San Aurelio se fundó en 1804 junto al río Claro. El censo contó 20 millones de habitantes en el área metropolitana.",
      [CITY_EN],
      "es",
    );
    expect(r.status).toBe("unverified");
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain("20 millones");
  });
});
