/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * deepResearchGate.test.ts — R-07 (ronda física de la 0.1.68): la
 * puerta de emergencia/salud manda también sobre Investigar.
 *
 * Composición reproducida (send() de ChatScreen, el tramo que decide
 * el turno): con el modo profundo activo, la puerta se consulta ANTES
 * de la bifurcación — si dispara, el turno va por la ruta protegida y
 * runDeepResearch ni se invoca; si no dispara, corre la investigación
 * y su segunda red (tras descomponer) puede aún abandonarla y caer a
 * la ruta protegida. Las piezas son las reales: la decisión de
 * emergencyGate y el pipeline de orchestrator con el motor y la
 * recuperación apuntalados, como en orchestrator.test.ts.
 *
 * La vía de «emergencia primero» (handleEmergencySend) no tiene ruta
 * propia: detiene la generación en curso y reenvía el texto por el
 * mismo send(), así que su aterrizaje protegido es esta misma
 * composición con el texto de emergencia — el segundo test la nombra.
 *
 * Al final, aserciones de cableado sobre el fuente de ChatScreen (el
 * patrón de featureFlagsStartupWiring): la puerta va antes de la
 * bifurcación en el código real, no solo en esta reproducción.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const generateMock = vi.fn();
const retrieveMock = vi.fn();

vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    generate: (opts: any) => generateMock(opts),
    hasEmbeddedChatTemplate: () => false,
  },
}));

vi.mock("../rag/retrieve", () => ({
  retrieve: (query: string) => retrieveMock(query),
  assemblePrompt: () => "mock sub-question prompt",
}));

import { runDeepResearch } from "./orchestrator";
import { gatePreemptsDeepResearch } from "../routing/emergencyGate";

type GateLang = "es" | "en" | "pt";
type Route = "protected" | "deep";

/** La decisión de send() para un turno, con las piezas reales. */
async function routeTurn(
  query: string,
  deepModeOn: boolean,
  lang: GateLang
): Promise<{ route: Route; intercepted?: boolean }> {
  const gateHit = gatePreemptsDeepResearch(query, lang);
  if (deepModeOn && !gateHit) {
    const result = await runDeepResearch(query, undefined, undefined, 200, undefined, undefined, undefined, lang);
    if (result.emergencyIntercepted) return { route: "protected", intercepted: true };
    return { route: "deep" };
  }
  return { route: "protected" };
}

const ROUND_PHRASE = "Que hago si argument se esta atragantando?";

function scriptEngine(subQuestions: string) {
  generateMock.mockImplementation(async (opts: { prompt: string }) => {
    const p = opts.prompt ?? "";
    if (p.startsWith("Break this research question") || p.startsWith("Divide esta pregunta de investigación")) {
      return subQuestions;
    }
    return "mock answer";
  });
  retrieveMock.mockResolvedValue([{ chunkId: "pack:nido-viaje:1" }]);
}

beforeEach(() => {
  generateMock.mockReset();
  retrieveMock.mockReset();
});

describe("R-07 composición — el turno con Investigar activo", () => {
  it("la frase exacta de la ronda va protegida y la investigación ni se invoca", async () => {
    scriptEngine("¿Qué es un argumento?\n¿Cómo se estructura un debate?");
    const r = await routeTurn(ROUND_PHRASE, true, "es");
    expect(r.route).toBe("protected");
    // Ni descomposición, ni recuperación, ni síntesis: la puerta paró
    // el turno antes de la bifurcación.
    expect(generateMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("la vía de emergencia primero aterriza protegida: el texto tecleado durante una investigación en curso se reenvía por send() y no vuelve a Investigar", async () => {
    // handleEmergencySend detiene la generación y reenvía el texto por
    // el send() normal; con Investigar aún activo, la misma decisión
    // de la puerta lo manda a la ruta protegida.
    scriptEngine("¿Qué es un argumento?\n¿Cómo se estructura un debate?");
    const r = await routeTurn(ROUND_PHRASE, true, "es");
    expect(r.route).toBe("protected");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("la segunda red: la descomposición destapa la emergencia y el turno cae a la ruta protegida", async () => {
    scriptEngine("¿Qué es un debate académico?\nqué hacer si alguien se esta atragantando");
    const r = await routeTurn("Quiero investigar cómo se organiza un debate", true, "es");
    expect(r.route).toBe("protected");
    expect(r.intercepted).toBe(true);
    // Se descompuso (una llamada al motor) pero no se investigó nada.
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("una pregunta de investigación ordinaria sí investiga con el modo activo", async () => {
    scriptEngine("What are the benefits?\nWhat are the risks?");
    const r = await routeTurn("What are the trade-offs of rooftop solar panels?", true, "en");
    expect(r.route).toBe("deep");
    expect(retrieveMock).toHaveBeenCalled();
  });

  it("la historia no se desvía: 1918 se investiga, no cae a la puerta", async () => {
    scriptEngine("¿Qué pasó en 1918?\n¿Qué efectos tuvo?");
    const r = await routeTurn("¿cuántas personas murieron de gripe en 1918?", true, "es");
    expect(r.route).toBe("deep");
  });

  it("sin el modo activo, la frase de la ronda va protegida como siempre", async () => {
    scriptEngine("¿Qué es un argumento?");
    const r = await routeTurn(ROUND_PHRASE, false, "es");
    expect(r.route).toBe("protected");
    expect(generateMock).not.toHaveBeenCalled();
  });
});

describe("R-07 cableado — ChatScreen consulta la puerta antes de la bifurcación", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../ui/ChatScreen.tsx"), "utf8");

  it("la decisión de la puerta aparece antes de la llamada a runDeepResearch", () => {
    const gateAt = source.indexOf("gatePreemptsDeepResearch(query, uiLang)");
    const deepAt = source.indexOf("await runDeepResearch(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(deepAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(deepAt);
  });

  it("el pipeline recibe el idioma de la interfaz y la intercepción cae a la ruta protegida", () => {
    const deepAt = source.indexOf("await runDeepResearch(");
    const callBlock = source.slice(deepAt, deepAt + 700);
    expect(callBlock).toContain("uiLang");
    expect(source).toContain("result.emergencyIntercepted");
    // Los post-chequeos de la puerta miran la decisión por turno.
    expect(source.match(/!deepTurn/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
