/**
 * security.ts — NIDO: observabilidad segura del estado de seguridad del dispositivo.
 *
 * Propósito: responder con evidencia (no con configuración) a:
 *   - ¿SQLCipher está cargado? ¿qué cipher_version reporta?
 *   - ¿Keystore/SecureStore está disponible? ¿round-trip funcional?
 *   - ¿Capacidad biométrica del dispositivo?
 *   - ¿Respaldo por hardware / StrongBox? (cuando sea verificable)
 *
 * REGLAS DURAS:
 * - Nunca se registran claves, secretos, DEKs, SKs ni material criptográfico.
 * - El round-trip de Keystore usa un canary aleatorio que se borra después;
 *   nunca una clave real.
 * - Lo que no se puede verificar desde JS se reporta como NO VERIFICADO,
 *   nunca como "sí". CONFIGURED != VERIFIED ON DEVICE.
 * - Módulos nativos inyectables (mismo patrón que biometricGate) para tests.
 */

export type VerifyState = "verified" | "unavailable" | "not-verifiable" | "failed";

export interface SqlCipherStatus {
  state: VerifyState;
  /** p.ej. "4.6.1 community". null si no se pudo obtener. Nunca contiene claves. */
  cipherVersion: string | null;
  note: string;
}

export interface KeystoreStatus {
  state: VerifyState;
  roundTripOk: boolean;
  note: string;
}

export interface BiometricStatus {
  state: VerifyState;
  hasHardware: boolean;
  enrolled: boolean;
  /** Nombres legibles de tipos soportados, p.ej. ["fingerprint","face"]. */
  types: string[];
  note: string;
}

export interface HardwareBackedStatus {
  state: VerifyState;
  note: string;
}

export interface SecurityDiagnostics {
  generatedAt: string;
  sqlcipher: SqlCipherStatus;
  keystore: KeystoreStatus;
  biometric: BiometricStatus;
  /** Respaldo hardware del Keystore (Android). Hoy: no verificable desde JS. */
  hardwareBacked: HardwareBackedStatus;
  /** StrongBox (Android). Hoy: no verificable desde JS. */
  strongBox: HardwareBackedStatus;
}

export interface DiagnosticsDeps {
  /** Manejador mínimo de DB para `PRAGMA cipher_version;` (inyectado en tests). */
  db?: {
    getAllAsync(sql: string): Promise<Array<{ cipher_version?: string }>>;
  };
  secureStore?: {
    setItemAsync(key: string, value: string): Promise<void>;
    getItemAsync(key: string): Promise<string | null>;
    deleteItemAsync(key: string): Promise<void>;
  };
  localAuth?: {
    hasHardwareAsync(): Promise<boolean>;
    isEnrolledAsync(): Promise<boolean>;
    supportedAuthenticationTypesAsync(): Promise<number[]>;
  };
  /** Generador aleatorio inyectable (tests deterministas). */
  randomHex?: (bytes: number) => string;
}

const CANARY_ALIAS = "__nido_diag_canary__";

function defaultRandomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const g = globalThis as {
    crypto?: { getRandomValues?: (a: Uint8Array) => void };
  };
  if (typeof g.crypto?.getRandomValues === "function") {
    g.crypto.getRandomValues(arr);
  } else {
    // Hermes no tiene WebCrypto (ver T-009): expo-crypto expone
    // getRandomBytes síncrono respaldado por CSPRNG. Import diferido para
    // no romper entornos sin el módulo (tests puros).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cryptoMod = require("expo-crypto") as {
      getRandomBytes(n: number): Uint8Array;
    };
    // T5-12-2026-10-06: verificar forma del módulo en runtime.
    const { assertExpoCryptoShape } = require("../security/secureDatabase") as {
      assertExpoCryptoShape(mod: unknown, caller: string): void;
    };
    assertExpoCryptoShape(cryptoMod, "diagnostics/security.defaultRandomHex");
    const { getRandomBytes } = cryptoMod;
    arr.set(getRandomBytes(bytes));
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

const AUTH_TYPE_NAMES: Record<number, string> = {
  1: "fingerprint",
  2: "facial",
  3: "iris",
};

async function checkSqlCipher(
  db: DiagnosticsDeps["db"],
): Promise<SqlCipherStatus> {
  if (!db) {
    return {
      state: "not-verifiable",
      cipherVersion: null,
      note: "Sin manejador de DB: no se puede ejecutar PRAGMA cipher_version.",
    };
  }
  try {
    const rows = await db.getAllAsync("PRAGMA cipher_version;");
    const version = rows?.[0]?.cipher_version ?? "";
    if (!version) {
      return {
        state: "failed",
        cipherVersion: null,
        note: "El SQLite no trae SQLCipher (cipher_version vacío). Fail-closed.",
      };
    }
    return {
      state: "verified",
      cipherVersion: version,
      note: "SQLCipher nativo cargado y activo en esta DB.",
    };
  } catch (e) {
    return {
      state: "failed",
      cipherVersion: null,
      note: `PRAGMA cipher_version falló: ${(e as Error).message}`,
    };
  }
}

