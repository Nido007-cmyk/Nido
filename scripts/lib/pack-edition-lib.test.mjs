/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { buildEditionCard, canonicalJson, editionCardDigest, recordsDigest, validateEditionCard } from "./pack-edition-lib.mjs";

const COMPUTED = {
  packId: "nido-esencial",
  builtAt: "2026-10-31T00:00:00.000Z",
  languages: ["en", "es"],
  documentCount: 116,
  recordCount: 1410,
  factsCount: 0,
  archiveSizeBytes: 12_345_678,
  packageSha256: "a".repeat(64),
  recordsSha256: "b".repeat(64),
  attribution: "Written by NIDO from public guidance.",
  license: "CC BY 4.0 (NIDO)",
  checks: [{ file: "retrieval-checks.json", sha256: "c".repeat(64), cases: 57 }],
  embeddingModel: "intfloat/multilingual-e5-small",
  embeddingModelSha256: "d".repeat(64),
};

const DESCRIPTOR = {
  edition: "2026-10",
  sourceEdition: "NIDO guides tree, 58 guides per language",
  rights: "CC BY 4.0 (NIDO)",
  publisher: "NIDO",
  updatePolicy: "New edition when a cited guideline changes; published editions are immutable.",
  knownLimitations: "General information only.",
};

describe("recordsDigest", () => {
  it("no depende del orden y cambia si cambia un registro", () => {
    const a = recordsDigest([
      { title: "Uno", body: "cuerpo uno" },
      { title: "Dos", body: "cuerpo dos" },
    ]);
    const b = recordsDigest([
      { title: "Dos", body: "cuerpo dos" },
      { title: "Uno", body: "cuerpo uno" },
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const c = recordsDigest([
      { title: "Uno", body: "cuerpo uno" },
      { title: "Dos", body: "cuerpo dos distinto" },
    ]);
    expect(c).not.toBe(a);
  });
});

describe("buildEditionCard + validateEditionCard", () => {
  it("con descriptor completo y casos, la edición queda release-ready", () => {
    const { card, errors } = buildEditionCard({ descriptor: DESCRIPTOR, computed: COMPUTED });
    expect(errors).toEqual([]);
    expect(card.state).toBe("release-ready");
    expect(card.packId).toBe("nido-esencial");
    expect(card.sourceLock).toBe(`records:${"b".repeat(64)}`);
    expect(card.retrievalCases[0].cases).toBe(57);
  });

  it("sin descriptor, la ficha es un borrador con cada falta nombrada", () => {
    const { card, errors } = buildEditionCard({ descriptor: {}, computed: { ...COMPUTED, checks: [] } });
    expect(card.state).toBe("draft");
    expect(errors.join(" ")).toContain("edition");
    expect(errors.join(" ")).toContain("updatePolicy");
    expect(errors.join(" ")).toContain("retrievalCases");
    // Los derechos caen a la licencia calculada: no es una falta.
    expect(card.rights).toBe("CC BY 4.0 (NIDO)");
  });

  it("un fichero de casos sin huella o sin recuento no vale para lista", () => {
    const { card, errors } = buildEditionCard({
      descriptor: DESCRIPTOR,
      computed: { ...COMPUTED, checks: [{ file: "retrieval-checks.json", sha256: "no-es-hex", cases: 0 }] },
    });
    expect(card.state).toBe("draft");
    expect(errors.some((e) => e.startsWith("retrievalCases"))).toBe(true);
  });

  it("el bloqueo del descriptor manda sobre el de los registros", () => {
    const { card } = buildEditionCard({
      descriptor: { ...DESCRIPTOR, sourceLock: "knowledge-packs@f20e1e9" },
      computed: COMPUTED,
    });
    expect(card.sourceLock).toBe("knowledge-packs@f20e1e9");
  });
});

describe("editionCardDigest", () => {
  it("es estable ante el orden de claves y sensible a cualquier campo", () => {
    const { card } = buildEditionCard({ descriptor: DESCRIPTOR, computed: COMPUTED });
    const shuffled = Object.fromEntries(Object.entries(card).reverse());
    expect(canonicalJson(shuffled)).toBe(canonicalJson(card));
    expect(editionCardDigest(shuffled)).toBe(editionCardDigest(card));
    expect(editionCardDigest({ ...card, recordCount: card.recordCount + 1 })).not.toBe(editionCardDigest(card));
  });

  it("validateEditionCard rechaza huellas que no son SHA-256", () => {
    const { card } = buildEditionCard({ descriptor: DESCRIPTOR, computed: COMPUTED });
    const errors = validateEditionCard({ ...card, packageSha256: "xyz" });
    expect(errors.some((e) => e.startsWith("packageSha256"))).toBe(true);
  });
});
