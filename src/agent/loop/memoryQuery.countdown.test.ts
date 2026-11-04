// Arreglos «todo es todo» (2026-11-03): «¿cuántos días faltan para mi
// cumpleaños?» caía a la charla con la fecha guardada. Pares: sin fecha
// guardada se dice que no se encuentra; la fecha ajena no se usa.
import { describe, expect, it } from "vitest";
import { answerMemoryQuery, type MemoryQueryData } from "./memoryQuery";
import { classifyIntent } from "./intent";

const daysUntil = (month: number, day: number): number => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), month, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month, day);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
};

const MEM: MemoryQueryData = {
  facts: [
    { content: "mi cumpleaños es el 3 de mayo", category: "event" },
    { content: "el cumpleaños de mi mamá es el 15 de marzo", category: "event" },
    { content: "el cumpleaños de Ana es el 20 de junio", category: "event" },
  ],
  people: [{ name: "Ana", relationship: "hermana" }],
};

describe("cuenta atrás hasta un cumpleaños guardado", () => {
  it("el propio, en es/en/pt, y entra como pregunta de memoria", () => {
    const n = daysUntil(4, 3);
    expect(classifyIntent("¿cuántos días faltan para mi cumpleaños?")).toBe("recordar");
    expect(answerMemoryQuery("¿cuántos días faltan para mi cumpleaños?", MEM, "es")).toContain(`${n} día`);
    expect(answerMemoryQuery("how many days until my birthday?", { facts: [{ content: "my birthday is May 3", category: "event" }], people: [] }, "en")).toContain(`${n} day`);
    expect(answerMemoryQuery("quantos dias faltam para o meu aniversário?", { facts: [{ content: "meu aniversário é dia 3 de maio", category: "event" }], people: [] }, "pt")).toContain(`${n} dia`);
  });
  it("el de otra persona, por parentesco o por nombre", () => {
    expect(answerMemoryQuery("¿cuántos días faltan para el cumpleaños de mi mamá?", MEM, "es")).toContain(`${daysUntil(2, 15)} día`);
    expect(answerMemoryQuery("¿cuántos días faltan para el cumpleaños de Ana?", MEM, "es")).toContain(`${daysUntil(5, 20)} día`);
    expect(answerMemoryQuery("¿cuántos días faltan para el cumpleaños de mi hermana?", MEM, "es")).toContain(`${daysUntil(5, 20)} día`);
  });
  it("par: sin la fecha guardada no se inventa una cuenta", () => {
    const empty: MemoryQueryData = { facts: [], people: [] };
    expect(answerMemoryQuery("¿cuántos días faltan para mi cumpleaños?", empty, "es")).toContain("No lo encuentro");
    expect(
      answerMemoryQuery("¿cuántos días faltan para mi cumpleaños?", { facts: [{ content: "el cumpleaños de mi mamá es el 15 de marzo", category: "event" }], people: [] }, "es"),
    ).toContain("No lo encuentro");
  });
});