async function checkKeystore(
  store: DiagnosticsDeps["secureStore"],
  randomHex: (bytes: number) => string,
): Promise<KeystoreStatus> {
  if (!store) {
    return {
      state: "not-verifiable",
      roundTripOk: false,
      note: "SecureStore no disponible en este entorno.",
    };
  }
  // Canary aleatorio de un solo uso: NUNCA una clave real. Se borra al final.
  const canary = randomHex(16);
  try {
    await store.setItemAsync(CANARY_ALIAS, canary);
    const back = await store.getItemAsync(CANARY_ALIAS);
    const ok = back === canary;
    return {
      state: ok ? "verified" : "failed",
      roundTripOk: ok,
      note: ok
        ? "SecureStore disponible: round-trip de canary efímero OK (borrado)."
        : "SecureStore respondió pero el round-trip no coincide.",
    };
  } catch (e) {
    return {
      state: "failed",
      roundTripOk: false,
      note: `SecureStore falló: ${(e as Error).message}`,
    };
  } finally {
    await store.deleteItemAsync(CANARY_ALIAS).catch(() => {});
  }
}

async function checkBiometric(
  auth: DiagnosticsDeps["localAuth"],
): Promise<BiometricStatus> {
  if (!auth) {
    return {
      state: "not-verifiable",
      hasHardware: false,
      enrolled: false,
      types: [],
      note: "expo-local-authentication no disponible en este entorno.",
    };
  }
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      auth.hasHardwareAsync(),
      auth.isEnrolledAsync(),
      auth.supportedAuthenticationTypesAsync(),
    ]);
    return {
      state: "verified",
      hasHardware,
      enrolled,
      types: types.map((t) => AUTH_TYPE_NAMES[t] ?? `type-${t}`),
      note:
        hasHardware && enrolled
          ? "Biometría disponible y enrolada."
          : "Biometría no disponible o sin enrolar (ver hasHardware/enrolled).",
    };
  } catch (e) {
    return {
      state: "failed",
      hasHardware: false,
      enrolled: false,
      types: [],
      note: `Consulta biométrica falló: ${(e as Error).message}`,
    };
  }
}

function notVerifiableFromJs(what: string): HardwareBackedStatus {
  return {
    state: "not-verifiable",
    note:
      `${what}: no verificable desde JS con las APIs actuales ` +
      "(expo-secure-store no expone respaldo hardware). " +
      "Requiere módulo nativo o verificación on-device. " +
      "NO asumir: reportado como no verificado.",
  };
}

/**
 * Recolecta el diagnóstico de seguridad. El reporte resultante NO contiene
 * secretos por construcción: cipher_version es una cadena de versión pública,
 * el canary de Keystore es aleatorio y se borra, y el resto son booleanos.
 */
export async function collectSecurityDiagnostics(
  deps: DiagnosticsDeps = {},
): Promise<SecurityDiagnostics> {
  const randomHex = deps.randomHex ?? defaultRandomHex;
  const [sqlcipher, keystore, biometric] = await Promise.all([
    checkSqlCipher(deps.db),
    checkKeystore(deps.secureStore, randomHex),
    checkBiometric(deps.localAuth),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    sqlcipher,
    keystore,
    biometric,
    hardwareBacked: notVerifiableFromJs("Respaldo hardware del Keystore"),
    strongBox: notVerifiableFromJs("StrongBox"),
  };
}

/**
 * Renderiza el diagnóstico como texto seguro para logs: por construcción no
 * incluye secretos, pero esta función es el único punto de serialización para
 * mantenerlo garantizado en un solo lugar.
 */
export function diagnosticsToSafeText(d: SecurityDiagnostics): string {
  const lines = [
    `security-diagnostics ${d.generatedAt}`,
    `sqlcipher: ${d.sqlcipher.state} version=${d.sqlcipher.cipherVersion ?? "n/a"} :: ${d.sqlcipher.note}`,
    `keystore: ${d.keystore.state} roundTrip=${d.keystore.roundTripOk} :: ${d.keystore.note}`,
    `biometric: ${d.biometric.state} hw=${d.biometric.hasHardware} enrolled=${d.biometric.enrolled} types=[${d.biometric.types.join(",")}] :: ${d.biometric.note}`,
    `hardware-backed: ${d.hardwareBacked.state} :: ${d.hardwareBacked.note}`,
    `strongbox: ${d.strongBox.state} :: ${d.strongBox.note}`,
  ];
  return lines.join("\n");
}
