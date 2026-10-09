/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0 — reference-ts
// SHA-256 over the UTF-8 bytes of the canonical representation.

import { createHash } from 'node:crypto';

export function sha256HexUtf8(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
