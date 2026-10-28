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
  let sectionQuestions = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ heading, text, questions: sectionQuestions });
    else if (sectionQuestions.length && sections.length) sections[sections.length - 1].questions.push(...sectionQuestions);
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
  if (meta.verified && !/^\d{4}-\d{2}-\d{2}$/.test(meta.verified)) throw new Error(`${file}: verified must be YYYY-MM-DD`);
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
  if (!doc || typeof doc !== "object") throw new Error(`${file}: not an object`);
  const regions = doc.regions ?? {};
  for (const [code, r] of Object.entries(regions)) {
    if (!/^[A-Z]{2}$/.test(code)) throw new Error(`${file}: region ${code} is not an ISO 3166-1 alpha-2 code`);
    for (const l of ["es", "en", "pt"]) if (!r?.names?.[l]) throw new Error(`${file}: region ${code} needs names.${l}`);
    if (!Array.isArray(r.aliases) || r.aliases.length === 0) throw new Error(`${file}: region ${code} needs aliases`);
    if (r.in !== undefined) for (const l of ["es", "en", "pt"]) if (!r.in?.[l]) throw new Error(`${file}: region ${code} needs in.${l}`);
  }
  const facts = Array.isArray(doc.facts) ? doc.facts : [];
  const seen = new Set();
  for (const f of facts) {
    const where = `${file}: fact ${f?.key ?? "?"}/${f?.region ?? "?"}`;
    if (!f?.key || !/^[a-z]+(\.[a-z0-9-]+)+$/.test(f.key)) throw new Error(`${where}: bad key`);
    if (!regions[f.region]) throw new Error(`${where}: unknown region`);
    if (!f.value || typeof f.value !== "string") throw new Error(`${where}: needs a value`);
    for (const l of ["es", "en", "pt"]) if (!f.label?.[l]) throw new Error(`${where}: needs label.${l}`);
    if (f.note !== undefined) for (const l of ["es", "en", "pt"]) if (!f.note?.[l]) throw new Error(`${where}: needs note.${l}`);
    const s = f.source ?? {};
    if (!s.title || !/^https:\/\//.test(s.url ?? "") || !s.quote || !/^\d{4}-\d{2}-\d{2}$/.test(s.checked ?? "")) {
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

/** Visible text of an HTML page (scripts and styles dropped, entities decoded). */
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? (/^[a-z](acute|grave|tilde|uml|circ|cedil)$/i.test(n) ? n[0] : m));
}

/** True when the quote (normalized) appears in the page text (normalized). */
export function quoteIsPresent(pageText, quote) {
  return normalizeForQuote(pageText).includes(normalizeForQuote(quote));
}

/** Days between a YYYY-MM-DD check date and `today` (a Date). */
export function daysSince(checked, today = new Date()) {
  return Math.floor((today.getTime() - Date.parse(`${checked}T00:00:00Z`)) / 86_400_000);
}
