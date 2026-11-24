#!/usr/bin/env node
// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Auditoría 0.1.112, bloque 6: primeras baterías JVM de tres módulos
// nativos que no tenían ninguna. Cada uno expone su lógica pura en un
// fichero sin Android, que el módulo usa tal cual:
//   - nido-p2p:      NidoP2PFraming.kt  (framing, saludo, direcciones LAN, subred)
//   - nido-keyvault: NidoKeyVaultBlob.kt (formato y sellado del blob)
//   - nido-ocr:      NidoOcrCore.kt     (tamaños, página escaneada, hashes de tessdata)
// Lo que depende del teléfono (Bluetooth, Keystore, BiometricPrompt,
// Tesseract, PdfRenderer) no se prueba aquí.
//
// Necesita kotlinc y java. Uso:
//   KOTLINC=/ruta/a/kotlinc node scripts/check-native-cores.mjs
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
  console.log("check-native-cores: SKIP (no hay kotlinc; define KOTLINC)");
  process.exit(0);
}

const SUITES = [
  {
    name: "check-p2p-framing",
    sources: [
      "modules/nido-p2p/android/src/main/java/expo/modules/nidop2p/NidoP2PFraming.kt",
      "modules/nido-p2p/jvm-check/NidoP2PFramingCheck.kt",
    ],
    main: "expo.modules.nidop2p.NidoP2PFramingCheckKt",
    args: [],
  },
  {
    name: "check-keyvault-blob",
    sources: [
      "modules/nido-keyvault/android/src/main/java/expo/modules/nidokeyvault/NidoKeyVaultBlob.kt",
      "modules/nido-keyvault/jvm-check/NidoKeyVaultBlobCheck.kt",
    ],
    main: "expo.modules.nidokeyvault.NidoKeyVaultBlobCheckKt",
    args: [],
  },
  {
    name: "check-ocr-core",
    sources: [
      "modules/nido-ocr/android/src/main/java/expo/modules/nidoocr/NidoOcrCore.kt",
      "modules/nido-ocr/jvm-check/NidoOcrCoreCheck.kt",
    ],
    main: "expo.modules.nidoocr.NidoOcrCoreCheckKt",
    args: [join(ROOT, "modules/nido-ocr/android/src/main/assets/tessdata")],
  },
];

let failed = false;
for (const s of SUITES) {
  const dir = mkdtempSync(join(tmpdir(), `${s.name}-`));
  const jar = join(dir, "check.jar");
  execFileSync(kotlinc, [...s.sources.map((p) => join(ROOT, p)), "-include-runtime", "-d", jar], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  const out = execFileSync("java", ["-Dstdout.encoding=UTF-8", "-cp", jar, s.main, ...s.args], { encoding: "utf8" });
  process.stdout.write(out);
  if (!new RegExp(`${s.name}: PASS`).test(out)) failed = true;
}
process.exit(failed ? 1 : 0);
