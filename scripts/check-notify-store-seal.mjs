#!/usr/bin/env node
// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// El almacén de avisos de nido-notify va sellado desde la 0.1.99
// (NotifyStoreSeal.kt, T-15 m-58): AES-256-GCM por entrada con el
// identificador como datos asociados. Este script compila esa clase pura
// con kotlinc y corre su comprobación en la JVM
// (jvm-check/NotifyStoreSealCheck.kt): ida y vuelta byte a byte, IV
// propio por entrada, y rechazo ante manipulación, trasplante de
// entrada, otra clave y formatos rotos.
//
// Necesita kotlinc y java. Uso:
//   KOTLINC=/ruta/a/kotlinc node scripts/check-notify-store-seal.mjs
// Sin kotlinc: dice SKIP y sale con 0 (la CI lo descarga y lo corre).

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const kotlinc = process.env.KOTLINC || "kotlinc";
try {
  execFileSync(kotlinc, ["-version"], { stdio: "ignore" });
} catch {
  console.log("check-notify-store-seal: SKIP (no hay kotlinc; define KOTLINC)");
  process.exit(0);
}

const MOD = join(ROOT, "modules/nido-notify");
const dir = mkdtempSync(join(tmpdir(), "notify-store-seal-"));
const jar = join(dir, "check.jar");
execFileSync(
  kotlinc,
  [
    join(MOD, "android/src/main/java/expo/modules/nidonotify/NotifyStoreSeal.kt"),
    join(MOD, "jvm-check/NotifyStoreSealCheck.kt"),
    "-include-runtime",
    "-d",
    jar,
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);
const out = execFileSync("java", ["-Duser.language=es", "-Duser.country=ES", "-jar", jar], { encoding: "utf8" });
process.stdout.write(out);
if (!/check-notify-store-seal: PASS/.test(out)) process.exit(1);
