/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Auditoría 0.1.79: varias pantallas mostraban `e.message` tal cual
 * («Error: ENOSPC…», «Cannot read property…») en una app en español. Esto
 * convierte un error en un texto para personas, en el idioma de la app,
 * sin esconder el detalle técnico (sirve para pedir ayuda).
 */
import type { TFunction } from "i18next";
import { ramBudgetReason } from "./ramBudgetMessage";
import { diagnose } from "./components/modelLoadDiagnosis";

/** Detalle técnico corto: el mensaje del error, en una línea, sin pasarse de largo. */
export function technicalDetail(e: unknown, max = 160): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : String((e as { message?: unknown })?.message ?? e);
  const one = raw.replace(/^(Error:\s*)+/i, "").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * La parte que va en una plantilla con {{error}} («No se pudo X: {{error}}»):
 * memoria y espacio, explicados; lo demás, el detalle técnico corto.
 */
export function errorReason(t: TFunction, e: unknown, lang = "en"): string {
  const ram = ramBudgetReason(t, e, lang);
  if (ram) return ram;
  const detail = technicalDetail(e);
  const d = diagnose(detail, t as never);
  if (d.category === "storage") return `${d.title}. ${d.recommendation}`;
  return detail;
}

/** Un texto completo, para cuando el error se muestra solo. */
export function userFacingError(t: TFunction, e: unknown, lang = "en"): string {
  const ram = ramBudgetReason(t, e, lang);
  if (ram) return ram;
  const detail = technicalDetail(e);
  const d = diagnose(detail, t as never);
  if (d.category === "storage") return `${d.title}. ${d.recommendation}`;
  return detail ? t("errors.unexpected", { detail }) : t("errors.unexpectedNoDetail");
}
