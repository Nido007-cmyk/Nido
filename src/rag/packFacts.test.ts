/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { composeFactsAnswer, emergencyQuestionKind, findRegion, type PackFact, type PackRegion } from "./packFacts";

// The real NIDO Local data, read the way the app reads the pack's tables.
const doc = JSON.parse(readFileSync(new URL("../../knowledge-packs/nido-local/facts.json", import.meta.url), "utf8"));
const regions: PackRegion[] = Object.entries(doc.regions).map(([code, r]: [string, any]) => ({
  code,
  names: r.names,
  phrases: r.in ?? {},
  aliases: r.aliases,
}));
const facts: PackFact[] = doc.facts.map((f: any) => ({
  region: f.region,
  key: f.key,
  value: f.value,
  label: f.label,
  note: f.note ?? {},
  sourceTitle: f.source.title,
  sourceUrl: f.source.url,
  quote: f.source.quote,
  checked: f.source.checked,
}));

describe("datos verificados de los packs (0.1.55)", () => {
  it("reconoce el país por nombre, alias o ciudad, en cualquier idioma", () => {
    expect(findRegion("número de la policía en Bogotá", regions)?.code).toBe("CO");
    expect(findRegion("emergency number in the Dominican Republic", regions)?.code).toBe("DO");
    expect(findRegion("número de emergência no Brasil", regions)?.code).toBe("BR");
    expect(findRegion("911 en EE.UU.", regions)?.code).toBe("US");
    expect(findRegion("bomberos en Asunción", regions)?.code).toBe("PY");
  });

  it("«usa» como verbo no es Estados Unidos; «USA» sí", () => {
    expect(findRegion("qué número se usa para emergencias", regions)).toBeNull();
    expect(findRegion("qué número se usa en México", regions)?.code).toBe("MX");
    expect(findRegion("emergency number USA", regions)?.code).toBe("US");
  });

  it("distingue una pregunta por un número de emergencia de otras frases", () => {
    expect(emergencyQuestionKind("¿a qué número llamo para una ambulancia en Chile?")).toBe("ambulance");
    expect(emergencyQuestionKind("policía en Perú")).toBe("police");
    expect(emergencyQuestionKind("fire department phone number in Panama")).toBe("fire");
    expect(emergencyQuestionKind("número de emergencias de España")).toBe("general");
    expect(emergencyQuestionKind("cuéntame la historia de los bomberos voluntarios de Chile y cómo empezaron")).toBeNull();
    expect(emergencyQuestionKind("qué tiempo hace en Chile")).toBeNull();
  });

  it("auditoría 2026-10-31 (F1 B-3): una pregunta larga con sus señales entra en la ruta de datos", () => {
    expect(
      emergencyQuestionKind("por favor dime cual es el numero de telefono de emergencias para llamar a la policia en chile ahora mismo gracias"),
    ).toBe("police");
    // Larga y sin señal de número: sigue sin ser pregunta.
    expect(
      emergencyQuestionKind("cuéntame con calma la historia de los bomberos voluntarios de Chile y de cómo empezaron hace ya muchos años atrás"),
    ).toBeNull();
  });

  it("auditoría 2026-10-31 (F1 B-7): con dos servicios, encabeza el nombrado primero", () => {
    expect(emergencyQuestionKind("número de ambulancia y de policía en Chile")).toBe("ambulance");
    expect(emergencyQuestionKind("número de policía y de ambulancia en Chile")).toBe("police");
    const a = composeFactsAnswer("número de ambulancia y de policía en Chile", "es", regions, facts)!;
    expect(a.text.split("\n")[0]).toBe("En Chile, para una ambulancia:");
  });

  it("responde con el número pedido primero, los demás después y la fuente con fecha", () => {
    const a = composeFactsAnswer("¿a qué número llamo para una ambulancia en Chile?", "es", regions, facts)!;
    expect(a.region).toBe("CL");
    const lines = a.text.split("\n");
    expect(lines[0]).toBe("En Chile, para una ambulancia:");
    expect(lines[1]).toBe("• 131 — emergencias médicas");
    expect(a.text).toContain("Otros números:");
    expect(a.text).toContain("• 133 — policía");
    expect(a.text).toMatch(/Fuente: Gobierno de Australia \(Smartraveller\), consejos de viaje \(Chile\) \(comprobado el \d{4}-\d{2}-\d{2}\)\./);
    expect(a.title).toBe("Emergencias en Chile");
    expect(a.calls.map((c) => c.tel)).toEqual(["tel:131", "tel:133", "tel:132"]);
  });

  it("con un número único, ese es la respuesta para cualquier servicio", () => {
    const a = composeFactsAnswer("which number do I call for the police in Spain?", "en", regions, facts)!;
    expect(a.text.split("\n").slice(0, 2)).toEqual(["In Spain, for the police:", "• 112 — emergencies (single number) (free from landlines and mobiles, even with the phone locked)"]);
  });

  it("Perú: el SAMU 106 con su nota sobre EsSalud 117", () => {
    const a = composeFactsAnswer("número de ambulancia en Lima", "es", regions, facts)!;
    expect(a.text).toContain("• 106 — emergencias médicas (SAMU del Ministerio de Salud, gratuito; los asegurados de EsSalud también tienen el 117)");
  });

  it("en portugués usa las etiquetas en portugués", () => {
    const a = composeFactsAnswer("qual o telefone dos bombeiros no Brasil?", "pt", regions, facts)!;
    expect(a.text.split("\n").slice(0, 2)).toEqual(["No Brasil, para os bombeiros:", "• 193 — bombeiros"]);
    expect(a.text).toContain("Fonte:");
  });

  it("sin país, o con un país que el pack no cubre, no responde (sigue el camino normal)", () => {
    expect(composeFactsAnswer("número de emergencias", "es", regions, facts)).toBeNull();
    expect(composeFactsAnswer("emergency number in Japan", "en", regions, facts)).toBeNull();
  });

  it("cada número que la app puede decir está en la cita de su fuente", () => {
    for (const f of facts) expect(f.quote.replace(/\D/g, "")).toContain(f.value.replace(/\D/g, ""));
  });
});

