// Pure helpers for scripts/build-knowledge-pack.mjs (tested in knowledge-pack-lib.test.mjs).

export const USAGE = `usage: node scripts/build-knowledge-pack.mjs [options]

Builds an offline knowledge pack from Wikipedia article introductions.

  --level N          Vital Articles level to use: 4 (~10k articles) or 5 (~50k, default)
  --titles FILE      use your own list of article titles instead, one per line
  --limit N          keep only the first N titles (quick test builds)
  --id ID            pack id and file name (default wiki-vital<level>, or wiki-custom)
  --name NAME        name shown in the app
  --out DIR          output directory (default build/knowledge-pack)
  --chunk-chars N    target characters per chunk (default 600)
  --max-chunks N     chunks kept per article (default 3)
  --threads N        embedding workers (default 4)
  -h, --help         show this help`;

export function parseArgs(argv) {
  const opts = { level: 5, titlesFile: undefined, limit: undefined, id: undefined, name: undefined, out: "build/knowledge-pack", chunkChars: 600, maxChunks: 3, threads: 4, help: false };
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
      case "--limit": opts.limit = num(needs(), a); break;
      case "--id": opts.id = needs(); break;
      case "--name": opts.name = needs(); break;
      case "--out": opts.out = needs(); break;
      case "--chunk-chars": opts.chunkChars = num(needs(), a); break;
      case "--max-chunks": opts.maxChunks = num(needs(), a); break;
      case "--threads": opts.threads = num(needs(), a); break;
      case "-h":
      case "--help": opts.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  opts.id ??= opts.titlesFile ? "wiki-custom" : `wiki-vital${opts.level}`;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(opts.id)) throw new Error("--id must be lowercase letters, digits or dashes");
  opts.name ??= opts.titlesFile ? "Wikipedia (custom list)" : `Wikipedia Vital Articles (level ${opts.level})`;
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
