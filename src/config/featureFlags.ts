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
 *   at startup. Persistence is best-effort (fail-open to defaults). Since
 *   0.1.49 the P2P protections (sealed hello, v5) default ON; risky
 *   features (delegation, panic button) stay OFF.
 *
 * SAFETY: `delegation.enabled` defaults to OFF. All delegation code
 * paths (protocol handlers, executor, approval UI) must check this
 * flag and stay unreachable when it is off. The existing P2P stack
 * (transport, handshake, negotiation, chat) never reads this flag.
 */

export type FeatureFlag =
  | "delegation.enabled"
  | "p2p.sealedHandshake"
  | "p2p.ratchetV5"
  | "p2p.privateHelloOnly"
  | "security.panicButton";

const DEFAULTS: Record<FeatureFlag, boolean> = {
  /** Delegated task execution NIDO-A -> NIDO-B. Default OFF. */
  "delegation.enabled": false,
  /**
   * P2P v4 (2026-10-21): saludo sellado, sin identidad en claro. Solo cambia
   * lo que ENVÍA este teléfono al llamar a un contacto que ya dijo soportarlo.
   * Recibir saludos sellados funciona siempre. 0.1.49: ON por defecto (nada
   * débil por defecto); con un contacto que no lo soporta no cambia nada.
   */
  "p2p.sealedHandshake": true,
  /**
   * P2P v5 (0.1.46): clave nueva por mensaje (Double Ratchet) y arranque
   * híbrido X25519 + ML-KEM-768. Solo se usa si los DOS teléfonos lo tienen
   * activado; si no, la sesión sigue en el modo de siempre. 0.1.49: ON por
   * defecto; un teléfono viejo o con v5 apagado sigue en el modo clásico.
   */
  "p2p.ratchetV5": true,
  /**
   * 0.1.55: «Solo saludo privado». Con él encendido este teléfono NUNCA dice
   * en claro quién es: no llama a contactos que no admiten el saludo sellado
   * (NIDO anteriores a la 0.1.49), no llama a dispositivos sin contacto
   * conocido (la lista de cercanos) y rechaza los saludos en claro que le
   * lleguen. Default OFF: encendido deja sin conexión a quien tenga un NIDO
   * viejo, y eso lo decide el usuario.
   */
  "p2p.privateHelloOnly": false,
  /**
   * Botón de pánico (0.1.46, como Briar): muestra en la pantalla principal un
   * botón que, mantenido 3 segundos, borra todos los datos de NIDO sin más
   * preguntas. Default OFF: lo activa el usuario en Ajustes.
   */
  "security.panicButton": false,
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

/**
 * Solo tests: fija un interruptor en memoria (sin tocar disco). Los arneses
 * que fabrican frames clásicos a mano fijan v5 apagado con esto.
 */
export function setFeatureOverrideForTests(flag: FeatureFlag, value: boolean): void {
  overrides.set(flag, value);
}

/** 0.1.47: tras borrar todos los datos, los interruptores vuelven a los de fábrica. */
export function resetFeatureFlagsInMemory(): void {
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
    // Fail-open to defaults.
  }
}
