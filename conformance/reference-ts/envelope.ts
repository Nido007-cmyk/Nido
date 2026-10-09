/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0 — reference-ts
// Envelope validation: the §8 pipeline as pure functions, no network.
//
// Steps implemented:
//  1. strict parse (rejects duplicate keys, trailing data, unsafe integers)
//  2. required envelope fields with correct types
//  3. protocol_version supported (exact 'nido/1.0' in v0)
//  4. crypto_suite acceptable
//  5. identifier formats (128-bit lowercase hex for message_id/task_id/nonce)
//  6. timestamps vs injected now (EXPIRED / INVALID_TIMESTAMP)
//  7. device_cert: structure, expiry, binding, signature by identity key
//  8. envelope signature by the certified device key
//  9. message_id replay check against injected seen-set
// 10. message_type known
// 11. payload: object, no forbidden fields, no unknown fields (per-type allowlist)
//
// Deliberately NOT implemented (needs network/agent): HELLO transcript binding,
// revocation freshness checks, relay duplicate suppression.

import { Result, ok, err } from './types';
import { JsonValue, parseStrict } from './strictJson';
import { canonicalize } from './canonicalize';
import { edVerify, edSign, TEST_KEYS } from './sig';

export type EnvelopeError =
  | 'PARSE_ERROR'
  | 'UNSAFE_INTEGER'
  | 'DUPLICATE_FIELD'
  | 'ENVELOPE_MALFORMED'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_CRYPTO'
  | 'INVALID_ID_FORMAT'
  | 'INVALID_TIMESTAMP'
  | 'EXPIRED'
  | 'UNKNOWN_DEVICE'
  | 'CERT_INVALID'
  | 'CERT_EXPIRED'
  | 'CERT_BINDING_MISMATCH'
  | 'INVALID_SIGNATURE'
  | 'DUPLICATE_MESSAGE'
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'FORBIDDEN_FIELD'
  | 'PAYLOAD_MALFORMED';

export interface ValidateCtx {
  now_ms: number;
  skew_ms: number;
  seen: Set<string>;
  allowedSuites: string[];
}

export const DEFAULT_CTX: ValidateCtx = {
  now_ms: 0,
  skew_ms: 300_000,
  seen: new Set<string>(),
  allowedSuites: ['ed25519-sha256-v1'],
};

const HEX32 = /^[0-9a-f]{32}$/;

// Per-type payload allowlists (v0 minimal). Unknown message_type -> UNKNOWN_MESSAGE_TYPE.
const PAYLOAD_FIELDS: Record<string, string[]> = {
  TASK_REQUEST: ['capability', 'capability_version', 'parameters', 'consent_requirement', 'ttl_ms', 'idempotency_key'],
  TASK_RESULT: ['task_id', 'result', 'disclosure_summary'],
  TASK_ERROR: ['task_id', 'error_code', 'retryable', 'detail'],
  TASK_ACCEPT: ['task_id', 'accepted_capability_version', 'eta_ms'],
  TASK_REJECT: ['task_id', 'reason_code', 'retryable', 'detail'],
  TASK_CANCEL: ['task_id', 'reason'],
  TASK_PROGRESS: ['task_id', 'progress_pct', 'note'],
  CAPABILITY_QUERY: ['query_id', 'capability_filter'],
  CAPABILITY_RESPONSE: ['query_id', 'capabilities'],
  CONSENT_REQUEST: ['consent_id', 'action_description', 'capability', 'parameters_summary', 'expires_at'],
  CONSENT_RESULT: ['consent_id', 'decision', 'grant_scope'],
  NEGOTIATION_PROPOSE: ['negotiation_id', 'capability', 'capability_version', 'terms', 'expires_at', 'max_rounds'],
  NEGOTIATION_COUNTER: ['negotiation_id', 'round', 'terms', 'expires_at'],
  NEGOTIATION_ACCEPT: ['negotiation_id', 'terms'],
  NEGOTIATION_DECLINE: ['negotiation_id', 'reason'],
  NEGOTIATION_EXPIRE: ['negotiation_id'],
};

const FORBIDDEN_RE = /prompt|instructions|system_prompt/i;

function hasForbiddenField(v: JsonValue): boolean {
  if (Array.isArray(v)) return v.some(hasForbiddenField);
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_RE.test(k)) return true;
      if (hasForbiddenField((v as Record<string, JsonValue>)[k])) return true;
    }
  }
  return false;
}

export interface ValidEnvelope {
  message_type: string;
  message_id: string;
  task_id: string;
  sender_identity: string;
  sender_device: string;
  recipient_identity: string;
  payload: Record<string, JsonValue>;
}

