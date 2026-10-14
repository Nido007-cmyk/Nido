/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * biometricGate.ts — NIDO: gate biométrico de acceso (capa UX, NO criptografía).
 *
 * La biometría/PIN del sistema autoriza el ACCESO a la app; no sustituye a la
 * criptografía. La DEK de SQLCipher vive en el Android Keystore (protegida
 * por hardware) independientemente de este gate. Lo que este módulo aporta:
 * impedir que alguien con el teléfono desbloqueado (o sin bloqueo) abra NIDO
 * y lea datos sensibles sin pasar por la autenticación del sistema.
 *
 * Límites honestos (ver docs/C1_SQLCIPHER.md):
 * - expo-local-authentication no puede exigir StrongBox ni crear claves
 *   Keystore con setUserAuthenticationRequired; eso requiere un módulo
 *   nativo a medida (trabajo futuro documentado).
 * - No se guarda ningún booleano "authenticated=true": cada desbloqueo es
 *   una autenticación fresca del SO; solo se cachea la MARCA TEMPORAL en
 *   memoria (se pierde al reiniciar) para no pedir el dedo cada 30 segundos.
 *
 * Política:
 * - Desbloqueo al abrir NIDO y al volver de background tras el timeout.
 * - Timeout de sesión desbloqueada: 5 minutos.
 * - Background → `lockNow()` (lo llama la UI vía AppState); foreground →
 *   `ensureUnlocked()` vuelve a pedir autenticación.
 * - Varios intentos fallidos: los gestiona el SO (bloqueo temporal); aquí se
 *   propaga el error sin reintentar en bucle.
 * - Cambio de enrollment (huella eliminada/añadida): se detecta vía
 *   getEnrolledLevelAsync y se registra; si ya no hay nada enrolado, el
 *   gate no puede operar → se lanza BiometricUnavailable (la UI decide:
 *   aviso degradado, nunca bypass silencioso).
 * - Fallback: si no hay biometría pero sí credencial del dispositivo
 *   (PIN/patrón), se permite como fallback del SO (disableDeviceFallback
 *   = false). No se inventa ningún PIN propio.
 */

export class BiometricUnavailable extends Error {}
export class BiometricCancelled extends Error {}
export class BiometricFailed extends Error {}

export type AuthMethod = "biometrics" | "device-credential" | "none";

export interface GateStatus {
  hasHardware: boolean;
  enrolled: boolean;
  method: AuthMethod;
  /**
   * 0.1.37 (auditoría): alguna consulta al sistema falló. Entonces no se
   * sabe si hay PIN: nunca se concluye «sin bloqueo».
   */
  probeFailed?: boolean;
}

interface LocalAuthModule {
  hasHardwareAsync(): Promise<boolean>;
  isEnrolledAsync(): Promise<boolean>;
  supportedAuthenticationTypesAsync(): Promise<number[]>;
  getEnrolledLevelAsync(): Promise<number>;
  authenticateAsync(opts: {
    promptMessage: string;
    fallbackLabel?: string;
    disableDeviceFallback?: boolean;
  }): Promise<{ success: boolean; error?: string }>;
}

let testModule: LocalAuthModule | null = null;

/** Solo para tests: inyecta un mock del módulo nativo. */
export function setBiometricTestModule(m: LocalAuthModule | null): void {
  testModule = m;
}

function realModule(): LocalAuthModule | null {
  if (testModule) return testModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("expo-local-authentication") as LocalAuthModule;
    if (typeof m?.authenticateAsync !== "function") return null;
    return m;
  } catch {
    return null;
  }
}

/** 1 = solo credencial, 2 = biométrico débil, 3 = biométrico fuerte (Android). */
export async function getGateStatus(): Promise<GateStatus> {
  const m = realModule();
  if (!m) return { hasHardware: false, enrolled: false, method: "none" };
  let probeFailed = false;
  const failed = <T,>(v: T) => () => {
    probeFailed = true;
    return v;
  };
  const [hasHardware, enrolledBio, level] = await Promise.all([
    m.hasHardwareAsync().catch(failed(false)),
    m.isEnrolledAsync().catch(failed(false)),
    m.getEnrolledLevelAsync().catch(failed(0)),
  ]);
  // hasHardwareAsync/isEnrolledAsync miran SOLO la biometría (fuente nativa
  // de Expo en Android: isEnrolled = canAuthenticate(biométrico) == SUCCESS).
  // En un dispositivo sin hardware biométrico pero con PIN del sistema, ambos
  // dan false y el gate concluía «sin biometría ni PIN» con el PIN puesto,
  // bloqueando hasta «Crear backup». La credencial del dispositivo vive en
  // getEnrolledLevelAsync: en Android devuelve 1 (SECRET) cuando
  // KeyguardManager.isDeviceSecure, 2/3 cuando hay biometría enrolada.
  // Evidencia (Tab A9+, v0.1.24): PIN recién configurado y la pantalla de
  // bloqueo decía «Este dispositivo no tiene biometría ni PIN configurado».
  const enrolled = enrolledBio || level > 0;
  const method: AuthMethod = !enrolled
    ? "none"
    : level >= 2 || enrolledBio
      ? "biometrics"
      : "device-credential";
  return probeFailed ? { hasHardware, enrolled, method, probeFailed } : { hasHardware, enrolled, method };
}

