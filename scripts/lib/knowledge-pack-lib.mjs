/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Pure helpers for scripts/build-knowledge-pack.mjs (tested in knowledge-pack-lib.test.mjs),
// plus, at the end, the two atomic-publish helpers (the only impure ones).

export const USAGE = `usage: node scripts/build-knowledge-pack.mjs [options]

Builds an offline knowledge pack from Wikipedia article introductions.

  --level N          Vital Articles level to use: 4 (~10k articles) or 5 (~50k, default)
  --titles FILE      use your own list of article titles instead, one per line
  --guides DIR       build from NIDO's own guides (Markdown files with a front matter) instead of Wikipedia
  --limit N          keep only the first N titles (quick test builds)
  --id ID            pack id and file name (default wiki-vital<level>, or wiki-custom)
  --name NAME        name shown in the app
  --out DIR          output directory (default build/knowledge-pack)
  --chunk-chars N    target characters per chunk (default 600)
  --max-chunks N     chunks kept per article (default 3)
  --threads N        embedding workers (default 4)
  --embedding MODEL  bge (default: the app's English search model) or e5 (multilingual search)
  --built-at ISO     fixed build date for meta.builtAt (so rebuilds are byte-identical)
  --edition FILE     edition-card descriptor (default: edition.json in the guides dir, if any)
  -h, --help         show this help`;

/** True only for a YYYY-MM-DD string that names a day that exists
 * (round-trip through its components: 2026-02-30 does not pass). */
function isRealDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === "string" ? value : "");
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseArgs(argv) {
  const opts = { level: 5, titlesFile: undefined, limit: undefined, id: undefined, name: undefined, out: "build/knowledge-pack", chunkChars: 600, maxChunks: 3, threads: 4, embedding: "bge", builtAt: undefined, guidesDir: undefined, editionFile: undefined, help: false };
  const num = (v, flag) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive whole number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    const needs = () => {
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      i++;
      return v;
    };
    switch (a) {
      case "--level": opts.level = num(needs(), a); if (![4, 5].includes(opts.level)) throw new Error("--level must be 4 or 5"); break;
      case "--titles": opts.titlesFile = needs(); break;
      case "--guides": opts.guidesDir = needs(); break;
      case "--limit": opts.limit = num(needs(), a); break;
      case "--id": opts.id = needs(); break;
      case "--name": opts.name = needs(); break;
      case "--out": opts.out = needs(); break;
      case "--chunk-chars": opts.chunkChars = num(needs(), a); break;
      case "--max-chunks": opts.maxChunks = num(needs(), a); break;
      case "--threads": opts.threads = num(needs(), a); break;
      case "--embedding": opts.embedding = needs(); if (!["bge", "e5"].includes(opts.embedding)) throw new Error("--embedding must be bge or e5"); break;
      case "--built-at": opts.builtAt = needs(); if (!isRealDate(opts.builtAt.slice(0, 10)) || Number.isNaN(Date.parse(opts.builtAt))) throw new Error("--built-at must be an ISO date"); break;
      case "--edition": opts.editionFile = needs(); break;
      case "-h":
      case "--help": opts.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  if (opts.guidesDir && opts.titlesFile) throw new Error("use --guides or --titles, not both");
  opts.id ??= opts.guidesDir ? "nido-guides" : opts.titlesFile ? "wiki-custom" : `wiki-vital${opts.level}`;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(opts.id)) throw new Error("--id must be lowercase letters, digits or dashes");
  opts.name ??= opts.guidesDir ? "NIDO guides" : opts.titlesFile ? "Wikipedia (custom list)" : `Wikipedia Vital Articles (level ${opts.level})`;
  return opts;
}

/** The Vital Articles list pages to read links from: skips the index, archives, alerts and talk-style pages. */
export function vitalListPages(allPages, level) {
  const root = `Wikipedia:Vital articles/Level ${level}`;
  return allPages.filter((p) => {
    if (!p.startsWith(`${root}/`)) return false;
    const rest = p.slice(root.length + 1);
    return rest.length > 0 && !/Article alerts|Archive|Subpage|Removed|Proposals|Statistics|Header|Footer/i.test(rest);
  });
}

