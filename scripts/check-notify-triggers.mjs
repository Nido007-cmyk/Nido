#!/usr/bin/env node
// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Las notificaciones locales propias (modules/nido-notify) calculan en
// Kotlin la próxima hora de cada aviso (NotifyTriggers.kt), igual que lo
// hacía expo-notifications. Este script compila esa parte pura con kotlinc
// y corre su comprobación en la JVM (jvm-check/NotifyTriggersCheck.kt):
// casos exactos y propiedades en varias zonas horarias.
//
// Necesita kotlinc y java. Uso:
//   KOTLINC=/ruta/a/kotlinc node scripts/check-notify-triggers.mjs
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
  console.log("check-notify-triggers: SKIP (no hay kotlinc; define KOTLINC)");
  process.exit(0);
}

const MOD = join(ROOT, "modules/nido-notify");
const dir = mkdtempSync(join(tmpdir(), "notify-triggers-"));
const jar = join(dir, "check.jar");
execFileSync(
  kotlinc,
  [
    join(MOD, "android/src/main/java/expo/modules/nidonotify/NotifyTriggers.kt"),
    join(MOD, "jvm-check/NotifyTriggersCheck.kt"),
    "-include-runtime",
    "-d",
    jar,
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);
const out = execFileSync("java", ["-Duser.language=es", "-Duser.country=ES", "-jar", jar], { encoding: "utf8" });
process.stdout.write(out);
if (!/check-notify-triggers: PASS/.test(out)) process.exit(1);