// ---------------------------------------------------------------------------
// Sesión desbloqueada (solo memoria; se pierde al reiniciar el proceso)
// ---------------------------------------------------------------------------

const UNLOCK_TIMEOUT_MS = 5 * 60 * 1000;
let lastUnlockAt = 0;

/** La UI lo llama al pasar a background: la vuelta exigirá autenticarse. */
export function lockNow(): void {
  lastUnlockAt = 0;
}

/**
 * HW-VAULT: el desbloqueo de la bóveda de hardware YA fue una autenticación
 * real del sistema (PIN o huella fuerte): no volver a pedirla en seguida.
 */
export function markUnlockedNow(): void {
  lastUnlockAt = Date.now();
}

/** Solo para tests. */
export function setLastUnlockAtForTest(t: number): void {
  lastUnlockAt = t;
}

export function isUnlocked(): boolean {
  return Date.now() - lastUnlockAt < UNLOCK_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Desbloqueo
// ---------------------------------------------------------------------------

/**
 * Pide autenticación del sistema. Lanza BiometricUnavailable si el dispositivo
 * no tiene nada enrolado, BiometricCancelled si el usuario cancela y
 * BiometricFailed si falla. Nunca devuelve "éxito" sin pasar por el SO.
 */
/**
 * 0.1.29 (B-2, auditoría ofensiva 2026-10-12): UNA sola política para todas
 * las puertas de la clave de respaldo (crear backup en la pantalla de
 * respaldo y en Ajustes, ver la clave, rotarla). Antes Ajustes y «ver la
 * clave» bloqueaban en un teléfono sin PIN, mientras que crear/rotar en la
 * pantalla de respaldo seguían: el usuario sin PIN podía acabar con
 * respaldos que nunca podría restaurar.
 *
 * - Desbloqueo correcto → "unlocked".
 * - El teléfono no tiene ni biometría ni PIN → "no-lock": la puerta no
 *   puede proteger nada (quien tiene el teléfono ya ve todo NIDO); la
 *   pantalla AVISA de forma visible y continúa.
 * - Cancelado o fallido → lanza (BiometricCancelled/BiometricFailed): no
 *   se muestra nada.
 */
export async function unlockForSecret(reason: string): Promise<"unlocked" | "no-lock"> {
  try {
    await requireUnlock(reason);
    return "unlocked";
  } catch (e) {
    if (e instanceof BiometricUnavailable) return "no-lock";
    throw e;
  }
}

export async function requireUnlock(reason: string): Promise<void> {
  const m = realModule();
  // 0.1.37 (auditoría): sin módulo o con una consulta fallida NO se sabe
  // si el teléfono tiene PIN. Antes eso contaba como «sin bloqueo» y la
  // clave del respaldo se mostraba sin pedir nada: ahora falla cerrado.
  if (!m) throw new BiometricFailed("Módulo biométrico no disponible.");
  const status = await getGateStatus();
  if (status.probeFailed && !status.enrolled) {
    throw new BiometricFailed("No se pudo comprobar el bloqueo del dispositivo.");
  }
  if (!status.enrolled) {
    throw new BiometricUnavailable(
      "Este dispositivo no tiene biometría ni credencial del sistema configurada. " +
        "Configúrala en Ajustes para usar el gate de acceso de NIDO.",
    );
  }
  const res = await m.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: "Usar PIN del dispositivo",
    disableDeviceFallback: false, // permite PIN/patrón del SO como fallback
  });
  if (res.success) {
    lastUnlockAt = Date.now();
    return;
  }
  if (res.error === "user_cancel" || res.error === "system_cancel") {
    throw new BiometricCancelled("Autenticación cancelada por el usuario.");
  }
  throw new BiometricFailed(`Autenticación fallida (${res.error ?? "desconocido"}).`);
}

/**
 * Garantiza desbloqueo vigente: si el timeout expiró (o nunca se desbloqueó),
 * pide autenticación. Idempotente dentro de la ventana.
 */
export async function ensureUnlocked(reason: string): Promise<void> {
  if (isUnlocked()) return;
  await requireUnlock(reason);
}
