/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 0,
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import { MODEL_CATALOG } from "./manifest";
import {
  setupLlmChoices,
  preselectLlmId,
  PREFERRED_LLM_ID,
  LIGHT_LLM_ID,
} from "./defaultModel";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import pt from "../i18n/locales/pt.json";

const GiB = 1024 ** 3;

describe("setup model picker", () => {
  it("offers exactly the light and preferred LLMs, light first", () => {
    const choices = setupLlmChoices();
    expect(choices.map((m) => m.id)).toEqual([LIGHT_LLM_ID, PREFERRED_LLM_ID]);
    for (const m of choices) {
      expect(m.kind).toBe("llm");
      // Honest picker info must exist for every offered model.
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.description!.length).toBeGreaterThan(0);
      expect(m.sizeBytes).toBeGreaterThan(0);
    }
  });

  it("preselects the preferred model when RAM is unknown (blind)", () => {
    expect(preselectLlmId(0)).toBe(PREFERRED_LLM_ID);
  });

  it("preselects the light model on a low-RAM device (Tab A9+ class)", () => {
    expect(preselectLlmId(3.7 * GiB)).toBe(LIGHT_LLM_ID);
  });

  it("preselects the preferred model on a 6GB+ device", () => {
    expect(preselectLlmId(6 * GiB)).toBe(PREFERRED_LLM_ID);
  });

  it("every choice resolves to a catalog entry", () => {
    for (const m of setupLlmChoices()) {
      expect(MODEL_CATALOG.find((e) => e.id === m.id)).toBeDefined();
    }
  });
});

describe("setup model picker i18n", () => {
  const keys = ["modelTitle", "modelSubtitle", "modelRecommendedForDevice", "modelRam"];
  const locales = { en, es, pt } as const;
  for (const [lang, mod] of Object.entries(locales)) {
    it(`${lang} has all picker keys`, () => {
      const step2 = (mod as Record<string, unknown>).setupWizard as Record<
        string,
        Record<string, unknown>
      >;
      for (const k of keys) {
        expect(typeof step2.step2[k]).toBe("string");
      }
    });
  }
});
