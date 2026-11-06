#!/usr/bin/env node
// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// El medidor de ritmo de la RCP analiza cada fotograma en Kotlin
// (modules/nido-cpr/.../CprMotionCore.kt), pero sus pruebas de punta a
// punta corren sobre la versión de TypeScript (src/cpr/frameMotion.ts).
// Este script comprueba que las dos dan los mismos números:
//   1. genera fotogramas sintéticos de una reanimación con perturbaciones;
//   2. los analiza con frameMotion.ts;
//   3. compila CprMotionCore.kt con kotlinc y lo analiza en la JVM;
//   4. compara número a número (tolerancia 1e-9).
//
// Necesita kotlinc y java. Uso:
//   KOTLINC=/ruta/a/kotlinc node scripts/check-cpr-motion-parity.mjs
// Sin kotlinc: dice SKIP y sale con 0 (el CI lo descarga y lo corre).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const kotlinc = process.env.KOTLINC || "kotlinc";
try {
  execFileSync(kotlinc, ["-version"], { stdio: "ignore" });
} catch {
  console.log("check-cpr-motion-parity: SKIP (no hay kotlinc; define KOTLINC)");
  process.exit(0);
}

const { analyseFrame } = await import(pathToFileURL(join(ROOT, "src/cpr/frameMotion.ts")).href);
const { renderScene } = await import(pathToFileURL(join(ROOT, "src/cpr/syntheticCpr.ts")).href);

const W = 160;
const H = 120;
const scenes = [
  { seconds: 1, bpm: 110, seed: 1, width: W, height: H },
  { seconds: 1, bpm: 95, seed: 2, width: W, height: H, sensorNoise: 8, flicker: 0.05, shakePx: 1, hair: true, bystander: true },
  { seconds: 1, bpm: 120, seed: 3, width: W, height: H, horizontal: true, personSize: 0.25 },
];
const chunks = [];
for (const sc of scenes) for (const { frame } of renderScene(sc)) chunks.push(Buffer.from(frame.data));
// Las escenas van seguidas y ningún lado se reinicia entre ellas: el primer
// fotograma de cada escena se compara con el último de la anterior, igual
// en TypeScript que en Kotlin.
const expected = [];
{
  let st = null;
  for (const buf of chunks) {
    const r = analyseFrame({ width: W, height: H, rowStride: W, data: new Uint8Array(buf) }, st);
    st = r.state;
    expected.push(r.out ? Array.from(r.out) : null);
  }
}

const dir = mkdtempSync(join(tmpdir(), "cpr-parity-"));
const framesFile = join(dir, "frames.bin");
writeFileSync(framesFile, Buffer.concat(chunks));
const jar = join(dir, "parity.jar");
execFileSync(
  kotlinc,
  [
    join(ROOT, "modules/nido-cpr/android/src/main/java/expo/modules/nidocpr/CprMotionCore.kt"),
    join(ROOT, "scripts/cpr-parity/ParityMain.kt"),
    "-include-runtime",
    "-d",
    jar,
  ],
  { stdio: "inherit" }
);
if (!existsSync(jar)) throw new Error("kotlinc no produjo el jar");
const got = JSON.parse(
  execFileSync("java", ["-jar", jar, framesFile, String(W), String(H), String(chunks.length)], { maxBuffer: 64 << 20 }).toString()
);

let compared = 0;
let worst = 0;
for (let k = 0; k < expected.length; k++) {
  const a = expected[k];
  const b = got[k];
  if (a === null || b === null) {
    if (a !== b) throw new Error(`fotograma ${k}: TS ${a === null ? "null" : "datos"}, Kotlin ${b === null ? "null" : "datos"}`);
    continue;
  }
  if (a.length !== b.length) throw new Error(`fotograma ${k}: ${a.length} vs ${b.length} números`);
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    worst = Math.max(worst, d);
    if (d > 1e-9) throw new Error(`fotograma ${k}, número ${i}: TS ${a[i]} vs Kotlin ${b[i]}`);
    compared++;
  }
}
console.log(`PASS: CprMotionCore.kt = frameMotion.ts en ${expected.length} fotogramas (${compared} números, diferencia máxima ${worst.toExponential(2)})`);
