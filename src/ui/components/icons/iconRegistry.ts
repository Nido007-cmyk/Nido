/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * NIDO internal icon system v1 — registry.
 *
 * Maps the 40 frozen icon names (see ~/workspace/icon-system/frozen-v1/,
 * FINAL APPROVED 2026-09-28) to their production PNG assets.
 *
 * Assets are two-layer white-on-transparent PNGs rendered from the frozen
 * vector source at @1x/@2x/@3x/@4x; `NidoIcon` tints them at runtime with
 * the theme's `icon.ink` / `icon.gold` tokens. `require()` paths MUST stay
 * string literals — Metro statically analyzes them.
 *
 * Zero new dependencies. Do not add a vector library here.
 */
import type { ImageRequireSource } from "react-native";

export const ICON_NAMES = [
  "new-chat",
  "memory",
  "knowledge",
  "activity",
  "models",
  "pairing",
  "security",
  "appearance",
  "chat",
  "devices",
  "deep-research",
  "ideas",
  "telemetry",
  "compass",
  "wizard",
  "back",
  "close",
  "search",
  "send",
  "stop",
  "play",
  "pause",
  "add",
  "delete",
  "check",
  "menu",
  "download",
  "refresh",
  "copy",
  "external",
  "mic",
  "settings",
  "language",
  "warning",
  "error",
  "success",
  "info",
  "chev-up",
  "chev-down",
  "chev-right",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** Icons carrying a gold accent layer (13 of 40). Must match frozen-v1. */
export const TWO_TONE_ICONS: ReadonlySet<IconName> = new Set<IconName>([
  "new-chat",
  "memory",
  "knowledge",
  "activity",
  "models",
  "pairing",
  "security",
  "chat",
  "devices",
  "deep-research",
  "ideas",
  "telemetry",
  "wizard",
]);

const INK: Record<IconName, ImageRequireSource> = {
  "new-chat": require("../../../../assets/icons/ink/nido-new-chat.png"),
  "memory": require("../../../../assets/icons/ink/nido-memory.png"),
  "knowledge": require("../../../../assets/icons/ink/nido-knowledge.png"),
  "activity": require("../../../../assets/icons/ink/nido-activity.png"),
  "models": require("../../../../assets/icons/ink/nido-models.png"),
  "pairing": require("../../../../assets/icons/ink/nido-pairing.png"),
  "security": require("../../../../assets/icons/ink/nido-security.png"),
  "appearance": require("../../../../assets/icons/ink/nido-appearance.png"),
  "chat": require("../../../../assets/icons/ink/nido-chat.png"),
  "devices": require("../../../../assets/icons/ink/nido-devices.png"),
  "deep-research": require("../../../../assets/icons/ink/nido-deep-research.png"),
  "ideas": require("../../../../assets/icons/ink/nido-ideas.png"),
  "telemetry": require("../../../../assets/icons/ink/nido-telemetry.png"),
  "compass": require("../../../../assets/icons/ink/nido-compass.png"),
  "wizard": require("../../../../assets/icons/ink/nido-wizard.png"),
  "back": require("../../../../assets/icons/ink/nido-back.png"),
  "close": require("../../../../assets/icons/ink/nido-close.png"),
  "search": require("../../../../assets/icons/ink/nido-search.png"),
  "send": require("../../../../assets/icons/ink/nido-send.png"),
  "stop": require("../../../../assets/icons/ink/nido-stop.png"),
  "play": require("../../../../assets/icons/ink/nido-play.png"),
  "pause": require("../../../../assets/icons/ink/nido-pause.png"),
  "add": require("../../../../assets/icons/ink/nido-add.png"),
  "delete": require("../../../../assets/icons/ink/nido-delete.png"),
  "check": require("../../../../assets/icons/ink/nido-check.png"),
  "menu": require("../../../../assets/icons/ink/nido-menu.png"),
  "download": require("../../../../assets/icons/ink/nido-download.png"),
  "refresh": require("../../../../assets/icons/ink/nido-refresh.png"),
  "copy": require("../../../../assets/icons/ink/nido-copy.png"),
  "external": require("../../../../assets/icons/ink/nido-external.png"),
  "mic": require("../../../../assets/icons/ink/nido-mic.png"),
  "settings": require("../../../../assets/icons/ink/nido-settings.png"),
  "language": require("../../../../assets/icons/ink/nido-language.png"),
  "warning": require("../../../../assets/icons/ink/nido-warning.png"),
  "error": require("../../../../assets/icons/ink/nido-error.png"),
  "success": require("../../../../assets/icons/ink/nido-success.png"),
  "info": require("../../../../assets/icons/ink/nido-info.png"),
  "chev-up": require("../../../../assets/icons/ink/nido-chev-up.png"),
  "chev-down": require("../../../../assets/icons/ink/nido-chev-down.png"),
  "chev-right": require("../../../../assets/icons/ink/nido-chev-right.png"),
};

const GOLD: Record<IconName, ImageRequireSource> = {
  "new-chat": require("../../../../assets/icons/gold/nido-new-chat.png"),
  "memory": require("../../../../assets/icons/gold/nido-memory.png"),
  "knowledge": require("../../../../assets/icons/gold/nido-knowledge.png"),
  "activity": require("../../../../assets/icons/gold/nido-activity.png"),
  "models": require("../../../../assets/icons/gold/nido-models.png"),
  "pairing": require("../../../../assets/icons/gold/nido-pairing.png"),
  "security": require("../../../../assets/icons/gold/nido-security.png"),
  "chat": require("../../../../assets/icons/gold/nido-chat.png"),
  "devices": require("../../../../assets/icons/gold/nido-devices.png"),
  "deep-research": require("../../../../assets/icons/gold/nido-deep-research.png"),
  "ideas": require("../../../../assets/icons/gold/nido-ideas.png"),
  "telemetry": require("../../../../assets/icons/gold/nido-telemetry.png"),
  "wizard": require("../../../../assets/icons/gold/nido-wizard.png"),
} as Record<IconName, ImageRequireSource>;

export function hasGoldLayer(name: IconName): boolean {
  return TWO_TONE_ICONS.has(name);
}

/** Type guard: true when a string is one of the 40 frozen icon names. */
const NAME_SET: ReadonlySet<string> = new Set<string>(ICON_NAMES);
export function isIconName(value: string): value is IconName {
  return NAME_SET.has(value);
}

export function iconInkSource(name: IconName): ImageRequireSource {
  return INK[name];
}

export function iconGoldSource(name: IconName): ImageRequireSource | undefined {
  return hasGoldLayer(name) ? GOLD[name] : undefined;
}
