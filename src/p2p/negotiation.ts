/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * negotiation.ts — NIDO P2P: Negociación de tareas agent-to-agent.
 *
 * State machine: PROPOSE → COUNTER → ACCEPT | DECLINE | EXPIRE
 *
 * - PROPOSE: Un NIDO propone una tarea a otro, con capabilities solicitadas
 * - COUNTER: El receptor contrapropone (modifica scope, parámetros)
 * - ACCEPT: Ambas partes acuerdan; se emite un capability grant firmado
 * - DECLINE: Rechazo explícito, firmado
 * - EXPIRE: La propuesta expira por timeout, sin firma (determinista por tiempo)
 *
 * Seguridad:
 * - Toda transición (excepto EXPIRE) está firmada con Ed25519
 * - Serialización canónica (JSON ordenado) para firmas deterministas
 * - Anti-replay: nonce único + timestamp + ventana de validez
 * - Grants limitados por scope/peer/task/time/uses
 * - Integración con AUTO/ASK/DENY: ACCEPT de tareas sensibles requiere ASK
 *
 * NO es validación física. Es IMPLEMENTED + TESTED.
 */

import nacl from "tweetnacl";
import { toHex as bytesToHex, fromHex as hexToBytes } from "./crypto";

/** Estados de la negociación. */
export type NegotiationState =
  | "PROPOSED"
  | "COUNTERED"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED";

/** Tipos de mensajes de negociación. */
export type NegotiationMessageType =
  | "PROPOSE"
  | "COUNTER"
  | "ACCEPT"
  | "DECLINE";

/**
 * Capability grant: autorización limitada y firmada.
 *
 * Un grant autoriza a un peer a realizar acciones específicas,
 * limitado por múltiples dimensiones.
 */
export interface CapabilityGrant {
  /** ID único del grant. */
  grantId: string;
  /** Clave pública del emisor (quien otorga). */
  issuerPkHex: string;
  /** Clave pública del receptor (quien recibe). */
  granteePkHex: string;
  /** Alcances autorizados (ej: ["read:notes", "write:reminder"]). */
  scopes: string[];
  /** ID de la tarea específica (opcional, para grants de tarea única). */
  taskId?: string;
  /** Timestamp de emisión (epoch ms). */
  issuedAt: number;
  /** Timestamp de expiración (epoch ms). */
  expiresAt: number;
  /** Número máximo de usos (0 = ilimitado dentro del tiempo). */
  maxUses: number;
  /** Usos consumidos. */
  usesConsumed: number;
  /** Nonce anti-replay. */
  nonce: string;
  /** Firma Ed25519 del emisor sobre la serialización canónica. */
  signatureHex: string;
}

/**
 * Propuesta de tarea.
 */
export interface TaskProposal {
  /** ID único de la propuesta. */
  proposalId: string;
  /** Clave pública del proponente. */
  proposerPkHex: string;
  /** Clave pública del receptor. */
  recipientPkHex: string;
  /** Descripción humana de la tarea. */
  taskDescription: string;
  /** Capabilities solicitadas. */
  requestedScopes: string[];
  /** Parámetros de la tarea (serializables). */
  params: Record<string, unknown>;
  /** Timestamp de creación. */
  createdAt: number;
  /** Timestamp de expiración. */
  expiresAt: number;
  /** Nonce anti-replay. */
  nonce: string;
  /** Contador de contrapropuestas (0 = propuesta original). */
  counterRound: number;
  /** Firma Ed25519 del proponente. */
  signatureHex: string;
}

/**
 * Mensaje de negociación firmado.
 */
export interface SignedNegotiationMessage {
  type: NegotiationMessageType;
  proposalId: string;
  /** Para COUNTER: la propuesta modificada. Para otros: referencia. */
  payload: TaskProposal | { reason?: string };
  signerPkHex: string;
  timestamp: number;
  nonce: string;
  signatureHex: string;
}

/**
 * Serialización canónica: JSON con claves ordenadas recursivamente.
 * Determinista para firmas.
 */
export function canonicalSerialize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalSerialize).join(",") + "]";
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = sortedKeys.map(
    (k) => JSON.stringify(k) + ":" + canonicalSerialize((obj as Record<string, unknown>)[k])
  );
  return "{" + parts.join(",") + "}";
}

/**
 * Crea una propuesta firmada.
 */
export function createProposal(
  proposerSecretKey: Uint8Array,
  proposerPkHex: string,
  recipientPkHex: string,
  taskDescription: string,
  requestedScopes: string[],
  params: Record<string, unknown>,
  ttlMs: number = 300000 // 5 minutos por defecto
): TaskProposal {
  const now = Date.now();
  const proposal: Omit<TaskProposal, "signatureHex"> = {
    proposalId: bytesToHex(nacl.randomBytes(16)),
    proposerPkHex,
    recipientPkHex,
    taskDescription,
    requestedScopes: [...requestedScopes].sort(),
    params,
    createdAt: now,
    expiresAt: now + ttlMs,
    nonce: bytesToHex(nacl.randomBytes(16)),
    counterRound: 0,
  };
  const message = canonicalSerialize(proposal);
  const signature = nacl.sign.detached(
    new TextEncoder().encode(message),
    proposerSecretKey
  );
  return { ...proposal, signatureHex: bytesToHex(signature) };
}

/**
 * Verifica la firma de una propuesta.
 */
export function verifyProposal(
  proposal: TaskProposal,
  proposerPkBytes: Uint8Array
): boolean {
  const { signatureHex, ...unsigned } = proposal;
  const message = canonicalSerialize(unsigned);
  const signature = hexToBytes(signatureHex);
  return nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signature,
    proposerPkBytes
  );
}

