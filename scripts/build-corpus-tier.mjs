#!/usr/bin/env node
// Dev-machine-only, online script that builds a larger corpus pack for the
// "standard"/"full" setup tiers, using MediaWiki's batched random-article
// generator (20 articles/request) instead of one-by-one REST summary calls
// (much faster, still rate-limited politely). Output is committed to git and
// referenced via a raw.githubusercontent.com URL in src/models/manifest.ts
// so the app can download it like any other catalog asset. The app itself
// never runs this script or makes network calls beyond that one download.
//
// Usage: node scripts/build-corpus-tier.mjs <count> <output-path>
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";

const [, , countArg, outPath] = process.argv;
const TARGET_COUNT = parseInt(countArg ?? "300", 10);
const OUT_PATH = outPath ?? `assets/corpus/corpus-standard.json`;
const BATCH_SIZE = 20;

// Avoid the same Wikipedia article turning up in two different corpus
// packs (e.g. both Standard and Full) — scans every *.json already in
// assets/corpus/ (run tiers in dependency order: minimum, then standard,
// then full, writing each before starting the next) and excludes their
// titles up front.
function existingTitles() {
  const titles = new Set();
  let files = [];
  try {
    files = readdirSync("assets/corpus").filter((f) => f.endsWith(".json"));
  } catch {
    return titles;
  }
  for (const f of files) {
    try {
      const docs = JSON.parse(readFileSync(`assets/corpus/${f}`, "utf8"));
      for (const d of docs) titles.add(d.title);
    } catch {
      // skip unreadable/malformed files
    }
  }
  return titles;
}

async function fetchRandomBatch(attempt = 1) {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2` +
    `&generator=random&grnnamespace=0&grnlimit=${BATCH_SIZE}` +
    `&prop=extracts&exintro&explaintext&exchars=700`;
  const res = await fetch(url, {
    headers: { "User-Agent": "aoair-corpus-builder/0.1" },
  });
  if ((res.status === 429 || res.status === 503) && attempt <= 5) {
    const backoffMs = attempt * 4000;
    console.warn(`  ${res.status}, backing off ${backoffMs}ms (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, backoffMs));
    return fetchRandomBatch(attempt + 1);
  }
  if (!res.ok) {
    console.warn(`  batch failed: HTTP ${res.status}`);
    return [];
  }
  const data = await res.json();
  const pages = data?.query?.pages ?? [];
  return pages
    .filter((p) => p.extract && p.extract.length >= 200 && !p.extract.startsWith("#REDIRECT"))
    .map((p) => ({
      title: p.title,
      source: `Wikipedia — https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      body: p.extract,
    }));
}

async function main() {
  const exclude = existingTitles();
  console.log(`Excluding ${exclude.size} titles already used by other corpus packs.`);
  const seen = new Map();
  let batchNum = 0;

  while (seen.size < TARGET_COUNT) {
    batchNum++;
    process.stdout.write(`Batch ${batchNum} (have ${seen.size}/${TARGET_COUNT})... `);
    const docs = await fetchRandomBatch();
    let added = 0;
    for (const doc of docs) {
      if (!seen.has(doc.title) && !exclude.has(doc.title)) {
        seen.set(doc.title, doc);
        added++;
      }
    }
    console.log(`+${added}`);
    await new Promise((r) => setTimeout(r, 1200));

    if (batchNum > TARGET_COUNT / BATCH_SIZE + 30) {
      console.warn("Giving up early after too many batches (rate limiting?).");
      break;
    }
  }

  const docs = Array.from(seen.values()).slice(0, TARGET_COUNT);
  mkdirSync("assets/corpus", { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(docs, null, 2));
  console.log(`\nWrote ${docs.length} documents to ${OUT_PATH}`);
}

main();
