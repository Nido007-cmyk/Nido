/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packSource.ts — 0.1.55: lo puro de «leer la fuente entera». Un trozo de
 * un pack se identifica como `pack:<packId>:<fila>`; la guía entera son
 * todas las filas con el mismo título, en orden. Idea de BOAR («read a
 * source whole, offline, with the part BOAR used marked», MIT).
 */

export interface PackChunkRef {
  packId: string;
  rowId: number;
}

/** `pack:<packId>:<fila>` → sus partes; null si no es un trozo de pack. */
export function parsePackChunkId(chunkId: string | undefined | null): PackChunkRef | null {
  if (!chunkId || !chunkId.startsWith("pack:")) return null;
  const rest = chunkId.slice(5);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0) return null;
  const packId = rest.slice(0, cut);
  const rowText = rest.slice(cut + 1);
  if (!/^\d+$/.test(rowText)) return null;
  const rowId = Number(rowText);
  return Number.isSafeInteger(rowId) ? { packId, rowId } : null;
}

export interface PackSourcePart {
  id: number;
  body: string;
  /** La parte que la respuesta usó. */
  used: boolean;
}

export interface PackSourceDoc {
  title: string;
  /** De dónde sale la guía (columna `source` del pack: la fuente oficial). */
  source: string;
  parts: PackSourcePart[];
}

/** Tope de partes que se enseñan (una guía de NIDO Esencial tiene pocas). */
export const MAX_SOURCE_PARTS = 200;

/** Marca la parte usada; si no está entre las leídas, la doc no vale. */
export function markUsedPart(
  title: string,
  source: string,
  rows: Array<{ id: number; body: string }>,
  usedRowId: number,
): PackSourceDoc | null {
  if (!rows.some((r) => r.id === usedRowId)) return null;
  return {
    title,
    source,
    parts: rows.slice(0, MAX_SOURCE_PARTS).map((r) => ({ id: r.id, body: r.body, used: r.id === usedRowId })),
  };
}
