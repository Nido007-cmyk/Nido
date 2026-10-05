import * as FileSystem from "expo-file-system/legacy";
import { AssetKind } from "./manifest";
import { PersonalityId, DEFAULT_PERSONALITY_ID } from "../constants/personalities";
import { ModelRole, RoutingPreset } from "../routing/types";
import {
  SETTINGS_FORMAT_VERSION,
  SettingsVersionError,
  checkFormatVersion,
} from "../security/formatVersion";
/** Tier 2 (frozen 2026-09-27): only Daylight and Night Garden remain. */
export type ThemeId = "daylight" | "nightgarden";
export type FontScale = "compact" | "standard" | "large";
export type LanguageId = "en" | "pt" | "es";

interface Settings {
  /**
   * L1 — contrato de versionado. Cada escritura estampa format_version=1;
   * la lectura lo exige cuando está presente. Un fichero pre-versionado
   * (sin el campo) se acepta como v1 y se estampa en la próxima escritura.
   * Claves desconocidas se siguen tolerando (spread sobre defaults).
   */
  format_version?: unknown;
  activeModelId: Partial<Record<AssetKind, string>>;
  hidePromptIdeas?: boolean;
  personalityId?: PersonalityId;
  customSystemPrompt?: string;
  maxTokens?: number;
  hapticsEnabled?: boolean;
  voiceInputEnabled?: boolean;
  readAloudEnabled?: boolean;
  autoSummarize?: boolean;
  historyTurnThreshold?: number;
  maxSavedSessions?: number;
  autoGenerateTitles?: boolean;
  deepResearchMode?: boolean;
  themeId?: ThemeId;
  fontScale?: FontScale;
  languageId?: LanguageId;
  routingPreset?: RoutingPreset;
  modelRoleAssignments?: Partial<Record<ModelRole, string>>;
  adaptiveRoutingEnabled?: boolean;
}

export interface MemorySettings {
  autoSummarize: boolean;
  historyTurnThreshold: number;
  maxSavedSessions: number;
  autoGenerateTitles: boolean;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  autoSummarize: true,
  historyTurnThreshold: 6,
  maxSavedSessions: 10,
  autoGenerateTitles: true,
};

const SETTINGS_PATH = `${FileSystem.documentDirectory}settings.json`;
const DEFAULT_SETTINGS: Settings = { activeModelId: {} };
export const DEFAULT_MAX_TOKENS = 512;

async function readSettings(): Promise<Settings> {
  let raw: unknown;
  try {
    const info = await FileSystem.getInfoAsync(SETTINGS_PATH);
    if (!info.exists) return { ...DEFAULT_SETTINGS };
    raw = JSON.parse(await FileSystem.readAsStringAsync(SETTINGS_PATH));
  } catch {
    // Fichero ilegible (JSON corrupto, E/S): degradar a defaults, como
    // antes. La versión se chequea FUERA de este try: un format_version
    // desconocido o más nuevo nunca degrada en silencio — falla cerrado
    // con SettingsVersionError.
    return { ...DEFAULT_SETTINGS };
  }
  const parsed: Settings =
    typeof raw === "object" && raw !== null ? (raw as Settings) : { activeModelId: {} };
  if (parsed.format_version !== undefined) {
    checkFormatVersion({
      formatId: "settings.json",
      found: parsed.format_version,
      supportedMajor: SETTINGS_FORMAT_VERSION,
      ErrorClass: SettingsVersionError,
    });
  }
  // Claves desconocidas (p. ej. de un futuro) se toleran: spread sobre
  // defaults, solo la versión es exigida.
  return { ...DEFAULT_SETTINGS, ...parsed };
}

async function writeSettings(s: Settings): Promise<void> {
  await FileSystem.writeAsStringAsync(
    SETTINGS_PATH,
    JSON.stringify({ ...s, format_version: SETTINGS_FORMAT_VERSION })
  );
}

/** Deletes the settings file outright (used by appReset.ts) — next read falls back to defaults. */
export async function clearSettings(): Promise<void> {
  await FileSystem.deleteAsync(SETTINGS_PATH, { idempotent: true });
}

/** The user's chosen model for this kind, or null to fall back to the default. */
export async function getActiveModelId(kind: AssetKind): Promise<string | null> {
  const s = await readSettings();
  return s.activeModelId[kind] ?? null;
}

