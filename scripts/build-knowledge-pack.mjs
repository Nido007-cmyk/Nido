#!/usr/bin/env node
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
import { chunkIntro, cleanIntro, parseArgs, quantizeInt8, USAGE, vitalListPages } from "./lib/knowledge-pack-lib.mjs";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "NIDO-knowledge-pack-builder/1.0 (https://github.com/arsrs91-png/NIDO)";
const EMBEDDING_MODEL = {
  path: "assets/models/embedding.gguf",
  url: "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf",
  sha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
};

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
            vectors[j] = (await ctx.getEmbeddingFor(`${group[j].title}\n${group[j].body}`)).vector;
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

function writePack(file, opts, chunks, vectors, meta) {
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA page_size = 4096;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- vec: the chunk's embedding as int8 (384 bytes), vec * scale ≈ the float vector.
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL, scale REAL NOT NULL, vec BLOB NOT NULL);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(title, body, content='chunks', content_rowid='id');
  `);
  const { data, scales } = quantizeInt8(vectors, 384);
  const insert = db.prepare("INSERT INTO chunks (id, title, body, source, scale, vec) VALUES (?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  chunks.forEach((c, i) =>
    insert.run(i + 1, c.title, c.body, c.source, scales[i], Buffer.from(data.buffer, data.byteOffset + i * 384, 384))
  );
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

  const work = resolve("build/knowledge-pack", opts.id);
  mkdirSync(work, { recursive: true });
  log(`building ${opts.id} in ${work}`);

  const titles = await fetchTitles(opts, join(work, "titles.json"));
  log(`${titles.length} titles`);
  const pages = await fetchIntros(titles, join(work, "intros.jsonl"));
  log(`${pages.length} articles with an introduction`);

  const chunks = [];
  for (const p of pages) {
    for (const body of chunkIntro(cleanIntro(p.extract), opts.chunkChars, opts.maxChunks)) {
      chunks.push({ title: p.title, body, source: `Wikipedia — ${p.url}` });
    }
  }
  log(`${chunks.length} chunks`);

  await ensureEmbeddingModel();
  const vectors = await embedChunks(chunks, join(work, `embeddings-${chunks.length}.f32`), opts.threads);

  const outFile = resolve(opts.out, `${opts.id}.sqlite`);
  mkdirSync(dirname(outFile), { recursive: true });
  writePack(outFile, opts, chunks, vectors, {
    format: "nido-knowledge-pack",
    formatVersion: 1,
    dims: 384,
    id: opts.id,
    name: opts.name,
    source: opts.titlesFile ? `Wikipedia introductions for ${titles.length} listed titles` : `Wikipedia Vital Articles level ${opts.level} introductions`,
    license: "CC BY-SA 4.0 (Wikipedia)",
    articles: pages.length,
    chunks: chunks.length,
    embeddingModelSha256: EMBEDDING_MODEL.sha256,
    builtAt: new Date().toISOString(),
  });
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
