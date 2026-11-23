/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.55 — quick guides on the Emergency tab. Each one sends a plain
 * question to the chat, which answers from the NIDO Esencial guides on the
 * phone ("RCP (reanimación)…", "Hemorragias graves…", "Atragantamiento…",
 * "Quemaduras", "Terremoto", "Huracanes, ciclones…"). Labels and questions
 * live in i18n: emergency.guides.<key> / emergency.questions.<key>.
 */
import type { IconName } from "../components/icons/iconRegistry";

export interface QuickGuide {
  key: "cpr" | "bleeding" | "choking" | "burns" | "earthquake" | "hurricane";
  icon: IconName;
  /** Life-threatening right now: shown in red. */
  urgent: boolean;
  /**
   * La clave de SU guía en el pack Esencial (`guides.key`), cuando
   * el tema la tiene: viaja con la pregunta hasta el turno y la
   * guía servida es esa, sin pasar por la elección (espejo §1,
   * pieza A — H-LOOP-1/3). Terremoto y huracanes no la traen: su
   * turno sigue el camino de siempre.
   */
  guideKey?: string;
}

export const QUICK_GUIDES: readonly QuickGuide[] = [
  { key: "cpr", icon: "activity", urgent: true, guideKey: "esencial-rcp-adultos" },
  { key: "bleeding", icon: "warning", urgent: true, guideKey: "esencial-hemorragias-graves" },
  { key: "choking", icon: "warning", urgent: true, guideKey: "esencial-atragantamiento" },
  { key: "burns", icon: "warning", urgent: true, guideKey: "esencial-quemaduras" },
  { key: "earthquake", icon: "compass", urgent: false },
  { key: "hurricane", icon: "compass", urgent: false },
];
