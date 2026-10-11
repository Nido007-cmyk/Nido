/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
 *  2) `expo-crypto` nativo vía `require` directo a nivel de módulo —
 *     Hermes en el dispositivo. OJO: debe ser require() directo, NO
 *     `globalThis.require`: Metro lo inyecta como parámetro de ámbito de
 *     módulo, no en globalThis, así que `globalThis.require` es undefined
 *     en el dispositivo y esa rama nunca se ejecutaba (T-PRNG-2026-10-06,
 *     "no PRNG" en pantalla). Diferido (no import estático) para no romper
 *     los tests de Node, donde expo-crypto arrastra `react-native`
 *     (sintaxis Flow).
 *  3) Sin fuente disponible no se instala nada: `nacl.randomBytes()`
 *     lanzará su "no PRNG" explícito al usarse — fail-closed, nunca
 *     silencioso ni con aleatoriedad débil. NO se introduce fallback
 *     inseguro ni pseudoaleatoriedad propia.
 */
export function installSecurePrng(): void {
  const setPRNG = (nacl as unknown as { setPRNG?: (fn: (x: Uint8Array, n: number) => void) => void }).setPRNG;
  if (!setPRNG) return;
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;
  if (typeof webCrypto?.getRandomValues === "function") {
    setPRNG((x, n) => {
      webCrypto.getRandomValues!(x.subarray(0, n));
    });
    return;
  }
  try {
    // require() directo a nivel de módulo: el único que Metro/Hermes
    // resuelve en el dispositivo (ver nota arriba). Mismo patrón probado
    // en src/diagnostics/security.ts defaultRandomHex().
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cryptoMod = require("expo-crypto") as {
      getRandomBytes(n: number): Uint8Array;
    };
    // T5-12-2026-10-06: verificar forma del módulo en runtime.
    const { assertExpoCryptoShape } = require("../security/secureDatabase") as {
      assertExpoCryptoShape(mod: unknown, caller: string): void;
    };
    assertExpoCryptoShape(cryptoMod, "p2p/crypto.installSecurePrng");
    const { getRandomBytes } = cryptoMod;
    setPRNG((x, n) => {
      const r = getRandomBytes(n);
      // Auditoría 2026-10-10 (L2): si la fuente devolviera menos bytes,
      // `x.set` dejaría ceros sin aviso. Fail-closed: mejor lanzar.
      if (!r || r.length !== n) {
        throw new Error("PRNG: expo-crypto devolvió una longitud inesperada.");
      }
      x.set(r);
    });
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

/**
 * UTF-8 bien formado. Un surrogate suelto se codifica como U+FFFD (igual que
 * `TextEncoder`). Auditoría 2026-10-10 (L1): antes un surrogate alto seguido
 * de un carácter que no era surrogate bajo producía bytes basura y se
 * "comía" ese carácter.
 *
 * Para cadenas bien formadas (JSON.stringify, hex) la salida es idéntica a
 * la versión anterior: no cambia ninguna firma, hash ni frame en el cable.
 */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      if (c <= 0xdbff && i + 1 < s.length) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          i++;
          const cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          continue;
        }
      }
      c = 0xfffd; // surrogate suelto
    }
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

/**
 * Decodificador UTF-8 según el algoritmo WHATWG (el mismo que `TextDecoder`).
 * - fatal=true: lanza ante cualquier secuencia inválida (truncada,
 *   sobrelarga, surrogate codificado, > U+10FFFF, byte de inicio prohibido).
 * - fatal=false: sustituye cada subparte inválida máxima por U+FFFD,
 *   byte a byte idéntico a `new TextDecoder()`.
 * Implementación propia (sin depender del `TextDecoder` de Hermes, cuyo
 * soporte de `fatal` no está garantizado).
 */
