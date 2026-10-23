/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Pure helpers for scripts/build-knowledge-pack.mjs (tested in knowledge-pack-lib.test.mjs).

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
  -h, --help         show this help`;

export function parseArgs(argv) {
  const opts = { level: 5, titlesFile: undefined, limit: undefined, id: undefined, name: undefined, out: "build/knowledge-pack", chunkChars: 600, maxChunks: 3, threads: 4, embedding: "bge", builtAt: undefined, guidesDir: undefined, help: false };
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
      case "--built-at": opts.builtAt = needs(); if (Number.isNaN(Date.parse(opts.builtAt))) throw new Error("--built-at must be an ISO date"); break;
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
  return chunks.filter((c) => c.length >= 40);
}

/** Per-vector symmetric int8 quantization: v ≈ data * scale. */
export function quantizeInt8(vectors, dims) {
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
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of ["title", "lang", "sources"]) if (!meta[k]) throw new Error(`${file}: front matter needs "${k}"`);
  const sections = [];
  let heading = "";
  let buf = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ heading, text });
    buf = [];
  };
  for (const line of m[2].split("\n")) {
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) {
      flush();
      heading = h[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  if (sections.length === 0) throw new Error(`${file}: empty guide`);
  return { title: meta.title, category: meta.category ?? "", lang: meta.lang, sources: meta.sources, sections };
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
    for (const line of s.text.split("\n")) {
      if (cur && cur.length + 1 + line.length > target) {
        raw.push({ heading: s.heading, body: (label + cur).trim() });
        cur = line;
      } else {
        cur = cur ? `${cur}\n${line}` : line;
      }
    }
    if (cur.trim()) raw.push({ heading: s.heading, body: (label + cur).trim() });
  }
  const out = [];
  for (const c of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.heading !== c.heading && c.body.length < minChars && prev.body.length + 2 + c.body.length <= target) {
      prev.body = `${prev.body}\n\n${c.body}`;
    } else {
      out.push({ ...c });
    }
  }
  if (out.length > 1 && out[0].body.length < minChars && out[0].body.length + 2 + out[1].body.length <= target) {
    const [first, second] = out.splice(0, 2);
    out.unshift({ heading: second.heading, body: `${first.body}\n\n${second.body}` });
  }
  return out;
}
