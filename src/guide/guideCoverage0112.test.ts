/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría de la 0.1.112, bloque 5: la guía enseña todas las
 * herramientas del agente. Antes, 14 de las 28 no tenían lección.
 * Una herramienta nueva sin lección rompe esta batería.
 */
import { describe, expect, it } from "vitest";
import { LOCAL_TOOLS } from "../agent/tools/manifest";
import { extractToolAction } from "../agent/loop/toolRouter";
import { GUIDE_MODULES } from "./guideCatalog";

describe("bloque 5 (0.1.112): cobertura de la guía", () => {
  it("cada herramienta del manifiesto aparece en alguna lección", () => {
    const taught = new Set(GUIDE_MODULES.flatMap((m) => m.lessons.flatMap((l) => l.tools ?? [])));
    const missing = LOCAL_TOOLS.map((t) => t.name).filter((n) => !taught.has(n));
    expect(missing).toEqual([]);
  });

  it("las lecciones nuevas existen", () => {
    const ids = GUIDE_MODULES.flatMap((m) => m.lessons.map((l) => l.id));
    for (const id of ["forget", "skills", "agentMessages", "disappearing", "packShare", "panic"]) {
      expect(ids).toContain(id);
    }
  });

  it("paridad pt del enrutador NIDO (antes null / conversar)", () => {
    expect(extractToolAction("manda uma mensagem NIDO para a Ana: chego às 8")?.kind).toBe("nidoSend");
    expect(extractToolAction("tarefas pendentes do nido")?.kind).toBe("nidoTasks");
  });
});
