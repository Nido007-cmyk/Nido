/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diagnose } from "./modelLoadDiagnosis";

// Key-passthrough translator: proves diagnose() selects the right catalog
// keys without depending on the i18n runtime.
const t = (key: string) => key;

describe("diagnose() storage branch", () => {
  it("classifies an ENOSPC OS error as storage", () => {
    const d = diagnose("write failed: ENOSPC: no space left on device", t);
    expect(d.category).toBe("storage");
    expect(d.title).toBe("modelLoadErrorCard.storage.title");
    expect(d.detail).toBe("modelLoadErrorCard.storage.detail");
    expect(d.recommendation).toBe("modelLoadErrorCard.storage.recommendation");
  });

  it("classifies the P2 insufficientStorage message as storage", () => {
    const d = diagnose(
      "There isn't enough free space on this phone for this download \u2014 it needs 2 GB but only 300 MB is available. Free up space and try again.",
      t,
    );
    expect(d.category).toBe("storage");
  });

  it("classifies ES/PT storage messages as storage", () => {
    expect(
      diagnose("No hay suficiente espacio libre en este tel\u00e9fono para esta descarga", t).category,
    ).toBe("storage");
    expect(
      diagnose("N\u00e3o h\u00e1 espa\u00e7o livre suficiente neste telefone", t).category,
    ).toBe("storage");
  });

  it("classifies disk-full / quota variants as storage", () => {
    expect(diagnose("disk full: cannot write model file", t).category).toBe("storage");
    expect(diagnose("quota exceeded while staging model", t).category).toBe("storage");
  });

  it("does not misclassify a storage error as network/general", () => {
    const d = diagnose("disk full: cannot write model file", t);
    expect(d.category).toBe("storage");
    expect(d.category).not.toBe("general");
    // The storage copy must never blame the network.
    expect(d.recommendation).not.toBe("modelLoadErrorCard.general.recommendation");
  });
});

describe("diagnose() existing branches unchanged", () => {
  it("still classifies integrity failures as corrupt", () => {
    expect(diagnose("size mismatch: expected 100 got 90", t).category).toBe("corrupt");
    expect(diagnose("SHA-256 hash verification failed", t).category).toBe("corrupt");
  });

  it("still classifies missing files as missing", () => {
    expect(diagnose("model file not found on device", t).category).toBe("missing");
  });

  it("still classifies RAM failures as memory", () => {
    expect(diagnose("OOM while allocating tensor", t).category).toBe("memory");
    // LlamaEngine contract: the error must mention RAM for the card to pick it up.
    expect(diagnose("not enough RAM to load model", t).category).toBe("memory");
  });

  it("still falls back to general for unknown errors", () => {
    const d = diagnose("something unexpected happened", t);
    expect(d.category).toBe("general");
    expect(d.recommendation).toBe("modelLoadErrorCard.general.recommendation");
  });
});

describe("storage locale keys exist in EN/ES/PT", () => {
  const langs = ["en", "es", "pt"] as const;
  for (const lang of langs) {
    it(`locale ${lang} has modelLoadErrorCard.storage keys`, () => {
      const data = JSON.parse(
        readFileSync(join("src", "i18n", "locales", `${lang}.json`), "utf8"),
      );
      const s = data.modelLoadErrorCard.storage;
      expect(s, `missing storage section in ${lang}`).toBeTruthy();
      expect(s.title, `${lang} title`).toBeTruthy();
      expect(s.detail, `${lang} detail`).toBeTruthy();
      expect(s.recommendation, `${lang} recommendation`).toBeTruthy();
      // Storage copy must say "free up space", never "network".
      const rec = String(s.recommendation).toLowerCase();
      expect(rec).not.toMatch(/network|internet/);
    });
  }
});