describe("preguntas indexadas en la búsqueda léxica (packs v2)", () => {
  it("un término que solo está en las preguntas de la sección cuenta para la cobertura", async () => {
    const { buildLexicalQuery, filterByTermCoverage } = await import("./pure");
    const q = buildLexicalQuery("cómo pido una ambulancia en Chile")!;
    const hit = { title: "Chile: números de emergencia", body: "• 131 — emergencias médicas" };
    expect(filterByTermCoverage([hit], q.terms)).toHaveLength(0);
    expect(filterByTermCoverage([{ ...hit, keys: "cómo pido una ambulancia en Chile" }], q.terms)).toHaveLength(1);
  });
});

describe("pestaña Emergencia (0.1.55)", () => {
  it("ordena primero la ambulancia o el número único, y da el tel: solo con cifras", async () => {
    const { emergencyCard } = await import("./packFacts");
    const cl = emergencyCard("CL", "es", regions, facts)!;
    expect(cl.where).toBe("en Chile");
    expect(cl.numbers.map((n) => n.value)).toEqual(["131", "133", "132"]);
    expect(cl.numbers[0].tel).toBe("tel:131");
    const pr = emergencyCard("PR", "en", regions, facts)!;
    expect(pr.numbers[0].tel).toBe("tel:911");
    const gt = emergencyCard("GT", "es", regions, facts)!;
    expect(gt.numbers[0].label).toBe("Cruz Roja");
    expect(gt.sources).toHaveLength(1);
  });

  it("sin datos para el país no hay tarjeta", async () => {
    const { emergencyCard } = await import("./packFacts");
    expect(emergencyCard("JP", "es", regions, facts)).toBeNull();
  });

  it("lista los 32 países ordenados por su nombre en el idioma", async () => {
    const { emergencyRegions } = await import("./packFacts");
    const es = emergencyRegions("es", regions, facts);
    expect(es).toHaveLength(32);
    expect(es[0].name).toBe("Alemania");
    expect(es.map((r) => r.code)).toContain("ES");
  });
});

