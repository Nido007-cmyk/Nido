/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-11 (0.1.99) · m-14 — la lista de «qué recuerdo» del agente incluía
 * hechos escritos por PARES. El callback listMemories de ChatScreen
 * leía getFacts(500) (todas las fuentes) mientras el snapshot del
 * propio sistema usa getOwnerFacts. La cura va en la costura: la
 * región del callback pasa a leer SOLO hechos del dueño.
 *
 * Sonda estructural sobre el fuente: la región del callback
 * listMemories debe contener getOwnerFacts y no getFacts(500). (El
 * tipo Person no lleva campo source en el esquema: no existe vía de
 * personas creadas por pares; el asiento alcanza solo a los hechos.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatScreenSrc = readFileSync(
  fileURLToPath(new URL("./ChatScreen.tsx", import.meta.url)),
  "utf8",
);

describe("m-14: listMemories solo expone hechos del dueño", () => {
  it("la región del callback listMemories usa getOwnerFacts y no getFacts", () => {
    const start = chatScreenSrc.indexOf("listMemories: async");
    expect(start).toBeGreaterThan(-1);
    const region = chatScreenSrc.slice(start, start + 700);
    expect(region).toContain("getOwnerFacts");
    expect(region).not.toContain("getFacts(500)");
  });
});
