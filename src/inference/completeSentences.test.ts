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

  it("una lista cortada a mitad de punto se deja como lista", () => {
    const text = "Necesitas tres cosas:\n- harina\n- huevos\n- leche fres";
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
