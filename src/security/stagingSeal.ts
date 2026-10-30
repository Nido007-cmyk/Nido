/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * stagingSeal.ts — el archivo de la rotación de clave, cifrado.
 *
 * Mientras dura una rotación, rekey-staging.json guarda la clave vieja y la
 * nueva para poder recuperar la base si la app se cierra a mitad. Hasta 0.1.62
 * iban en claro en el directorio privado (riesgo aceptado y documentado; la
 * auditoría del 29-10-2026 lo señaló, y el informe sobre Signal recordó que
 * Signal Desktop tardó seis años en sacar su clave de SQLCipher de un
 * config.json en claro).
 *
 * Ahora el contenido va cifrado (XSalsa20-Poly1305, tweetnacl secretbox) con
 * una llave aleatoria guardada en SecureStore, es decir, protegida por el
 * Keystore de Android. Sin esa llave el archivo no dice nada. La recuperación
 * al arrancar sigue igual; solo cambia cómo se lee y se escribe el archivo.
 * Un archivo antiguo en claro (rotación interrumpida en 0.1.62 o antes) se
 * sigue leyendo.
 */
import nacl from "tweetnacl";
import { fromHex, toHex, utf8Decode, utf8Encode } from "../p2p/crypto";

export const STAGING_KEY_NAME = "nido_vault_rekey_staging_key";
const FORMAT = "nido-staging-sealed-v1";

export interface StagingKeyStore {
  get(): Promise<string | null>;
  set(hex: string): Promise<void>;
}

/** SecureStore (Keystore de Android), por keyManager. */
export const secureStagingKeyStore: StagingKeyStore = {
  async get() {
    const { readVaultSetting } = await import("../privacy/keyManager");
    return readVaultSetting(STAGING_KEY_NAME);
  },
  async set(hex) {
    const { writeVaultSetting } = await import("../privacy/keyManager");
    await writeVaultSetting(STAGING_KEY_NAME, hex);
  },
};

export class StagingKeyMissingError extends Error {
  constructor() {
    super("No está la llave del archivo de rotación: no se puede leer (no se borra).");
    this.name = "StagingKeyMissingError";
  }
}

function validKey(hex: string | null): hex is string {
  return typeof hex === "string" && /^[0-9a-f]{64}$/i.test(hex);
}

/** Cifra el contenido del archivo de rotación. Crea la llave si no existe. */
export async function sealStaging(json: string, keys: StagingKeyStore = secureStagingKeyStore): Promise<string> {
  let hex = await keys.get();
  if (!validKey(hex)) {
    hex = toHex(nacl.randomBytes(32));
    await keys.set(hex);
    // Se relee: si SecureStore no la guardó, no se escribe nada que luego
    // no se pueda abrir (la rotación se cancela, fail-closed).
    const back = await keys.get();
    if (back !== hex) throw new Error("No se pudo guardar la llave del archivo de rotación.");
  }
  const key = fromHex(hex);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const boxed = nacl.secretbox(utf8Encode(json), nonce, key);
  key.fill(0);
  return JSON.stringify({ format: FORMAT, n: toHex(nonce), c: toHex(boxed) });
}

/** true si el texto es un archivo de rotación cifrado. */
export function isSealedStaging(raw: string): boolean {
  try {
    return JSON.parse(raw)?.format === FORMAT;
  } catch {
    return false;
  }
}

/**
 * Devuelve el JSON del archivo de rotación. Uno en claro (0.1.62 o antes) se
 * devuelve tal cual. Uno cifrado sin su llave lanza StagingKeyMissingError;
 * uno manipulado lanza un error normal.
 */
export async function openStaging(raw: string, keys: StagingKeyStore = secureStagingKeyStore): Promise<string> {
  if (!isSealedStaging(raw)) return raw;
  const env = JSON.parse(raw) as { n: unknown; c: unknown };
  if (typeof env.n !== "string" || typeof env.c !== "string") throw new Error("Archivo de rotación cifrado mal formado.");
  const hex = await keys.get();
  if (!validKey(hex)) throw new StagingKeyMissingError();
  const key = fromHex(hex);
  const opened = nacl.secretbox.open(fromHex(env.c), fromHex(env.n), key);
  key.fill(0);
  if (!opened) throw new Error("Archivo de rotación cifrado no válido (manipulado o de otra llave).");
  return utf8Decode(opened);
}