/**
 * Crea una contrapropuesta firmada (modifica scopes o params).
 */
export function createCounter(
  counterSecretKey: Uint8Array,
  counterPkHex: string,
  original: TaskProposal,
  modifiedScopes?: string[],
  modifiedParams?: Record<string, unknown>,
  ttlMs: number = 300000
): TaskProposal {
  const now = Date.now();
  const counter: Omit<TaskProposal, "signatureHex"> = {
    proposalId: original.proposalId, // Mismo ID, nuevo round
    proposerPkHex: counterPkHex,
    recipientPkHex: original.proposerPkHex,
    taskDescription: original.taskDescription,
    requestedScopes: modifiedScopes ? [...modifiedScopes].sort() : original.requestedScopes,
    params: modifiedParams ?? original.params,
    createdAt: now,
    expiresAt: now + ttlMs,
    nonce: bytesToHex(nacl.randomBytes(16)),
    counterRound: original.counterRound + 1,
  };
  const message = canonicalSerialize(counter);
  const signature = nacl.sign.detached(
    new TextEncoder().encode(message),
    counterSecretKey
  );
  return { ...counter, signatureHex: bytesToHex(signature) };
}

/**
 * Emite un capability grant firmado al aceptar.
 */
export function issueGrant(
  issuerSecretKey: Uint8Array,
  issuerPkHex: string,
  granteePkHex: string,
  scopes: string[],
  taskId: string | undefined,
  ttlMs: number,
  maxUses: number
): CapabilityGrant {
  const now = Date.now();
  const grant: Omit<CapabilityGrant, "signatureHex"> = {
    grantId: bytesToHex(nacl.randomBytes(16)),
    issuerPkHex,
    granteePkHex,
    scopes: [...scopes].sort(),
    taskId,
    issuedAt: now,
    expiresAt: now + ttlMs,
    maxUses,
    usesConsumed: 0, // Inicial, no parte de la firma
    nonce: bytesToHex(nacl.randomBytes(16)),
  };
  // La firma cubre todo EXCEPTO usesConsumed (que cambia con el uso)
  const { usesConsumed: _, ...toSign } = grant;
  const message = canonicalSerialize(toSign);
  const signature = nacl.sign.detached(
    new TextEncoder().encode(message),
    issuerSecretKey
  );
  return { ...grant, signatureHex: bytesToHex(signature) };
}

/**
 * Verifica un grant: firma válida, no expirado, usos disponibles.
 *
 * Nota: usesConsumed se pasa por separado (no está en el payload firmado).
 * El firmante firma los límites (maxUses), el verificador rastrea el consumo.
 */
export function verifyGrant(
  grant: CapabilityGrant,
  issuerPkBytes: Uint8Array,
  usesConsumed: number = 0,
  now: number = Date.now()
): { valid: boolean; reason?: string } {
  // Verificar firma (sobre los límites, no el consumo actual)
  const { signatureHex, usesConsumed: _, ...unsigned } = grant;
  const message = canonicalSerialize(unsigned);
  const signature = hexToBytes(signatureHex);
  const sigValid = nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signature,
    issuerPkBytes
  );
  if (!sigValid) {
    return { valid: false, reason: "invalid_signature" };
  }
  // Verificar expiración
  if (now > grant.expiresAt) {
    return { valid: false, reason: "expired" };
  }
  // Verificar usos (contra el contador externo)
  if (grant.maxUses > 0 && usesConsumed >= grant.maxUses) {
    return { valid: false, reason: "uses_exhausted" };
  }
  return { valid: true };
}

/**
 * Verifica la firma de un mensaje de negociación (COUNTER/ACCEPT/DECLINE).
 * Usa el mismo patrón que verifyProposal: serialización canónica + Ed25519.
 */
export function verifyNegotiationMessage(
  msg: SignedNegotiationMessage,
  signerPkBytes: Uint8Array
): boolean {
  const { signatureHex, ...unsigned } = msg;
  const message = canonicalSerialize(unsigned);
  const signature = hexToBytes(signatureHex);
  return nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signature,
    signerPkBytes
  );
}

/**
 * Verifica si una propuesta ha expirado (determinista por tiempo).
 */
export function isExpired(proposal: TaskProposal, now: number = Date.now()): boolean {
  return now > proposal.expiresAt;
}

/**
 * Firma un mensaje de negociación (ACCEPT/DECLINE/COUNTER).
 * Complementa verifyNegotiationMessage para el production path completo.
 */
export function signNegotiationMessage(
  signerSecretKey: Uint8Array,
  signerPkHex: string,
  type: NegotiationMessageType,
  proposalId: string,
  payload: TaskProposal | { reason?: string }
): SignedNegotiationMessage {
  const unsigned = {
    type,
    proposalId,
    payload,
    signerPkHex,
    timestamp: Date.now(),
    nonce: bytesToHex(nacl.randomBytes(16)),
  };
  const message = canonicalSerialize(unsigned);
  const signature = nacl.sign.detached(
    new TextEncoder().encode(message),
    signerSecretKey
  );
  return {
    ...unsigned,
    signatureHex: bytesToHex(signature),
  };
}

/**
 * Transiciones válidas de la state machine.
 */
const VALID_TRANSITIONS: Record<NegotiationState, NegotiationState[]> = {
  PROPOSED: ["COUNTERED", "ACCEPTED", "DECLINED", "EXPIRED"],
  COUNTERED: ["COUNTERED", "ACCEPTED", "DECLINED", "EXPIRED"],
  ACCEPTED: [], // Terminal
  DECLINED: [], // Terminal
  EXPIRED: [], // Terminal
};

/**
 * Verifica si una transición de estado es válida.
 */
export function isValidTransition(from: NegotiationState, to: NegotiationState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
