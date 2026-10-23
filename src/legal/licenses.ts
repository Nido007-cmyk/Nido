/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * licenses.ts — 0.1.40: qué licencia tiene cada cosa que la app usa o
 * descarga, con el enlace a su texto oficial y, cuando la licencia pone
 * condiciones que importan al usuario, una nota (clave i18n).
 *
 * Toda etiqueta `license` del catálogo (src/models/manifest.ts) DEBE estar
 * aquí: lo comprueba licenses.test.ts, para que ningún modelo nuevo llegue
 * a la app sin su información legal.
 */
import type { CatalogModel } from "../models/manifest";
import notices from "./thirdPartyNotices.json";

export interface LicenseInfo {
  /** Nombre completo de la licencia. */
  name: string;
  /** Texto oficial de la licencia. */
  url: string;
  /** Clave i18n con las condiciones que conviene saber (opcional). */
  noteKey?: string;
}

const CC_BY_SA: LicenseInfo = {
  name: "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
  noteKey: "licenses.notes.ccBySa",
};

export const LICENSES: Readonly<Record<string, LicenseInfo>> = {
  MIT: { name: "MIT License", url: "https://opensource.org/license/mit" },
  "Apache-2.0": { name: "Apache License 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  "LFM Open License v1.0": {
    name: "LFM Open License v1.0 (Liquid AI)",
    url: "https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/raw/main/LICENSE",
    noteKey: "licenses.notes.lfm",
  },
  "CC BY-SA 4.0 (Wikipedia)": CC_BY_SA,
  "CC BY-SA 4.0 (Wikipedia; compiled by NIDO)": CC_BY_SA,
  // NIDO Esencial: guides written by NIDO (knowledge-packs/nido-esencial).
  "CC BY 4.0 (NIDO)": {
    name: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    url: "https://creativecommons.org/licenses/by/4.0/",
    noteKey: "licenses.notes.ccByNido",
  },
};

export function licenseInfo(label: string): LicenseInfo | null {
  return LICENSES[label] ?? null;
}

/** Una fila de la sección de modelos y conocimiento. */
export interface AssetLicenseRow {
  id: string;
  label: string;
  license: string;
  info: LicenseInfo | null;
}

export function assetLicenseRows(catalog: readonly CatalogModel[]): AssetLicenseRow[] {
  return catalog.map((m) => ({ id: m.id, label: m.label, license: m.license, info: licenseInfo(m.license) }));
}

export interface ThirdPartyPackage {
  name: string;
  version: string;
  license: string | null;
  elected?: string;
  local?: boolean;
  files: Array<{ file: string; text: string }>;
}

export interface ThirdPartyNotices {
  generatedFrom?: string;
  partial?: boolean;
  count: number;
  appLicense?: string;
  withoutText: string[];
  packages: ThirdPartyPackage[];
  texts: Record<string, string>;
}

/** Los avisos generados por scripts/third-party-notices.mjs. */
export const THIRD_PARTY: ThirdPartyNotices = notices as unknown as ThirdPartyNotices;

/** La licencia que se muestra para un paquete (con la elegida si ofrece varias). */
export function packageLicenseLabel(p: ThirdPartyPackage): string {
  if (p.local) return "MIT (NIDO)";
  if (!p.license) return "?";
  return p.elected ? `${p.elected} (${p.license})` : p.license;
}