/** Normalizes a plain-text extract: collapses whitespace inside paragraphs, drops empty ones. */
export function cleanIntro(text) {
  return text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .join("\n");
}

/**
 * Splits an introduction into chunks of about `target` characters on
 * paragraph, then sentence, boundaries; keeps at most `maxChunks`.
 */
export function chunkIntro(text, target = 600, maxChunks = 3) {
  const sentences = text.split("\n").flatMap((p) => p.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [p]);
  const chunks = [];
  let cur = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (cur && cur.length + 1 + s.length > target) {
      chunks.push(cur);
      if (chunks.length >= maxChunks) return chunks;
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur && chunks.length < maxChunks) chunks.push(cur);
  // The 40-char floor drops residual middle chunks; the last chunk
  // always survives, so a short introduction (or a short closing
  // sentence) is never lost in silence.
  return chunks.filter((c, i) => c.length >= 40 || i === chunks.length - 1);
}

/** Per-vector symmetric int8 quantization: v ≈ data * scale. */
export function quantizeInt8(vectors, dims) {
  if (!Number.isInteger(dims) || dims <= 0) {
    throw new Error(`quantizeInt8: dims must be a positive whole number, got ${dims}`);
  }
  if (vectors.length % dims !== 0) {
    throw new Error(`quantizeInt8: ${vectors.length} components do not make a whole number of ${dims}-dimension vectors`);
  }
  for (let i = 0; i < vectors.length; i++) {
    if (!Number.isFinite(vectors[i])) {
      throw new Error(`quantizeInt8: non-finite component at index ${i} (${vectors[i]})`);
    }
  }
  const count = vectors.length / dims;
  const data = new Int8Array(vectors.length);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let max = 0;
    for (let k = 0; k < dims; k++) max = Math.max(max, Math.abs(vectors[i * dims + k]));
    const scale = max > 0 ? max / 127 : 1;
    scales[i] = scale;
    for (let k = 0; k < dims; k++) data[i * dims + k] = Math.round(vectors[i * dims + k] / scale);
  }
  return { data, scales };
}

/**
 * NIDO's own guides: a Markdown file with a small front matter
 *
 *   ---
 *   title: Terremoto: qué hacer
 *   category: Desastres naturales
 *   lang: es
 *   sources: Ready.gov (FEMA); Cruz Roja
 *   ---
 *   Short summary paragraph.
 *
 *   ## Antes
 *   - …
 *
 * Returns { title, category, lang, sources, sections: [{ heading, text }] }.
 * Throws on a missing title, lang or sources: every guide must say where its
 * advice comes from.
 */
export function parseGuide(markdown, file = "guide") {
  const m = markdown.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) {
      const key = line.slice(0, i).trim();
      if (Object.hasOwn(meta, key)) throw new Error(`${file}: duplicated front matter key "${key}"`);
      meta[key] = line.slice(i + 1).trim();
    }
  }
  for (const k of ["title", "lang", "sources"]) if (!meta[k]) throw new Error(`${file}: front matter needs "${k}"`);
  if (!["es", "en", "pt"].includes(meta.lang)) throw new Error(`${file}: lang must be "es", "en" or "pt"`);
  const sections = [];
  let heading = "";
  let buf = [];
  let sectionQuestions = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ heading, text, questions: sectionQuestions });
    else if (sectionQuestions.length) throw new Error(`${file}: section "${heading}" declares questions but has no text`);
    buf = [];
    sectionQuestions = [];
  };
  for (const line of m[2].split("\n")) {
    const h = line.match(/^#{2,3}\s+(.*)$/);
    // Format v2: «<!-- preguntas: … | … -->» lists real questions this
    // section answers. Not shown to the reader: it only helps search.
    const q = line.match(/^\s*<!--\s*(?:preguntas|questions|perguntas)\s*:\s*(.*?)\s*-->\s*$/i);
    if (h) {
      flush();
      heading = h[1].trim();
    } else if (q) {
      sectionQuestions.push(...splitQuestions(q[1]));
    } else {
      buf.push(line);
    }
  }
  flush();
  if (sections.length === 0) throw new Error(`${file}: empty guide`);
  if (meta.region && !/^[A-Z]{2}$/.test(meta.region)) throw new Error(`${file}: region must be an ISO 3166-1 alpha-2 code`);
  if (meta.verified && !isRealDate(meta.verified)) throw new Error(`${file}: verified must be a real YYYY-MM-DD date`);
  if (meta.id && !/^[a-z0-9][a-z0-9-]*$/.test(meta.id)) throw new Error(`${file}: id must be lowercase letters, digits or dashes`);
  return {
    title: meta.title,
    category: meta.category ?? "",
    lang: meta.lang,
    sources: meta.sources,
    // Format v2 (all optional): a key shared by the same guide in every
    // language, the country it is about, when it was last checked, and real
    // questions it answers as a whole.
    key: meta.id ?? "",
    region: meta.region ?? "",
    verified: meta.verified ?? "",
    questions: splitQuestions(meta.questions ?? ""),
    sections,
  };
}

