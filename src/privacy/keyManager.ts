/**
 * keyManager.ts — NIDO: gestión de claves con el Android Keystore.
 *
 * - La clave de la base (SQLCipher) se genera una vez (32 bytes aleatorios)
 *   y vive en expo-secure-store, que en Android cifra con claves del
 *   Keystore respaldado por hardware cuando existe. Nunca se escribe en
 *   archivos, logs ni memoria persistente en claro.
 * - La clave privada de identidad P2P también vive en SecureStore
 *   (alias `nido_p2p_sk`); la tabla `p2p_identity` solo conserva la pública.
 *   Las bases antiguas que aún traían `sk_hex` se migran solas al leer.
 *
 * Diseño testeable: el backend de almacenamiento seguro es inyectable.
 * En producción es expo-secure-store; en tests, un backend en memoria.
 * Si el módulo nativo no está disponible:
 * - en dev (`__DEV__`) se devuelve null → la base abre en claro con aviso
 *   (comportamiento histórico de desarrollo);
 * - en producción se lanza → fail-closed, la app no abre datos sin cifrar.
 */

export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

let testBackend: SecureBackend | null = null;

/** Solo para tests: inyecta un backend en memoria. */
export function setTestSecureBackend(b: SecureBackend | null): void {
  testBackend = b;
}

/** Backend en memoria para tests. */
export function createMemorySecureBackend(): SecureBackend {
  const map = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => (map.has(k) ? map.get(k)! : null),
    setItemAsync: async (k: string, v: string) => {
      map.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      map.delete(k);
    },
  };
}

function realBackend(): SecureBackend | null {
  if (testBackend) return testBackend;
  try {
    // require perezoso: en Node/vitest el módulo nativo no existe.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ss = require("expo-secure-store") as SecureBackend;
    if (typeof ss?.getItemAsync !== "function") return null;
    return ss;
  } catch {
    return null;
  }
}

const DB_KEY_ALIAS = "nido_db_key";
export const P2P_SK_ALIAS = "nido_p2p_sk";
/**
 * F-2: el alias de la clave de firma se exporta para que el store P2P
 * pueda construir el error tipado de pérdida de clave de identidad
 * (P2PIdentityKeyLossError) con el alias exacto que falta.
 */
export const P2P_SIGN_SK_ALIAS = "nido_p2p_sign_sk";

declare const __DEV__: boolean | undefined;
function isDev(): boolean {
  try {
    return typeof __DEV__ !== "undefined" && __DEV__;
  } catch {
    return false;
  }
}

/**
 * The secure store failed (or returned an ambiguous value) while reading
 * key material. Fail-closed (M-1/M-2): callers must NOT treat this as
 * "absent" and generate replacement keys — doing so would silently
 * overwrite the real DEK or the P2P identity. The `alias` identifies which
 * key could not be read; the human-readable message is localized.
 */
