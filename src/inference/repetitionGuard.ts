/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * repetitionGuard.ts — 0.1.34 (prueba física, Tab A9+): el 0.5B entró en
 * bucle («…las aluminosas, las aluminosas, las aluminosas…») hasta agotar
 * el presupuesto de tokens: pantalla llena de basura, batería gastada.
 *
 * Detecta un trozo que se repite seguido al FINAL del texto. Puro (sin
 * nativos): lo usan el motor (para cortar la generación en cuanto aparece)
 * y la pantalla (para dejar solo la primera vez).
 *
 * Umbral conservador para no cortar texto legítimo: hace falta que el
 * trozo se repita al menos 4 veces seguidas Y que lo repetido sume 80+
 * caracteres (o 3 veces si el trozo es largo, 40+). Una fila de tabla
 * markdown («|---|---|») o un «ja ja ja» no llegan.
 */

const MAX_UNIT = 160;
const WINDOW = 2000;

export interface RepetitionLoop {
  /** Índice (en el texto completo) donde termina la PRIMERA aparición. */
  keepUntil: number;
  unitLength: number;
  repeats: number;
}

export function findRepetitionLoop(text: string): RepetitionLoop | null {
  if (text.length < 80) return null;
  // 0.1.37 (auditoría): dentro de un bloque de código abierto la
  // repetición es legítima (un tablero de ceros, filas iguales).
  if ((text.match(/```/g)?.length ?? 0) % 2 === 1) return null;
  const offset = Math.max(0, text.length - WINDOW);
  const s = text.slice(offset);
  const n = s.length;
  for (let L = 2; L <= MAX_UNIT && L * 3 <= n; L++) {
    const unit = s.slice(n - L);
    if (!unit.trim()) continue;
    // 0.1.37: filas de tabla («| | |»), separadores («====») y listas de
    // números no son el bucle del modelo; los bucles reales llevan palabras.
    if (unit.includes("|") || !/\p{L}/u.test(unit)) continue;
    let k = 1;
    while (n - (k + 1) * L >= 0 && s.slice(n - (k + 1) * L, n - k * L) === unit) k++;
    const span = k * L;
    if ((k >= 4 && span >= 80) || (k >= 3 && L >= 40)) {
      return { keepUntil: offset + n - span + L, unitLength: L, repeats: k };
    }
  }
  return null;
}

/** Deja el texto hasta la primera aparición del bucle y lo marca con «…». */
export function trimRepetitionLoop(text: string): string {
  const loop = findRepetitionLoop(text);
  if (!loop) return text;
  return text.slice(0, loop.keepUntil).replace(/[\s,;:.]+$/u, "") + "…";
}
