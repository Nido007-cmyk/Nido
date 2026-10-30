/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
  /** Dictation only with the phone's on-device recognizer (default true). */
  voiceOnDeviceOnly?: boolean;
  readAloudEnabled?: boolean;
  /** 0.1.60: resumen diario de las 8:00. Opt-in (constitución §9). */
  dailySummaryEnabled?: boolean;
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
  /** Herramientas del agente que el usuario apagó. */
  disabledTools?: string[];
  /** 0.1.14: guía de usuario (onboarding visto, lecciones abiertas). */
  guideOnboardingDone?: boolean;
  guideVisited?: string[];
  /** 0.1.15: the user said "not now" to the P2P battery hint. */
  p2pBatteryHintDismissed?: boolean;
  /** 0.1.51: the hardware-vault offer on the main screen: "never" or snoozed until (epoch ms). */
  vaultOfferNever?: boolean;
  vaultOfferSnoozeUntil?: number;
  /** 0.1.55: country chosen on the Emergency tab (ISO 3166-1 alpha-2). */
  emergencyRegion?: string;
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
/** C2-2026-10-06: tope del prompt de sistema personalizado (~500 tokens). */
export const MAX_CUSTOM_SYSTEM_PROMPT_CHARS = 2000;

/** A copy of the defaults that shares no object with DEFAULT_SETTINGS. */
function freshDefaults(): Settings {
  return { ...DEFAULT_SETTINGS, activeModelId: {} };
}

