/**
 * Tanda T-05 de la 0.1.99 — juez: cantidades, unidades, fechas en
 * letra y residuo. Regresión de las sondas del acta del carril 02 de
 * la auditoría (H-03…H-05, H-07…H-11 → asientos M-03, M-04, M-05,
 * m-04…m-08 del acta consolidada) y de los casos cerrables del
 * residuo 0197 medidos en esta tanda, con sus controles fieles: el
 * freno del dueño manda que ninguna estrechez nueva corte una
 * respuesta fiel.
 */
import { describe, expect, it } from "vitest";
import {
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding";
import {
  quantitiesOf,
  quantityConflict,
  evidenceQuantities,
  evidenceNumberValues,
  sentenceWordReadings,
} from "./evidenceNumbers";
import { parseDateMentions } from "./dates";
import { fuseRetrievalResults } from "./pure";
import type { RetrievedChunk } from "./retrieve.types";

const REF = new Date(2026, 10, 14); // 14 de noviembre de 2026, como las sondas
const J = (answer: string, chunks: GroundingChunk[], lang: "es" | "en" | "pt", query = "") =>
  verifyGroundedAnswer(answer, chunks, lang, query, REF);
const G = (title: string, body: string): GroundingChunk => ({ title, body });

// ---------------------------------------------------------------- M-03

describe("T-05 · M-03 el cambio de unidad con la misma cifra", () => {
  const DISYUNTOR = [
    G(
      "Disyuntor y cuadro eléctrico",
      "Si salta el disyuntor, desconecta los aparatos de la zona y baja todas las palancas del cuadro. La tensión habitual de la vivienda es de 230 voltios. La instalación se revisa cada 24 meses por un técnico. Sube primero la palanca principal y después cada circuito, uno a uno. Nunca toques el cuadro eléctrico con las manos mojadas. Esta guía fue revisada el 9 de diciembre de 2023.",
    ),
  ];
  it("matriz-a-524: «230 vatios» por «230 voltios» no se sella (el valor bajo otra dimensión es trasplante, no rescate)", () => {
    const r = J("La tensión habitual de la vivienda es de 230 vatios.", DISYUNTOR, "es", "¿Qué hago si salta el disyuntor de mi casa?");
    expect(r.text).not.toContain("230 vatios");
  });
  it("control fiel: «230 voltios» se conserva", () => {
    const r = J("La tensión habitual de la vivienda es de 230 voltios.", DISYUNTOR, "es", "¿Qué hago si salta el disyuntor de mi casa?");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("230 voltios");
  });
  it("V-02: sin pregunta (query vacía explícita) la pierna de cantidades juzga igual", () => {
    const r = J("La tensión habitual de la vivienda es de 230 vatios.", DISYUNTOR, "es", "");
    expect(r.text).not.toContain("230 vatios");
  });
  it("matriz-a-477 (cond d): «25 minutos» lavado de «25 metres» no se conserva ni en la rama débil", () => {
    const fuentes = [
      G("Smell of gas at home", "If you smell gas at home, do not light matches or switches. Open doors and windows and leave with everyone in the house. Stay 25 metres from the house while you wait for help. Call 112 once you are outside; the gas company phone number is 800-555-0186. This guide was reviewed on September 22, 2023."),
      G("Market towns", "The market town holds its fair 25 days after the harvest each year, with stalls filling the old square."),
    ];
    const r = J("Espere 25 minutos dentro de casa antes de ligar para o 112.", fuentes, "pt", "O que devo fazer se sentir cheiro a gás em casa?");
    expect(r.text).not.toContain("Espere 25 minutos dentro de casa");
  });
  it("P-07 de la auditoría: «50 pesos» contra fuente en dólares no se sella, y «50 dólares» ya parsea", () => {
    const src = [G("Repuesto", "El repuesto cuesta 50 dólares en la tienda.")];
    const r = J("El repuesto cuesta 50 pesos en la tienda.", src, "es", "¿Cuánto cuesta el repuesto?");
    expect(r.text).not.toContain("50 pesos");
    const fiel = J("El repuesto cuesta 50 dólares en la tienda.", src, "es", "¿Cuánto cuesta el repuesto?");
    expect(fiel.status).toBe("grounded");
    expect(fiel.text).toContain("50 dólares");
  });
  it("a nivel de función: los plurales en -es y el portugués de la tabla parsean", () => {
    expect(quantitiesOf("cuesta 50 dólares")).toEqual([
      expect.objectContaining({ dim: "dinero:usd", canon: 50 }),
    ]);
    expect(quantitiesOf("cuesta 50 reales")).toEqual([
      expect.objectContaining({ dim: "dinero:brl", canon: 50 }),
    ]);
    expect(quantitiesOf("cuesta 50 euros")).toEqual([
      expect.objectContaining({ dim: "dinero:eur", canon: 50 }),
    ]);
  });
  it("matriz-b-113: «duzentos miligramas» contra «20 miligramas» se corta (miligrama/grama en la tabla)", () => {
    const src = [
      G("Chocolate e cães", "Nunca dê chocolate ao seu cão: o chocolate é tóxico para os cães. A dose tóxica começa nos 20 miligramas de teobromina por quilo de peso do cão."),
    ];
    const r = J("A dose tóxica começa nos duzentos miligramas de teobromina por quilo de peso do cão.", src, "pt", "O chocolate faz mal ao meu cão?");
    expect(r.text).not.toContain("duzentos miligramas");
    expect(quantitiesOf("20 miligramas")).toEqual([expect.objectContaining({ dim: "masa", canon: 20 })]);
    expect(quantitiesOf("duzentos miligramas")).toEqual([expect.objectContaining({ dim: "masa", canon: 200 })]);
  });
});

// ---------------------------------------------------------------- M-04

describe("T-05 · M-04 la fecha con el día en letra", () => {
  it("P-03: «el diez de abril» contra «el 10 de mayo» se corta", () => {
    const src = [G("Revisión", "La revisión del coche es el 10 de mayo.")];
    const r = J("La revisión del coche es el diez de abril.", src, "es", "¿Cuándo es la revisión del coche?");
    expect(r.text).not.toContain("diez de abril");
  });
  it("gemela pt: «o dez de abril» contra «o 10 de maio» se corta", () => {
    const src = [G("Revisão", "A revisão do carro é o 10 de maio.")];
    const r = J("A revisão do carro é o dez de abril.", src, "pt", "Quando é a revisão do carro?");
    expect(r.text).not.toContain("dez de abril");
  });
  it("control fiel es: «el diez de mayo» contra «el 10 de mayo» se conserva", () => {
    const src = [G("Revisión", "La revisión del coche es el 10 de mayo.")];
    const r = J("La revisión del coche es el diez de mayo.", src, "es", "¿Cuándo es la revisión del coche?");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("diez de mayo");
  });
  it("control fiel pt: «o primeiro de abril» contra «o 1 de abril» se conserva", () => {
    const src = [G("Revisão", "A revisão do carro é o 1 de abril.")];
    const r = J("A revisão do carro é o primeiro de abril.", src, "pt", "Quando é a revisão do carro?");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("primeiro de abril");
  });
  it("a nivel de función: las menciones con día en letra nacen en es/en/pt", () => {
    const es = parseDateMentions("La revisión del coche es el diez de abril.", REF);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ dom: 10, month: 4, kind: "calendario" });
    const en1 = parseDateMentions("The inspection is on the tenth of April.", REF);
    expect(en1).toHaveLength(1);
    expect(en1[0]).toMatchObject({ dom: 10, month: 4 });
    const en2 = parseDateMentions("The inspection is on April tenth.", REF);
    expect(en2).toHaveLength(1);
    expect(en2[0]).toMatchObject({ dom: 10, month: 4 });
    const pt = parseDateMentions("A revisão é o trinta e um de maio.", REF);
    expect(pt).toHaveLength(1);
    expect(pt[0]).toMatchObject({ dom: 31, month: 5 });
    const compuesto = parseDateMentions("La cita es el treinta y uno de mayo.", REF);
    expect(compuesto).toHaveLength(1);
    expect(compuesto[0]).toMatchObject({ dom: 31, month: 5 });
  });
});

