/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { packIdPrefix, planSeed, type ExpectedDoc } from "./seedPlan";

const builtIn: ExpectedDoc[] = [{ id: "app-moe-ram" }, { id: "wiki-min-photosynthesis" }];
const full: ExpectedDoc[] = Array.from({ length: 4 }, (_, i) => ({
  id: `wiki-corpus-full-t${i}`,
  packId: "corpus-full",
}));

describe("planSeed", () => {
  it("índice completo → nada que hacer (sin aviso de progreso)", () => {
    const expected = [...builtIn, ...full];
    const plan = planSeed(expected, expected.map((d) => d.id), []);
    expect(plan.missing).toEqual([]);
    expect(plan.stale).toEqual([]);
    expect(plan.packs["corpus-full"]).toEqual({ indexed: 4, total: 4 });
  });

  it("evidencia: filas de un paquete borrado ya no obligan a recorrer todo cada vez", () => {
    // Antes: COUNT(*) (6) !== esperados (2) → recorrido completo en cada arranque.
    const existing = [...builtIn, ...full].map((d) => d.id);
    const plan = planSeed(builtIn, existing, ["corpus-full"]);
    expect(plan.missing).toEqual([]);
    expect(plan.stale).toEqual(full.map((d) => d.id));
  });

  it("indexado a medias → solo falta lo que falta, en orden", () => {
    const expected = [...builtIn, ...full];
    const plan = planSeed(expected, ["app-moe-ram", "wiki-corpus-full-t0", "wiki-corpus-full-t2"], []);
    expect(plan.missing).toEqual(["wiki-min-photosynthesis", "wiki-corpus-full-t1", "wiki-corpus-full-t3"]);
    expect(plan.packs["corpus-full"]).toEqual({ indexed: 2, total: 4 });
  });

  it("nunca borra filas desconocidas ni de paquetes que siguen en el teléfono", () => {
    const plan = planSeed(builtIn, ["app-old-doc", "wiki-corpus-standard-x", ...builtIn.map((d) => d.id)], [
      "corpus-full",
    ]);
    expect(plan.stale).toEqual([]);
  });

  it("un prefijo de paquete no confunde paquetes con nombres parecidos", () => {
    expect(packIdPrefix("corpus-full")).toBe("wiki-corpus-full-");
    const plan = planSeed([], ["wiki-corpus-fullx-a", "wiki-corpus-full-a"], ["corpus-full"]);
    expect(plan.stale).toEqual(["wiki-corpus-full-a"]);
  });
});
