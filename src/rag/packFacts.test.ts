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