// ---------------------------------------------------------------- M-05

describe("T-05 · M-05 la frecuencia fuera del marco diario", () => {
  const JARABE = [
    G("Jarabe para la tos", "Tome 5 ml dos veces al día. No dupliques la dosis. Si la tos sigue, consulta al médico."),
  ];
  it("P-09: «dos veces por semana» contra «dos veces al día» se corta", () => {
    const r = J("Tome 5 ml dos veces por semana.", JARABE, "es", "¿Cómo se toma el jarabe?");
    expect(r.text).not.toContain("por semana");
  });
  it("gemela pt: «duas vezes por semana» contra «duas vezes por dia» se corta", () => {
    const src = [G("Xarope", "Tome 5 ml duas vezes por dia. Não duplique a dose.")];
    const r = J("Tome 5 ml duas vezes por semana.", src, "pt", "Como se toma o xarope?");
    expect(r.text).not.toContain("por semana");
  });
  it("gemela en: «twice a week» contra «twice a day» se corta", () => {
    const src = [G("Syrup", "Take 5 ml twice a day. Do not double the dose.")];
    const r = J("Take 5 ml twice a week.", src, "en", "How do I take the syrup?");
    expect(r.text).not.toContain("twice a week");
  });
  it("control fiel de mundo cerrado (a nivel de función): sin frecuencia en la evidencia, la pierna no juzga la de la respuesta", () => {
    // La guarda vive en quantityConflict: la guía que pauta sin
    // este marco («por la mañana y por la noche») no declara
    // frecuencia en esta dimensión, y la de la respuesta no se
    // condena contra un conjunto vacío. Con la frecuencia SÍ en la
    // evidencia (P-09), el mismo juicio corta.
    const sinMarco = ["Tome 5 ml por la mañana y por la noche. No dupliques la dosis."];
    expect(
      quantityConflict("Tome 5 ml dos veces al día.", evidenceQuantities(sinMarco), evidenceNumberValues(sinMarco)),
    ).toBe(false);
    const conMarco = ["Tome 5 ml dos veces al día. No dupliques la dosis."];
    expect(
      quantityConflict("Tome 5 ml dos veces por semana.", evidenceQuantities(conMarco), evidenceNumberValues(conMarco)),
    ).toBe(true);
  });
  it("variante con dígitos: «2 veces al día» contra «1 vez al día» en la guía se corta", () => {
    const src = [G("Jarabe para la tos", "Tome 5 ml 1 vez al día. No dupliques la dosis.")];
    const r = J("Tome 5 ml 2 veces al día.", src, "es", "¿Cómo se toma el jarabe?");
    expect(r.text).not.toContain("2 veces al día");
  });
  it("a nivel de función: la frecuencia es una cantidad con dimensión propia", () => {
    const f = quantitiesOf("tome 5 ml dos veces por semana").filter((q) => q.dim === "frecuencia");
    expect(f).toHaveLength(1);
    expect(f[0]!.canon).toBeCloseTo(2 / 7, 6);
    const d = quantitiesOf("take 5 ml twice a day").filter((q) => q.dim === "frecuencia");
    expect(d).toHaveLength(1);
    expect(d[0]!.canon).toBeCloseTo(2, 6);
  });
});

