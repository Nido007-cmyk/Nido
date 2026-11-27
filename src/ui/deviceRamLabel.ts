/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.118: la RAM que anuncia el fabricante, como la escribe la caja
 * («4 GB», «8 GB»). Android la da en bytes y unos fabricantes la cuentan
 * en GB decimales (4 000 000 000) y otros en binarios (4 294 967 296):
 * si la cifra es un número entero de GB decimales se usa esa base; si no,
 * la binaria redondeada. 0 o menos = sin dato (null).
 */
const GiB = 1024 * 1024 * 1024;

export function advertisedRamGb(bytes: number): number | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const dec = bytes / 1e9;
  if (Math.abs(dec - Math.round(dec)) < 1e-9) return Math.round(dec);
  const bin = bytes / GiB;
  return Math.round(bin * 2) / 2; // 1,5 GB y 2,5 GB existen
}
