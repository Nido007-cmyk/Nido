/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { trimToCompleteSentences } from "./completeSentences";

describe("trimToCompleteSentences (nunca una frase cortada)", () => {
  it("cortada a media frase: se queda en la última frase completa", () => {
    expect(
      trimToCompleteSentences("El río baja de la montaña. Lleva agua todo el año y por eso se", true)
    ).toBe("El río baja de la montaña.");
  });

  it("sin corte declarado, no se toca ni aunque acabe sin punto", () => {
    const text = "La capital es Madrid";
    expect(trimToCompleteSentences(text, false)).toBe(text);
  });

  it("cortada pero ya terminada en frase: intacta", () => {
    const text = "Primera frase. Segunda frase.";
    expect(trimToCompleteSentences(text, true)).toBe(text);
  });

  it("sin ninguna frase completa, no se vacía la respuesta", () => {
    const text = "una explicación larga que nunca llegó a cerrar su primera";
    expect(trimToCompleteSentences(text, true)).toBe(text);
  });

  it("el código no se recorta como si fueran frases", () => {
    const text = "Usa esto:\n```\nconst x = 1.5; const y = sin terminar";
    expect(trimToCompleteSentences(text, true)).toBe(text);
  });

  it("una lista cortada a mitad de punto deja los puntos completos, no la media frase (F2-m6)", () => {
    // Hasta la 0.1.98 la exención de listas dejaba el texto entero con el
    // último punto a medias («leche fres»): la ficha F2-m6 lo nombra como
    // defecto — el punto cortado se cae, los completos se quedan.
    const text = "Necesitas tres cosas:\n- harina\n- huevos\n- leche fres";
    expect(trimToCompleteSentences(text, true)).toBe("Necesitas tres cosas:\n- harina\n- huevos");
  });

  it("una lista con un solo punto, cortado, no se vacía", () => {
    const text = "Necesitas:\n- leche fres";
    expect(trimToCompleteSentences(text, true)).toBe(text);
  });

  it("los pasos numerados cortados conservan hasta el último paso completo", () => {
    const text = "1. Llama al 112.\n2. Comprime el pecho con fuerza y no par";
    expect(trimToCompleteSentences(text, true)).toBe("1. Llama al 112.");
  });

  it("una abreviatura no cuenta como cierre de frase (F2-m6: pasos amputados)", () => {
    // Con la regla vieja, «Dr.» cerraba la «frase» y el recorte amputaba
    // el paso justo ahí, a media instrucción.
    const text = "Primera frase completa. El Dr. García vino y después se fue sin decir";
    expect(trimToCompleteSentences(text, true)).toBe("Primera frase completa.");
  });

  it("si el único «cierre» es una abreviatura, no se amputa nada", () => {
    const text = "Avisa al Dr. García si empeora el dolor y luego acude a";
    expect(trimToCompleteSentences(text, true)).toBe(text);
  });

  it("las iniciales tampoco cuentan como cierre", () => {
    const text = "Lo escribió J. R. R. Tolkien en su casa y nunca lo pu";
    expect(trimToCompleteSentences(text, true)).toBe(text);
  });

  it("conserva el cierre tras signos de interrogación y comillas", () => {
    expect(trimToCompleteSentences("¿Vienes mañana? Dijo que sí, que vendría sob", true)).toBe(
      "¿Vienes mañana?"
    );
    expect(trimToCompleteSentences('Su respuesta fue «no». Luego empezó a explic', true)).toBe(
      "Su respuesta fue «no»."
    );
  });
});