// ------------------------------------------------------------- m-04/m-05

describe("T-05 · m-04/m-05 el emparejado fecha-evento de R8", () => {
  const CITAS = [
    G("Citas", "La vacuna de Ana es el 12 de diciembre. La revisión de Ana es el 3 de enero."),
  ];
  it("P-05 (m-04): dos eventos fundidos con la fecha de uno se cortan", () => {
    const r = J("La vacuna y la revisión de Ana son el 12 de diciembre.", CITAS, "es", "¿Cuándo son la vacuna y la revisión de Ana?");
    expect(r.text).not.toContain("son el 12 de diciembre");
  });
  it("control fiel (m-04): la fusión que da las dos fechas se conserva entera", () => {
    const r = J("La vacuna de Ana es el 12 de diciembre y la revisión de Ana es el 3 de enero.", CITAS, "es", "¿Cuándo son la vacuna y la revisión de Ana?");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("12 de diciembre");
    expect(r.text).toContain("3 de enero");
  });
  it("P-15 (m-05): el evento con sinónimo y la fecha del otro se corta", () => {
    const r = J("La inmunización de Ana es el 3 de enero.", CITAS, "es", "¿Cuándo es la vacuna de Ana?");
    expect(r.text).not.toContain("inmunización de Ana es el 3 de enero");
  });
  it("gemela pt (m-05): «a imunização de Ana» com a data da revisão corta", () => {
    const src = [G("Consultas", "A vacina de Ana é o 12 de dezembro. A revisão de Ana é o 3 de janeiro.")];
    const r = J("A imunização de Ana é o 3 de janeiro.", src, "pt", "Quando é a vacina de Ana?");
    expect(r.text).not.toContain("imunização de Ana é o 3 de janeiro");
  });
  it("control fiel (m-05): el sinónimo con la fecha PROPIA del evento se conserva", () => {
    const r = J("La inmunización de Ana es el 12 de diciembre.", CITAS, "es", "¿Cuándo es la vacuna de Ana?");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("12 de diciembre");
  });
});

