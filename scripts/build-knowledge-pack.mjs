#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Builds an offline knowledge pack: Wikipedia article introductions, chunked,
// embedded with the same bge-small model the app uses, in one SQLite file the
// app opens directly (no indexing on the phone). See docs/KNOWLEDGE_PACKS.md.
//
//   node scripts/build-knowledge-pack.mjs                     # Vital Articles level 5 (~50k)
//   node scripts/build-knowledge-pack.mjs --level 4           # level 4 (~10k)
//   node scripts/build-knowledge-pack.mjs --titles my.txt     # your own list, one title per line
//
// Every step is cached under build/knowledge-pack/<id>/, so an interrupted run resumes.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { chunkGuide, chunkIntro, cleanIntro, parseArgs, parseGuide, quantizeInt8, USAGE, validateFacts, vitalListPages } from "./lib/knowledge-pack-lib.mjs";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "NIDO-knowledge-pack-builder/1.0 (https://github.com/arsrs91-png/NIDO)";
// The pack's vectors must come from the same model the app searches with.
// bge: the default (English) model. e5: multilingual search (Spanish,
// Portuguese, English), with the passage/query prefixes the app uses
// (src/rag/embeddingProfile.ts).
const EMBEDDING_MODELS = {
  bge: {
    path: "assets/models/embedding.gguf",
    url: "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf",
    sha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
    name: "BAAI/bge-small-en-v1.5",
    passagePrefix: "",
    queryPrefix: "",
  },
  e5: {
    path: "assets/models/embedding-multilingual.gguf",
    url: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v2/multilingual-e5-small-q8_0.gguf",
    sha256: "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde",
    name: "intfloat/multilingual-e5-small",
    passagePrefix: "passage: ",
    queryPrefix: "query: ",
  },
};
let EMBEDDING_MODEL = EMBEDDING_MODELS.bge;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function wiki(params, attempt = 0) {
  const url = `${WIKI_API}?${new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params })}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error?.code === "maxlag") throw new Error("maxlag");
    if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
    return data;
  } catch (e) {
    if (attempt >= 6) throw e;
    await sleep(2000 * 2 ** attempt);
    return wiki(params, attempt + 1);
  }
}

async function fetchTitles(opts, cacheFile) {
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
  let titles;
  if (opts.titlesFile) {
    titles = readFileSync(opts.titlesFile, "utf8").split("\n").map((t) => t.trim()).filter(Boolean);
  } else {
    const prefix = `Vital_articles/Level_${opts.level}/`;
    const pages = [];
    let cont = {};
    do {
      const d = await wiki({ action: "query", list: "allpages", apnamespace: "4", apprefix: prefix, apfilterredir: "nonredirects", aplimit: "500", ...cont });
      pages.push(...d.query.allpages.map((p) => p.title));
      cont = d.continue ?? null;
    } while (cont);
    const listPages = vitalListPages(pages, opts.level);
    log(`${listPages.length} Vital Articles level ${opts.level} list pages`);
    const set = new Set();
    for (const page of listPages) {
      let c = {};
      do {
        const d = await wiki({ action: "query", prop: "links", titles: page, plnamespace: "0", pllimit: "max", ...c });
        for (const p of d.query.pages) for (const l of p.links ?? []) set.add(l.title);
        c = d.continue ?? null;
      } while (c);
    }
    titles = [...set];
  }
  if (opts.limit) titles = titles.slice(0, opts.limit);
  writeFileSync(cacheFile, JSON.stringify(titles));
  return titles;
}

async function fetchIntros(titles, cacheFile) {
  const done = new Set();
  if (existsSync(cacheFile)) {
    for (const line of readFileSync(cacheFile, "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      for (const t of r.requested) done.add(t);
    }
  }
  const todo = titles.filter((t) => !done.has(t));
  log(`intros: ${done.size} cached, ${todo.length} to fetch`);
  const batches = [];
  for (let i = 0; i < todo.length; i += 20) batches.push(todo.slice(i, i + 20));
  let n = 0;
  const worker = async () => {
    while (batches.length) {
      const batch = batches.shift();
      const d = await wiki({ action: "query", prop: "extracts|info", inprop: "url", exintro: "1", explaintext: "1", exlimit: "20", redirects: "1", titles: batch.join("|") });
      const pages = (d.query.pages ?? [])
        .filter((p) => !p.missing && p.extract)
        .map((p) => ({ pageid: p.pageid, title: p.title, url: p.fullurl, extract: p.extract }));
      appendFileSync(cacheFile, `${JSON.stringify({ requested: batch, pages })}\n`);
      n += batch.length;
      if (n % 2000 < 20) log(`intros: ${n}/${todo.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const byId = new Map();
  for (const line of readFileSync(cacheFile, "utf8").split("\n")) {
    if (!line) continue;
    for (const p of JSON.parse(line).pages) byId.set(p.pageid, p);
  }
  return [...byId.values()].sort((a, b) => a.pageid - b.pageid);
}

async function ensureEmbeddingModel() {
  if (!existsSync(EMBEDDING_MODEL.path)) {
    log(`downloading the embedding model to ${EMBEDDING_MODEL.path}`);
    mkdirSync(dirname(EMBEDDING_MODEL.path), { recursive: true });
    const res = await fetch(EMBEDDING_MODEL.url);
    if (!res.ok) throw new Error(`embedding model download failed: HTTP ${res.status}`);
    writeFileSync(EMBEDDING_MODEL.path, Buffer.from(await res.arrayBuffer()));
  }
  const sha = await sha256File(EMBEDDING_MODEL.path);
  if (sha !== EMBEDDING_MODEL.sha256) {
    throw new Error(`${EMBEDDING_MODEL.path} doesn't match the app's embedding model (sha256 ${sha}); packs must use the same model`);
  }
}

function sha256File(path) {
  return new Promise((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", fail);
  });
}

async function embedChunks(chunks, cacheFile, threads) {
  // Cache: raw float32 vectors appended in chunk order.
  const dims = 384;
  const have = existsSync(cacheFile) ? Math.floor(statSync(cacheFile).size / (dims * 4)) : 0;
  log(`embeddings: ${have} cached, ${chunks.length - have} to compute`);
  if (have < chunks.length) {
    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama({ gpu: false });
    const model = await llama.loadModel({ modelPath: EMBEDDING_MODEL.path });
    const contexts = await Promise.all(
      Array.from({ length: threads }, () => model.createEmbeddingContext({ contextSize: 512, threads: 2 }))
    );
    const start = Date.now();
    for (let i = have; i < chunks.length; i += threads * 16) {
      const group = chunks.slice(i, i + threads * 16);
      const vectors = new Array(group.length);
      await Promise.all(
        contexts.map(async (ctx, w) => {
          for (let j = w; j < group.length; j += threads) {
            // Format v2: the real questions a chunk answers are embedded with
            // it (the reader never sees them; they help a question in other
            // words find it).
            const keys = group[j].keys ? `\n${group[j].keys}` : "";
            vectors[j] = (await ctx.getEmbeddingFor(`${EMBEDDING_MODEL.passagePrefix}${group[j].title}\n${group[j].body}${keys}`)).vector;
          }
        })
      );
      const buf = Buffer.alloc(group.length * dims * 4);
      vectors.forEach((v, j) => {
        if (v.length !== dims) throw new Error(`expected ${dims} dims, got ${v.length}`);
        Float32Array.from(v).forEach((x, k) => buf.writeFloatLE(x, (j * dims + k) * 4));
      });
      appendFileSync(cacheFile, buf);
      const doneNow = i + group.length;
      if (Math.floor(doneNow / 2000) > Math.floor(i / 2000)) {
        const rate = (doneNow - have) / ((Date.now() - start) / 1000);
        log(`embeddings: ${doneNow}/${chunks.length} (${rate.toFixed(0)}/s, ~${Math.round((chunks.length - doneNow) / rate / 60)} min left)`);
      }
    }
    await Promise.all(contexts.map((c) => c.dispose()));
    await model.dispose();
  }
  const raw = readFileSync(cacheFile);
  return new Float32Array(raw.buffer, raw.byteOffset, chunks.length * dims);
}

function writePack(file, opts, chunks, vectors, meta, extra = {}) {
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  // Format v2 adds, without changing anything an older app reads: the guide
  // of each chunk and its search keys (chunks.guide, chunks.keys, also in the
  // full-text index), the guides themselves, and the verified facts.
  db.exec(`
    PRAGMA page_size = 4096;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- vec: the chunk's embedding as int8 (384 bytes), vec * scale ≈ the float vector.
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL, scale REAL NOT NULL, vec BLOB NOT NULL, guide INTEGER, keys TEXT NOT NULL DEFAULT '');
    CREATE VIRTUAL TABLE chunks_fts USING fts5(title, body, keys, content='chunks', content_rowid='id');
    CREATE TABLE guides (id INTEGER PRIMARY KEY, key TEXT NOT NULL, lang TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, region TEXT NOT NULL, sources TEXT NOT NULL, verified TEXT NOT NULL);
    CREATE TABLE regions (code TEXT PRIMARY KEY, names TEXT NOT NULL, aliases TEXT NOT NULL, phrases TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE facts (id INTEGER PRIMARY KEY, region TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, label TEXT NOT NULL, note TEXT NOT NULL, source_title TEXT NOT NULL, source_url TEXT NOT NULL, quote TEXT NOT NULL, checked TEXT NOT NULL);
    CREATE INDEX facts_region ON facts (region, key);
  `);
  const { data, scales } = quantizeInt8(vectors, 384);
  const insertGuide = db.prepare("INSERT INTO guides (id, key, lang, title, category, region, sources, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insert = db.prepare("INSERT INTO chunks (id, title, body, source, scale, vec, guide, keys) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertRegion = db.prepare("INSERT INTO regions (code, names, aliases, phrases) VALUES (?, ?, ?, ?)");
  const insertFact = db.prepare("INSERT INTO facts (region, key, value, label, note, source_title, source_url, quote, checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  (extra.guides ?? []).forEach((g, i) =>
    insertGuide.run(i + 1, g.key || `guide-${i + 1}`, g.lang, g.title, g.category, g.region, g.sources, g.verified)
  );
  chunks.forEach((c, i) =>
    insert.run(i + 1, c.title, c.body, c.source, scales[i], Buffer.from(data.buffer, data.byteOffset + i * 384, 384), c.guide ?? null, c.keys ?? "")
  );
  for (const [code, r] of Object.entries(extra.regions ?? {})) insertRegion.run(code, JSON.stringify(r.names), JSON.stringify(r.aliases), JSON.stringify(r.in ?? {}));
  for (const f of extra.facts ?? []) {
    insertFact.run(f.region, f.key, f.value, JSON.stringify(f.label), JSON.stringify(f.note ?? {}), f.source.title, f.source.url, f.source.quote, f.source.checked);
  }
  db.exec("COMMIT");
  db.exec("INSERT INTO chunks_fts (chunks_fts) VALUES ('rebuild')");
  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(meta)) setMeta.run(k, String(v));
  db.exec("VACUUM");
  db.close();
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(1);
  }
  if (opts.help) return console.log(USAGE);
  EMBEDDING_MODEL = EMBEDDING_MODELS[opts.embedding];

  const work = resolve("build/knowledge-pack", opts.id);
  mkdirSync(work, { recursive: true });
  log(`building ${opts.id} in ${work}`);

  let titles = [];
  let pages = [];
  const chunks = [];
  if (opts.guidesDir) {
    // NIDO's own guides (knowledge-packs/<pack>/<lang>/*.md), in file order.
    const files = readdirSync(opts.guidesDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".md") && !f.toLowerCase().endsWith("readme.md"))
      .sort();
    for (const f of files) {
      const g = parseGuide(readFileSync(join(opts.guidesDir, f), "utf8"), f);
      pages.push(g);
      for (const c of chunkGuide(g)) {
        chunks.push({
          title: c.heading ? `${g.title} — ${c.heading}` : g.title,
          body: c.body,
          source: `NIDO — ${g.title} (${g.lang === "es" ? "basado en" : "based on"}: ${g.sources})`,
          guide: pages.length,
          keys: c.questions.join("\n"),
        });
      }
    }
    titles = pages.map((g) => g.title);
    log(`${pages.length} guides`);
  } else {
    titles = await fetchTitles(opts, join(work, "titles.json"));
    log(`${titles.length} titles`);
    pages = await fetchIntros(titles, join(work, "intros.jsonl"));
    log(`${pages.length} articles with an introduction`);
    for (const p of pages) {
      for (const body of chunkIntro(cleanIntro(p.extract), opts.chunkChars, opts.maxChunks)) {
        chunks.push({ title: p.title, body, source: `Wikipedia — ${p.url}` });
      }
    }
  }
  log(`${chunks.length} chunks`);

  await ensureEmbeddingModel();
  const vectors = await embedChunks(chunks, join(work, `embeddings-${chunks.length}.f32`), opts.threads);

  const outFile = resolve(opts.out, `${opts.id}.sqlite`);
  mkdirSync(dirname(outFile), { recursive: true });
  // Format v2: verified facts beside the guides (knowledge-packs/<pack>/facts.json).
  let factsDoc = { regions: {}, facts: [] };
  const factsFile = opts.guidesDir ? join(opts.guidesDir, "facts.json") : null;
  if (factsFile && existsSync(factsFile)) {
    factsDoc = validateFacts(JSON.parse(readFileSync(factsFile, "utf8")), factsFile);
    log(`${factsDoc.facts.length} verified facts for ${Object.keys(factsDoc.regions).length} regions`);
  }
  writePack(outFile, opts, chunks, vectors, {
    format: "nido-knowledge-pack",
    formatVersion: 2,
    facts: factsDoc.facts.length,
    dims: 384,
    id: opts.id,
    name: opts.name,
    ...(opts.guidesDir
      ? {
          source: `${titles.length} guides written by NIDO from official sources (cited in each guide)`,
          license: "CC BY 4.0 (NIDO)",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          attribution:
            "Written by NIDO (https://github.com/Nido007-cmyk/Nido) from public guidance by the organizations cited in each guide. " +
            `Vectors computed by NIDO with ${EMBEDDING_MODEL.name}. General information only: not a substitute for a first aid course or ` +
            "for professional help. In an emergency, call your local emergency number.",
        }
      : {
          source: opts.titlesFile ? `Wikipedia introductions for ${titles.length} listed titles` : `Wikipedia Vital Articles level ${opts.level} introductions`,
          license: "CC BY-SA 4.0 (Wikipedia)",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
          attribution:
            "Compiled by NIDO (https://github.com/Nido007-cmyk/Nido) from Wikipedia article introductions " +
            `(https://www.wikipedia.org, CC BY-SA 4.0). Vectors computed by NIDO with ${EMBEDDING_MODEL.name}. ` +
            "If you share or adapt this pack, credit NIDO and Wikipedia, link the license, say what you changed, and keep CC BY-SA 4.0.",
        }),
    articles: pages.length,
    chunks: chunks.length,
    embeddingModelSha256: EMBEDDING_MODEL.sha256,
    embeddingModel: EMBEDDING_MODEL.name,
    embeddingPassagePrefix: EMBEDDING_MODEL.passagePrefix,
    embeddingQueryPrefix: EMBEDDING_MODEL.queryPrefix,
    builtAt: opts.builtAt ?? new Date().toISOString(),
  }, opts.guidesDir ? { guides: pages, regions: factsDoc.regions, facts: factsDoc.facts } : {});
  const size = statSync(outFile).size;
  const sha = await sha256File(outFile);
  const summary = { id: opts.id, file: outFile, sizeBytes: size, sha256: sha, articles: pages.length, chunks: chunks.length };
  writeFileSync(`${outFile}.json`, `${JSON.stringify(summary, null, 2)}\n`);
  log(`done: ${outFile}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
