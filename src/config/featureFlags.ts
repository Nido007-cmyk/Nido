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
  | "p2p.relay"
  | "p2p.relaySend"
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
   * en claro quién es al LLAMAR: no llama a contactos que no admiten el
   * saludo sellado (NIDO anteriores a la 0.1.49) ni a dispositivos sin
   * contacto conocido (la lista de cercanos).
   *
   * 0.1.99 (auditoría M-21): ON por defecto, como las demás protecciones
   * del P2P desde la 0.1.49 (nada débil por defecto). El volteo solo
   * endurece la INICIACIÓN: el lado respondedor sigue contestando los
   * saludos en claro que le lleguen, y solo los rechaza si el usuario
   * encendió el ajuste EXPRESAMENTE (ver `isFeatureExplicitlyEnabled`,
   * que es lo que lee el respondedor). Quien ya tocó el ajuste conserva
   * su elección: su valor guardado manda sobre este defecto, y apagarlo
   * en Ajustes restaura el comportamiento anterior entero.
   */
  "p2p.privateHelloOnly": true,
  /**
   * Mensajes de amigo en amigo (docs/RELAY.md): dar mi clave de buzón a los
   * contactos, sellar en sobre los mensajes que no salen directos y abrir
   * los que me traen. ON por defecto; llevar sobres de OTROS es un ajuste
   * aparte, apagado por defecto. Apagado, el teléfono ni manda ni acepta
   * nada de esto (interruptor de emergencia).
   */
  "p2p.relay": true,
  /**
   * 0.1.99 (auditoría m-51): sellar en sobre los mensajes PROPIOS que no
   * salen directos, para que los lleven los contactos. Es una cara del
   * relevo distinta de llevar sobres de otros (ajuste aparte, en la
   * tarjeta del relevo): quien no quiere que sus mensajes viajen de
   * teléfono en teléfono lo apaga aquí sin tocar lo demás. ON por
   * defecto: sellar es el comportamiento del relevo desde que existe.
   * Apagado, no se sella nada nuevo; los sobres ya en viaje terminan su
   * vida de 72 horas como siempre.
   */
  "p2p.relaySend": true,
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

/**
 * 0.1.99 (auditoría M-21): ¿el usuario encendió este interruptor
 * EXPRESAMENTE? Solo cuenta su elección (el valor guardado en disco o
 * fijado en memoria), nunca el defecto del código. Lo lee quien no debe
 * endurecerse por un volteo de defecto: el respondedor del saludo, que
 * solo rechaza saludos en claro si el usuario lo pidió él mismo.
 */
export function isFeatureExplicitlyEnabled(flag: FeatureFlag): boolean {
  return overrides.get(flag) === true;
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

/**
 * Persist a flag value. Best-effort: failures keep the in-memory value.
 *
 * Auditoría completa 2026-10-31 (F3-11): la escritura era directa y
 * sin cola, al contrario que settings.ts. Un corte a mitad dejaba el
 * JSON roto y loadFeatureFlags cae a los valores de fábrica en
 * silencio (fail-open: p2p.privateHelloOnly, que el usuario había
 * encendido, volvía a apagado sin decirlo), y dos cambios casi a la
 * vez se pisaban (leer, modificar, escribir sin serializar). Ahora:
 * cola de escritura y temporal más renombrado, el mismo patrón.
 */
let flagsWriteQueue: Promise<unknown> = Promise.resolve();
export async function setFeatureEnabled(
  flag: FeatureFlag,
  value: boolean
): Promise<void> {
  overrides.set(flag, value);
  const run = flagsWriteQueue.then(async () => {
    try {
      const path = await flagsPath();
      const FS = await import("expo-file-system/legacy");
      const { readAsStringAsync, writeAsStringAsync, getInfoAsync } = FS;
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
      const json = JSON.stringify(current);
      const move = typeof FS.moveAsync === "function" ? FS.moveAsync : undefined;
      if (!move) {
        await writeAsStringAsync(path, json);
        return;
      }
      const tmp = `${path}.tmp`;
      await writeAsStringAsync(tmp, json);
      await move({ from: tmp, to: path });
    } catch {
      // Disk unavailable: in-memory value stands for this session.
    }
  });
  flagsWriteQueue = run.catch(() => {});
  return run;
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