function decodeUtf8(bytes: Uint8Array, fatal: boolean): string {
  const units: number[] = [];
  const parts: string[] = [];
  const flush = () => {
    if (units.length > 0) {
      parts.push(String.fromCharCode.apply(null, units));
      units.length = 0;
    }
  };
  const emit = (cp: number) => {
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      units.push(cp);
    }
    if (units.length >= 8192) flush();
  };
  const fail = () => {
    if (fatal) throw new Error("UTF-8 inválido.");
    emit(0xfffd);
  };
  let needed = 0;
  let seen = 0;
  let cp = 0;
  let lower = 0x80;
  let upper = 0xbf;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (needed === 0) {
      if (b <= 0x7f) {
        emit(b);
      } else if (b >= 0xc2 && b <= 0xdf) {
        needed = 1;
        cp = b & 0x1f;
      } else if (b >= 0xe0 && b <= 0xef) {
        if (b === 0xe0) lower = 0xa0;
        if (b === 0xed) upper = 0x9f;
        needed = 2;
        cp = b & 0x0f;
      } else if (b >= 0xf0 && b <= 0xf4) {
        if (b === 0xf0) lower = 0x90;
        if (b === 0xf4) upper = 0x8f;
        needed = 3;
        cp = b & 0x07;
      } else {
        fail();
      }
      continue;
    }
    if (b < lower || b > upper) {
      cp = 0;
      needed = 0;
      seen = 0;
      lower = 0x80;
      upper = 0xbf;
      fail();
      i--; // se reprocesa este byte como posible inicio
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    cp = (cp << 6) | (b & 0x3f);
    seen++;
    if (seen === needed) {
      emit(cp);
      cp = 0;
      needed = 0;
      seen = 0;
    }
  }
  if (needed !== 0) fail();
  flush();
  return parts.join("");
}

/**
 * Decodifica UTF-8 de forma ESTRICTA: lanza ante bytes inválidos.
 * Auditoría 2026-10-10 (L1): la versión anterior aceptaba secuencias
 * truncadas y sobrelargas (p. ej. `C0 AF` → "/"), que un decodificador
 * estándar rechaza; eso abre diferencias entre implementaciones.
 */
export function utf8Decode(bytes: Uint8Array): string {
  return decodeUtf8(bytes, true);
}

/**
 * Decodifica UTF-8 sin lanzar: lo inválido se convierte en U+FFFD.
 * Solo para MOSTRAR texto no confiable (p. ej. vista previa de un documento).
 */
export function utf8DecodeLossy(bytes: Uint8Array): string {
  return decodeUtf8(bytes, false);
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
 * HMAC-SHA512 sobre `nacl.hash` (construcción RFC 2104 estándar; la
 * aleatoriedad no interviene aquí). TweetNaCl no exporta HMAC, así que
 * se implementa sobre el hash auditado. Verificado contra los vectores
 * RFC 4231 en crypto.test.ts.
 */
function hmacSha512(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const BLOCK = 128; // tamaño de bloque de SHA-512
  let k = key;
  if (k.length > BLOCK) k = nacl.hash(k);
  const kb = new Uint8Array(BLOCK);
  kb.set(k);
  const ipad = new Uint8Array(BLOCK);
  const opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    ipad[i] = kb[i] ^ 0x36;
    opad[i] = kb[i] ^ 0x5c;
  }
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(ipad, 0);
  inner.set(msg, BLOCK);
  const innerHash = nacl.hash(inner);
  const outer = new Uint8Array(BLOCK + innerHash.length);
  outer.set(opad, 0);
  outer.set(innerHash, BLOCK);
  const out = nacl.hash(outer);
  // Limpieza de material intermedio.
  kb.fill(0);
  ipad.fill(0);
  opad.fill(0);
  inner.fill(0);
  outer.fill(0);
  innerHash.fill(0);
  return out;
}

/**
 * HKDF-SHA512 (RFC 5869) sobre `nacl.hash`. Exportado para tests
 * (verificación cruzada contra `crypto.hkdfSync` de Node).
 *
 * @param salt sal no secreta (puede ser etiqueta de dominio).
 * @param ikm  material de entrada (aquí: secreto DH + nonces).
 * @param info etiqueta de contexto ligada a la salida.
 * @param length bytes de salida (1..255*64).
 */
