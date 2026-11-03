/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ESENCIAL_REL,
  clinicalHash,
  clinicalText,
  ledgerProblems,
  ratchetProblems,
  validateLedger,
  validateRow,
} from "./esencial-ledger-lib.mjs";

const GUIDE = `---
title: Suero oral
category: Salud en casa
lang: es
sources: OMS y UNICEF
---
La dosis es de 5 miligramos por kilo.
<!-- preguntas: qué dosis lleva | cuánto se da -->
Úsalo en las 24 horas siguientes.
`;

describe("clinicalHash (R00-4)", () => {
  it("does not move when a section-question comment changes", () => {
    const changed = GUIDE.replace("qué dosis lleva | cuánto se da", "otra pregunta | otra más");
    expect(clinicalHash(changed)).toBe(clinicalHash(GUIDE));
  });

  it("does not move when id, verified or header questions are added", () => {
    const sealed = GUIDE.replace(
      "sources: OMS y UNICEF\n",
      "sources: OMS y UNICEF\nid: esencial-suero\nverified: 2026-11-02\nquestions: cómo se prepara | cuánto dura\n",
    );
    expect(clinicalHash(sealed)).toBe(clinicalHash(GUIDE));
  });

  it("moves when a clinical word, a figure or the sources change", () => {
    expect(clinicalHash(GUIDE.replace("5 miligramos", "6 miligramos"))).not.toBe(clinicalHash(GUIDE));
    expect(clinicalHash(GUIDE.replace("24 horas", "12 horas"))).not.toBe(clinicalHash(GUIDE));
    expect(clinicalHash(GUIDE.replace("OMS y UNICEF", "OMS"))).not.toBe(clinicalHash(GUIDE));
    expect(clinicalHash(GUIDE.replace("Suero oral", "Suero"))).not.toBe(clinicalHash(GUIDE));
  });

  it("normalizes CRLF to LF", () => {
    expect(clinicalHash(GUIDE.replace(/\n/g, "\r\n"))).toBe(clinicalHash(GUIDE));
  });

  it("covers title, category, lang, sources and body in that order", () => {
    expect(clinicalText(GUIDE)).toBe(
      "Suero oral\nSalud en casa\nes\nOMS y UNICEF\nLa dosis es de 5 miligramos por kilo.\nÚsalo en las 24 horas siguientes.\n",
    );
  });
});

const GOOD_ROW = {
  tema: "26",
  guia: "esencial-suero-oral",
  idioma: "es",
  afirmacionId: "26-A01",
  textoLiteral: "Úsalo en las 24 horas siguientes.",
  tipo: "duración",
  institucion: "OMS",
  documento: "Recomendaciones sobre el manejo clínico de la diarrea",
  edicion: "2006",
  identificador: "ISBN 9241594217",
  localizador: "capítulo 3",
  citaLiteral: "should be used within 24 hours",
  fechaComprobacion: "2026-11-02",
  desenlace: "sostenida",
};

describe("validateRow / validateLedger (check (c), offline)", () => {
  it("accepts a complete row", () => {
    expect(validateRow(GOOD_ROW)).toEqual([]);
  });

  it("demands the consulted sources on a NO ENCONTRADO row", () => {
    const row = { ...GOOD_ROW, desenlace: "NO ENCONTRADO" };
    expect(validateRow(row).join(" ")).toMatch(/fuentesConsultadas/);
    expect(validateRow({ ...row, fuentesConsultadas: ["OMS, manual de diarrea (who.int), 2026-11-02"] })).toEqual([]);
  });

  it("rejects an outcome outside the vocabulary and a correction without before/after", () => {
    expect(validateRow({ ...GOOD_ROW, desenlace: "más o menos" }).join(" ")).toMatch(/vocabulario/);
    expect(validateRow({ ...GOOD_ROW, desenlace: "corregida desde la fuente" }).join(" ")).toMatch(/antesDespues/);
  });

  it("rejects a ledger whose preparer signs as their own auditor", () => {
    const doc = { guides: [{ guideId: "esencial-suero-oral", idioma: "es", ruta: `${ESENCIAL_REL}/es/26-suero.md`, verified: "2026-11-02", hashClinico: "0".repeat(64), preparador: "uno", auditor: "uno", filas: [GOOD_ROW] }] };
    expect(validateLedger(doc).join(" ")).toMatch(/misma persona/);
  });
});

describe("ledgerProblems / ratchetProblems on a fixture pack", () => {
  let root;
  const rel = `${ESENCIAL_REL}/es/26-suero.md`;
  const entry = () => ({
    guideId: "esencial-suero-oral",
    idioma: "es",
    ruta: rel,
    verified: "2026-11-02",
    hashClinico: clinicalHash(GUIDE),
    preparador: "preparador-r11",
    auditor: "auditor-r11",
    filas: [GOOD_ROW],
  });
  const writeGuide = (text) => writeFileSync(join(root, rel), text);
  const sealedGuide = () =>
    GUIDE.replace("sources: OMS y UNICEF\n", "sources: OMS y UNICEF\nid: esencial-suero-oral\nverified: 2026-11-02\n");

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nido-esencial-checks-"));
    for (const lang of ["es", "en", "pt"]) mkdirSync(join(root, ESENCIAL_REL, lang), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is silent when file, seal and ledger agree", () => {
    writeGuide(sealedGuide());
    expect(ledgerProblems(root, { guides: [entry()] })).toEqual([]);
    expect(ratchetProblems(root, { guides: ["esencial-suero-oral"] }, { guides: [entry()] })).toEqual([]);
  });

  it("bites when the clinical text changes under an old seal", () => {
    writeGuide(sealedGuide().replace("5 miligramos", "6 miligramos"));
    expect(ledgerProblems(root, { guides: [entry()] }).join(" ")).toMatch(/hash clínico/);
  });

  it("bites when the seal remains but the ledger entry is gone, and when a sealed baseline guide loses its seal", () => {
    writeGuide(sealedGuide());
    expect(ledgerProblems(root, { guides: [] }).join(" ")).toMatch(/sin entrada en el ledger/);
    expect(ratchetProblems(root, { guides: ["esencial-suero-oral"] }, { guides: [entry()] }).join(" ")).not.toMatch(/desapareció/);
    writeGuide(GUIDE); // seal removed
    expect(ratchetProblems(root, { guides: ["esencial-suero-oral"] }, { guides: [entry()] }).join(" ")).toMatch(/desapareció/);
  });

  it("does not bite when only a retrieval seat moves on a sealed guide", () => {
    writeGuide(sealedGuide().replace("qué dosis lleva | cuánto se da", "pregunta nueva | otra pregunta"));
    expect(ledgerProblems(root, { guides: [entry()] })).toEqual([]);
  });
});
