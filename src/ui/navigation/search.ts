/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.55 — search in the chat history and in Settings. Accent- and
 * case-insensitive, every word must appear ("ajustes voz" finds "Voz").
 */

export function foldSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every word of the query appears in one of the texts. */
export function matchesSearch(query: string, ...texts: Array<string | null | undefined>): boolean {
  const q = foldSearch(query);
  if (!q) return true;
  const hay = foldSearch(texts.filter(Boolean).join(" "));
  return q.split(" ").every((w) => hay.includes(w));
}

export function filterByTitle<T extends { title: string }>(items: T[], query: string): T[] {
  return foldSearch(query) ? items.filter((i) => matchesSearch(query, i.title)) : items;
}
