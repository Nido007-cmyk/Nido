/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Adaptive routing Phase 2 — model profiles and presets. Configuration layer
 * only, independent from the UI (per the build plan) and from execution
 * (Phase 3/4 aren't built yet) — this module answers "given what's actually
 * downloaded on this device, which model fills each role", nothing more.
 *
 * Deliberately does not require three models. Per docs/ADAPTIVE_ROUTING.md
 * §3: only one generation model can be resident at a time, so a plan that
 * uses multiple roles executes them sequentially — this module doesn't
 * decide *when* to switch, only *what's available* to switch to.
 */
import { CatalogModel } from "../models/manifest";
import { computeCompatibility, Compatibility } from "../models/compatibility";
import { contextSpecForModel } from "../models/defaultModel";
import { estimateContextBytes } from "../inference/ramBudget";
import { ModelRole, RoutingPreset } from "./types";

export interface ModelProfile {
  modelId: string;
  role: ModelRole;
  enabled: boolean;
  /** True if this came from an explicit user role assignment, false if auto-resolved. */
  userOverride: boolean;
  estimatedMemoryMb?: number;
  estimatedTokensPerSecond?: number;
  compatibilityStatus: Compatibility;
}

/**
 * Which roles a preset actually uses, and whether each is required (the
 * preset is non-functional without it) or optional (skipped gracefully if
 * unavailable — see resolveModelForRole's fallback behavior). This is
 * config data, not execution logic: Phase 3's router decides *whether* to
 * take the retrieve/verify steps for a given query, this just declares
 * which roles that decision space includes.
 */
export interface PresetDefinition {
  id: RoutingPreset;
  /** Roles this preset is allowed to use, and whether each is required or optional. */
  roles: Partial<Record<ModelRole, "required" | "optional">>;
}

export const PRESET_DEFINITIONS: Record<RoutingPreset, PresetDefinition> = {
  simple: {
    id: "simple",
    // One model, minimal overhead — matches today's existing single-pass
    // chat behavior almost exactly, deliberately, so picking "Simple" isn't
    // a behavior change for someone who never touches routing settings.
    roles: { general: "required" },
  },
  balanced: {
    id: "balanced",
    roles: { general: "required", fast: "optional", embedding: "optional" },
  },
  research: {
    id: "research",
    roles: { reasoning: "required", general: "optional", verifier: "optional", embedding: "optional" },
  },
  custom: {
    id: "custom",
    // No fixed roles — Custom's whole point is the user decides which
    // roles are active; UI phase provides the actual enable/disable + model
    // assignment controls. Kept intentionally empty here.
    roles: {},
  },
};

/** A model is "available" for routing purposes once it's actually on disk, not just in the catalog. */
export interface AvailableModel {
  model: CatalogModel;
  present: boolean;
}

/**
 * Resolves a role to a specific downloaded model.
 *
 * Resolution order:
 * 1. User's explicit override for this role, if it's present on disk.
 * 2. A curated MODEL_CATALOG entry whose capabilities.roles includes this
 *    role, if present on disk.
 * 3. Graceful fallback: the currently-active/default LLM, if any LLM is
 *    present — matches the plan's "a user with one suitable model should
 *    still have a functional app" requirement. The fallback is flagged
 *    (userOverride: false, and the caller can tell it wasn't a real match
 *    via the returned model's capabilities not listing this role) so it's
 *    visible in debug/UI, never silent.
 * 4. Nothing available: returns an explicit disabled profile, never throws
 *    and never routes to a model that isn't actually on disk.
 */
export function resolveModelForRole(
  role: ModelRole,
  available: AvailableModel[],
  overrides: Partial<Record<ModelRole, string>>,
  deviceRamBytes: number,
  fallbackModelId?: string
): ModelProfile {
  const presentModels = available.filter((a) => a.present).map((a) => a.model);
  const presentById = new Map(presentModels.map((m) => [m.id, m]));

  const overrideId = overrides[role];
  if (overrideId && presentById.has(overrideId)) {
    const model = presentById.get(overrideId)!;
    return toProfile(model, role, true, deviceRamBytes);
  }

  const curated = presentModels.find((m) => m.capabilities?.roles.includes(role));
  if (curated) {
    return toProfile(curated, role, false, deviceRamBytes);
  }

  if (fallbackModelId && presentById.has(fallbackModelId)) {
    const model = presentById.get(fallbackModelId)!;
    return toProfile(model, role, false, deviceRamBytes);
  }

  return {
    modelId: "",
    role,
    enabled: false,
    userOverride: false,
    compatibilityStatus: "unknown",
  };
}

function toProfile(
  model: CatalogModel,
  role: ModelRole,
  userOverride: boolean,
  deviceRamBytes: number
): ModelProfile {
  return {
    modelId: model.id,
    role,
    enabled: true,
    userOverride,
    estimatedMemoryMb:
      model.capabilities?.estimatedMemoryMb ??
      Math.round(estimateContextBytes(contextSpecForModel(model)).totalBytes / (1024 * 1024)),
    estimatedTokensPerSecond: model.capabilities?.estimatedTokensPerSecond,
    compatibilityStatus: computeCompatibility(model, deviceRamBytes),
  };
}

/**
 * Resolves every role a preset needs into ModelProfiles. Required roles
 * that can't be resolved to any present model are still returned
 * (enabled: false) rather than omitted, so the caller can surface why the
 * preset isn't fully functional instead of silently missing a step.
 */
export function buildModelProfiles(
  preset: RoutingPreset,
  available: AvailableModel[],
  overrides: Partial<Record<ModelRole, string>>,
  deviceRamBytes: number,
  fallbackModelId?: string
): ModelProfile[] {
  const definition = PRESET_DEFINITIONS[preset];
  return Object.keys(definition.roles).map((role) =>
    resolveModelForRole(role as ModelRole, available, overrides, deviceRamBytes, fallbackModelId)
  );
}