export async function setActiveModelId(kind: AssetKind, id: string): Promise<void> {
  const s = await readSettings();
  s.activeModelId[kind] = id;
  await writeSettings(s);
}

/** "Don't show again" preference for the prompt-ideas onboarding carousel. */
export async function getHidePromptIdeas(): Promise<boolean> {
  const s = await readSettings();
  return s.hidePromptIdeas ?? false;
}

export async function setHidePromptIdeas(hide: boolean): Promise<void> {
  const s = await readSettings();
  s.hidePromptIdeas = hide;
  await writeSettings(s);
}

export async function getPersonalityId(): Promise<PersonalityId> {
  const s = await readSettings();
  return s.personalityId ?? DEFAULT_PERSONALITY_ID;
}

export async function setPersonalityId(id: PersonalityId): Promise<void> {
  const s = await readSettings();
  s.personalityId = id;
  await writeSettings(s);
}

export async function getCustomSystemPrompt(): Promise<string> {
  const s = await readSettings();
  return s.customSystemPrompt ?? "";
}

export async function setCustomSystemPrompt(prompt: string): Promise<void> {
  const s = await readSettings();
  s.customSystemPrompt = prompt;
  await writeSettings(s);
}

export async function getMaxTokens(): Promise<number> {
  const s = await readSettings();
  return s.maxTokens ?? DEFAULT_MAX_TOKENS;
}

export async function setMaxTokens(maxTokens: number): Promise<void> {
  const s = await readSettings();
  s.maxTokens = maxTokens;
  await writeSettings(s);
}

export async function getHapticsEnabled(): Promise<boolean> {
  const s = await readSettings();
  return s.hapticsEnabled ?? true;
}

export async function setHapticsEnabled(enabled: boolean): Promise<void> {
  const s = await readSettings();
  s.hapticsEnabled = enabled;
  await writeSettings(s);
}

/** Whether the chat shows the microphone button. */
export async function getVoiceInputEnabled(): Promise<boolean> {
  const s = await readSettings();
  return s.voiceInputEnabled ?? true;
}

export async function setVoiceInputEnabled(enabled: boolean): Promise<void> {
  const s = await readSettings();
  s.voiceInputEnabled = enabled;
  await writeSettings(s);
}

/** Whether NIDO reads its answers aloud (offline system TTS). Default off. */
export async function getReadAloudEnabled(): Promise<boolean> {
  const s = await readSettings();
  return s.readAloudEnabled ?? false;
}

export async function setReadAloudEnabled(enabled: boolean): Promise<void> {
  const s = await readSettings();
  s.readAloudEnabled = enabled;
  await writeSettings(s);
}

export async function getMemorySettings(): Promise<MemorySettings> {
  const s = await readSettings();
  return {
    autoSummarize: s.autoSummarize ?? DEFAULT_MEMORY_SETTINGS.autoSummarize,
    historyTurnThreshold: s.historyTurnThreshold ?? DEFAULT_MEMORY_SETTINGS.historyTurnThreshold,
    maxSavedSessions: s.maxSavedSessions ?? DEFAULT_MEMORY_SETTINGS.maxSavedSessions,
    autoGenerateTitles: s.autoGenerateTitles ?? DEFAULT_MEMORY_SETTINGS.autoGenerateTitles,
  };
}

export async function setMemorySettings(patch: Partial<MemorySettings>): Promise<void> {
  const s = await readSettings();
  Object.assign(s, patch);
  await writeSettings(s);
}

/**
 * "Deep Research Mode" — a sequential multi-pass pipeline over the same
 * single model (decompose -> research sub-questions -> synthesize), not
 * multiple models running concurrently. See src/services/orchestrator.ts.
 */
export async function getDeepResearchMode(): Promise<boolean> {
  const s = await readSettings();
  return s.deepResearchMode ?? false;
}

export async function setDeepResearchMode(enabled: boolean): Promise<void> {
  const s = await readSettings();
  s.deepResearchMode = enabled;
  await writeSettings(s);
}

