#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Checks that a newly built knowledge pack's vectors match the vectors of a
// published reference pack made with the same embedding model, for every
// chunk whose text is identical in both. This catches a builder that embeds
// differently from what the app expects (wrong model, wrong prefix, wrong
// text): the app would then search the new pack badly without any error.
//
//   node scripts/check-pack-parity.mjs <new.sqlite> <reference.sqlite> [--min 0.97] [--github]
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--") && !/^\d/.test(a));
const minIdx = args.indexOf("--min");
const MIN = minIdx >= 0 ? Number(args[minIdx + 1]) : 0.97;
const github = args.includes("--github");
if (files.length !== 2) {
  console.error("usage: node scripts/check-pack-parity.mjs <new.sqlite> <reference.sqlite> [--min 0.97] [--github]");
  process.exit(2);
}

function load(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  const byText = new Map();
  for (const r of db.prepare("SELECT title, body, scale, vec FROM chunks").all()) {
    const v = new Int8Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength);
    byText.set(`${r.title}\n${r.body}`, Float32Array.from(v, (x) => x * r.scale));
  }
  db.close();
  return { meta, byText };
}

function cosine(a, b) {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb);
}

const say = (level, msg) => console.log(github ? `::${level} title=Pack parity::${msg}` : msg);
const fresh = load(files[0]);
const ref = load(files[1]);
if (fresh.meta.embeddingModelSha256 !== ref.meta.embeddingModelSha256) {
  say("error", `different embedding models: ${fresh.meta.embeddingModelSha256} vs ${ref.meta.embeddingModelSha256}`);
  process.exit(1);
}
const sims = [];
for (const [text, v] of fresh.byText) {
  const w = ref.byText.get(text);
  if (w) sims.push(cosine(v, w));
}
if (sims.length === 0) {
  say("error", `no chunk text in common with ${files[1]}: nothing to compare`);
  process.exit(1);
}
sims.sort((a, b) => a - b);
const mean = sims.reduce((s, x) => s + x, 0) / sims.length;
const msg = `${fresh.meta.id}: ${sims.length} chunks in common with ${ref.meta.id}; cosine min ${sims[0].toFixed(4)}, median ${sims[Math.floor(sims.length / 2)].toFixed(4)}, mean ${mean.toFixed(4)} (required min ${MIN})`;
if (sims[0] < MIN) {
  say("error", msg);
  process.exit(1);
}
say("notice", msg);