describe("líneas de crisis (familia crisis.*): el consumidor que faltaba", () => {
  // Los datos reales verificados del pack NIDO Crisis (muestra de la
  // auditoría 2026-10-30: ES 024 · US 988 · MX 800-911-2000).
  const crisisRegions: PackRegion[] = [
    { code: "ES", names: { es: "España", en: "Spain", pt: "Espanha" }, phrases: { es: "en España", en: "in Spain", pt: "em Espanha" }, aliases: ["España", "Spain", "Espanha"] },
    { code: "US", names: { es: "Estados Unidos", en: "United States", pt: "Estados Unidos" }, phrases: { es: "en Estados Unidos", en: "in the United States", pt: "nos Estados Unidos" }, aliases: ["Estados Unidos", "United States", "USA"] },
    { code: "MX", names: { es: "México", en: "Mexico", pt: "México" }, phrases: { es: "en México", en: "in Mexico", pt: "no México" }, aliases: ["México", "Mexico"] },
  ];
  const crisisFacts: PackFact[] = [
    {
      region: "ES", key: "crisis.hotline", value: "024",
      label: { es: "línea de atención a la conducta suicida", en: "suicide prevention line", pt: "linha de prevenção do suicídio" }, note: {},
      sourceTitle: "Ministerio de Sanidad", sourceUrl: "https://www.sanidad.gob.es/", quote: "El 024 es un servicio de alcance nacional", checked: "2026-10-30",
    },
    {
      region: "US", key: "crisis.hotline", value: "988",
      label: { es: "línea de crisis y suicidio", en: "suicide and crisis lifeline", pt: "linha de crise e suicídio" }, note: {},
      sourceTitle: "SAMHSA", sourceUrl: "https://www.samhsa.gov/", quote: "988 offers 24/7 judgment-free support", checked: "2026-10-30",
    },
    {
      region: "MX", key: "crisis.hotline", value: "800-911-2000",
      label: { es: "Línea de la Vida", en: "Lifeline", pt: "Linha da Vida" }, note: {},
      sourceTitle: "CONASAMA", sourceUrl: "https://www.gob.mx/conasama", quote: "llama al 800-911-2000", checked: "2026-10-30",
    },
  ];

  it("distingue una pregunta de crisis de una de emergencias", async () => {
    const { crisisQuestionKind } = await import("./packFacts");
    expect(crisisQuestionKind("¿cuál es la línea de crisis de España?")).toBe(true);
    expect(crisisQuestionKind("what is the suicide hotline in the United States?")).toBe(true);
    expect(crisisQuestionKind("quiero quitarme la vida, ¿a quién llamo en México?")).toBe(true);
    expect(crisisQuestionKind("número de emergencias de España")).toBe(false);
    expect(crisisQuestionKind("cuéntame la historia de los bomberos de Chile")).toBe(false);
    expect(crisisQuestionKind("qué tiempo hace en España")).toBe(false);
  });

  it("responde con la línea del país, su fuente con fecha y el botón de llamada", async () => {
    const { composeCrisisAnswer } = await import("./packFacts");
    const a = composeCrisisAnswer("¿cuál es la línea de crisis de España?", "es", crisisRegions, crisisFacts)!;
    expect(a.region).toBe("ES");
    expect(a.text.split("\n")[0]).toBe("Línea de crisis en España:");
    expect(a.text).toContain("• 024 — línea de atención a la conducta suicida");
    expect(a.text).toContain("Fuente: Ministerio de Sanidad (comprobado el 2026-10-30).");
    expect(a.title).toBe("Línea de crisis en España");
    expect(a.calls).toEqual([{ value: "024", label: "línea de atención a la conducta suicida", tel: "tel:024" }]);
    const us = composeCrisisAnswer("suicide hotline in the United States", "en", crisisRegions, crisisFacts)!;
    expect(us.text).toContain("• 988 — suicide and crisis lifeline");
    expect(us.calls[0].tel).toBe("tel:988");
  });

  it("una expresión de crisis con país también recibe la línea", async () => {
    const { composeCrisisAnswer } = await import("./packFacts");
    const a = composeCrisisAnswer("quiero quitarme la vida, ¿a quién llamo en México?", "es", crisisRegions, crisisFacts)!;
    expect(a.region).toBe("MX");
    expect(a.text).toContain("800-911-2000");
    expect(a.calls[0].tel).toBe("tel:8009112000");
  });

  it("sin pregunta de crisis, o sin línea para el país, no responde", async () => {
    const { composeCrisisAnswer } = await import("./packFacts");
    expect(composeCrisisAnswer("número de emergencias de España", "es", crisisRegions, crisisFacts)).toBeNull();
    expect(composeCrisisAnswer("línea de crisis de Japón", "es", crisisRegions, crisisFacts)).toBeNull();
    expect(composeCrisisAnswer("línea de crisis", "es", crisisRegions, crisisFacts)).toBeNull();
  });

  it("la tarjeta de crisis de la pestaña Emergencia trae la línea y su fuente", async () => {
    const { crisisCard } = await import("./packFacts");
    const es = crisisCard("ES", "es", crisisRegions, crisisFacts)!;
    expect(es.lines.map((l) => l.value)).toEqual(["024"]);
    expect(es.lines[0].tel).toBe("tel:024");
    expect(es.sources).toEqual([{ title: "Ministerio de Sanidad", url: "https://www.sanidad.gob.es/", checked: "2026-10-30" }]);
    expect(crisisCard("JP", "es", crisisRegions, crisisFacts)).toBeNull();
  });

  it("la fusión no duplica regiones: el dueño manda en emergencias y crisis se suma a su región", async () => {
    const { mergePackFacts, crisisCard: cc, emergencyCard: ec, emergencyRegions: er } = await import("./packFacts");
    const localDef: PackRegion = { code: "ES", names: { es: "España" }, phrases: { es: "en España" }, aliases: ["España"] };
    const crisisDef: PackRegion = { code: "ES", names: { es: "España (crisis)" }, phrases: { es: "en España" }, aliases: ["España"] };
    const emg = (region: string, key: string, value: string): PackFact => ({
      region, key, value, label: { es: key }, note: {}, sourceTitle: "Local", sourceUrl: "https://example.org/", quote: value, checked: "2026-10-30",
    });
    const merged = mergePackFacts([
      { regions: [localDef], facts: [emg("ES", "emergency.general", "112")] },
      // NIDO Crisis repite la definición de ES (la de Local gana) y trae un
      // número de emergencias rival que NO debe entrar, más su línea.
      { regions: [crisisDef], facts: [emg("ES", "emergency.police", "999"), crisisFacts[0]] },
      // Un tercer pack con la misma línea no la duplica: manda el primero.
      { regions: [], facts: [{ ...crisisFacts[0], value: "111" }] },
    ]);
    expect(merged.regions.map((r) => r.code)).toEqual(["ES"]);
    expect(merged.regions[0].names.es).toBe("España");
    expect(merged.regionOwner).toEqual([0]);
    expect(merged.facts.map((f) => `${f.key}=${f.value}`)).toEqual(["emergency.general=112", "crisis.hotline=024"]);
    expect(cc("ES", "es", merged.regions, merged.facts)?.lines[0].value).toBe("024");
    expect(ec("ES", "es", merged.regions, merged.facts)?.numbers.map((n) => n.value)).toEqual(["112"]);
    // La lista de países de la pestaña sigue mandada por emergencias.
    expect(er("es", merged.regions, merged.facts).map((r) => r.code)).toEqual(["ES"]);
  });
});

describe("respuestas desde un pack desactualizado (0.1.57)", () => {
  it("mantiene los números y la fecha de la fuente, y avisa de que hay una versión más nueva", async () => {
    const { markOutdated } = await import("./packFacts");
    const a = composeFactsAnswer("número de emergencias de España", "es", regions, facts)!;
    const m = markOutdated(a, "es", "NIDO Local");
    expect(m.outdated).toBe(true);
    expect(m.text.startsWith(a.text)).toBe(true);
    expect(m.text).toMatch(/comprobado el \d{4}-\d{2}-\d{2}/);
    expect(m.text).toContain("versión anterior del pack «NIDO Local»");
    expect(m.calls).toEqual(a.calls);
    expect(markOutdated(a, "en", "NIDO Local").text).toContain("older version of the “NIDO Local” pack");
    expect(markOutdated(a, "pt", "NIDO Local").text).toContain("versão anterior do pacote «NIDO Local»");
  });
});
