#!/usr/bin/env node
// Verifies every download pin declared in src/models/manifest.ts.
//
// Why this exists: on 2026-09-27 two corpus entries pointed at
// raw.githubusercontent.com/arsrs91-png/NIDO/<sha>/… which returns 404
// anonymously (the repo is private). Nothing automated caught it — only a
// manual curl did. This script makes that class of breakage fail CI.
//
// What it checks (read-only — it never downloads file bodies):
//   1. Internal consistency: unique ids, unique filenames, sizeBytes > 0,
//      sha256 is 64-char lowercase hex, and at least one required llm and
//      one required embedding exist (the setup screen depends on them).
//   2. URL sanity: pinnedSourceUrl() output parses, uses https, host is one
//      of the known-good hosts (warn on anything else), and when a revision
//      is pinned no /main/ branch pointer survives in the final URL.
//   3. Reachability: HTTP HEAD (falling back to a single-byte ranged GET
//      for servers that reject HEAD) against each pinned URL, anonymously.
//      Any 4xx/5xx or network failure FAILS the script.
//
// Honest errors: DNS/connection/timeout failures are reported as NETWORK
// with the underlying cause code (ENOTFOUND, ECONNREFUSED, ETIMEDOUT…),
// distinct from HTTP status failures, so the log says what actually broke.
//
// Exit code: 0 when everything passes (warnings allowed), 1 on any failure.
// No new dependencies: uses node builtins + the repo's own typescript to
// transpile manifest.ts, so the REAL pinnedSourceUrl() is exercised.

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const MANIFEST_PATH = new URL("../src/models/manifest.ts", import.meta.url);
const TIMEOUT_MS = 20_000;
const USER_AGENT = "NIDO-manifest-pin-check/1.0";

// Hosts we have proven to serve the pinned bytes anonymously.
const KNOWN_HOSTS = new Set([
  "huggingface.co", // model weights, /resolve/<rev>/ or /resolve/main/
  "raw.githubusercontent.com", // corpus mirrors pinned to a commit
  "github.com", // release assets via /releases/download/…
]);

const failures = [];
const warnings = [];
const fail = (msg) => failures.push(msg);
const warn = (msg) => warnings.push(msg);

