// Práctica de RCP (0.1.76): el texto es el de la guía, palabra por
// palabra; el ritmo está dentro de lo que dice la guía; el conteo 30:2 y
// el aviso de turnarse caen donde deben.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BEAT_MS,
  BREATH_PAUSE_MS,
  CPR_BPM,
  CPR_GUIDE,
  compressionBlockStartMs,
  cprLangOf,
  cprPhaseAt,
  formatElapsed,
  switchReminderDue,
  type CprLang,
} from "./cprCoach";

const FILES: Record<CprLang, string> = {
  es: "knowledge-packs/nido-esencial/es/02-rcp-adultos.md",
  en: "knowledge-packs/nido-esencial/en/02-cpr-adults.md",
  pt: "knowledge-packs/nido-esencial/pt/02-rcp-em-adultos.md",
};

describe("el texto es el de la guía NIDO Esencial, palabra por palabra", () => {
  for (const lang of ["es", "en", "pt"] as const) {
    it(lang, () => {
      const md = readFileSync(FILES[lang], "utf8");
      const g = CPR_GUIDE[lang];
      expect(md).toContain(`title: ${g.title}\n`);
      expect(md).toContain(`id: ${g.guideId}\n`);
      expect(md).toContain(`verified: ${g.verified}\n`);
      expect(md).toContain(`sources: ${g.sources}\n`);
      for (const h of Object.values(g.headings)) expect(md).toContain(`## ${h}\n`);
      for (const line of g.before) expect(md).toContain(`- ${line}\n`);
      g.compressions.forEach((line, i) => expect(md).toContain(`${i + 1}. ${line}\n`));
      for (const line of g.breaths) expect(md).toContain(`- ${line}\n`);
      for (const line of g.stop) expect(md).toContain(`- ${line}`);
      expect(md).toContain(g.switchLine);
      // Nada se queda fuera de las secciones que enseña la práctica.
      const section = (h: string) => md.split(`## ${h}\n`)[1].split("\n## ")[0].split("\n").filter((l) => /^(?:- |\d+\. )/.test(l));
      expect(section(g.headings.before)).toHaveLength(g.before.length);
      expect(section(g.headings.compressions)).toHaveLength(g.compressions.length);
      expect(section(g.headings.breaths)).toHaveLength(g.breaths.length);
      expect(section(g.headings.stop)).toHaveLength(g.stop.length);
    });
  }
});

describe("el ritmo", () => {
  it("110 por minuto, dentro del «100 a 120» que dice la guía", () => {
    expect(CPR_BPM).toBeGreaterThanOrEqual(100);
    expect(CPR_BPM).toBeLessThanOrEqual(120);
    expect(CPR_GUIDE.es.compressions.some((l) => l.includes("100 a 120 por minuto"))).toBe(true);
    expect(CPR_GUIDE.en.compressions.some((l) => l.includes("100 to 120 per minute"))).toBe(true);
    expect(CPR_GUIDE.pt.compressions.some((l) => l.includes("100 a 120 por minuto"))).toBe(true);
  });
  it("la pausa de 2 respiraciones es menor de 10 s", () => {
    expect(BREATH_PAUSE_MS).toBeLessThan(10_000);
  });
});

describe("conteo", () => {
  it("continuo: 1 al empezar, 110 al cabo de un minuto", () => {
    expect(cprPhaseAt(0, "continuous").count).toBe(1);
    expect(cprPhaseAt(60_000 - 1, "continuous").count).toBe(110);
    expect(cprPhaseAt(60_000 + 1, "continuous").total).toBe(111);
  });
  it("30:2: treinta compresiones, pausa, y vuelve a 1", () => {
    expect(cprPhaseAt(0, "30:2")).toMatchObject({ phase: "compressions", count: 1, cycle: 1 });
    expect(cprPhaseAt(29 * BEAT_MS + 1, "30:2")).toMatchObject({ phase: "compressions", count: 30, total: 30 });
    expect(cprPhaseAt(30 * BEAT_MS + 1, "30:2")).toMatchObject({ phase: "breaths", cycle: 1, total: 30 });
    const second = compressionBlockStartMs(2);
    expect(second).toBeCloseTo(30 * BEAT_MS + BREATH_PAUSE_MS);
    expect(cprPhaseAt(second + 1, "30:2")).toMatchObject({ phase: "compressions", count: 1, cycle: 2, total: 31 });
  });
});

describe("aviso de turnarse cada 2 minutos", () => {
  it("continuo: al cruzar 2 min, una sola vez", () => {
    expect(switchReminderDue(119_000, "continuous", 0)).toBeNull();
    expect(switchReminderDue(120_100, "continuous", 0)).toBe(1);
    expect(switchReminderDue(121_000, "continuous", 1)).toBeNull();
    expect(switchReminderDue(240_500, "continuous", 1)).toBe(2);
  });
  it("30:2: espera a la pausa de respiraciones", () => {
    // Busca el primer instante tras 2 min que cae en compresiones y el primero en respiraciones.
    let t = 120_000;
    while (cprPhaseAt(t, "30:2").phase !== "compressions") t += 50;
    expect(switchReminderDue(t, "30:2", 0)).toBeNull();
    while (cprPhaseAt(t, "30:2").phase !== "breaths") t += 50;
    expect(switchReminderDue(t, "30:2", 0)).toBe(1);
  });
});

describe("utilidades", () => {
  it("formato del tiempo y lengua", () => {
    expect(formatElapsed(187_400)).toBe("03:07");
    expect(cprLangOf("pt-BR")).toBe("pt");
    expect(cprLangOf("fr")).toBe("en");
  });
});
