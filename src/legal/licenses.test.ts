/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../models/manifest";
import { assetLicenseRows, licenseInfo, packageLicenseLabel, THIRD_PARTY } from "./licenses";
import es from "../i18n/locales/es.json";
import en from "../i18n/locales/en.json";
import pt from "../i18n/locales/pt.json";

const get = (o: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);

describe("información legal del catálogo", () => {
  it("toda licencia del catálogo tiene nombre y enlace oficial (un modelo nuevo no entra sin ella)", () => {
    for (const row of assetLicenseRows(MODEL_CATALOG)) {
      expect(row.info, `${row.id}: «${row.license}» no está en src/legal/licenses.ts`).not.toBeNull();
      expect(row.info!.url).toMatch(/^https:\/\//);
    }
  });

  it("las notas de condiciones existen en los tres idiomas", () => {
    const keys = new Set(assetLicenseRows(MODEL_CATALOG).map((r) => r.info?.noteKey).filter(Boolean) as string[]);
    expect(keys.size).toBeGreaterThan(0);
    for (const k of keys) for (const loc of [es, en, pt]) expect(get(loc, k), k).toBeTypeOf("string");
  });

  it("la licencia LFM lleva su nota del tope comercial", () => {
    expect(licenseInfo("LFM Open License v1.0")?.noteKey).toBe("licenses.notes.lfm");
    expect(String(get(en, "licenses.notes.lfm"))).toMatch(/10/);
  });
});

describe("avisos de terceros que viajan en la app", () => {
  it("traen la licencia de la propia app con los dos avisos de copyright", () => {
    expect(THIRD_PARTY.appLicense).toMatch(/Copyright \(c\) 2026 NIDO contributors/);
    expect(THIRD_PARTY.appLicense).toMatch(/Copyright \(c\) 2026 aoair contributors/);
  });

  it("node-forge se muestra con la licencia elegida", () => {
    const forge = THIRD_PARTY.packages.find((p) => p.name === "node-forge");
    expect(forge && packageLicenseLabel(forge)).toMatch(/^BSD-3-Clause/);
  });
});