// ---------------------------------------------------------------- m-06

describe("T-05 · m-06 meses y años como cantidades de tiempo", () => {
  it("P-11b: «dura 3 años» contra «3 meses» se corta", () => {
    const src = [G("Garantía", "La garantía del motor dura 3 meses desde la compra.")];
    const r = J("La garantía del motor dura 3 años desde la compra.", src, "es", "¿Cuánto dura la garantía del motor?");
    expect(r.text).not.toContain("3 años");
  });
  it("control fiel: la misma unidad se conserva («3 meses» y «1 año»)", () => {
    // OJO: restar la cantidad en OTRA unidad («12 meses» por «1 año»)
    // muere hoy en la pierna de cifras, antes de llegar a cantidades:
    // es la conducta previa de la casa y esta tanda no la cambia.
    const srcA = [G("Garantía", "La garantía del motor dura 3 meses desde la compra.")];
    const rA = J("La garantía del motor dura 3 meses desde la compra.", srcA, "es", "¿Cuánto dura la garantía del motor?");
    expect(rA.status).toBe("grounded");
    expect(rA.text).toContain("3 meses");
    const srcB = [G("Garantía", "La garantía del motor dura 1 año desde la compra.")];
    const rB = J("La garantía del motor dura 1 año desde la compra.", srcB, "es", "¿Cuánto dura la garantía del motor?");
    expect(rB.status).toBe("grounded");
    expect(rB.text).toContain("1 año");
  });
  it("a nivel de función: mes y año parsean como tiempo", () => {
    expect(quantitiesOf("dura 3 meses")).toEqual([expect.objectContaining({ dim: "tiempo", canon: 3 * 2592000 })]);
    expect(quantitiesOf("dura 3 años")).toEqual([expect.objectContaining({ dim: "tiempo", canon: 3 * 31536000 })]);
    expect(quantitiesOf("lasts 3 years")).toEqual([expect.objectContaining({ dim: "tiempo", canon: 3 * 31536000 })]);
  });
});

// ---------------------------------------------------------------- m-08

describe("T-05 · m-08 «twice» existe para el lector en letra", () => {
  it("P-10a: la paráfrasis fiel «two times a day» contra «twice a day» se conserva", () => {
    const src = [G("Syrup", "Take 5 ml twice a day. Do not double the dose.")];
    const r = J("Take 5 ml two times a day.", src, "en", "How do I take the syrup?");
    expect(r.text).toContain("two times a day");
  });
  it("P-10b (control que ya cortaba): «three times daily» contra «two times a day» sigue cortado", () => {
    const src = [G("Syrup", "Take 5 ml two times a day. Do not double the dose.")];
    const r = J("Take 5 ml three times daily.", src, "en", "How do I take the syrup?");
    expect(r.text).not.toContain("three times daily");
  });
  it("a nivel de función: «twice a day» da la lectura 2 y «once a day» la lectura 1", () => {
    expect(sentenceWordReadings("Take 5 ml twice a day.").map((r) => r.value)).toContain(2);
    expect(sentenceWordReadings("Take 5 ml once a day.").map((r) => r.value)).toContain(1);
  });
});

// ------------------------------------------------- residuo: fechas vii