async function loadManifest() {
  // Transpile the real TS source in-memory (type-only imports are elided),
  // then import it — no reimplementation of pinnedSourceUrl(), no drift.
  const source = readFileSync(MANIFEST_PATH, "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
  });
  const problems = (diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  if (problems.length > 0) {
    throw new Error(
      "manifest.ts failed to transpile: " +
        problems.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; ")
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "nido-manifest-"));
  const file = join(dir, "manifest.mjs");
  // manifest.ts imports ./downloadErrors (relative, no extension). Transpile
  // and place it alongside, rewriting the import to include the .mjs extension
  // so Node ESM can resolve it from the temp dir.
  const depSource = readFileSync(join(dirname(fileURLToPath(MANIFEST_PATH)), "downloadErrors.ts"), "utf8");
  const depOut = ts.transpileModule(depSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  writeFileSync(join(dir, "downloadErrors.mjs"), depOut.outputText);
  const fixedOutput = outputText.replace(
    'from "./downloadErrors"',
    'from "./downloadErrors.mjs"'
  );
  try {
    writeFileSync(file, fixedOutput);
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkConsistency(catalog) {
  const ids = new Set();
  const filenames = new Set();
  for (const a of catalog) {
    if (!a.id || typeof a.id !== "string") fail(`entry missing id: ${JSON.stringify(a.id)}`);
    else if (ids.has(a.id)) fail(`duplicate id: ${a.id}`);
    else ids.add(a.id);

    if (!a.filename || typeof a.filename !== "string") fail(`entry ${a.id}: missing filename`);
    else if (filenames.has(a.filename)) fail(`duplicate filename: ${a.filename} (id ${a.id})`);
    else filenames.add(a.filename);

    if (!Number.isInteger(a.sizeBytes) || a.sizeBytes <= 0)
      fail(`entry ${a.id}: sizeBytes must be a positive integer, got ${a.sizeBytes}`);

    if (!/^[0-9a-f]{64}$/.test(a.sha256 ?? ""))
      fail(`entry ${a.id}: sha256 must be 64-char lowercase hex`);

    if (a.revision !== undefined) {
      if (typeof a.revision !== "string" || a.revision.trim() === "")
        fail(`entry ${a.id}: revision is present but empty`);
      else if (!/^[0-9a-f]{40}$/.test(a.revision))
        warn(`entry ${a.id}: revision "${a.revision}" is not a 40-char commit sha`);
    }
  }
  // The first-run setup screen requires one default LLM and one embedding
  // model. Corpus packs are optional by design (tiers), so no check there.
  const required = (kind) => catalog.some((a) => a.kind === kind && a.required);
  if (!required("llm")) fail("no required llm entry in catalog");
  if (!required("embedding")) fail("no required embedding entry in catalog");
}

function checkUrlShape(asset, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`entry ${asset.id}: pinned URL does not parse: ${url}`);
    return null;
  }
  if (parsed.protocol !== "https:")
    fail(`entry ${asset.id}: pinned URL is not https: ${url}`);
  if (!KNOWN_HOSTS.has(parsed.hostname))
    warn(`entry ${asset.id}: unexpected host ${parsed.hostname} (allowed: ${[...KNOWN_HOSTS].join(", ")})`);
  if (asset.revision) {
    // Pinning is pointless if a moving branch pointer survives.
    if (url.includes("/resolve/main/") || /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\//.test(url))
      fail(`entry ${asset.id}: revision pinned but /main/ branch pointer still in URL: ${url}`);
    if (!url.includes(asset.revision))
      fail(`entry ${asset.id}: revision ${asset.revision} not present in pinned URL: ${url}`);
  }
  return parsed;
}

async function checkReachable(asset, url) {
  // HEAD first: no body. Some hosts reject HEAD (405/501) — then do a
  // single-byte ranged GET and cancel the body immediately, so even a
  // server that ignores Range never transfers the file.
  const attempt = async (method, headers) => {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": USER_AGENT, ...headers },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (method === "GET") await res.body?.cancel().catch(() => {});
    return res;
  };
  try {
    let res = await attempt("HEAD");
    if (res.status === 405 || res.status === 501) {
      res = await attempt("GET", { Range: "bytes=0-0" });
    }
    if (res.status === 200 || res.status === 206) return { ok: true, status: res.status };
    fail(`entry ${asset.id}: HTTP ${res.status} for ${url}`);
    return { ok: false, status: res.status };
  } catch (e) {
    // fetch wraps network failures in TypeError with `cause`.
    const code = e?.cause?.code ?? e?.name ?? "unknown";
    fail(`entry ${asset.id}: NETWORK failure (${code}: ${e?.cause?.message ?? e.message}) for ${url}`);
    return { ok: false, status: null };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("Loading src/models/manifest.ts …");
  const { MODEL_CATALOG, pinnedSourceUrl } = await loadManifest();
  console.log(`Catalog entries: ${MODEL_CATALOG.length}\n`);

  checkConsistency(MODEL_CATALOG);

  for (const asset of MODEL_CATALOG) {
    const url = pinnedSourceUrl(asset);
    const tag = `[${asset.id}]`;
    if (!checkUrlShape(asset, url)) continue;
    process.stdout.write(`${tag} HEAD ${url} … `);
    const { ok, status } = await checkReachable(asset, url);
    console.log(ok ? `OK (${status})` : `FAIL (${status ?? "network"})`);
    // Be polite to hosts; 10 entries, tiny pause between them.
    await sleep(300);
  }

  console.log("");
  for (const w of warnings) console.log(`WARN: ${w}`);
  if (failures.length === 0) {
    console.log(
      `PASS: ${MODEL_CATALOG.length} pins verified` +
        (warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : "")
    );
    process.exit(0);
  }
  console.log(`FAIL: ${failures.length} problem${failures.length === 1 ? "" : "s"}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
