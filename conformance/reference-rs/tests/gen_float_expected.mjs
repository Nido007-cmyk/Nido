// Generates float_expected.jsonl from float_corpus.txt using the JS engine's
// Number.prototype.toString as ground truth.
//   node tests/gen_float_expected.mjs   (run from tests/ or repo root via path below)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(join(dir, 'float_corpus.txt'), 'utf8').split('\n').filter((l) => l.trim() !== '');
const out = [];
for (const hex of lines) {
  const bits = BigInt('0x' + hex.trim());
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(bits);
  const v = buf.readDoubleBE(0);
  if (!Number.isFinite(v)) throw new Error('non-finite in corpus: ' + hex);
  // -0 must format as "0" per the canonicalization rule (not "-0")
  const s = Object.is(v, -0) ? '0' : v.toString();
  out.push(JSON.stringify({ bits: hex.trim(), js: s }));
}
writeFileSync(join(dir, 'float_expected.jsonl'), out.join('\n') + '\n');
console.log(`wrote ${out.length} expected outputs`);
