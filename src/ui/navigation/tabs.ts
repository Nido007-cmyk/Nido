/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.55 — the five main sections, always one tap away (bottom tab bar).
 * Pure: which tab owns which screen, so the drawer, deep links and the bar
 * agree and no screen is left without a way back.
 */
import type { IconName } from "../components/icons/iconRegistry";

export type MainTab = "chat" | "emergency" | "library" | "nido" | "settings";

export const MAIN_TABS: readonly MainTab[] = ["chat", "emergency", "library", "nido", "settings"];

export const TAB_ICON: Record<MainTab, IconName> = {
  chat: "chat",
  emergency: "warning",
  library: "knowledge",
  nido: "pairing",
  settings: "settings",
};

/** i18n key of each tab's label. */
export const TAB_LABEL_KEY: Record<MainTab, string> = {
  chat: "tabs.chat",
  emergency: "tabs.emergency",
  library: "tabs.library",
  nido: "tabs.nido",
  settings: "tabs.settings",
};

/** Old drawer entries that are now a whole tab (the drawer keeps them as shortcuts). */
export const DRAWER_KEY_TO_TAB: Record<string, MainTab> = {
  knowledge: "library",
  guide: "library",
  settings: "settings",
  nido: "nido",
};

export function isMainTab(value: unknown): value is MainTab {
  return typeof value === "string" && (MAIN_TABS as readonly string[]).includes(value);
}
