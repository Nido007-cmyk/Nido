/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * provenance.ts — 0.1.38: de dónde vino cada tramo del texto de la caja.
 *
 * La «cerca» del enrutado se apoya en CÓMO llegó el texto, no en marcas
 * dentro del propio texto: lo pegado y lo compartido desde otra app es
 * contenido citado y el router no lo mira (un «recuérdame…» dentro no es
 * ninguna evidencia de orden). Lo escrito, lo dictado con el micrófono del
 * chat y los ejemplos de la propia app sí son órdenes posibles.
 *
 * Puro, sin React: la pantalla llama a applyEdit en cada cambio del texto.
 */

export type InputSource = "typed" | "dictated" | "pasted" | "shared" | "example";

export interface Segment {
  text: string;
  source: InputSource;
}

/** Fuentes cercadas: su texto nunca llega al router. */
export const FENCED_SOURCES: ReadonlySet<InputSource> = new Set(["pasted", "shared"]);

/**
 * Un cambio que mete de golpe al menos esto (y con espacios: varias
 * palabras) sin venir del micrófono ni de la app se toma como pegado.
 * Android no avisa de un «pegar» en la caja de React Native; el teclado
 * predictivo mete una palabra cada vez, muy por debajo de este umbral.
 */
export const PASTE_MIN_CHARS = 24;

export function joinSegments(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}

function normalize(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && last.source === s.source) last.text += s.text;
    else out.push({ text: s.text, source: s.source });
  }
  return out;
}

/** Los tramos de [start, end) del texto, con su fuente. */
export function sliceSegments(segments: Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const s of segments) {
    const a = pos;
    const b = pos + s.text.length;
    pos = b;
    const from = Math.max(a, start);
    const to = Math.min(b, end);
    if (from < to) out.push({ text: s.text.slice(from - a, to - a), source: s.source });
  }
  return out;
}

/**
 * Aplica un cambio de la caja (prev → next) a los tramos. `source` es la
 * fuente conocida del texto insertado (micrófono, compartir, ejemplo); sin
 * ella se deduce: escrito, o pegado si entra mucho texto de golpe.
 */
export function applyEdit(segments: Segment[], prev: string, next: string, source?: InputSource): Segment[] {
  if (next === "") return [];
  // Tramos desincronizados (no debería pasar): conservador, si había algo
  // cercado todo queda cercado; si no, todo es escrito.
  if (joinSegments(segments) !== prev) {
    const fenced = segments.some((s) => FENCED_SOURCES.has(s.source));
    return [{ text: next, source: source ?? (fenced ? "pasted" : "typed") }];
  }
  let p = 0;
  const maxP = Math.min(prev.length, next.length);
  while (p < maxP && prev[p] === next[p]) p++;
  let s = 0;
  const maxS = Math.min(prev.length, next.length) - p;
  while (s < maxS && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  const inserted = next.slice(p, next.length - s);
  const insertedSource: InputSource =
    source ?? (inserted.length >= PASTE_MIN_CHARS && /\s/.test(inserted.trim()) ? "pasted" : "typed");
  return normalize([
    ...sliceSegments(segments, 0, p),
    { text: inserted, source: insertedSource },
    ...sliceSegments(segments, prev.length - s, prev.length),
  ]);
}

export function hasFenced(segments: Segment[]): boolean {
  return segments.some((s) => FENCED_SOURCES.has(s.source) && s.text.trim().length > 0);
}

/** Solo lo que el router puede mirar: lo escrito, dictado o de un ejemplo. */
export function routableText(segments: Segment[]): string {
  return segments
    .filter((s) => !FENCED_SOURCES.has(s.source))
    .map((s) => s.text)
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}
