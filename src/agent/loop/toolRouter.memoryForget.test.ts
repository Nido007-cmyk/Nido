// Arreglos «todo es todo» (2026-11-03, ADV-M2): olvidar un recuerdo desde
// el chat. El borrado pasa por delete_memory (irreversible: la política
// pide confirmación con el recuerdo exacto). Pares: varios candidatos o
// ninguno no borran nada; sin lista de recuerdos, la guía honesta.
import { describe, expect, it } from "vitest";
import { extractToolAction, runToolAction, type ToolAction } from "./toolRouter";

const items = [
  { id: "f1", kind: "fact" as const, label: "mi color favorito es el azul" },
  { id: "f2", kind: "fact" as const, label: "vivo en Tucson" },
  { id: "f3", kind: "fact" as const, label: "el teléfono de la clínica es 520-555-0147" },
  { id: "f4", kind: "fact" as const, label: "la clínica abre a las 9" },
  { id: "p1", kind: "person" as const, label: "Ana (hermana)" },
];
const make = () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const deps = {
    dispatch: async (n: string, a: Record<string, unknown>) => {
      calls.push([n, a]);
      return { status: "executed" as const, text: "ok" };
    },
    isDisabled: () => false,
    listMemories: async () => items,
  };
  return { calls, deps };
};
const run = async (t: string) => {
  const { calls, deps } = make();
  const out = await runToolAction(extractToolAction(t) as ToolAction, deps);
  return { calls, out };
};

describe("olvidar desde el chat", () => {
  it("un solo recuerdo coincide → delete_memory con el recuerdo exacto", async () => {
    const { calls, out } = await run("olvida mi color favorito");
    expect(calls).toEqual([["delete_memory", { id: "f1", kind: "fact", content: "mi color favorito es el azul" }]]);
    expect(out.response).toContain("mi color favorito es el azul");
  });
  it("en otra lengua y a una persona", async () => {
    expect((await run("forget that I live in Tucson")).calls[0]?.[1]).toMatchObject({ id: "f2" });
    expect((await run("olvida a mi hermana Ana")).calls[0]?.[1]).toMatchObject({ id: "p1", kind: "person" });
  });
  it("par: varios candidatos → se listan y no se borra nada", async () => {
    const { calls, out } = await run("borra el hecho de la clínica");
    expect(calls).toEqual([]);
    expect(out.response).toContain("520-555-0147");
    expect(out.response).toContain("abre a las 9");
  });
  it("par: ninguno → se dice, sin borrar", async () => {
    const { calls, out } = await run("olvida mi perro");
    expect(calls).toEqual([]);
    expect(out.response).toContain("No encontré");
  });
  it("sin lista de recuerdos (tareas programadas): la guía honesta", async () => {
    const out = await runToolAction({ kind: "memoryForget", query: "mi color", lang: "es" }, { dispatch: async () => ({ status: "executed", text: "" }), isDisabled: () => false });
    expect(out.response).toContain("Mi memoria");
  });
  it("«olvida todo», «forget everything», «olvida lo que te dije»: se pide cuál, sin buscar ni borrar", async () => {
    for (const q of ["olvida todo", "forget everything", "olvida lo que te dije", "esquece tudo"]) {
      const { calls, out } = await run(q);
      expect(calls).toEqual([]);
      expect(out.response).not.toContain("No encontr");
      expect(out.response).toMatch(/Mi memoria|My Memory|Minha Memória/);
    }
  });
  it("«olvida» a secas en el chat pide cuál (ya no dice que no borra)", async () => {
    const { deps } = make();
    const out = await runToolAction({ kind: "memoryForgetHelp", lang: "es" }, deps);
    expect(out.response).toContain("te pediré confirmación");
  });
  it("par: «ana» no encuentra «mañana», «car» no encuentra «carne»", async () => {
    const { calls } = make();
    const deps = {
      dispatch: async (n: string, a: Record<string, unknown>) => { calls.push([n, a]); return { status: "executed" as const, text: "" }; },
      isDisabled: () => false,
      listMemories: async () => [
        { id: "x1", kind: "fact" as const, label: "mañana tengo dentista" },
        { id: "x2", kind: "fact" as const, label: "no como carne" },
      ],
    };
    const a = await runToolAction(extractToolAction("olvida a Ana") as ToolAction, deps);
    const b = await runToolAction(extractToolAction("forget my car") as ToolAction, deps);
    expect(calls).toEqual([]);
    expect(a.response).toContain("No encontr");
    expect(b.response).toContain("couldn't find");
  });
});