export function hkdfSha512(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  if (!Number.isInteger(length) || length <= 0 || length > 255 * 64) {
    throw new Error("HKDF: longitud inválida.");
  }
  // Extract: PRK = HMAC-SHA512(salt, IKM). Sal vacía → ceros (RFC 5869 §2.2).
  const prk = hmacSha512(salt.length > 0 ? salt : new Uint8Array(64), ikm);
  // Expand: T(i) = HMAC(PRK, T(i-1) | info | i).
  const n = Math.ceil(length / 64);
  const okm = new Uint8Array(n * 64);
  let prev: Uint8Array = new Uint8Array(0);
  for (let i = 1; i <= n; i++) {
    const data = new Uint8Array(prev.length + info.length + 1);
    data.set(prev, 0);
    data.set(info, prev.length);
    data[data.length - 1] = i;
    const t = hmacSha512(prk, data);
    okm.set(t, (i - 1) * 64);
    data.fill(0);
    prev.fill(0);
    prev = t;
  }
  prev.fill(0);
  prk.fill(0);
  const out = okm.slice(0, length);
  okm.fill(0);
  return out;
}

/**
 * KDF de la clave de sesión del handshake v2 (ver
 * docs/HANDSHAKE_THREAT_MODEL.md):
 *
 *   PRK = HMAC-SHA512(salt="nido-session-v2", DH || nonce_min || nonce_max)
 *   K   = HKDF-Expand(PRK, info="nido-session-key-v1", 32)
 *
 * Ligar ambos nonces (orden canónico para que ambos lados coincidan)
 * impide que un HELLO repetido resucite una sesión pasada o permita
 * predecir la clave de la nueva: el otro nonce siempre es fresco por
 * conexión. HKDF-SHA512 (RFC 5869) reemplaza al truncado directo de
 * SHA-512: construcción estándar con análisis publicado.
 *
 * NOTA DE COMPATIBILIDAD: la derivación cambió respecto a versiones
 * anteriores (SHA-512 truncado → HKDF). Ambas tablets deben correr el
 * mismo código; no hay negociación de versión de KDF (fail-closed:
 * claves distintas → el session_confirm no verifica y la sesión no se
 * promociona).
 *
 * HIGIENE DE MEMORIA: el secreto efímero del llamador se borra
 * (`fill(0)`) en cuanto el DH queda computado — es el mismo objeto
 * Uint8Array que conserva el llamador, así que la limpieza cubre
 * todas las rutas (messenger.completeHandshake, P2PSession).
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
  // P8 (auditoría 2026-10-10): un efímero de orden bajo (p. ej. todo ceros)
  // produce un X25519 nulo, y la clave quedaría determinada solo por los
  // nonces, que viajan en claro. Se comprueba el DH crudo (box.before le
  // aplica HSalsa20, así que su salida nunca es cero). Sin salida temprana.
  const rawDh = nacl.scalarMult(myEphemeralSecret, theirEphemeralPk);
  let dhOr = 0;
  for (let i = 0; i < rawDh.length; i++) dhOr |= rawDh[i];
  rawDh.fill(0);
  if (dhOr === 0) {
    myEphemeralSecret.fill(0);
    throw new Error("Clave efímera del peer inválida (secreto compartido nulo).");
  }
  const shared = nacl.box.before(theirEphemeralPk, myEphemeralSecret);
  // El secreto efímero ya cumplió su único propósito (el DH): borrarlo
  // ahora cierra la ventana de forward-secrecy en memoria.
  myEphemeralSecret.fill(0);
  // Orden canónico: ambos lados derivan la misma clave sin importar quién
  // inició la conexión.
  const [lo, hi] =
    compareBytes(nonceA, nonceB) <= 0 ? [nonceA, nonceB] : [nonceB, nonceA];
  const ikm = new Uint8Array(shared.length + lo.length + hi.length);
  ikm.set(shared, 0);
  ikm.set(lo, shared.length);
  ikm.set(hi, shared.length + lo.length);
  const key = hkdfSha512(
    utf8Encode("nido-session-v2"),
    ikm,
    utf8Encode("nido-session-key-v1"),
    32,
  );
  // Limpieza: el secreto DH y el IKM no deben quedar en memoria más de
  // lo necesario.
  shared.fill(0);
  ikm.fill(0);
  return key;
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