async function readSettings(): Promise<Settings> {
  let raw: unknown;
  try {
    const info = await FileSystem.getInfoAsync(SETTINGS_PATH);
    if (!info.exists) return freshDefaults();
    raw = JSON.parse(await FileSystem.readAsStringAsync(SETTINGS_PATH));
  } catch {
    // Fichero ilegible (JSON corrupto, E/S): degradar a defaults, como
    // antes. La versión se chequea FUERA de este try: un format_version
    // desconocido o más nuevo nunca degrada en silencio — falla cerrado
    // con SettingsVersionError.
    return freshDefaults();
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
  // activeModelId is always a fresh object: it used to be DEFAULT_SETTINGS's
  // own object when the file was missing or lacked it, so setActiveModelId
  // mutated the defaults and a model chosen before "Clear all data" came back
  // in memory until the next restart.
  return { ...DEFAULT_SETTINGS, ...parsed, activeModelId: { ...(parsed.activeModelId ?? {}) } };
}

/**
 * Offensive audit (0.1.18): atomic write. writeAsStringAsync over the live
 * file could leave it half written if the app is killed mid-write; the next
 * read then fell back to defaults and silently re-enabled every tool the user
 * had switched off (Agent permissions), reset the language, etc. Now: write a
 * temp file, then rename over the old one. Without moveAsync (test fakes)
 * it writes in place as before.
 */
async function writeSettings(s: Settings): Promise<void> {
  const json = JSON.stringify({ ...s, format_version: SETTINGS_FORMAT_VERSION });
  let move: typeof FileSystem.moveAsync | undefined;
  try {
    move = typeof FileSystem.moveAsync === "function" ? FileSystem.moveAsync : undefined;
  } catch {
    move = undefined;
  }
  if (!move) {
    await FileSystem.writeAsStringAsync(SETTINGS_PATH, json);
    return;
  }
  const tmp = `${SETTINGS_PATH}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, json);
  await move({ from: tmp, to: SETTINGS_PATH });
}

/**
 * Offensive audit (0.1.18): every change is read → modify → write, one at a
 * time. Before, two changes close together (typing the custom prompt, which
 * saves on every keystroke, while a tool is switched off, or the guide marks a
 * lesson) each read the old file and the last write erased the other change —
 * e.g. a tool the user had just disabled came back enabled.
 */
let settingsQueue: Promise<unknown> = Promise.resolve();
function mutateSettings(change: (s: Settings) => void): Promise<void> {
  const run = settingsQueue.then(async () => {
    const s = await readSettings();
    change(s);
    await writeSettings(s);
  });
  settingsQueue = run.catch(() => {});
  return run;
}

/** Deletes the settings file outright (used by appReset.ts) — next read falls back to defaults. */
export async function clearSettings(): Promise<void> {
  // Queued like every change, so a write already on its way can't recreate
  // the file right after the reset.
  const run = settingsQueue.then(async () => {
    await FileSystem.deleteAsync(SETTINGS_PATH, { idempotent: true });
    // También el ajuste privado cifrado (prompt personalizado).
    const km = await import("../privacy/keyManager").catch(() => null);
    await km?.writePrivateSetting(CUSTOM_PROMPT_KEY, null).catch(() => false);
  });
  settingsQueue = run.catch(() => {});
  return run;
}

/** The user's chosen model for this kind, or null to fall back to the default. */
export async function getActiveModelId(kind: AssetKind): Promise<string | null> {
  const s = await readSettings();
  return s.activeModelId[kind] ?? null;
}

export async function setActiveModelId(kind: AssetKind, id: string): Promise<void> {
  return mutateSettings((s) => {
    s.activeModelId[kind] = id;
  });
}

/** "Don't show again" preference for the prompt-ideas onboarding carousel. */
export async function getHidePromptIdeas(): Promise<boolean> {
  const s = await readSettings();
  return s.hidePromptIdeas ?? false;
}

export async function setHidePromptIdeas(hide: boolean): Promise<void> {
  return mutateSettings((s) => {
    s.hidePromptIdeas = hide;
  });
}

export async function getPersonalityId(): Promise<PersonalityId> {
  const s = await readSettings();
  return s.personalityId ?? DEFAULT_PERSONALITY_ID;
}

export async function setPersonalityId(id: PersonalityId): Promise<void> {
  return mutateSettings((s) => {
    s.personalityId = id;
  });
}

/**
 * Blindaje 0.1.44: el prompt personalizado es texto del usuario, así que se
 * guarda cifrado en SecureStore y no en `settings.json` en claro. Si
 * SecureStore no está disponible (tests, fallo del Keystore) se usa el
 * archivo como antes: nunca se pierde ni se rompe el ajuste.
 */
const CUSTOM_PROMPT_KEY = "nido_private_custom_prompt";

async function privateStore() {
  return import("../privacy/keyManager");
}

export async function getCustomSystemPrompt(): Promise<string> {
  const km = await privateStore();
  const secure = await km.readPrivateSetting(CUSTOM_PROMPT_KEY);
  if (typeof secure === "string") return secure;
  const s = await readSettings();
  const legacy = s.customSystemPrompt ?? "";
  if (secure === null && legacy) {
    // Migración: mover el valor viejo del archivo a SecureStore y quitarlo
    // del archivo solo si la escritura cifrada funcionó.
    if (await km.writePrivateSetting(CUSTOM_PROMPT_KEY, legacy)) {
      await mutateSettings((x) => {
        delete x.customSystemPrompt;
      }).catch(() => {});
    }
  }
  return legacy;
}

export async function setCustomSystemPrompt(prompt: string): Promise<void> {
  // C2-2026-10-06: cap para que un prompt personalizado gigante no rompa el
  // presupuesto de contexto del modelo.
  const value = (prompt ?? "").slice(0, MAX_CUSTOM_SYSTEM_PROMPT_CHARS);
  // En la misma cola que el resto de cambios: se guarda en cada tecla, y dos
  // escrituras seguidas no deben poder llegar al revés.
  const run = settingsQueue.then(async () => {
    const km = await privateStore();
    const secured = await km.writePrivateSetting(CUSTOM_PROMPT_KEY, value);
    const s = await readSettings();
    if (secured) delete s.customSystemPrompt;
    else s.customSystemPrompt = value;
    await writeSettings(s);
  });
  settingsQueue = run.catch(() => {});
  return run;
}

export async function getMaxTokens(): Promise<number> {
  const s = await readSettings();
  return s.maxTokens ?? DEFAULT_MAX_TOKENS;
}

export async function setMaxTokens(maxTokens: number): Promise<void> {
  return mutateSettings((s) => {
    s.maxTokens = maxTokens;
  });
}

export async function getHapticsEnabled(): Promise<boolean> {
  const s = await readSettings();
  return s.hapticsEnabled ?? true;
}

export async function setHapticsEnabled(enabled: boolean): Promise<void> {
  return mutateSettings((s) => {
    s.hapticsEnabled = enabled;
  });
}

/** Whether the chat shows the microphone button. */
export async function getVoiceInputEnabled(): Promise<boolean> {
  const s = await readSettings();
  return s.voiceInputEnabled ?? true;
}

export async function setVoiceInputEnabled(enabled: boolean): Promise<void> {
  return mutateSettings((s) => {
    s.voiceInputEnabled = enabled;
  });
}

/**
 * Auditoría 2026-10-29 (y lección de Briar: un solo canal fuera del
 * perímetro rompe la promesa entera): el dictado solo usa el reconocedor que
 * funciona EN el teléfono. El servicio del sistema puede mandar el audio a
 * internet; usarlo es una decisión de la persona. Default true.
 */
export async function getVoiceOnDeviceOnly(): Promise<boolean> {
  const s = await readSettings();
  return s.voiceOnDeviceOnly ?? true;
}

export async function setVoiceOnDeviceOnly(onDeviceOnly: boolean): Promise<void> {
  return mutateSettings((s) => {
    s.voiceOnDeviceOnly = onDeviceOnly;
  });
}

/** Whether NIDO reads its answers aloud (offline system TTS). Default off. */
export async function getReadAloudEnabled(): Promise<boolean> {
  const s = await readSettings();
  return s.readAloudEnabled ?? false;
}

export async function setReadAloudEnabled(enabled: boolean): Promise<void> {
  return mutateSettings((s) => {
    s.readAloudEnabled = enabled;
  });
}

/**
 * 0.1.60: el resumen diario de las 8:00 es opcional y viene apagado. Antes
 * se programaba solo en cuanto había permiso de notificaciones; la
 * constitución de NIDO (§9) dice que las notificaciones son las que la
 * persona pide.
 */
export async function getDailySummaryEnabled(): Promise<boolean> {
  const s = await readSettings();
  return s.dailySummaryEnabled ?? false;
}

export async function setDailySummaryEnabled(enabled: boolean): Promise<void> {
  return mutateSettings((s) => {
    s.dailySummaryEnabled = enabled;
  });
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
  return mutateSettings((s) => {
    Object.assign(s, patch);
  });
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
  return mutateSettings((s) => {
    s.deepResearchMode = enabled;
  });
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
  return mutateSettings((s) => {
    s.themeId = theme;
  });
}

export async function getFontScale(): Promise<FontScale> {
  const s = await readSettings();
  return s.fontScale ?? "standard";
}

export async function setFontScale(scale: FontScale): Promise<void> {
  return mutateSettings((s) => {
    s.fontScale = scale;
  });
}

/**
 * Language used when the user hasn't picked one explicitly.
 * H7-2026-10-06: detect the device locale via Intl (no native dependency);
 * default to Spanish on es-* devices, Portuguese on pt-*, English otherwise.
 * The user can still override via Settings → Language (persisted).
 */
export function deviceDefaultLanguage(): LanguageId {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    if (locale.startsWith("es")) return "es";
    if (locale.startsWith("pt")) return "pt";
  } catch {
    // Intl unavailable: fall through to English default.
  }
  return "en";
}

/** Country code from the device locale ("es-CL" → "CL"), or null. */
export function deviceRegion(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const m = /[-_]([A-Za-z]{2})(?:$|[-_])/.exec(locale);
    return m ? m[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

/** 0.1.55: the Emergency tab's country; the device's region until the user picks one. */
export async function getEmergencyRegion(): Promise<string | null> {
  const s = await readSettings();
  return s.emergencyRegion ?? deviceRegion();
}

export async function setEmergencyRegion(code: string): Promise<void> {
  if (!/^[A-Z]{2}$/.test(code)) return;
  return mutateSettings((s) => {
    s.emergencyRegion = code;
  });
}

export async function getLanguageId(): Promise<LanguageId> {
  const s = await readSettings();
  return s.languageId ?? deviceDefaultLanguage();
}

export async function setLanguageId(language: LanguageId): Promise<void> {
  return mutateSettings((s) => {
    s.languageId = language;
  });
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
  return mutateSettings((s) => {
    s.routingPreset = preset;
  });
}

export async function getModelRoleAssignments(): Promise<Partial<Record<ModelRole, string>>> {
  const s = await readSettings();
  return s.modelRoleAssignments ?? {};
}

export async function setModelRoleAssignment(role: ModelRole, modelId: string | undefined): Promise<void> {
  return mutateSettings((s) => {
    const assignments = { ...(s.modelRoleAssignments ?? {}) };
    if (modelId) {
      assignments[role] = modelId;
    } else {
      delete assignments[role];
    }
    s.modelRoleAssignments = assignments;
  });
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
  return mutateSettings((s) => {
    s.adaptiveRoutingEnabled = enabled;
  });
}

/** Herramientas del agente que el usuario apagó (permisos del agente). */
export async function getDisabledToolNames(): Promise<string[]> {
  const s = await readSettings();
  return Array.isArray(s.disabledTools)
    ? s.disabledTools.filter((n): n is string => typeof n === "string")
    : [];
}

export async function setDisabledToolNames(names: string[]): Promise<void> {
  return mutateSettings((s) => {
    s.disabledTools = [...new Set(names)].sort();
  });
}

// ------------------------------------------------------------ guía (0.1.14)

/** Whether the 3-screen onboarding was already shown (or skipped). */
export async function getGuideOnboardingDone(): Promise<boolean> {
  const s = await readSettings();
  return s.guideOnboardingDone === true;
}

export async function setGuideOnboardingDone(done = true): Promise<void> {
  return mutateSettings((s) => {
    s.guideOnboardingDone = done;
  });
}

/** Lessons the user opened ("module.lesson"). Losing it is harmless. */
export async function getGuideVisited(): Promise<string[]> {
  const s = await readSettings();
  return Array.isArray(s.guideVisited) ? s.guideVisited.filter((x) => typeof x === "string") : [];
}

export async function markGuideVisited(id: string): Promise<void> {
  return mutateSettings((s) => {
    const list = Array.isArray(s.guideVisited) ? s.guideVisited : [];
    if (list.includes(id)) return;
    s.guideVisited = [...list, id].slice(-200);
  });
}

/** 0.1.51: ¿toca ofrecer la protección por hardware en la pantalla principal? */
export async function getVaultOfferState(): Promise<{ never: boolean; snoozeUntil: number }> {
  const s = await readSettings();
  return { never: s.vaultOfferNever === true, snoozeUntil: Number(s.vaultOfferSnoozeUntil ?? 0) || 0 };
}

export async function snoozeVaultOffer(untilMs: number): Promise<void> {
  return mutateSettings((s) => {
    s.vaultOfferSnoozeUntil = untilMs;
  });
}

export async function neverOfferVault(): Promise<void> {
  return mutateSettings((s) => {
    s.vaultOfferNever = true;
  });
}

export async function getP2PBatteryHintDismissed(): Promise<boolean> {
  const s = await readSettings();
  return s.p2pBatteryHintDismissed === true;
}

export async function setP2PBatteryHintDismissed(dismissed: boolean): Promise<void> {
  return mutateSettings((s) => {
    s.p2pBatteryHintDismissed = dismissed;
  });
}