function isRecord(v: JsonValue): v is Record<string, JsonValue> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function validateEnvelope(raw: string, ctxIn?: Partial<ValidateCtx>): Result<ValidEnvelope, EnvelopeError> {
  const ctx: ValidateCtx = { ...DEFAULT_CTX, ...ctxIn };
  const parsed = parseStrict(raw);
  if (!parsed.ok) return err(parsed.error as EnvelopeError);
  const env = parsed.value;
  if (!isRecord(env)) return err('ENVELOPE_MALFORMED');

  const req = ['protocol_version', 'message_type', 'message_id', 'task_id', 'nonce',
    'created_at', 'expires_at', 'sender', 'recipient_identity', 'crypto_suite', 'payload', 'signature'] as const;
  for (const f of req) {
    if (!(f in env)) return err('ENVELOPE_MALFORMED');
  }
  if (typeof env['protocol_version'] !== 'string' ||
      typeof env['message_type'] !== 'string' ||
      typeof env['message_id'] !== 'string' ||
      typeof env['task_id'] !== 'string' ||
      typeof env['nonce'] !== 'string' ||
      typeof env['created_at'] !== 'number' ||
      typeof env['expires_at'] !== 'number' ||
      typeof env['recipient_identity'] !== 'string' ||
      typeof env['crypto_suite'] !== 'string' ||
      typeof env['signature'] !== 'string' ||
      !isRecord(env['sender']) ||
      !isRecord(env['payload'])) {
    return err('ENVELOPE_MALFORMED');
  }

  if (env['protocol_version'] !== 'nido/1.0') return err('UNSUPPORTED_VERSION');
  if (!ctx.allowedSuites.includes(env['crypto_suite'] as string)) return err('UNSUPPORTED_CRYPTO');

  for (const id of [env['message_id'], env['task_id'], env['nonce']] as string[]) {
    if (!HEX32.test(id)) return err('INVALID_ID_FORMAT');
  }

  const createdAt = env['created_at'] as number;
  const expiresAt = env['expires_at'] as number;
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return err('INVALID_TIMESTAMP');
  if (expiresAt <= createdAt) return err('INVALID_TIMESTAMP');
  if (ctx.now_ms > expiresAt + ctx.skew_ms) return err('EXPIRED');
  if (createdAt > ctx.now_ms + ctx.skew_ms) return err('INVALID_TIMESTAMP');

  const sender = env['sender'] as Record<string, JsonValue>;
  if (typeof sender['identity_pubkey'] !== 'string' || typeof sender['device_id'] !== 'string') {
    return err('ENVELOPE_MALFORMED');
  }
  const identityPubkey = sender['identity_pubkey'] as string;
  const deviceId = sender['device_id'] as string;

  // Device certificate: required in v0, must bind device key to identity.
  const cert = sender['device_cert'];
  if (!isRecord(cert)) return err('UNKNOWN_DEVICE');
  const certFields = ['device_pubkey', 'identity_pubkey', 'issued_at', 'expires_at', 'signature'];
  for (const f of certFields) {
    if (!(f in cert)) return err('CERT_INVALID');
  }
  if (typeof cert['device_pubkey'] !== 'string' ||
      typeof cert['identity_pubkey'] !== 'string' ||
      typeof cert['issued_at'] !== 'number' ||
      typeof cert['expires_at'] !== 'number' ||
      typeof cert['signature'] !== 'string') {
    return err('CERT_INVALID');
  }
  if (cert['identity_pubkey'] !== identityPubkey) return err('CERT_BINDING_MISMATCH');
  if (ctx.now_ms > (cert['expires_at'] as number)) return err('CERT_EXPIRED');
  // cert signature: over canonical cert-without-signature, verified by identity key
  const certBody: Record<string, JsonValue> = {
    device_pubkey: cert['device_pubkey'],
    identity_pubkey: cert['identity_pubkey'],
    issued_at: cert['issued_at'],
    expires_at: cert['expires_at'],
  };
  const certCanon = canonicalize(certBody);
  if (!certCanon.ok) return err('CERT_INVALID');
  if (!edVerify(identityPubkey, Buffer.from(certCanon.value, 'utf8'), cert['signature'] as string)) {
    return err('CERT_INVALID');
  }
  const devicePubkey = cert['device_pubkey'] as string;

  // Envelope signature: over canonical envelope-without-signature.
  const body: Record<string, JsonValue> = { ...env };
  delete body['signature'];
  const canon = canonicalize(body);
  if (!canon.ok) return err('ENVELOPE_MALFORMED');
  if (!edVerify(devicePubkey, Buffer.from(canon.value, 'utf8'), env['signature'] as string)) {
    return err('INVALID_SIGNATURE');
  }

  const messageId = env['message_id'] as string;
  if (ctx.seen.has(messageId)) return err('DUPLICATE_MESSAGE');

  const messageType = env['message_type'] as string;
  const allowed = PAYLOAD_FIELDS[messageType];
  if (!allowed) return err('UNKNOWN_MESSAGE_TYPE');

  const payload = env['payload'] as Record<string, JsonValue>;
  if (hasForbiddenField(payload)) return err('FORBIDDEN_FIELD');
  for (const k of Object.keys(payload)) {
    if (!allowed.includes(k)) return err('PAYLOAD_MALFORMED');
  }

  ctx.seen.add(messageId);
  return ok({
    message_type: messageType,
    message_id: messageId,
    task_id: env['task_id'] as string,
    sender_identity: identityPubkey,
    sender_device: deviceId,
    recipient_identity: env['recipient_identity'] as string,
    payload,
  });
}

// Test helper: build a device cert for the fixed TEST_KEYS (deterministic).
export function makeTestDeviceCert(deviceAlias: 'devA1', identityAlias: 'idA', issuedAt: number, expiresAt: number): Record<string, JsonValue> {
  const dev = TEST_KEYS[deviceAlias];
  const id = TEST_KEYS[identityAlias];
  const body: Record<string, JsonValue> = {
    device_pubkey: dev.pubHex,
    identity_pubkey: id.pubHex,
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  const canon = canonicalize(body);
  if (!canon.ok) throw new Error('cert canon failed');
  const signature = edSign(id, Buffer.from(canon.value, 'utf8'));
  return { ...body, signature };
}

export { TEST_KEYS };
