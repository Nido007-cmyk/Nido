#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * third-party-notices.mjs — genera los avisos de licencias de terceros:
 *
 *   src/legal/thirdPartyNotices.json  → lo que enseña la app (Acerca de → Licencias)
 *   THIRD_PARTY_NOTICES.md            → lo mismo, legible en GitHub
 *
 * Fuente: package-lock.json (qué paquetes y versiones) + los archivos de
 * licencia de cada paquete en node_modules (el texto exacto, con su línea
 * de copyright). Necesita `npm ci` hecho antes.
 *
 * Uso:
 *   node scripts/third-party-notices.mjs            # escribe los dos archivos
 *   node scripts/third-party-notices.mjs --check    # falla si no coinciden
 *   node scripts/third-party-notices.mjs --lockfile-only
 *       # sin node_modules: solo nombres, versiones y licencias declaradas
 *       # (la app avisa de que faltan los textos). El APK nunca usa esto:
 *       # su workflow regenera con los textos justo antes de compilar.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LICENSE_FILE_RE, VENDORED_DIRS, buildNotices, productionPackages, renderMarkdown } from "./lib/third-party-notices-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const lockfileOnly = args.has("--lockfile-only");

const JSON_OUT = join(ROOT, "src/legal/thirdPartyNotices.json");
const MD_OUT = join(ROOT, "THIRD_PARTY_NOTICES.md");
const MAX_FILES_PER_PACKAGE = 12;
const MAX_TEXT_BYTES = 64 * 1024;

const lockRaw = readFileSync(join(ROOT, "package-lock.json"), "utf8");
const lock = JSON.parse(lockRaw);
const lockSha = createHash("sha256").update(lockRaw).digest("hex").slice(0, 12);

if (!lockfileOnly && !existsSync(join(ROOT, "node_modules"))) {
  console.error("third-party-notices: node_modules no existe. Corre `npm ci` antes (o usa --lockfile-only).");
  process.exit(2);
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function licenseFilesIn(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => LICENSE_FILE_RE.test(f) && isFile(join(dir, f)))
      .sort();
  } catch {
    return [];
  }
}

/** Textos de licencia de un paquete: los de su raíz y los de lo que empotra. */
function readNotices(pkg) {
  if (lockfileOnly || pkg.local) return [];
  const base = join(ROOT, pkg.path);
  const found = licenseFilesIn(base).map((f) => join(base, f));
  // Componentes empotrados (p. ej. llama.cpp dentro de llama.rn/cpp): su
  // licencia viaja en el binario aunque el paquete tenga otra propia.
  for (const d of VENDORED_DIRS) {
    const dir = join(base, d);
    for (const f of licenseFilesIn(dir)) found.push(join(dir, f));
    let subdirs = [];
    try {
      subdirs = readdirSync(dir).filter((s) => s !== "node_modules" && !isFile(join(dir, s)));
    } catch {
      /* no existe */
    }
    for (const s of subdirs) for (const f of licenseFilesIn(join(dir, s))) found.push(join(dir, s, f));
  }
  return found.slice(0, MAX_FILES_PER_PACKAGE).flatMap((file) => {
    const buf = readFileSync(file);
    if (buf.length > MAX_TEXT_BYTES || buf.includes(0)) return [];
    return [{ file: relative(base, file), text: buf.toString("utf8") }];
  });
}

const notices = buildNotices(productionPackages(lock), readNotices, {
  generatedFrom: `package-lock.json sha256:${lockSha}`,
  partial: lockfileOnly,
  // La licencia de la propia app (con el aviso de BOAR): también la enseña
  // la pantalla de licencias.
  appLicense: readFileSync(join(ROOT, "LICENSE"), "utf8").replace(/\r\n?/g, "\n").trim(),
});
const json = JSON.stringify(notices) + "\n";
const md = renderMarkdown(notices) + "\n";

if (check) {
  const same = existsSync(JSON_OUT) && readFileSync(JSON_OUT, "utf8") === json && existsSync(MD_OUT) && readFileSync(MD_OUT, "utf8") === md;
  if (!same) {
    console.error("third-party-notices: los avisos no están al día. Corre `npm run notices` y súbelos.");
    process.exit(1);
  }
  console.log(`third-party-notices: al día (${notices.count} paquetes).`);
} else {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, json);
  writeFileSync(MD_OUT, md);
  console.log(
    `third-party-notices: ${notices.count} paquetes, ${Object.keys(notices.texts).length} textos distintos, ` +
      `${notices.withoutText.length} sin archivo de licencia${lockfileOnly ? " (solo lockfile)" : ""}.`,
  );
}
