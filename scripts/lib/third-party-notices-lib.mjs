/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * third-party-notices-lib.mjs — puro (sin E/S): de package-lock.json y de
 * los archivos de licencia leídos de node_modules a la lista de avisos de
 * terceros que viaja en la app y en THIRD_PARTY_NOTICES.md.
 *
 * Por qué: MIT, BSD, ISC y Apache-2.0 piden que quien recibe una copia
 * reciba también el aviso de copyright y el texto de la licencia. El APK
 * lleva el JavaScript de estos paquetes compilado dentro, así que sus
 * avisos tienen que ir con él (Acerca de → Licencias).
 */

/** Nombres de archivo que son textos de licencia o avisos. */
export const LICENSE_FILE_RE = /^(?:licen[cs]e|copying|notice|copyright)(?:[-_.][\w.-]*)?$/i;

/** Directorios dentro de un paquete donde se buscan componentes empotrados. */
export const VENDORED_DIRS = ["cpp", "vendor", "third_party", "third-party", "deps", "ios", "android"];

/**
 * Licencias con opción: cuál elige NIDO y por qué. Elegir es parte de la
 * licencia («OR»): se documenta para que nadie tenga que suponerlo.
 */
export const LICENSE_ELECTIONS = {
  "node-forge": {
    offered: "(BSD-3-Clause OR GPL-2.0)",
    elected: "BSD-3-Clause",
    reason: "NIDO is MIT-licensed; the BSD-3-Clause option keeps it permissive.",
  },
};

/**
 * Paquetes que no traen archivo de licencia pero salen del mismo proyecto
 * que otro que sí lo trae: mismo titular (Meta Platforms) y misma licencia
 * MIT que `react-native`. Su aviso es el de ese proyecto. Solo se aplica si
 * la licencia declarada coincide con la del paquete de origen.
 */
export const LICENSE_FALLBACKS = [
  {
    match: /^(?:@react-native\/|metro(?:-|$)|ob1$|hermes-compiler$|react-devtools-core$)/,
    from: "react-native",
  },
];

/**
 * 0.1.55 (P-10): código nativo copiado DENTRO de este repositorio (no llega
 * por npm, así que el lockfile no lo ve). Lista revisada a mano: cada
 * entrada nombra el archivo de licencia del propio repo, cuyo texto se
 * copia tal cual. Lo que trae llama.rn (llama.cpp, MIT) ya sale con
 * llama.rn: su carpeta `cpp` se recorre como componente empotrado.
 */
export const NATIVE_COMPONENTS = [
  {
    name: "mlkem-native",
    version: "2.0.0",
    license: "Apache-2.0 OR ISC OR MIT",
    where: "modules/nido-p2p (ML-KEM-768, compiled into libnidomlkem.so)",
    licenseFile: "modules/nido-p2p/android/src/main/cpp/mlkem-native/LICENSE",
  },
];

/** Nombre del paquete a partir de su ruta en el lockfile. */
export function packageNameFromPath(path) {
  const i = path.lastIndexOf("node_modules/");
  return i === -1 ? path : path.slice(i + "node_modules/".length);
}

/** El campo license del lockfile, normalizado a texto. */
export function normalizeLicense(value) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map((v) => normalizeLicense(v)).filter(Boolean).join(" OR ") || null;
  if (typeof value === "object" && typeof value.type === "string") return value.type;
  return null;
}

/**
 * Los paquetes que entran en la app: todo lo que el lockfile NO marca como
 * de desarrollo. Los módulos locales (`file:./modules/*`) son de NIDO.
 * Devuelve [{ path, name, version, license, local }], ordenado y sin
 * duplicados de nombre+versión.
 */
