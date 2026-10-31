/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Color por fuente (programa «Lo mejor de la bounty», tanda 1; patrón
 * de Commonplace, Apache-2.0): cada fuente de una respuesta tiene un
 * acento, y el mismo color tiñe su píldora en las notas de fuentes, su
 * marcador [n] en el texto y la tarjeta de evidencia. Así se sigue de
 * un vistazo qué frase cuelga de qué fuente.
 *
 * Adaptación a la casa: los temas de NIDO son de dominante verde por
 * diseño y no existe una paleta arcoíris en el sistema; el acento rota
 * entre las escalas del tema (esmeralda, ámbar, carmesí, cian) en vez
 * de inventar matices fuera de él. El número acompaña SIEMPRE al
 * color: el color nunca es la única señal (TalkBack lee el número).
 */

import type { Colors } from "../theme/colors";

export interface SourceAccent {
  /** Color fuerte: texto del número y del marcador [n]. */
  solid: string;
  /** Fondo suave de la píldora. */
  subtle: string;
  /** Borde a juego. */
  border: string;
}

const SCALE_ORDER = ["emerald", "amber", "crimson", "cyan"] as const;

export function sourceAccent(colors: Colors, index: number): SourceAccent {
  const scales = colors as unknown as Record<string, Record<string, string> | undefined>;
  const scale = scales[SCALE_ORDER[index % SCALE_ORDER.length]] ?? {};
  return {
    solid: scale[600] ?? scale[500] ?? colors.text.accentCyan,
    subtle: scale.bgSubtle ?? colors.bg.subtle,
    border: scale.border ?? colors.border.default,
  };
}
