/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0 — reference-ts
// Ed25519 sign/verify via node:crypto (audited platform primitive, no custom crypto).
//
// TEST-ONLY keys: three fixed keypairs derived from public, constant seeds.
// They exist ONLY so test vectors are deterministic and reproducible.
// They must never be used outside the conformance suite.

import { createPrivateKey, createPublicKey, sign, verify, KeyObject } from 'node:crypto';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function seedBytes(start: number): string {
  const b = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) b[i] = (start + i) & 0xff;
  return b.toString('hex');
}

export interface TestKeypair {
  name: string;
  seedHex: string;
  privateKey: KeyObject;
  pubHex: string; // 32 raw bytes as lowercase hex
}

function keypair(name: string, start: number): TestKeypair {
  const seedHex = seedBytes(start);
  const seed = Buffer.from(seedHex, 'hex');
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const pubDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
  const pubHex = Buffer.from(pubDer).subarray(-32).toString('hex');
  return { name, seedHex, privateKey, pubHex };
}

function pubKeyObject(pubHex: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(pubHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

export const TEST_KEYS: Record<string, TestKeypair> = {
  // identity A (primary under test)
  idA: keypair('idA', 0x00),
  // device A1, certified by idA
  devA1: keypair('devA1', 0x20),
  // identity B (peer / attacker-controlled in adversarial vectors)
  idB: keypair('idB', 0x40),
};

export function edSign(kp: TestKeypair, data: Buffer): string {
  return sign(null, data, kp.privateKey).toString('hex');
}

export function edVerify(pubHex: string, data: Buffer, sigHex: string): boolean {
  try {
    const sig = Buffer.from(sigHex, 'hex');
    if (sig.length !== 64) return false;
    if (!/^[0-9a-f]{64}$/.test(pubHex)) return false;
    return verify(null, data, pubKeyObject(pubHex), sig);
  } catch {
    return false;
  }
}
