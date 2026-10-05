/**
 * handshakeV3.ts — NIDO P2P: constantes y ayudantes puros del protocolo
 * HELLO v3 + CONFIRM v1 (R4).
 *
 * Especificación autoritativa:
 * `~/workspace/audits/r4-hello-v2-design-packet-2026-09-28.md` (revisión
 * red-team). Este módulo NO toca la red: solo bytes, constantes y reglas
 * deterministas. Todo aquí es unit-testeable.
 */

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** Tipo de frame del HELLO v3 en el cable. */
export const HELLO_TYPE_V3 = "nido-hello";
/** Versión de cable del HELLO (hard cut: v != 3 se rechaza en parse). */
export const HELLO_VERSION = 3;
/** Tipo de frame del CONFIRM v1 en el cable. */
export const CONFIRM_TYPE_V1 = "nido-confirm";
/** Versión de cable del CONFIRM. */
export const CONFIRM_VERSION = 1;

/**
 * Ventana de frescura del timestamp del HELLO, en segundos.
 * PROVISIONAL (no es una constante de seguridad definitiva): debe
 * probarse con relojes incorrectos/reinicios/dispositivos reales.
 * CONFIRM sigue siendo la pared principal; el timestamp es defensa
 * secundaria que además hace la evicción de la cache anti-replay segura
 * por construcción.
 */
export const HELLO_TS_SKEW_S = 600;

/** Límite máximo del `ts` aceptado (2^40 segundos Unix). */
export const HELLO_TS_MAX = 2 ** 40;

/**
 * Ventana de retención de la cache anti-replay persistente:
 * HELLO_TS_SKEW_S + margen. Las filas más viejas corresponden a HELLOs
 * que el chequeo de frescura rechaza de todos modos, así que podarlas
 * no puede re-admitir un replay.
 */
export const NONCE_CACHE_WINDOW_S = HELLO_TS_SKEW_S + 3000;

/** Espera máxima del CONFIRM del peer tras enviar el nuestro. */
export const CONFIRM_WAIT_MS = 10_000;

export interface ConfirmPayload {
  pk: string;
  cn: string;
  pn: string;
  sig: string;
}

/**
 * Valida y parsea un frame CONFIRM v1 (cuerpo JSON en claro).
 * Lanza si es inválido. Puro y determinista.
 */
export function parseConfirm(body: Uint8Array): ConfirmPayload {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  } catch {
    throw new Error("CONFIRM no es JSON.");
  }
  if (obj.t !== CONFIRM_TYPE_V1) throw new Error("CONFIRM de tipo desconocido.");
  if (obj.v !== CONFIRM_VERSION) throw new Error("CONFIRM de versión desconocida.");
  const pk = typeof obj.pk === "string" ? obj.pk.toLowerCase() : "";
  const cn = typeof obj.cn === "string" ? obj.cn.toLowerCase() : "";
  const pn = typeof obj.pn === "string" ? obj.pn.toLowerCase() : "";
  const sig = typeof obj.sig === "string" ? obj.sig.toLowerCase() : "";
  if (!HEX64.test(pk)) throw new Error("CONFIRM sin pk válida.");
  if (!HEX32.test(cn)) throw new Error("CONFIRM sin cn válido.");
  if (!HEX32.test(pn)) throw new Error("CONFIRM sin pn válido.");
  if (!HEX128.test(sig)) throw new Error("CONFIRM sin firma válida.");
  return { pk, cn, pn, sig };
}

/**
 * Construye el cuerpo de un CONFIRM v1 propio (firmado).
 * `myPkHex`: mi identidad; `myNonceHex` (cn): mi nonce de HELLO;
 * `peerNonceHex` (pn): el nonce del peer visto en ESTA conexión.
 */
export function buildConfirmV1(
  myPkHex: string,
  myNonceHex: string,
  peerNonceHex: string,
  sigHex: string,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      t: CONFIRM_TYPE_V1,
      v: CONFIRM_VERSION,
      pk: myPkHex.toLowerCase(),
      cn: myNonceHex.toLowerCase(),
      pn: peerNonceHex.toLowerCase(),
      sig: sigHex.toLowerCase(),
    }),
  );
}

/**
 * Clave canónica del tie-break de simultaneous dial (packet §4.5):
 *   K = min(nonceLocal, noncePeer) || max(nonceLocal, noncePeer)
 *
 * Comparación lexicográfica byte-wise sobre los 32 chars hex en minúsculas
 * (el orden de chars ASCII coincide con el orden de bytes para [0-9a-f]).
 * Ambos peers observan el MISMO par desordenado de nonces por sesión, así
 * que ambos calculan la misma K para cada socket y eligen el mismo ganador
 * sin importar el orden local de los eventos. Gana la sesión con menor K.
 */
export function tieBreakKey(nonceLocalHex: string, noncePeerHex: string): string {
  const a = nonceLocalHex.toLowerCase();
  const b = noncePeerHex.toLowerCase();
  if (!HEX32.test(a) || !HEX32.test(b)) {
    throw new Error("Nonces inválidos para el tie-break.");
  }
  return a < b ? a + b : b + a;
}
