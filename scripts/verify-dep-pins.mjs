#!/usr/bin/env node
// F-8 build gate: npm dependency pins.
//
// Why this exists: package.json used to declare floating `^`/`~` ranges for
// native and security-sensitive packages (e.g. `llama.rn ^0.13.0-rc.4`
// resolving to lock `0.13.0-rc.6`; `expo-secure-store ^57.0.4`). A range lets
// any lockfile regeneration silently swap the native binary (llama.cpp
// `.so`/xcframework) or the Keystore wrapper WITHOUT code review, so the
// tested binary would no longer be the reviewed binary. `npm ci` does NOT
// catch this class of drift — it only checks lockfile↔package.json
// consistency at one point in time.
//
// What this checks (read-only; never installs, never edits):
//   1. RANGE BAN: every non-`file:` entry in `dependencies` and
//      `devDependencies` must be an EXACT version (`1.2.3`, prerelease
//      allowed, e.g. `0.13.0-rc.6`). Any `^` `~` `>=` `<=` `>` `<` `*` `x`
//      `||` or bare dist-tag FAILS. `file:./modules/*` local modules are
//      exempt (they are in-tree, reviewable source — not registry binaries).
//   2. MANIFEST↔LOCK CONSISTENCY: the declared exact version must equal the
//      version resolved in `package-lock.json` (`packages["node_modules/<n>"]`).
//      This proves the freeze is exactly what the tree already installs.
//
// Classification used when this lane froze the pins (F-8, 2026-09-28;
// recorded here so future decisions have an anchor, not a rule engine):
//   - NATIVE MODULES (ship .so/.aar/native bridges; drift swaps the binary):
//       llama.rn, expo, react-native, and every expo-* module.
//   - SECURITY-SENSITIVE (crypto / keystore / DB encryption / biometric):
//       expo-secure-store, expo-sqlite, expo-crypto, expo-local-authentication,
//       tweetnacl (P2P crypto primitives), react-native, react.
//   - PURE-JS TOOLING (i18next, react-i18next, qrcode, adb, @types/*,
//       node-llama-cpp, vitest, typescript): also pinned EXACT. Pinning them
//       adds no churn (the gate runs locally + in CI) and closes the drift
//       vector entirely, so the whole tree is reproducible — not just the
//       native subset. This is the lane's documented per-dependency decision.
//
// Usage: node scripts/verify-dep-pins.mjs [package.json] [package-lock.json]
//   (arguments default to the repo files; used by the negative proof to
//   point at /tmp fixtures). No new dependencies: node builtins only.
// Exit code: 0 when all pins hold, 1 on any failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgPath = process.argv[2] ?? join(ROOT, "package.json");
const lockPath = process.argv[3] ?? join(ROOT, "package-lock.json");

const failures = [];
const fail = (msg) => failures.push(msg);

// Exact version: digits + dots, optional prerelease/build suffix.
// Accepts "57.0.4", "0.13.0-rc.6", "19.2.3". Rejects "^", "~", ">=…", "*", "x".
const EXACT_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function main() {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const packages = lock.packages ?? {};

  const sections = ["dependencies", "devDependencies"];
  let checked = 0;

  for (const section of sections) {
    const deps = pkg[section] ?? {};
    for (const [name, declared] of Object.entries(deps)) {
      if (typeof declared !== "string") {
        fail(`${section}.${name}: declaration is not a string`);
        continue;
      }
      if (declared.startsWith("file:")) continue; // in-tree local modules: exempt by design

      checked++;
      if (!EXACT_RE.test(declared)) {
        fail(
          `${section}.${name}: floating range "${declared}" — ` +
            `native/security-sensitive deps must be pinned to an exact version`
        );
        continue;
      }

      const locked = packages[`node_modules/${name}`];
      if (!locked) {
        fail(`${section}.${name}: not present in package-lock.json packages["node_modules/${name}"]`);
        continue;
      }
      if (locked.version !== declared) {
        fail(
          `${section}.${name}: package.json declares ${declared} but lockfile resolves ${locked.version} — ` +
            `regenerate the lockfile (no upgrades) or fix the declaration`
        );
      }
    }
  }

  if (failures.length === 0) {
    console.log(`PASS: ${checked} npm dependency pins verified (exact, manifest ↔ lockfile in sync)`);
    process.exit(0);
  }
  console.log(`FAIL: ${failures.length} dependency pin problem${failures.length === 1 ? "" : "s"}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

main();
