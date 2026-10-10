/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * pairing.ts — NIDO P2P: emparejamiento por QR (Fase E + Hardening).
 *
 * El QR es el intercambio de claves fuera de banda: escanearlo en persona
 * autentica la identidad del contacto (modelo Briar). Opt-in mutuo:
 * cada lado escanea el QR del otro.
 *
 * v2: además de la identidad X25519 (`pk`) incluye la clave pública de
 * firma Ed25519 (`spk`), que autentica el handshake (ver
 * docs/HANDSHAKE_THREAT_MODEL.md).
 */

import { fromHex, toHex } from "./crypto";

/**
 * P5 (auditoría 2026-10-10): caracteres que un nombre de contacto no puede
 * llevar. El nombre se muestra en diálogos de confirmación y entra al
 * contexto del agente, así que no puede contener saltos de línea ni otros
 * controles (inyección), controles bidireccionales ni espacios de ancho
 * cero (suplantación visual), ni "<" / ">" (etiquetas del prompt).
 * U+200D (ZWJ) se permite: lo usan los emoji compuestos.
 */
const UNSAFE_NAME_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff<>]/;

/** true si el nombre es seguro para mostrarse y usarse como etiqueta. */
export function isSafeContactName(name: string): boolean {
  return !UNSAFE_NAME_CHARS.test(name);
}

export interface PairingPayload {
  v: 1 | 2;
  app: "nido";
  /** Nombre visible que el dueño le pone a su NIDO. */
  name: string;
  /** Clave pública de identidad X25519, en hex (64 chars). */
  pk: string;
  /** v2: clave pública de firma Ed25519, en hex (64 chars). */
  spk?: string;
}

/**
 * Codifica el payload para mostrarlo como QR (siempre v2).
 * Formato: "NIDO1:" + JSON (prefijo para que el escáner lo reconozca).
 */
export function encodePairingPayload(name: string, publicKey: Uint8Array, signingPublicKey: Uint8Array): string {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error("Ponle un nombre a tu NIDO para emparejar.");
  if (!isSafeContactName(clean)) throw new Error("El nombre de tu NIDO tiene caracteres no permitidos.");
  if (publicKey.length !== 32) throw new Error("Clave pública inválida.");
  if (signingPublicKey.length !== 32) throw new Error("Clave de firma inválida.");
  const payload: PairingPayload = {
    v: 2,
    app: "nido",
    name: clean,
    pk: toHex(publicKey),
    spk: toHex(signingPublicKey),
  };
  return "NIDO1:" + JSON.stringify(payload);
}

/**
 * Decodifica y valida el QR escaneado. Lanza si no es un QR de NIDO válido.
 * Verifica: prefijo, JSON, versión, app, nombre y clave de 32 bytes.
 */
export function decodePairingPayload(qrText: string): PairingPayload {
  const text = qrText.trim();
  if (!text.startsWith("NIDO1:")) {
    throw new Error("Ese QR no es de NIDO.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice("NIDO1:".length));
  } catch {
    throw new Error("El QR de NIDO está dañado.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("El QR de NIDO está dañado.");
  }
  const p = parsed as Record<string, unknown>;
  if ((p.v !== 1 && p.v !== 2) || p.app !== "nido") throw new Error("Versión de emparejamiento no soportada.");
  if (typeof p.name !== "string" || !p.name.trim()) throw new Error("El QR no trae un nombre válido.");
  if (!isSafeContactName(p.name.trim())) throw new Error("El QR trae un nombre con caracteres no permitidos.");
  if (typeof p.pk !== "string") throw new Error("El QR no trae una clave válida.");
  let pk: Uint8Array;
  try {
    pk = fromHex(p.pk);
  } catch {
    throw new Error("La clave del QR no es válida.");
  }
  if (pk.length !== 32) throw new Error("La clave del QR no es válida.");
  // P8: una clave todo-ceros no es una identidad (punto de orden bajo).
  if (pk.every((b) => b === 0)) throw new Error("La clave del QR no es válida.");
  // v2 trae la clave de firma; v1 (legacy) no la trae.
  let spk: string | undefined;
  if (p.spk !== undefined) {
    if (typeof p.spk !== "string") throw new Error("La clave de firma del QR no es válida.");
    let raw: Uint8Array;
    try {
      raw = fromHex(p.spk);
    } catch {
      throw new Error("La clave de firma del QR no es válida.");
    }
    if (raw.length !== 32) throw new Error("La clave de firma del QR no es válida.");
    if (raw.every((b) => b === 0)) throw new Error("La clave de firma del QR no es válida.");
    spk = toHex(raw);
  } else if (p.v === 2) {
    throw new Error("El QR v2 no trae clave de firma.");
  }
  return { v: p.v as 1 | 2, app: "nido", name: p.name.trim().slice(0, 40), pk: toHex(pk), spk };
}
