// Pruebas adversarias del 2026-11-03: una negación no es un nombre.
// Pares: el nombre afirmado se sigue guardando; el negado ya no crea
// personas ni nombre propio falsos.
import { describe, expect, it } from "vitest";
import { extractPeople, extractRememberFact, extractSelfName } from "./rememberRouter";

describe("la negación no crea personas ni nombres", () => {
  it.each(["recuerda que mi papá no se llama Juan", "my dad is not named John", "mi hermana ya no se llama Ana"])("%s → sin persona", (t) => {
    expect(extractPeople(t)).toEqual([]);
  });
  it("«my name is not Aldo» no guarda el nombre propio", () => {
    expect(extractSelfName("my name is not Aldo")).toBeNull();
  });
  it("con «recuerda que», la frase negada se guarda como hecho, tal cual", () => {
    expect(extractRememberFact("recuerda que mi papá no se llama Juan")?.content).toBe("mi papá no se llama Juan");
  });
  it("par: el nombre afirmado se sigue guardando en las tres lenguas", () => {
    expect(extractPeople("mi hermana se llama Ana")).toEqual([{ name: "Ana", relationship: "hermana" }]);
    expect(extractPeople("my sister's name is Ana")).toEqual([{ name: "Ana", relationship: "sister" }]);
    expect(extractPeople("minha irmã se chama Ana")).toEqual([{ name: "Ana", relationship: "irmã" }]);
    expect(extractSelfName("my name is Aldo")).toBe("Aldo");
    expect(extractPeople("mi papá se llama Juan, no Pedro")).toEqual([{ name: "Juan", relationship: "papá" }]);
  });
});
