/**
 * crypto.ts — NIDO P2P: criptografía de extremo a extremo (Fase E + Hardening).
 *
 * NaCl vía TweetNaCl (JS puro, auditado, sin código nativo):
 * - Identidad: keypair X25519 (identificador + cifrado) + keypair Ed25519
 *   (firma del handshake). Cada uno se usa para su propósito; no hay
 *   derivación cruzada entre curvas.
 * - Handshake v2: la clave de firma Ed25519 firma el efímero (ver
 *   docs/HANDSHAKE_THREAT_MODEL.md). Sin firma válida no hay sesión.
 * - Sesión: ECDH efímero–efímero por conexión, ligado a los nonces de
 *   ambos lados (anti-replay de HELLO).
 * - Mensajes: secretbox (XSalsa20-Poly1305), nonce aleatorio de 24 B.
 *
 * Todo es determinista y testeable. Ninguna operación toca la red.
 */

import nacl from "tweetnacl";

/**
 * T-009: TweetNaCl detecta su PRNG buscando `crypto.getRandomValues`, que no
 * existe en Hermes — `nacl.randomBytes()` lanzaba "no PRNG" y la generación
 * de identidad P2P fallaba en el dispositivo (sin QR de emparejamiento,
 * spinner eterno).
 *
 * Instalamos una fuente segura antes de cualquier uso, en este orden:
 *  1) WebCrypto (`globalThis.crypto.getRandomValues`) — Node >= 19,
 *     navegadores y RN con polyfill. Mantiene los tests unitarios en Node
 *     sin arrastrar módulos nativos.
 *  2) `expo-crypto` nativo vía `require` diferido — Hermes en el dispositivo.
 *     Diferido (no import estático) para no romper los tests de Node, donde
 *     expo-crypto arrastra `react-native` (sintaxis Flow).
 *  3) Sin fuente disponible no se instala nada: `nacl.randomBytes()`
 *     lanzará su "no PRNG" explícito al usarse — fail-closed, nunca
 *     silencioso ni con aleatoriedad débil.
 */
function installSecurePrng(): void {
  const setPRNG = (nacl as unknown as { setPRNG?: (fn: (x: Uint8Array, n: number) => void) => void }).setPRNG;
  if (!setPRNG) return;
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;
  if (webCrypto?.getRandomValues) {
    setPRNG((x, n) => {
      webCrypto.getRandomValues!(x.subarray(0, n));
    });
    return;
  }
  try {
    const req = (globalThis as { require?: (id: string) => unknown }).require;
    const Crypto = (req ? req("expo-crypto") : null) as { getRandomBytes?: (n: number) => Uint8Array } | null;
    if (Crypto?.getRandomBytes) {
      setPRNG((x, n) => {
        x.set(Crypto.getRandomBytes!(n));
      });
    }
  } catch {
    /* sin PRNG: queda el error explícito de TweetNaCl (fail-closed) */
  }
}

installSecurePrng();

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/* ---------- utilidades de codificación (sin dependencias) ---------- */

