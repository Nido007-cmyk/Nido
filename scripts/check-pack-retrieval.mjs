#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Checks that a knowledge pack answers real questions with the right text:
// each question in the list is embedded with the pack's own model and query
// prefix (as the app does) and the expected guide must be among the top
// results. Catches a pack whose vectors are fine but whose text is chunked
// or titled so that searches miss it.
//
//   node scripts/check-pack-retrieval.mjs <pack.sqlite> <checks.json> --model <file.gguf> [--langs es,en] [--top 3] [--min 0.9] [--github]
//
// checks.json: [{ "lang": "es", "q": "cómo paro una hemorragia", "expect": "Hemorragias graves" }, ...]
// `expect` is matched against the start of the chunk title (the guide title).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const WITH_VALUE = new Set(["--model", "--langs", "--top", "--min"]);
const files = args.filter((a, i) => !a.startsWith("--") && !WITH_VALUE.has(args[i - 1]));
const github = args.includes("--github");
const modelPath = opt("--model");
const TOP = Number(opt("--top", "3"));
const MIN = Number(opt("--min", "0.9"));
const langs = opt("--langs") ? new Set(opt("--langs").split(",")) : null;
if (files.length !== 2 || !modelPath) {
  console.error("usage: node scripts/check-pack-retrieval.mjs <pack.sqlite> <checks.json> --model <file.gguf> [--langs es,en] [--top 3] [--min 0.9] [--github]");
  process.exit(2);
}
const say = (level, msg) => console.log(github ? `::${level} title=Pack retrieval::${msg}` : msg);

const db = new DatabaseSync(files[0], { readOnly: true });
const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
const rows = db.prepare("SELECT title, scale, vec FROM chunks").all().map((r) => ({
  title: r.title,
  v: Float32Array.from(new Int8Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength), (x) => x * r.scale),
}));
db.close();

const modelSha = createHash("sha256").update(readFileSync(modelPath)).digest("hex");
if (modelSha !== meta.embeddingModelSha256) {
  say("error", `${modelPath} is not the pack's embedding model (${meta.embeddingModel})`);
  process.exit(1);
}

const checks = JSON.parse(readFileSync(files[1], "utf8")).filter((c) => !langs || langs.has(c.lang));
const { getLlama } = await import("node-llama-cpp");
const llama = await getLlama({ gpu: false });
const model = await llama.loadModel({ modelPath });
const ctx = await model.createEmbeddingContext({ contextSize: 512 });

const cosine = (a, b) => {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb);
};

let ok = 0;
const misses = [];
for (const c of checks) {
  const q = (await ctx.getEmbeddingFor(`${meta.embeddingQueryPrefix ?? ""}${c.q}`)).vector;
  const top = rows
    .map((r) => ({ title: r.title, s: cosine(q, r.v) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP);
  if (top.some((t) => t.title.startsWith(c.expect))) ok++;
  else misses.push(`[${c.lang}] "${c.q}" → expected "${c.expect}", got: ${top.map((t) => t.title).join(" | ")}`);
}
await ctx.dispose();
await model.dispose();

const rate = checks.length ? ok / checks.length : 0;
for (const m of misses) say("warning", m);
const msg = `${meta.id}: ${ok}/${checks.length} questions found the right guide in the top ${TOP} (${(rate * 100).toFixed(0)}%, required ${(MIN * 100).toFixed(0)}%)`;
if (checks.length === 0 || rate < MIN) {
  say("error", msg);
  process.exit(1);
}
say("notice", msg);