export function productionPackages(lock) {
  const out = new Map();
  for (const [path, info] of Object.entries(lock?.packages ?? {})) {
    if (!path || info.dev) continue;
    const name = info.name ?? packageNameFromPath(path);
    // Los módulos propios de NIDO aparecen dos veces en el lockfile: el
    // enlace en node_modules y su carpeta (modules/…). Los dos son de NIDO.
    const local =
      Boolean(info.link) ||
      !path.includes("node_modules/") ||
      (typeof info.resolved === "string" && info.resolved.startsWith("modules/"));
    const version = info.version ?? (local ? "local" : "?");
    const key = `${name}@${version}`;
    if (out.has(key)) continue;
    out.set(key, { path, name, version, license: normalizeLicense(info.license), local });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Texto de licencia limpio: saltos de línea normalizados y sin espacio final. */
export function cleanText(text) {
  return String(text).replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

/** Id corto y estable de un texto (FNV-1a de 32 bits, en hex). */
export function textId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Arma la lista final. `readNotices(pkg)` devuelve los textos de licencia
 * del paquete ([{ file, text }], vacío si el paquete no trae ninguno).
 * Los textos idénticos se guardan una sola vez (`texts`).
 */
export function buildNotices(packages, readNotices, meta = {}) {
  const texts = {};
  const entries = [];
  for (const pkg of packages) {
    const files = [];
    for (const n of readNotices(pkg) ?? []) {
      const text = cleanText(n.text);
      if (!text) continue;
      const id = textId(text);
      texts[id] = text;
      files.push({ file: n.file, text: id });
    }
    const election = LICENSE_ELECTIONS[pkg.name];
    entries.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      ...(election ? { elected: election.elected, electionReason: election.reason } : {}),
      ...(pkg.local ? { local: true } : {}),
      files,
    });
  }
  // Segundo paso: los que no traen archivo y salen del mismo proyecto que
  // otro paquete (LICENSE_FALLBACKS) llevan el aviso de ese proyecto.
  for (const e of entries) {
    if (e.files.length || e.local) continue;
    const fb = LICENSE_FALLBACKS.find((f) => f.match.test(e.name));
    const origin = fb && entries.find((o) => o.name === fb.from && o.files.length);
    if (!origin || origin.license !== e.license) continue;
    e.files = origin.files.map((f) => ({ file: `${f.file} (${origin.name})`, text: f.text }));
    e.inheritedFrom = origin.name;
  }
  // Sin node_modules (--lockfile-only) no se leyó ningún texto: no es que
  // falten, es que no se buscaron.
  const withoutText = meta.partial
    ? []
    : entries.filter((e) => e.files.length === 0 && !e.local).map((e) => `${e.name}@${e.version}`);
  const native = (meta.native ?? []).map((c) => {
    const text = cleanText(c.licenseText ?? "");
    const rest = { name: c.name, version: c.version, license: c.license, where: c.where, licenseFile: c.licenseFile };
    if (!text) return rest;
    const id = textId(text);
    texts[id] = text;
    return { ...rest, text: id };
  });
  return { ...meta, native, count: entries.length, withoutText, packages: entries, texts };
}

/** THIRD_PARTY_NOTICES.md a partir del resultado de buildNotices. */
export function renderMarkdown(notices) {
  const lines = [];
  lines.push("# Third-party notices — NIDO");
  lines.push("");
  lines.push("<!-- Generated by scripts/third-party-notices.mjs from package-lock.json and the");
  lines.push("     license files in node_modules. Do not edit by hand: run `npm run notices`. -->");
  lines.push("");
  lines.push(
    "NIDO (MIT, see [LICENSE](LICENSE)) is built with the open-source packages below. " +
      "Their code is compiled into the app, so their copyright notices and license texts travel with it; " +
      "the same list is readable inside the app (About → Licenses).",
  );
  lines.push("");
  lines.push(
    "The list covers every package that `package-lock.json` does not mark as development-only. " +
      "It is a superset of what ends up in the APK: some of them are build tools that Expo needs " +
      "at compile time (for example `lightningcss`, MPL-2.0) and are not shipped.",
  );
  lines.push("");
  lines.push(
    "AI models and knowledge packs are not part of the app: they are downloaded separately and keep " +
      "their own licenses (see [ATTRIBUTION.md](ATTRIBUTION.md) and `docs/release/MODEL_LICENSE_AUDIT.md`). " +
      "Android libraries resolved by Gradle at build time (AndroidX, Kotlin, SQLCipher and their dependencies) " +
      "do not come from npm: since 0.1.55 the exact list for each build is attached to its GitHub release as " +
      "`android-runtime-dependencies.txt` (see below).",
  );
  lines.push("");
  if (notices.generatedFrom) lines.push(`Source: \`${notices.generatedFrom}\` · ${notices.count} packages.`);
  if (notices.partial) {
    lines.push("");
    lines.push("> **Partial list:** generated without `node_modules`, so the license texts are missing. Run `npm ci && npm run notices`.");
  }
  lines.push("");
  const elections = notices.packages.filter((p) => p.elected);
  if (elections.length) {
    lines.push("## License elections");
    lines.push("");
    for (const p of elections) lines.push(`- **${p.name}** is offered under \`${p.license}\`; NIDO uses it under **${p.elected}**. ${p.electionReason}`);
    lines.push("");
  }
  if (notices.native?.length) {
    lines.push("## Native code vendored in this repository");
    lines.push("");
    lines.push("| Component | Version | License | Where |");
    lines.push("|---|---|---|---|");
    for (const c of notices.native) lines.push(`| ${c.name} | ${c.version} | ${c.license} | ${c.where} |`);
    lines.push("");
  }
  lines.push("## Android libraries (Gradle)");
  lines.push("");
  lines.push(
    "AndroidX, Kotlin, SQLCipher (`net.zetetic`) and whatever they pull in are resolved by Gradle when the APK is built. " +
      "The release workflow saves the exact `releaseRuntimeClasspath` tree of each build and attaches it to the " +
      "GitHub release as `android-runtime-dependencies.txt`. Their license texts are not reproduced in this file yet.",
  );
  lines.push("");
  lines.push("## Packages");
  lines.push("");
  lines.push("| Package | Version | License |");
  lines.push("|---|---|---|");
  for (const p of notices.packages) {
    const lic = p.local ? "MIT (NIDO's own module)" : p.license ?? "not declared";
    lines.push(`| ${p.name} | ${p.version} | ${lic}${p.elected ? ` (used under ${p.elected})` : ""} |`);
  }
  lines.push("");
  lines.push("## License texts");
  lines.push("");
  for (const p of notices.packages) {
    if (!p.files.length) continue;
    if (p.inheritedFrom) {
      lines.push(`### ${p.name}@${p.version}`);
      lines.push("");
      lines.push(`Ships no license file; same project, copyright holder and license as \`${p.inheritedFrom}\`, whose notice applies (see above).`);
      lines.push("");
      continue;
    }
    for (const f of p.files) {
      lines.push(`### ${p.name}@${p.version} — ${f.file}`);
      lines.push("");
      lines.push("```text");
      lines.push(notices.texts[f.text].replace(/```/g, "ʼʼʼ"));
      lines.push("```");
      lines.push("");
    }
  }
  for (const c of notices.native ?? []) {
    if (!c.text) continue;
    lines.push(`### ${c.name}@${c.version} — ${c.licenseFile}`);
    lines.push("");
    lines.push("```text");
    lines.push(notices.texts[c.text].replace(/```/g, "ʼʼʼ"));
    lines.push("```");
    lines.push("");
  }
  if (notices.withoutText?.length) {
    lines.push("## Packages without a license file");
    lines.push("");
    lines.push("These packages declare a license in their `package.json` but ship no license file; the declared license applies. Most are build tools that do not end up in the APK.");
    lines.push("");
    for (const n of notices.withoutText) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}
