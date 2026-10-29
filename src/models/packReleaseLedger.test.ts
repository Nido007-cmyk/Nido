/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.59 — a file in a NIDO release is never replaced. An app only accepts
 * the exact bytes its own signed catalog names, so republishing a file under
 * the same URL breaks every older app (0.1.57 could not download NIDO Local
 * after knowledge-packs-v5 was republished for 0.1.58). A new pack version
 * goes to a new release tag and a new line in knowledge-packs/release-ledger.json.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MODEL_CATALOG } from "./manifest";

const ledger = JSON.parse(readFileSync(new URL("../../knowledge-packs/release-ledger.json", import.meta.url), "utf8")) as {
  files: Record<string, string>;
  replacedOnce: Record<string, string>;
};
const NIDO_RELEASE = "https://github.com/Nido007-cmyk/Nido/releases/download/";
const catalogFiles = MODEL_CATALOG.flatMap((m) =>
  [m.sourceUrl, ...(((m as { mirrorUrls?: string[] }).mirrorUrls) ?? [])]
    .filter((u): u is string => typeof u === "string" && u.startsWith(NIDO_RELEASE))
    .map((url) => ({ id: m.id, url, sha256: m.sha256 })),
);

describe("archivos de las releases de NIDO: nunca se sustituyen", () => {
  it("cada archivo del catálogo está en el registro con la misma huella", () => {
    expect(catalogFiles.length).toBeGreaterThan(0);
    for (const f of catalogFiles) {
      // A different fingerprint for a URL already in the ledger means the file
      // was (or would be) replaced: publish the new version under a new tag.
      expect(ledger.files[f.url]).toBe(f.sha256);
    }
  });

  it("huellas y direcciones bien formadas; lo sustituido una vez queda solo como registro", () => {
    for (const f of catalogFiles) {
      const old = ledger.replacedOnce[f.url];
      if (old) expect(old).not.toBe(f.sha256);
    }
    for (const [url, sha] of Object.entries(ledger.files)) {
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
      expect(url).toMatch(/^https:\/\/github\.com\/Nido007-cmyk\/Nido\/releases\/download\/knowledge-packs-v\d+\/[\w.-]+$/);
    }
  });
});