describe("T-05 · residuo: la fecha única de la evidencia (R8 sin tema)", () => {
  const FUENTES_018 = [
    G("Paracetamol: dose for adults", "The usual dose of paracetamol for an adult is 500 mg per dose, every 6 hours. Do not exceed 3000 mg in 24 hours and never give paracetamol to a baby without asking a doctor. If the fever goes above 39 degrees, seek medical care. In an emergency call 112; the health information phone number is 061. This guide was reviewed on March 10, 2024."),
    G("Seascale", "Seascale is a village on the coast of Cumbria, in north-west England. About 3000 people live in the village, which is known for its long sandy beach and its views across the Irish Sea."),
  ];
  it("matriz-a-018: la revisión con el mes cambiado se retira aunque el tema no empareje entre idiomas", () => {
    const r = J("Esta guía fue revisada el 10 de abril de 2024.", FUENTES_018, "es", "¿Qué dosis de paracetamol puedo tomar si soy adulto?");
    expect(r.text).not.toContain("10 de abril de 2024");
  });
  it("control fiel: la misma fecha traducida se conserva", () => {
    const r = J("Esta guía fue revisada el 10 de marzo de 2024.", FUENTES_018, "es", "¿Qué dosis de paracetamol puedo tomar si soy adulto?");
    expect(r.text).toContain("10 de marzo de 2024");
  });
});

// --------------------------------------- residuo: polaridad por cláusulas

describe("T-05 · residuo: la prohibición desnudada y el mejor emparejado", () => {
  it("matriz-a-463: la prohibición sin su «do not», fundida con un fragmento fiel, se retira", () => {
    const src = [
      G("Main water shutoff", "The main water shutoff valve is usually near the water meter or where the pipe enters the house. Turn the valve clockwise to close it and stop the water flow. Do not use a metal wrench on a plastic valve. A leaking tap can waste 15 liters of water a day. The meter is read every 30 days by the water company. If a pipe bursts, call a plumber at 800-555-0128; for a major flood call 911. This guide was reviewed on January 27, 2024."),
    ];
    const r = J("Use a metal wrench on a plastic valve near the water meter where the pipe enters the house.", src, "en", "How do I turn off the water in my house if a pipe bursts?");
    expect(r.text).not.toContain("Use a metal wrench on a plastic valve near the water meter");
  });
  it("matriz-a-340: el «don't know» no blanquea la prohibición: la cláusula copiada con la negación caída se retira", () => {
    const src = [
      G("Jump starting a car", "To jump start a car, connect the red cable to the positive terminal of the dead battery first. Do not connect the black cable to the negative terminal of the dead battery. Connect the black cable to a metal part of the engine, away from the battery. A healthy battery holds 12 volts. Wait 5 minutes before trying to start the car. Roadside assistance answers on 800-555-0162. This guide was reviewed on November 2, 2023."),
    ];
    const r = J("I don't know, but connect the black cable to the negative terminal of the dead battery first.", src, "en", "How do I jump start a car with a dead battery?");
    expect(r.text).not.toContain("connect the black cable to the negative terminal");
  });
  it("control fiel de la misma guía: el cable negro a la pieza de metal se conserva", () => {
    const src = [
      G("Jump starting a car", "To jump start a car, connect the red cable to the positive terminal of the dead battery first. Do not connect the black cable to the negative terminal of the dead battery. Connect the black cable to a metal part of the engine, away from the battery. A healthy battery holds 12 volts. Wait 5 minutes before trying to start the car. Roadside assistance answers on 800-555-0162. This guide was reviewed on November 2, 2023."),
    ];
    const r = J("Connect the black cable to a metal part of the engine, away from the battery.", src, "en", "How do I jump start a car with a dead battery?");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("metal part of the engine");
  });
  it("matriz-b-103: el troceo portugués no deshace «Não deixe o telemóvel…»: la prohibición desnudada se retira", () => {
    const src = [
      G("River Danube", "The River Danube is the second longest river in Europe, flowing 2,850 kilometres through ten countries before emptying into the Black Sea."),
      G("Carregar o telemóvel", "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."),
    ];
    const r = J("Deixe o telemóvel a carregar toda a noite ligado à tomada para cuidar da bateria.", src, "pt", "Como devo carregar o telemóvel para cuidar da bateria?");
    expect(r.text).not.toContain("Deixe o telemóvel a carregar toda a noite");
  });
  it("matriz-b-111: la negación repartida entre cláusulas no sella la frase", () => {
    const src = [
      G("Carregar o telemóvel", "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."),
    ];
    const r = J("Primeiro, deixe o telemóvel a carregar toda a noite e nunca o desligue da tomada.", src, "pt", "Como devo carregar o telemóvel para cuidar da bateria?");
    expect(r.text).not.toContain("nunca o desligue da tomada");
    expect(r.text).not.toContain("deixe o telemóvel a carregar toda a noite");
  });
  it("control fiel pt: la instrucción de carga de la guía se conserva tal cual", () => {
    const src = [
      G("Carregar o telemóvel", "Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível. Não deixe o telemóvel a carregar toda a noite ligado à tomada."),
    ];
    const r = J("Carregue o telemóvel até aos 80 por cento para cuidar da bateria e desligue o carregador quando chegar a esse nível.", src, "pt", "Como devo carregar o telemóvel para cuidar da bateria?");
    expect(r.text).toContain("Carregue o telemóvel até aos 80 por cento");
  });
});