/**
 * Chunks of a guide: one or more per section, about `target` characters each,
 * split on line boundaries (a list item never gets cut in half). Each chunk
 * names its section so it makes sense on its own when NIDO quotes it.
 *
 * A section shorter than `minChars` (a one-line intro, the closing note with
 * the sources) is not worth a search result of its own: it joins the chunk
 * before it (or, for the first one, the chunk after it) when the two fit in
 * `target`. Otherwise near-identical closing notes would crowd out real
 * answers. The tail of a long section stays on its own (it already has its
 * section label).
 */
export function chunkGuide(guide, target = 900, minChars = 250) {
  const raw = [];
  for (const s of guide.sections) {
    const label = s.heading ? `${s.heading}\n` : "";
    let cur = "";
    let questions = [...(s.questions ?? [])];
    for (const line of s.text.split("\n")) {
      if (cur && cur.length + 1 + line.length > target) {
        raw.push({ heading: s.heading, body: (label + cur).trim(), questions });
        questions = [];
        cur = line;
      } else {
        cur = cur ? `${cur}\n${line}` : line;
      }
    }
    if (cur.trim()) raw.push({ heading: s.heading, body: (label + cur).trim(), questions });
  }
  const out = [];
  for (const c of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.heading !== c.heading && c.body.length < minChars && prev.body.length + 2 + c.body.length <= target) {
      prev.body = `${prev.body}\n\n${c.body}`;
      prev.questions = [...prev.questions, ...c.questions];
    } else {
      out.push({ ...c, questions: [...c.questions] });
    }
  }
  if (out.length > 1 && out[0].body.length < minChars && out[0].body.length + 2 + out[1].body.length <= target) {
    const [first, second] = out.splice(0, 2);
    out.unshift({ heading: second.heading, body: `${first.body}\n\n${second.body}`, questions: [...first.questions, ...second.questions] });
  }
  // The guide's own questions go with its first chunk.
  if (out.length > 0 && guide.questions?.length) out[0].questions = [...guide.questions, ...out[0].questions];
  return out;
}

/** «a | b | c» → ["a", "b", "c"] (format v2 questions). */
export function splitQuestions(text) {
  return String(text ?? "")
    .split("|")
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
}

/**
 * Format v2: the pack's verified facts (knowledge-packs/<pack>/facts.json).
 * Every fact names its region, a value, and the official source it was
 * checked against: title, URL, the exact quote and the date. Throws on
 * anything missing, so an unsourced fact can never reach a pack.
 */
