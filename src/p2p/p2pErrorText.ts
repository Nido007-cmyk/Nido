/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P2P errors → what the user reads (final audit, 0.1.17).
 *
 * The NIDO screen used to show e.message as is: technical Spanish from the
 * transport ("Fin del stream.", "HELLO sin firma válida.", "NPE interno en
 * connect()…") or the native module, also for English/Portuguese users. This
 * maps every known message to a key under nido.errors.* with a plain
 * explanation of what to do. Anything unknown gets a generic sentence with the
 * original message in parentheses (still useful when someone reports it).
 *
 * Pure: no React, no i18n instance; the screen passes `t`.
 */

export interface P2PErrorText {
  key: string;
  vars?: Record<string, string>;
}

const message = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : String(e);
};

const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : "";
};

/** Ordered: first match wins (specific before generic). */
const RULES: Array<{ re: RegExp; key: string; group?: string }> = [
  { re: /Primero crea tu identidad NIDO/i, key: "noIdentity" },
  // 0.1.55 (P-04): no se llamó para no revelar la identidad.
  { re: /^Saludo privado: no pude comprobar/, key: "privateCheckFailed" },
  { re: /^Solo saludo privado: este contacto usa un NIDO antiguo/, key: "privateOnlyOldContact" },
  { re: /^Solo saludo privado: este dispositivo no es un contacto/, key: "privateOnlyNoTarget" },
  { re: /^Solo saludo privado: rechazado un saludo en claro/, key: "privateOnlyPlainHello" },
  { re: /Ese es tu propio QR|Es mi propio dispositivo/i, key: "ownQr" },
  {
    re: /La clave (de firma )?del QR no es válida|El QR de NIDO está dañado|Clave de firma del contacto inválida|Versión de emparejamiento no soportada/i,
    key: "qrInvalid",
  },
  { re: /Ya tienes un contacto vivo llamado «([^»]+)»/, key: "duplicateName", group: "name" },
  { re: /No encontré una dirección Bluetooth ni Wi-Fi local en «([^»]+)»/, key: "noAddress", group: "alias" },
  { re: /No se pudo guardar el contacto/i, key: "contactSaveFailed" },
  { re: /Contacto revocado/i, key: "revoked" },
  { re: /El transporte no soporta revocación/i, key: "revokeUnsupported" },
  { re: /El transporte no soporta recuperación de revocaciones/i, key: "revokeRecoveryUnsupported" },
  { re: /NidoMessenger invalidado por Clear All Data/i, key: "sessionInvalidated" },
  { re: /Versión de protocolo no soportada|HELLO de versión desconocida/i, key: "versionMismatch" },
  { re: /El Bluetooth está apagado/i, key: "bluetoothOff" },
  { re: /Bluetooth no disponible|Ni Bluetooth ni Wi-Fi local están disponibles|sin radio/i, key: "noRadio" },
  { re: /permiso|permission|BLUETOOTH_CONNECT/i, key: "permission" },
  { re: /Handshake duplicado|Handshake simultáneo/i, key: "alreadyConnected" },
  { re: /db locked|database is locked|SQLITE_BUSY/i, key: "busy" },
  {
    re: /Handshake agotado|handshake|HELLO|socket|stream|read failed|write failed|timeout|timed out|ECONN|EHOSTUNREACH|refused|Conexión cerrada|Sin conexión con|No se pudo conectar|NPE interno|Peer no conectado|Sin peer enlazado|Discovery detenido|Desconectado/i,
    key: "connection",
  },
];

const CODE_RULES: Record<string, string> = {
  PERM_ERROR: "permission",
  BT_CONNECT: "connection",
  BT_SEND: "connection",
  BT_ERROR: "connection",
  LAN_ERROR: "connection",
};

export function describeP2PError(e: unknown): P2PErrorText {
  const msg = message(e).trim();
  for (const rule of RULES) {
    const m = rule.re.exec(msg);
    if (m) return rule.group ? { key: `nido.errors.${rule.key}`, vars: { [rule.group]: m[1] } } : { key: `nido.errors.${rule.key}` };
  }
  const byCode = CODE_RULES[codeOf(e)];
  if (byCode) return { key: `nido.errors.${byCode}` };
  return { key: "nido.errors.generic", vars: { detail: msg || "?" } };
}

/** Convenience for screens: `p2pErrorText(e, t)`. */
export function p2pErrorText(e: unknown, t: (key: string, vars?: Record<string, string>) => string): string {
  const d = describeP2PError(e);
  return t(d.key, d.vars);
}
