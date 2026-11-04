// Pruebas adversarias del 2026-11-03: «emergency number usa» no encontraba
// Estados Unidos. Pares: el verbo español «usa» no se toma por el país.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findRegion, type PackRegion } from "./packFacts";

const doc = JSON.parse(readFileSync(new URL("../../knowledge-packs/nido-local/facts.json", import.meta.url), "utf8"));
const regions: PackRegion[] = Object.entries(doc.regions).map(([code, r]: [string, any]) => ({
  code,
  names: r.names,
  phrases: r.in ?? {},
  aliases: r.aliases,
}));

describe("Estados Unidos escrito «usa», «U.S.» o «U.S.A.»", () => {
  it.each(["emergency number usa", "emergency number in the usa", "911 in the U.S.", "emergency number U.S.A.", "número de emergencias en usa"])(
    "%s → US",
    (q) => expect(findRegion(q, regions)?.code).toBe("US"),
  );
  it("par: el verbo «usa» no es el país", () => {
    expect(findRegion("qué número usa la policía", regions)).toBeNull();
    expect(findRegion("esta app usa el 112", regions)).toBeNull();
    expect(findRegion("qué número usa la policía en México", regions)?.code).toBe("MX");
  });
});
