/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Feature flags — delegated task execution.
 *
 * TESTFIX-2026-10-08 (Fix 7): the flag was `as const` (compile-time OFF)
 * and NOTHING read it — delegation was unwireable. Now:
 * - `isFeatureEnabled()` stays synchronous (safe to call in hot paths and
 *   message handlers), reading an in-memory override map over defaults.
 * - `setFeatureEnabled()` persists to disk; `loadFeatureFlags()` hydrates
 *   at startup. Persistence is best-effort (fail-open to defaults, which
 *   are all OFF — fail-closed direction for risky features).
 *
 * SAFETY: `delegation.enabled` defaults to OFF. All delegation code
 * paths (protocol handlers, executor, approval UI) must check this
 * flag and stay unreachable when it is off. The existing P2P stack
 * (transport, handshake, negotiation, chat) never reads this flag.
 */

export type FeatureFlag = "delegation.enabled";

const DEFAULTS: Record<FeatureFlag, boolean> = {
  /** Delegated task execution NIDO-A -> NIDO-B. Default OFF. */
  "delegation.enabled": false,
};

/** In-memory overrides (hydrated from disk by loadFeatureFlags). */
const overrides = new Map<string, boolean>();

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const o = overrides.get(flag);
  if (o !== undefined) return o;
  return DEFAULTS[flag] === true;
}

/** Test/introspection helper: clear in-memory overrides (does not touch disk). */
export function resetFeatureFlagsForTests(): void {
  overrides.clear();
}

const FLAGS_PATH_SUFFIX = "feature-flags.json";

async function flagsPath(): Promise<string> {
  const { documentDirectory } = await import("expo-file-system/legacy");
  return `${documentDirectory ?? ""}${FLAGS_PATH_SUFFIX}`;
}

/** Persist a flag value. Best-effort: failures keep the in-memory value. */
export async function setFeatureEnabled(
  flag: FeatureFlag,
  value: boolean
): Promise<void> {
  overrides.set(flag, value);
  try {
    const path = await flagsPath();
    const { readAsStringAsync, writeAsStringAsync, getInfoAsync } = await import(
      "expo-file-system/legacy"
    );
    let current: Record<string, boolean> = {};
    try {
      const info = await getInfoAsync(path);
      if (info.exists) {
        const raw = await readAsStringAsync(path);
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          current = parsed as Record<string, boolean>;
        }
      }
    } catch {
      // Corrupt file: overwrite with current overrides.
    }
    current[flag] = value;
    await writeAsStringAsync(path, JSON.stringify(current));
  } catch {
    // Disk unavailable: in-memory value stands for this session.
  }
}

/** Hydrate overrides from disk. Call once at startup. Never throws. */
export async function loadFeatureFlags(): Promise<void> {
  try {
    const path = await flagsPath();
    const { readAsStringAsync, getInfoAsync } = await import(
      "expo-file-system/legacy"
    );
    const info = await getInfoAsync(path);
    if (!info.exists) return;
    const raw = await readAsStringAsync(path);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (k in DEFAULTS && typeof v === "boolean") {
        overrides.set(k, v);
      }
    }
  } catch {
    // Fail-open to defaults (all OFF).
  }
}