export class SecureStoreReadError extends Error {
  readonly alias: string;
  constructor(alias: string, message: string, cause?: unknown) {
    super(message);
    this.name = "SecureStoreReadError";
    this.alias = alias;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * N4 — La DEK falta en el almacén seguro pero existen bases cifradas
 * gestionadas en el dispositivo (pérdida/corrupción del Keystore con DBs
 * huérfanas). NUNCA se genera una DEK nueva en este estado: hacerlo
 * silenciosamente vararía los datos reales tras una base ilegible.
 *
 * El error es explícito, verificable y visible para el usuario:
 * - `code` estable ("NIDO_KEY_LOST") para que la UI detecte el estado de
 *   recovery y muestre la pantalla correspondiente (nunca un first-run
 *   silencioso);
 * - `databases` lista las bases encontradas (no se destruyeron);
 * - el mensaje explica qué pasó y el camino documentado hacia adelante
 *   (`recoverFromKeyLoss` en secureDatabase, con confirmación explícita).
 */
export class KeyLossError extends Error {
  readonly code = "NIDO_KEY_LOST";
  readonly alias = DB_KEY_ALIAS;
  readonly databases: string[];
  constructor(databases: string[], message: string) {
    super(message);
    this.name = "KeyLossError";
    this.databases = [...databases];
  }
}

/**
 * N4 — Sonda de "¿existen bases gestionadas?". Devuelve los nombres de las
 * bases cifradas gestionadas presentes en el dispositivo. La registra
 * secureDatabase (dueña de los nombres y del driver) al cargarse el módulo;
 * keyManager no puede importarla (ciclo). Si nadie la registra (p. ej.
 * tests unitarios de keyManager puros), la comprobación N4 se omite — la
 * ruta real de arranque siempre pasa por secureDatabase.
 */
export type KeyLossProbe = () => Promise<string[]>;

let keyLossProbe: KeyLossProbe | null = null;

/** Registra (o limpia con null) la sonda de pérdida de clave. */
export function registerKeyLossProbe(p: KeyLossProbe | null): void {
  keyLossProbe = p;
}

/**
 * Copy for fail-closed secure-store errors, in the user's language
 * (English-first). Resolved lazily — never a top-level import — because
 * the i18n/settings chain pulls native modules that unit tests cannot
 * load. If resolution fails, English (the app default) is used.
 */
interface KeyStoreStrings {
  dbKeyReadFailed: string;
  dbKeyCorrupt: string;
  dbKeyLost: string;
  p2pKeyReadFailed: string;
  p2pKeyCorrupt: string;
  p2pSignKeyReadFailed: string;
  p2pSignKeyCorrupt: string;
}

const EN_KEYSTORE_STRINGS: KeyStoreStrings = {
  dbKeyReadFailed:
    "NIDO could not read the database encryption key from the secure store. " +
    "Fail-closed: no new key will be created, because that would permanently lock " +
    "your existing encrypted data. Restart the app and try again.",
  dbKeyCorrupt:
    "The stored database encryption key is damaged or has an unexpected format. " +
    "Fail-closed: NIDO will not overwrite it or open the database without it. " +
    "If this keeps happening, reinstalling is the only recovery (existing local " +
    "data cannot be decrypted without the original key).",
  dbKeyLost:
    "NIDO's database encryption key is missing from the secure store, but " +
    "encrypted databases still exist on this device. Fail-closed: NIDO will NOT " +
    "generate a new key silently — that would strand your existing data behind " +
    "an unreadable database. Your data has NOT been deleted. To use NIDO again " +
    "you must explicitly choose recovery (existing encrypted data cannot be " +
    "decrypted without the original key).",
  p2pKeyReadFailed:
    "NIDO could not read this device's identity key from the secure store. " +
    "Fail-closed: no new identity will be created, because that would silently " +
    "break all your pairings. Restart the app and try again.",
  p2pKeyCorrupt:
    "This device's stored identity key is damaged or has an unexpected format. " +
    "Fail-closed: NIDO will not replace it silently. Reset the identity to " +
    "create a new one (you will need to re-pair your contacts).",
  p2pSignKeyReadFailed:
    "NIDO could not read this device's message-signing key from the secure store. " +
    "Fail-closed: no new signing key will be created. Restart the app and try again.",
  p2pSignKeyCorrupt:
    "This device's stored message-signing key is damaged or has an unexpected format. " +
    "Fail-closed: NIDO will not replace it silently. Reset the identity to create a new one.",
};

function keyStoreStrings(): KeyStoreStrings {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const i18n = require("../i18n").default as { t(k: string): string };
    return {
      dbKeyReadFailed: i18n.t("keyStore.dbKeyReadFailed"),
      dbKeyCorrupt: i18n.t("keyStore.dbKeyCorrupt"),
      dbKeyLost: i18n.t("keyStore.dbKeyLost"),
      p2pKeyReadFailed: i18n.t("keyStore.p2pKeyReadFailed"),
      p2pKeyCorrupt: i18n.t("keyStore.p2pKeyCorrupt"),
      p2pSignKeyReadFailed: i18n.t("keyStore.p2pSignKeyReadFailed"),
      p2pSignKeyCorrupt: i18n.t("keyStore.p2pSignKeyCorrupt"),
    };
  } catch {
    return EN_KEYSTORE_STRINGS;
  }
}

let testRandomBytes: ((n: number) => Promise<Uint8Array>) | null = null;

/** Solo para tests: inyecta la fuente de bytes aleatorios. */
export function setTestRandomBytes(fn: ((n: number) => Promise<Uint8Array>) | null): void {
  testRandomBytes = fn;
}

async function randomHex32Async(): Promise<string> {
  let bytes: Uint8Array;
  if (testRandomBytes) {
    bytes = await testRandomBytes(32);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Crypto = require("expo-crypto") as {
      getRandomBytesAsync(n: number): Promise<Uint8Array>;
    };
    bytes = await Crypto.getRandomBytesAsync(32);
  }
  if (bytes.length !== 32) throw new Error("keyManager: fuente aleatoria inválida.");
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Devuelve la clave hex de 32 bytes para SQLCipher, generándola y
 * guardándola en el Keystore la primera vez. Null solo en dev sin
 * SecureStore (la base abre en claro con aviso).
 *
 * M-1 (fail-closed): un FALLO de lectura NO es "ausente". Solo una lectura
 * exitosa que devuelve null significa "primera vez" y puede generar una
 * clave. Cualquier fallo —o un valor guardado que no valida (estado
 * ambiguo)— lanza SecureStoreReadError en vez de generar/sobrescribir:
 * un glitch transitorio del SecureStore jamás puede invalidar la base
 * cifrada existente. Las llamadas concurrentes comparten la misma
 * resolución en curso para no acuñar dos claves distintas.
 *
 * N4 (key-loss): incluso una ausencia GENUINA (lectura exitosa → null) no
 * genera si existen bases cifradas gestionadas: eso es pérdida de clave,
 * no instalación nueva. Lanza KeyLossError (estado de recovery explícito)
 * en vez de una DEK fresca silenciosa.
 */
let dekInFlight: Promise<string | null> | null = null;

export async function getDatabaseKeyHex(): Promise<string | null> {
  const backend = realBackend();
  if (!backend) {
    if (isDev()) {
      console.warn("[keyManager] Sin SecureStore: sin clave de cifrado (solo dev).");
      return null;
    }
    throw new Error("keyManager: SecureStore no disponible en producción (fail-closed).");
  }
  if (!dekInFlight) {
    dekInFlight = resolveDatabaseKeyHex(backend).finally(() => {
      dekInFlight = null;
    });
  }
  return dekInFlight;
}

async function resolveDatabaseKeyHex(backend: SecureBackend): Promise<string | null> {
  let existing: string | null;
  try {
    existing = await backend.getItemAsync(DB_KEY_ALIAS);
  } catch (e) {
    throw new SecureStoreReadError(DB_KEY_ALIAS, keyStoreStrings().dbKeyReadFailed, e);
  }
  if (existing === null) {
    // N4: la lectura tuvo éxito y devolvió null → "ausente de verdad". ANTES
    // de generar, distinguir instalación genuinamente nueva de pérdida de
    // clave: si existen bases cifradas gestionadas, la clave se PERDIÓ
    // (Keystore borrado/corrupto con DBs huérfanas) y generar una DEK nueva
    // en silencio vararía los datos reales tras una base ilegible.
    // Estado de recovery explícito, verificable y visible: nunca first-run
    // silencioso.
    if (keyLossProbe) {
      let present: string[];
      try {
        present = await keyLossProbe();
      } catch (e) {
        // La sonda no pudo leer el sistema de ficheros: estado ambiguo
        // (¿nuevo o pérdida?). Fail-closed: no generar.
        throw new SecureStoreReadError(DB_KEY_ALIAS, keyStoreStrings().dbKeyReadFailed, e);
      }
      if (present.length > 0) {
        const names = present.join(", ");
        throw new KeyLossError(
          present,
          `${keyStoreStrings().dbKeyLost} (${names})`,
        );
      }
    }
    // Primera vez genuina: generar y persistir. Si la escritura falla, el
    // error se propaga y la clave recién generada nunca se devuelve sin
    // estar guardada.
    const fresh = await randomHex32Async();
    await backend.setItemAsync(DB_KEY_ALIAS, fresh);
    return fresh;
  }
  if (!/^[0-9a-f]{64}$/i.test(existing)) {
    throw new SecureStoreReadError(DB_KEY_ALIAS, keyStoreStrings().dbKeyCorrupt);
  }
  return existing.toLowerCase();
}

/** Guarda la clave privada de identidad P2P en el Keystore. */
export async function storeP2PPrivateKey(skHex: string): Promise<void> {
  const backend = realBackend();
  if (!backend) throw new Error("keyManager: SecureStore no disponible.");
  if (!/^[0-9a-f]{64}$/i.test(skHex)) throw new Error("keyManager: sk inválida.");
  await backend.setItemAsync(P2P_SK_ALIAS, skHex.toLowerCase());
}

/** Lee la clave privada P2P del Keystore (null si no existe).
 *
 * M-2 (fail-closed): un FALLO de lectura lanza SecureStoreReadError en vez
 * de devolver null. Devolver null haría que getIdentity()/ensureIdentity()
 * generaran una identidad nueva y sobrescribieran la real, rompiendo todos
 * los emparejamientos en silencio. Un valor guardado corrupto también lanza
 * (estado ambiguo): nunca se sobrescribe material existente en silencio.
 */
export async function loadP2PPrivateKey(): Promise<string | null> {
  const backend = realBackend();
  if (!backend) return null;
  let v: string | null;
  try {
    v = await backend.getItemAsync(P2P_SK_ALIAS);
  } catch (e) {
    throw new SecureStoreReadError(P2P_SK_ALIAS, keyStoreStrings().p2pKeyReadFailed, e);
  }
  if (v !== null && !/^[0-9a-f]{64}$/i.test(v)) {
    throw new SecureStoreReadError(P2P_SK_ALIAS, keyStoreStrings().p2pKeyCorrupt);
  }
  return v ? v.toLowerCase() : null;
}

/** Borra la clave privada P2P del Keystore (p. ej. al restablecer identidad). */
export async function deleteP2PPrivateKey(): Promise<void> {
  const backend = realBackend();
  if (!backend) return;
  await backend.deleteItemAsync(P2P_SK_ALIAS).catch(() => {});
}

/**
 * Guarda la clave privada de FIRMA P2P (Ed25519) en el Keystore.
 * Clave distinta de la de cifrado: cada una se usa para su propósito.
 */
export async function storeP2PSigningKey(skHex: string): Promise<void> {
  const backend = realBackend();
  if (!backend) throw new Error("keyManager: SecureStore no disponible.");
  if (!/^[0-9a-f]{64}$/i.test(skHex)) throw new Error("keyManager: sk de firma inválida.");
  await backend.setItemAsync(P2P_SIGN_SK_ALIAS, skHex.toLowerCase());
}

/** Lee la clave privada de firma P2P del Keystore (null si no existe).
 *
 * M-2 (fail-closed): igual que loadP2PPrivateKey — un fallo de lectura
 * lanza en vez de devolver null, para que getSigningKeypair() no genere y
 * sobrescriba la clave de firma en silencio (los peers con la spk antigua
 * rechazarían todos los handshakes).
 */
export async function loadP2PSigningKey(): Promise<string | null> {
  const backend = realBackend();
  if (!backend) return null;
  let v: string | null;
  try {
    v = await backend.getItemAsync(P2P_SIGN_SK_ALIAS);
  } catch (e) {
    throw new SecureStoreReadError(P2P_SIGN_SK_ALIAS, keyStoreStrings().p2pSignKeyReadFailed, e);
  }
  if (v !== null && !/^[0-9a-f]{64}$/i.test(v)) {
    throw new SecureStoreReadError(P2P_SIGN_SK_ALIAS, keyStoreStrings().p2pSignKeyCorrupt);
  }
  return v ? v.toLowerCase() : null;
}

/** Borra la clave privada de firma P2P del Keystore. */
export async function deleteP2PSigningKey(): Promise<void> {
  const backend = realBackend();
  if (!backend) return;
  await backend.deleteItemAsync(P2P_SIGN_SK_ALIAS).catch(() => {});
}

/**
 * Borra la DEK de SQLCipher (`nido_db_key`) del Keystore (p. ej. en
 * "Clear All Data"). Vía deleteItemAsync de SecureStore, que en Android
 * elimina la entrada cifrada: es la ruta de borrado correcta, porque
 * SecureStore gestiona internamente su propia clave maestra del Keystore
 * (compartida, sin material de usuario) y por tanto no hay una entrada
 * de Keystore por clave que borrar a mano. Tras el borrado,
 * getDatabaseKeyHex() generará una clave nueva en el próximo arranque.
 */
export async function deleteDatabaseKey(): Promise<void> {
  const backend = realBackend();
  if (!backend) return;
  await backend.deleteItemAsync(DB_KEY_ALIAS).catch(() => {});
}

/**
 * Lectura NO generadora de la DEK: devuelve la clave si existe y es
 * válida, null si está ausente de verdad. A diferencia de getDatabaseKeyHex(),
 * nunca crea una clave nueva. Uso: verificación post-borrado
 * ("Clear All Data") — comprobar que la clave ya no existe.
 *
 * Fail-closed: si la lectura FALLA, lanza en vez de devolver null. La
 * verificación de borrado no puede afirmar "ya no existe" cuando ni
 * siquiera pudo leer: un null falso declararía éxito en silencio.
 */
export async function peekDatabaseKey(): Promise<string | null> {
  const backend = realBackend();
  if (!backend) return null;
  let v: string | null;
  try {
    v = await backend.getItemAsync(DB_KEY_ALIAS);
  } catch (e) {
    throw new SecureStoreReadError(DB_KEY_ALIAS, keyStoreStrings().dbKeyReadFailed, e);
  }
  if (v !== null && !/^[0-9a-f]{64}$/i.test(v)) {
    throw new SecureStoreReadError(DB_KEY_ALIAS, keyStoreStrings().dbKeyCorrupt);
  }
  return v ? v.toLowerCase() : null;
}

/**
 * Aplica `PRAGMA key` a una base recién abierta y verifica dos cosas:
 *  1. que el SQLite trae SQLCipher (`PRAGMA cipher_version` no vacío);
 *  2. que la clave es CORRECTA: lee una página (`sqlite_master`). Con clave
 *     incorrecta, base corrupta o base en claro, la lectura falla con
 *     "file is not a database" → fail-closed inmediato, no un error confuso
 *     más tarde. Nunca se registra la clave en el mensaje de error.
 * `label` solo se usa en mensajes de error.
 */
export async function applyDatabaseKey(
  db: {
    execAsync(sql: string): Promise<void>;
    getAllAsync(sql: string): Promise<Array<{ cipher_version?: string }>>;
    getFirstAsync(sql: string): Promise<unknown>;
    closeAsync(): Promise<void>;
  },
  keyHex: string | null,
  label: string,
): Promise<void> {
  if (!keyHex) return; // dev sin SecureStore: la base abre en claro (con aviso ya emitido)
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    await db.closeAsync().catch(() => {});
    throw new Error(`${label}: formato de clave inválido (fail-closed).`);
  }
  await db.execAsync(`PRAGMA key = "x'${keyHex.toLowerCase()}'";`);
  const rows = await db.getAllAsync("PRAGMA cipher_version;");
  const version = rows?.[0]?.cipher_version ?? "";
  if (!version) {
    await db.closeAsync().catch(() => {});
    throw new Error(
      `${label}: se pidió cifrado pero el SQLite no trae SQLCipher — ` +
        "fail-closed: la base no se abre en claro. Usa un build con SQLCipher.",
    );
  }
  // Verificación de clave: fuerza la lectura de una página. Falla cerrado si
  // la clave es incorrecta, la base está corrupta o sigue en claro.
  try {
    await db.getFirstAsync("SELECT count(*) AS n FROM sqlite_master;");
  } catch {
    await db.closeAsync().catch(() => {});
    throw new Error(
      `${label}: la base no se pudo descifrar (clave incorrecta, base corrupta ` +
        "o base en claro sin migrar). Fail-closed: no se abre en claro.",
    );
  }
}
