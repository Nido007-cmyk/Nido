/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.61 (velocidad): el título de un chat nuevo sale de la primera pregunta,
 * sin modelo. Antes se pedía al modelo justo después de la primera
 * respuesta, en el mismo contexto de llama.cpp: gastaba batería y borraba
 * de la caché el prefijo del sistema, así que la segunda pregunta tenía que
 * volver a leerlo entero (unos 285 tokens con el modelo por defecto).
 */
const LEADING = /^(?:hola|hey|hi|hello|ol[aá]|oye|por favor|please|nido)[,!\s]+/i;

export function titleFromQuestion(question: string, maxChars = 48): string {
  let t = (question ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING, "")
    .replace(/^[¿¡"'«“(]+/, "")
    .replace(/[?!.…:;,"'»”)]+$/, "")
    .trim();
  if (!t) return "";
  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars + 1);
    const lastSpace = cut.lastIndexOf(" ");
    t = `${(lastSpace > maxChars * 0.5 ? cut.slice(0, lastSpace) : cut.slice(0, maxChars)).replace(/[,;:\s]+$/, "")}…`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}
