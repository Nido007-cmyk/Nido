/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// NIDO Protocol Conformance Suite v0
// Generic runner: every official vector in vectors/v0/final/*.json is fed to
// the reference adapter, and the normalized result must deep-equal `expected`.
//
// This file contains no test logic per vector: the vectors ARE the tests.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { runVector, Vector } from '../reference-ts/adapter';

const FINAL = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'v0', 'final');
const SKIP = new Set(['manifest.json', 'state_machines_tables.json']);

const files = readdirSync(FINAL).filter((f) => f.endsWith('.json') && !SKIP.has(f)).sort();

describe('nido conformance v0', () => {
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(FINAL, f), 'utf8'));
    describe(f, () => {
      for (const v of data.vectors as Vector[]) {
        it(`${v.id} [${v.category}] ${v.title}`, () => {
          expect(runVector(v)).toEqual(v.expected);
        });
      }
    });
  }

  it('manifest counts match the vector files', () => {
    const manifest = JSON.parse(readFileSync(join(FINAL, 'manifest.json'), 'utf8'));
    const totals: Record<string, number> = { valid: 0, invalid: 0, boundary: 0, adversarial: 0, total: 0 };
    for (const f of files) {
      const data = JSON.parse(readFileSync(join(FINAL, f), 'utf8'));
      for (const v of data.vectors as Vector[]) {
        totals[v.category]++;
        totals.total++;
      }
    }
    expect(manifest.totals).toEqual(totals);
  });
});