export function validateFacts(doc, file = "facts.json") {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${file}: not an object`);
  const isText = (v) => typeof v === "string" && v.trim().length > 0;
  const regions = doc.regions ?? {};
  if (typeof regions !== "object" || regions === null || Array.isArray(regions)) throw new Error(`${file}: regions must be an object`);
  for (const [code, r] of Object.entries(regions)) {
    if (!/^[A-Z]{2}$/.test(code)) throw new Error(`${file}: region ${code} is not an ISO 3166-1 alpha-2 code`);
    for (const l of ["es", "en", "pt"]) if (!isText(r?.names?.[l])) throw new Error(`${file}: region ${code} needs names.${l}`);
    if (!Array.isArray(r.aliases) || r.aliases.length === 0 || !r.aliases.every(isText)) throw new Error(`${file}: region ${code} needs aliases`);
    if (r.in !== undefined) for (const l of ["es", "en", "pt"]) if (!isText(r.in?.[l])) throw new Error(`${file}: region ${code} needs in.${l}`);
  }
  if (!Array.isArray(doc.facts)) throw new Error(`${file}: facts must be an array`);
  const facts = doc.facts;
  const seen = new Set();
  for (const f of facts) {
    const where = `${file}: fact ${f?.key ?? "?"}/${f?.region ?? "?"}`;
    if (!f?.key || !/^[a-z]+(\.[a-z0-9-]+)+$/.test(f.key)) throw new Error(`${where}: bad key`);
    if (!regions[f.region]) throw new Error(`${where}: unknown region`);
    if (!isText(f.value)) throw new Error(`${where}: needs a value`);
    for (const l of ["es", "en", "pt"]) if (!isText(f.label?.[l])) throw new Error(`${where}: needs label.${l}`);
    if (f.note !== undefined) for (const l of ["es", "en", "pt"]) if (!isText(f.note?.[l])) throw new Error(`${where}: needs note.${l}`);
    const s = f.source ?? {};
    let urlOk = false;
    try {
      const u = new URL(typeof s.url === "string" ? s.url : "");
      urlOk = u.protocol === "https:" && u.hostname.length > 0;
    } catch { urlOk = false; }
    if (!isText(s.title) || !urlOk || !isText(s.quote) || !normalizeForQuote(s.quote) || !isRealDate(s.checked ?? "")) {
      throw new Error(`${where}: needs source.title, an https source.url, source.quote and source.checked (YYYY-MM-DD)`);
    }
    const id = `${f.region}|${f.key}`;
    if (seen.has(id)) throw new Error(`${where}: duplicated`);
    seen.add(id);
  }
  return { regions, facts };
}

/**
 * Text normalization for the weekly source check: a quote still counts as
 * present when only accents, case, punctuation spacing, typographic quotes or
 * HTML entities changed on the official page.
 */
export function normalizeForQuote(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐-―]/g, "-")
    .toLowerCase()
    // Punctuation and markup spacing vary between page versions ("Civil: 110",
    // "Civil</strong>: 110", "Civil - 110"): compare the words and digits only.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const codePointOrReplacement = (n) =>
  Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\uFFFD";

/** Visible text of an HTML page (scripts and styles dropped, entities decoded). */
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(script|style|noscript)\b[\s\S]*$/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePointOrReplacement(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePointOrReplacement(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? (/^[a-z](acute|grave|tilde|uml|circ|cedil)$/i.test(n) ? n[0] : m));
}

/** True when the quote (normalized) appears in the page text (normalized). */
export function quoteIsPresent(pageText, quote) {
  const needle = normalizeForQuote(quote);
  if (!needle) return false;
  return ` ${normalizeForQuote(pageText)} `.includes(` ${needle} `);
}

/** Days between a YYYY-MM-DD check date and `today` (a Date). */
export function daysSince(checked, today = new Date()) {
  if (!isRealDate(checked)) throw new Error(`daysSince: "${checked}" is not a real YYYY-MM-DD date`);
  return Math.floor((today.getTime() - Date.parse(`${checked}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Publicación atómica (bounty, tanda 8; regla de corpus de Blobs,
// Apache-2.0: el constructor publica por temporal + renombrado).
// Hasta aquí, writePack borraba la salida y construía en sitio: una
// construcción que fallaba a mitad dejaba la ruta SIN la edición
// buena anterior. Ahora todo se construye sobre el hermano temporal
// y solo se renombra cuando está cerrado y completo.

import { renameSync, writeFileSync } from "node:fs";

/** La ruta hermana temporal sobre la que se construye antes de publicar. */
export function tempSiblingPath(path) {
  return `${path}.tmp`;
}

/** Escribe el contenido en el temporal y lo renombra sobre el destino. */
export function writeFileAtomicSync(path, data) {
  const tmp = tempSiblingPath(path);
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** Publica un fichero ya construido en su temporal renombrándolo. */
export function publishBuiltFileSync(tmpPath, path) {
  renameSync(tmpPath, path);
}
