/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";

/**
 * Copy-honesty keys for the self-knowledge lane (2026-09-28):
 * - sourceFootnotes.title must not overclaim "verified offline".
 * - sourceFootnotes.relevanceCaption explains the number is absolute
 *   match strength, not confidence.
 * - chatScreen.noRelevantOfflineSources is the deterministic honest
 *   no-result note.
 * All three must exist and be non-empty in EN/ES/PT.
 */

const locales = { en, es, pt } as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc: any, k) => (acc == null ? acc : acc[k]), obj);
}

describe("self-knowledge lane i18n keys", () => {
  it("sourceFootnotes.title exists, is non-empty, and never says 'verified offline'", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const title = get(locale, "sourceFootnotes.title");
      expect(typeof title, `${name}.sourceFootnotes.title`).toBe("string");
      expect((title as string).trim().length, name).toBeGreaterThan(0);
      expect(title as string, name).not.toMatch(/verificad/i);
    }
  });

  it("sourceFootnotes.relevanceCaption exists and is non-empty in all locales", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const caption = get(locale, "sourceFootnotes.relevanceCaption");
      expect(typeof caption, `${name}.sourceFootnotes.relevanceCaption`).toBe("string");
      expect((caption as string).trim().length, name).toBeGreaterThan(0);
    }
  });

  it("chatScreen.noRelevantOfflineSources exists and is non-empty in all locales", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const note = get(locale, "chatScreen.noRelevantOfflineSources");
      expect(typeof note, `${name}.chatScreen.noRelevantOfflineSources`).toBe("string");
      expect((note as string).trim().length, name).toBeGreaterThan(0);
    }
  });

  it("no locale file contains the overclaiming phrase anywhere", () => {
    for (const [name, locale] of Object.entries(locales)) {
      expect(JSON.stringify(locale), name).not.toMatch(/verified offline/i);
      expect(JSON.stringify(locale), name).not.toMatch(/verificadas? offline/i);
    }
  });
});