// ------------------------------------------ residuo: la cifra en otro rol

describe("T-05 · residuo: la copia casi idéntica con la cifra cambiada", () => {
  const ATRAGANTAMIENTO = [
    G("Atragantamiento en adultos", "Si una persona se atraganta y no puede hablar, da 5 golpes secos entre los omóplatos con la palma de la mano. No metas los dedos en la boca para sacar el objeto. Si pasan 90 segundos y la persona sigue sin respirar, llama al 112; el teléfono de información es el 061. Esta guía fue revisada el 20 de enero de 2024."),
  ];
  it("matriz-a-097: «90 golpes» lavado de «90 segundos» se retira", () => {
    const r = J("Da 90 golpes secos entre los omóplatos con la palma de la mano.", ATRAGANTAMIENTO, "es", "¿Qué hago si una persona se atraganta y no puede hablar?");
    expect(r.text).not.toContain("90 golpes");
  });
  it("matriz-a-130: «call 10» lavado de «answers in 10 seconds» se retira", () => {
    const src = [
      G("Emergency numbers", "In Spain, call 112 for any emergency, such as fire, medical help or police. In the United States, the emergency number is 911. Do not call the emergency number for general information. The general information phone number is 800-555-0106. The 112 service answers in 10 seconds on average. This guide was reviewed on June 8, 2023."),
    ];
    const r = J("In Spain, call 10 for any emergency, such as fire, medical help or police.", src, "en", "Which number do I call for an emergency in Spain?");
    expect(r.text).not.toContain("call 10 for any emergency");
  });
  it("control fiel: la copia con su cifra propia se conserva", () => {
    const r = J("Da 5 golpes secos entre los omóplatos con la palma de la mano.", ATRAGANTAMIENTO, "es", "¿Qué hago si una persona se atraganta y no puede hablar?");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("5 golpes");
  });
  it("control fiel: la copia que AÑADE una cifra de la guía no cae (el conteo de cifras difiere)", () => {
    const r = J("Da 5 golpes secos entre los omóplatos con la palma de la mano y llama al 112.", ATRAGANTAMIENTO, "es", "¿Qué hago si una persona se atraganta y no puede hablar?");
    expect(r.text).toContain("5 golpes");
    expect(r.text).toContain("112");
  });
});

// ---------------------------------------------------------------- P-07

describe("T-05 · P-07 el tope por artículo se indexa por documento, no por título", () => {
  const chunk = (chunkId: string, docId: string, title: string, score: number): RetrievedChunk => ({
    chunkId,
    docId,
    title,
    body: `cuerpo de ${chunkId}`,
    score,
    matchType: "lexical",
  });
  it("dos artículos distintos con el mismo título tienen cupo propio", () => {
    const lexical = [
      chunk("a1", "doc-a", "Mismo título", 3),
      chunk("a2", "doc-a", "Mismo título", 2.9),
      chunk("b1", "doc-b", "Mismo título", 2.8),
    ];
    const out = fuseRetrievalResults(lexical, [], 10);
    expect(out.map((c) => c.chunkId)).toContain("b1");
    expect(out).toHaveLength(3);
  });
  it("control: el mismo artículo sigue topado a MAX_CHUNKS_PER_ARTICLE", () => {
    const lexical = [
      chunk("a1", "doc-a", "Mismo título", 3),
      chunk("a2", "doc-a", "Mismo título", 2.9),
      chunk("a3", "doc-a", "Mismo título", 2.8),
    ];
    const out = fuseRetrievalResults(lexical, [], 10);
    expect(out).toHaveLength(2);
  });
});
