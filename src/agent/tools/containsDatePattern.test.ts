/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría de la 0.1.70: el detector de fechas que sugiere un
 * recordatorio al guardar un hecho solo conocía meses en español (sin
 * «setiembre») e inglés; las demás tablas de meses del árbol ya traen
 * el portugués.
 */
import { describe, expect, it } from "vitest";
import { containsDatePattern } from "./handlers";

describe("containsDatePattern", () => {
  it("portugués, «setiembre» y el ordinal inglés", () => {
    expect(containsDatePattern("O aniversário da minha mãe é 15 de março")).toBe(true);
    expect(containsDatePattern("A consulta é no dia 3 de setembro")).toBe(true);
    expect(containsDatePattern("La cita es el 10 de setiembre")).toBe(true);
    expect(containsDatePattern("Her birthday is the 10th of May")).toBe(true);
  });
  it("lo que ya detectaba sigue igual, y sin fecha no detecta", () => {
    expect(containsDatePattern("El cumpleaños de Ana es el 20 de junio")).toBe(true);
    expect(containsDatePattern("Dentist on March 3")).toBe(true);
    expect(containsDatePattern("Me gusta el café sin azúcar")).toBe(false);
    expect(containsDatePattern("Gosto de café sem açúcar")).toBe(false);
  });
});
