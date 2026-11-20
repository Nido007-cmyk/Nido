// Residuo memoryForgetWhich (paquete de arreglos del móvil, §10.16,
// juzgado con causa propia): cuando los recuerdos que coinciden son
// más de los 6 que se listan, el corte se anuncia, como el gemelo de
// §8.7 (F-PC61) hace en el resumen de memoria. Con 6 o menos, la
// salida es la de siempre, sin una letra más.
import { describe, expect, it } from "vitest";
import { extractToolAction, runToolAction, type ToolAction } from "./toolRouter";

const clinica = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `f${i + 1}`,
    kind: "fact" as const,
    label: `dato ${i + 1} de la clínica`,
  }));

const deps = (n: number) => ({
  dispatch: async () => ({ status: "executed" as const, text: "" }),
  isDisabled: () => false,
  listMemories: async () => clinica(n),
});

describe("memoryForgetWhich anuncia el resto", () => {
  it("8 coincidencias: lista 6 y anuncia las 2 que quedan fuera", async () => {
    const out = await runToolAction(extractToolAction("borra el hecho de la clínica") as ToolAction, deps(8));
    expect(out.response).toContain("dato 6 de la clínica");
    expect(out.response).not.toContain("dato 7 de la clínica");
    expect(out.response).toContain("…y 2 más.");
  });
  it("7 coincidencias: anuncia la única que queda fuera", async () => {
    const out = await runToolAction(extractToolAction("borra el hecho de la clínica") as ToolAction, deps(7));
    expect(out.response).toContain("…y 1 más.");
  });
  it("6 coincidencias: sin anuncio, como siempre", async () => {
    const out = await runToolAction(extractToolAction("borra el hecho de la clínica") as ToolAction, deps(6));
    expect(out.response).toContain("dato 6 de la clínica");
    expect(out.response).not.toContain("más.");
  });
  it("el anuncio sale en la lengua de la ruta (en y pt)", async () => {
    const en = await runToolAction({ kind: "memoryForget", query: "clínica", lang: "en" }, deps(9));
    expect(en.response).toContain("…and 3 more.");
    const pt = await runToolAction({ kind: "memoryForget", query: "clínica", lang: "pt" }, deps(9));
    expect(pt.response).toContain("…e mais 3.");
  });
});