export async function getThemeId(): Promise<ThemeId> {
  const s = await readSettings();
  // Tier 2 (2026-09-27): Daylight is the primary visual reference. Fresh
  // installs start here; a persisted choice always wins. Pre-Tier-2 terminal
  // theme ids (midnight/amber/frontier) migrate to Night Garden so dark-mode
  // users keep a dark theme.
  const stored = s.themeId as string | undefined;
  if (stored === "midnight" || stored === "amber" || stored === "frontier") {
    return "nightgarden";
  }
  return (stored as ThemeId) ?? "daylight";
}

export async function setThemeId(theme: ThemeId): Promise<void> {
  const s = await readSettings();
  s.themeId = theme;
  await writeSettings(s);
}

export async function getFontScale(): Promise<FontScale> {
  const s = await readSettings();
  return s.fontScale ?? "standard";
}

export async function setFontScale(scale: FontScale): Promise<void> {
  const s = await readSettings();
  s.fontScale = scale;
  await writeSettings(s);
}

/**
 * Language used when the user hasn't picked one explicitly: English.
 * NIDO is English-first — the device locale does not change the default.
 * Spanish and Portuguese remain fully user-selectable via Settings →
 * Language, and the choice is persisted. No network involved.
 */
export function deviceDefaultLanguage(): LanguageId {
  return "en";
}

export async function getLanguageId(): Promise<LanguageId> {
  const s = await readSettings();
  return s.languageId ?? deviceDefaultLanguage();
}

export async function setLanguageId(language: LanguageId): Promise<void> {
  const s = await readSettings();
  s.languageId = language;
  await writeSettings(s);
}

/**
 * Default preset when nothing's been explicitly set. `getRoutingPreset()`
 * has exactly one caller right now (`src/services/adaptiveChat.ts`'s
 * `runAdaptiveChat`, Phase 9) — it's read only when the separate
 * `adaptiveRoutingEnabled` flag is on (the default), so this is the preset
 * every user gets unless they turn adaptive routing off.
 *
 * Temporarily `"balanced"` (not `"simple"`) for real-device Phase 9
 * testing: `"simple"` only ever declares a `general` role slot (see
 * routing/profiles.ts's PRESET_DEFINITIONS), so with it, turning on
 * Adaptive Routing alone — with no preset picker UI yet to change this —
 * would never actually exercise any model switching, just silently
 * resolve to the same single model every time. `"balanced"` is the
 * smallest preset that unlocks the `fast` role, without inventing a new
 * preset or touching the routing rules themselves (router.ts/classify.ts/
 * profiles.ts are unchanged). Revert to `"simple"` (or replace with a real
 * picker UI) once real-device testing no longer needs this.
 */
export async function getRoutingPreset(): Promise<RoutingPreset> {
  const s = await readSettings();
  return s.routingPreset ?? "balanced";
}

export async function setRoutingPreset(preset: RoutingPreset): Promise<void> {
  const s = await readSettings();
  s.routingPreset = preset;
  await writeSettings(s);
}

export async function getModelRoleAssignments(): Promise<Partial<Record<ModelRole, string>>> {
  const s = await readSettings();
  return s.modelRoleAssignments ?? {};
}

export async function setModelRoleAssignment(role: ModelRole, modelId: string | undefined): Promise<void> {
  const s = await readSettings();
  const assignments = { ...(s.modelRoleAssignments ?? {}) };
  if (modelId) {
    assignments[role] = modelId;
  } else {
    delete assignments[role];
  }
  s.modelRoleAssignments = assignments;
  await writeSettings(s);
}

/**
 * Phase 9 (docs/ADAPTIVE_ROUTING.md) — wires planRoute()/executeRoutingPlan()
 * into ordinary chat (Deep Research Mode is unaffected either way, see
 * src/services/orchestrator.ts). Off by default: a real, reversible
 * feature flag, not a default-on behavior change, until real-device
 * testing passes. ChatScreen.tsx falls back to the existing fixed-active-
 * model path whenever this is off OR whenever the adaptive path throws for
 * any reason — a routing failure must never leave the user without a
 * response.
 */
export async function getAdaptiveRoutingEnabled(): Promise<boolean> {
  const s = await readSettings();
  return s.adaptiveRoutingEnabled ?? true;
}

export async function setAdaptiveRoutingEnabled(enabled: boolean): Promise<void> {
  const s = await readSettings();
  s.adaptiveRoutingEnabled = enabled;
  await writeSettings(s);
}
