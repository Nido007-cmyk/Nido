/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.56 — quick guides on the Emergency tab. Each one sends a plain
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
}

export const QUICK_GUIDES: readonly QuickGuide[] = [
  { key: "cpr", icon: "activity", urgent: true },
  { key: "bleeding", icon: "warning", urgent: true },
  { key: "choking", icon: "warning", urgent: true },
  { key: "burns", icon: "warning", urgent: true },
  { key: "earthquake", icon: "compass", urgent: false },
  { key: "hurricane", icon: "compass", urgent: false },
];