const HEX = "0123456789abcdef";

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += HEX[(bytes[i] >> 4) & 0xf] + HEX[bytes[i] & 0xf];
  }
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Clave en hex inválida.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const hi = c;
      const lo = s.charCodeAt(++i);
      const cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) {
      s += String.fromCharCode(b);
    } else if ((b & 0xe0) === 0xc0) {
      s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if ((b & 0xf0) === 0xe0) {
      s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return s;
}

/* ---------- identidad ---------- */

/** Genera la identidad del dispositivo (keypair X25519). */
export function generateIdentity(): KeyPair {
  return nacl.box.keyPair();
}

/**
 * Genera la clave de firma de la identidad (keypair Ed25519).
 * Se usa SOLO para firmar el HELLO del handshake v2; nunca cifra.
 */
export function generateSigningKeypair(): KeyPair {
  return nacl.sign.keyPair();
}

/**
 * Reconstruye el keypair Ed25519 desde su semilla de 32 B
 * (los primeros 32 B de `secretKey` de un keypair generado).
 */
export function signingKeypairFromSeed(seed: Uint8Array): KeyPair {
  if (seed.length !== 32) throw new Error("Semilla Ed25519 inválida (debe ser 32 bytes).");
  return nacl.sign.keyPair.fromSeed(seed);
}

/** Firma Ed25519 detached (64 B) sobre un mensaje. */
export function signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

/** Verifica una firma Ed25519 detached. Nunca lanza: false = inválida. */export function verifyDetached(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

/** SHA-512 (nacl.hash). Base del KDF de la clave de sesión v2. */
export function sha512(data: Uint8Array): Uint8Array {
  return nacl.hash(data);
}

/** Bytes aleatorios seguros (para nonces de handshake). */
export function randomNonce(bytes: number): Uint8Array {
  return nacl.randomBytes(bytes);
}

/**
 * Mensaje que firma el HELLO v2, con separación de dominio:
 *   "nido-hello-v2" | pk_hex | eph_hex | nonce_hex
 * Firmar los tres valores juntos liga el efímero a la identidad QR y a
 * esta conexión concreta (el nonce impide reutilizar la firma en otra).
 *
 * LEGADO: se conserva solo para que los tests puedan demostrar que una
 * firma v2 jamás verifica bajo el dominio v3 (confusión cross-version
 * imposible por construcción). En el cable solo se envía v3.
 */
export function buildHelloSignMessage(pkHex: string, ephHex: string, nonceHex: string): Uint8Array {
  return utf8Encode(`nido-hello-v2|${pkHex.toLowerCase()}|${ephHex.toLowerCase()}|${nonceHex.toLowerCase()}`);
}

/**
 * Mensaje que firma el HELLO v3 (R4), con separación de dominio:
 *   "nido-hello-v3" | pk_hex | eph_hex | nonce_hex | ts_dec
 *
 * `ts` (segundos Unix, decimal sin ceros a la izquierda) va DENTRO de la
 * firma para que un atacante no pueda "refrescar" el timestamp de un HELLO
 * capturado. La etiqueta de dominio "nido-hello-v3" hace que una firma v2
 * jamás verifique como v3 y viceversa.
 */
export function buildHelloSignMessageV3(
  pkHex: string,
  ephHex: string,
  nonceHex: string,
  tsSeconds: number,
): Uint8Array {
  if (!Number.isInteger(tsSeconds) || tsSeconds < 1 || tsSeconds >= 2 ** 40) {
    throw new Error("Timestamp de HELLO v3 inválido.");
  }
  return utf8Encode(
    `nido-hello-v3|${pkHex.toLowerCase()}|${ephHex.toLowerCase()}|${nonceHex.toLowerCase()}|${tsSeconds}`,
  );
}

/**
 * Mensaje que firma el CONFIRM v1 (R4), con separación de dominio:
 *   "nido-confirm-v1" | pk_hex | cn_hex | pn_hex
 *
 * `pk` es la identidad de quien confirma; `cn` su propio nonce de HELLO y
 * `pn` el nonce del peer que vio en ESTA conexión. Firmar ambos nonces liga
 * la confirmación al transcript vivo: un CONFIRM capturado de otra conexión
 * nombra otro `pn` y no verifica aquí.
 */
export function buildConfirmSignMessage(pkHex: string, cnHex: string, pnHex: string): Uint8Array {
  return utf8Encode(
    `nido-confirm-v1|${pkHex.toLowerCase()}|${cnHex.toLowerCase()}|${pnHex.toLowerCase()}`,
  );
}

/** Huella legible para verificación verbal: 8 grupos de 4 hex. */
export function fingerprint(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("Clave pública inválida (debe ser 32 bytes).");
  const hex = toHex(publicKey);
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) groups.push(hex.slice(i * 4, i * 4 + 4));
  return groups.join(" ");
}

/* ---------- sesión ---------- */

/** Par efímero para el handshake de una conexión. */
export function generateEphemeral(): KeyPair {
  return nacl.box.keyPair();
}

/**
 * KDF de la clave de sesión del handshake v2 (ver
 * docs/HANDSHAKE_THREAT_MODEL.md):
 *
 *   K = SHA-512("nido-session-v2" || secreto_DH || nonce_min || nonce_max)[0:32]
 *
 * Ligar ambos nonces (orden canónico para que ambos lados coincidan)
 * impide que un HELLO repetido resucite una sesión pasada o permita
 * predecir la clave de la nueva: el otro nonce siempre es fresco por
 * conexión. Construcción estándar: hash con separación de dominio sobre
 * el secreto Diffie-Hellman.
 */
export function deriveSessionKeyV2(
  myEphemeralSecret: Uint8Array,
  theirEphemeralPk: Uint8Array,
  nonceA: Uint8Array,
  nonceB: Uint8Array,
): Uint8Array {
  if (myEphemeralSecret.length !== 32 || theirEphemeralPk.length !== 32) {
    throw new Error("Claves de sesión inválidas.");
  }
  if (nonceA.length !== HANDSHAKE_NONCE_BYTES || nonceB.length !== HANDSHAKE_NONCE_BYTES) {
    throw new Error("Nonce de handshake inválido.");
  }
  const shared = nacl.box.before(theirEphemeralPk, myEphemeralSecret);
  const domain = utf8Encode("nido-session-v2");
  // Orden canónico: ambos lados derivan la misma clave sin importar quién
  // inició la conexión.
  const [lo, hi] =
    compareBytes(nonceA, nonceB) <= 0 ? [nonceA, nonceB] : [nonceB, nonceA];
  const input = new Uint8Array(domain.length + shared.length + lo.length + hi.length);
  input.set(domain, 0);
  input.set(shared, domain.length);
  input.set(lo, domain.length + shared.length);
  input.set(hi, domain.length + shared.length + lo.length);
  const digest = nacl.hash(input);
  // Limpieza: el secreto DH no debe quedar en memoria más de lo necesario.
  shared.fill(0);
  input.fill(0);
  return digest.slice(0, 32);
}

/** Nonces de handshake: 16 bytes aleatorios por HELLO. */
export const HANDSHAKE_NONCE_BYTES = 16;

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/* ---------- mensajes ---------- */

export interface SealedMessage {
  nonce: Uint8Array;
  boxed: Uint8Array;
}

/** Cifra y autentica un mensaje con la clave de sesión. */
export function sealMessage(plaintext: Uint8Array, sessionKey: Uint8Array): SealedMessage {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const boxed = nacl.secretbox(plaintext, nonce, sessionKey);
  return { nonce, boxed };
}

/**
 * Descifra y verifica. Devuelve null si el mensaje fue manipulado o la
 * clave es incorrecta (fallo de autenticación, no excepción).
 */
export function openMessage(sealed: SealedMessage, sessionKey: Uint8Array): Uint8Array | null {
  return nacl.secretbox.open(sealed.boxed, sealed.nonce, sessionKey);
}
