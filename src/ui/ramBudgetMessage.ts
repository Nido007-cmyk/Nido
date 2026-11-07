/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 2026-11-06 (prueba física): «No se pudo cargar…» salía con el mensaje
 * técnico en inglés del pre-flight dentro de una app en español. Este es
 * el texto para personas, en el idioma de la app, con las mismas cifras.
 */
import type { TFunction } from "i18next";
import { isRamBudgetError, toGb } from "../inference/ramBudget";

/** «1.0» en inglés, «1,0» en español y portugués. */
function gb(bytes: number, lang: string): string {
  const s = toGb(bytes);
  return /^(es|pt)/.test(lang) ? s.replace(".", ",") : s;
}

/** El motivo de un fallo de carga, legible; null si no es un rechazo por memoria. */
export function ramBudgetReason(t: TFunction, e: unknown, lang = "en"): string | null {
  if (!isRamBudgetError(e)) return null;
  const parts = [
    t("ramBudget.needs", { need: gb(e.needBytes, lang), free: gb(e.freeBytes, lang), total: gb(e.totalBytes, lang) }),
  ];
  if (e.crashSafety !== null) parts.push(t("ramBudget.afterCrash", { pct: Math.round(e.crashSafety * 100) }));
  parts.push(t("ramBudget.advice"));
  return parts.join(" ");
}

/** El texto del error para una notificación: el legible si es de memoria, si no el mensaje tal cual. */
export function loadErrorText(t: TFunction, e: unknown, lang = "en"): string {
  return ramBudgetReason(t, e, lang) ?? ((e as { message?: string })?.message ?? String(e));
}
