#!/usr/bin/env node
// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
// sign-manifest.mjs — sign (or verify) the NIDO download catalog.
//
// The manifest signing key is a maintainer-held Ed25519 private key. It is
// NEVER in the repo and NEVER in CI. What IS in the repo:
//   - src/models/manifestTrust.ts  (embedded PUBLIC key + canonicalization)
//   - src/models/manifestSignature.ts (detached signature, regenerated here)
//
// Usage:
//   NIDO_MANIFEST_SIGN_KEY=~/workspace/user/keystores/nido-manifest-sign.key \
//     node scripts/sign-manifest.mjs            # sign, write manifestSignature.ts
//   node scripts/sign-manifest.mjs --verify     # verify committed signature
//                                              # (no private key needed; CI runs this)
//
// Why: the signature is maintainer attestation over the exact catalog bytes
// (ids, URLs, revisions, SHA-256 pins). A manifest.ts edit without a fresh
// signature fails --verify, so CI and the app's startup check catch
// unsigned catalog changes. See src/models/manifestTrust.ts for the threat
// model.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createPrivateKey } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = new URL("..", import.meta.url);
const MANIFEST_TS = new URL("src/models/manifest.ts", ROOT);
const TRUST_TS = new URL("src/models/manifestTrust.ts", ROOT);
const SIG_TS = new URL("src/models/manifestSignature.ts", ROOT);

function transpile(url) {
  const source = readFileSync(url, "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  const problems = (diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  if (problems.length > 0) {
    throw new Error(
      "transpile failed for " + url + ": " +
      problems.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; ")
    );
  }
  // ESM needs explicit extensions on relative imports; TS source omits them.
  return outputText.replace(/from\s+["'](\.[^"']*)["']/g, (m, p) =>
    p.endsWith(".mjs") || p.endsWith(".js") ? m : `from "${p}.mjs"`
  );
}

async function importTranspiled(url, tag, extraDeps = []) {
  // Transpiled output may import npm packages (tweetnacl) or relative
  // siblings (./downloadErrors), which data: URLs cannot resolve. Write to
  // a temp .mjs INSIDE the repo so node resolves node_modules normally,
  // import via file URL, then clean up. Same idea
  // as scripts/verify-manifest-pins.mjs.
  const dir = mkdtempSync(join(fileURLToPath(ROOT), "tmp-sign-"));
  try {
    for (const dep of extraDeps) {
      writeFileSync(join(dir, dep.tag + ".mjs"), transpile(dep.url));
    }
    const file = join(dir, tag + ".mjs");
    writeFileSync(file, transpile(url));
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// manifest.ts's runtime imports, transpiled alongside so relative
// specifiers resolve inside the temp dir. Type-only imports are elided
// by transpileModule and need nothing.
const MANIFEST_DEPS = [
  { url: new URL("src/models/downloadErrors.ts", ROOT), tag: "downloadErrors" },
];

async function main() {
  const verifyOnly = process.argv.includes("--verify");
  const trust = await importTranspiled(TRUST_TS, "trust");
  const manifest = await importTranspiled(MANIFEST_TS, "manifest", MANIFEST_DEPS);
  const catalog = manifest.MODEL_CATALOG;
  if (!Array.isArray(catalog)) {
    throw new Error("could not find exported MODEL_CATALOG array in manifest.ts");
  }
  const canonical = trust.canonicalCatalogJSON(catalog);

  if (verifyOnly) {
    let sigB64 = null;
    try {
      const sigMod = await importTranspiled(SIG_TS, "sig");
      sigB64 = sigMod.MANIFEST_SIGNATURE_BASE64 ?? null;
    } catch {
      sigB64 = null; // missing file -> missing-signature, reported below
    }
    try {
      trust.verifyCatalogSignature(catalog, sigB64);
      console.log(`OK: manifest signature valid (${catalog.length} catalog entries)`);
    } catch (e) {
      console.error(`FAIL: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  const keyPath = process.env.NIDO_MANIFEST_SIGN_KEY;
  if (!keyPath) {
    console.error("FAIL: set NIDO_MANIFEST_SIGN_KEY to the Ed25519 private key PEM path");
    process.exit(1);
  }
  const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
  // Ed25519 (PureEdDSA): sign the canonical bytes directly. tweetnacl's
  // detached.verify on the app side checks exactly this.
  const edSig = require("node:crypto").sign(null, Buffer.from(canonical, "utf8"), privateKey);
  const b64 = edSig.toString("base64");
  // Self-check before writing: the committed signature must verify.
  trust.verifyCatalogSignature(catalog, b64);
  const out =
    `/**\n` +
    ` * MIT License\n` +
    ` * Copyright (c) 2026 NIDO contributors\n` +
    ` * See LICENSE file for details.\n` +
    ` *\n` +
    ` * manifestSignature.ts — GENERATED by scripts/sign-manifest.mjs. Do not hand-edit.\n` +
    ` * Detached Ed25519 signature over the canonical catalog JSON\n` +
    ` * (see canonicalCatalogJSON in manifestTrust.ts). Regenerate after any\n` +
    ` * manifest.ts change that touches a signed field.\n` +
    ` */\n` +
    `export const MANIFEST_SIGNATURE_BASE64 = "${b64}";\n`;
  writeFileSync(SIG_TS, out);
  console.log(`OK: signed ${catalog.length} catalog entries -> src/models/manifestSignature.ts`);
}

main().catch((e) => {
  console.error("FAIL: " + (e?.message ?? String(e)));
  process.exit(1);
});
