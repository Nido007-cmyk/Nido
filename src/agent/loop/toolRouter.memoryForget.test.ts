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
});
