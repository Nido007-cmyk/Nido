/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * build-knowledge-pack.cache.test.mjs — the embeddings cache is named by
 * content (cadena «Arregla todo» post-0.1.69, frente 3).
 *
 * The cache used to be named by chunk COUNT alone and resumed by file
 * size, never looking at a byte of content. Rebuilding after an edit that
 * kept the chunk count served the previous source's vectors, paired with
 * the new text by position: a build could measure the cache instead of
 * the source and call it green (demonstrated live on the Esencial pack:
 * a pristine source rebuilt over a cured source's cache measured the
 * cure the source no longer had).
 *
 * This test builds a two-guide fixture pack three times against one work
 * directory:
 *   (a) a chunk is edited WITHOUT changing the chunk count — the second
 *       build must re-embed (a new cache key, a miss) and the edited
 *       chunk's stored vector must change, while the untouched guide's
 *       vectors stay byte-identical (the model is deterministic);
 *   (b) the two guides swap order — every stored vector must follow its
 *       text (same vector per chunk title as in the first build), not
 *       its position.
 * Against the count-named cache both assertions fail: (a) is a silent
 * cache hit over edited text, (b) hands each chunk the other guide's
 * vector.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID = "cache-key-fixture";
const WORK = join(ROOT, "build", "knowledge-pack", ID);
const OUT = mkdtempSync(join(tmpdir(), "nido-cache-test-out-"));
const GUIDES = mkdtempSync(join(tmpdir(), "nido-cache-test-guides-"));

const GUIDE_A = `---
title: Rivers of the north, a test guide
category: Test
lang: en
sources: Fixture (this test)
---
Northern rivers begin as meltwater high in the mountains and gather
strength as smaller streams join them on the way down to the sea.

## The upper course
The river carries cold meltwater from the high glacier down through
pine forest and wide gravel banks. Trout hold in the deep pools below
the rapids, and dippers walk the streambed hunting insects under the
stones. In spring the water runs milky with rock flour ground fine by
the ice, and the current can rise a full metre in a single warm day.

## The lower course
Below the last gorge the river slows and spreads across the flood
plain, dropping its load of sand and silt in shifting bars. Farmers
along the banks watch the gauge boards in the wet season, and the
ferry crossings close when the water tops the landing steps.
`;

const GUIDE_A_EDITED = GUIDE_A.replace(
  "The river carries cold meltwater from the high glacier down through\npine forest and wide gravel banks.",
  "A suspension bridge of steel cables crosses the dry canyon far above\nthe old mining town, far from any glacier or forest."
);

const GUIDE_B = `---
title: Desert plants, a test guide
category: Test
lang: en
sources: Fixture (this test)
---
Desert plants survive where rain may not fall for a year, storing
water and shading their roots against the midday heat.

## Water in reserve
The barrel cactus keeps its water in pleated ribs that swell after a
storm and shrink slowly through the dry months. A waxy skin and spines
in place of leaves cut the loss to the wind, and the roots spread wide
and shallow to catch the first minutes of any shower.

## Flowers after rain
Within days of a real rain the desert floor can turn yellow and red
with annual flowers that slept as seeds for years. Their whole life
runs its course in a few weeks: sprout, bloom, set seed and die back
before the ground dries hard again.
`;

function build() {
  const r = spawnSync(
    "node",
    ["scripts/build-knowledge-pack.mjs", "--guides", GUIDES, "--id", ID, "--out", OUT, "--threads", "2"],
    { encoding: "utf8", cwd: ROOT, timeout: 240000 }
  );
  if (r.status !== 0) throw new Error(`builder failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function cacheKeyOf(stdout) {
  const m = stdout.match(/cache key ([0-9a-f]{16}) · (hit|partial|miss)/);
  if (!m) throw new Error(`no cache-key line in builder log:\n${stdout}`);
  return { key: m[1], state: m[2] };
}

function vectorsByTitle() {
  const db = new DatabaseSync(join(OUT, `${ID}.sqlite`), { readOnly: true });
  const rows = db.prepare("SELECT title, scale, vec FROM chunks ORDER BY id").all();
  db.close();
  const map = new Map();
  for (const r of rows) map.set(r.title, `${r.scale}:${Buffer.from(r.vec).toString("hex")}`);
  return map;
}

function writeGuides(a, b) {
  writeFileSync(join(GUIDES, "01-rivers.md"), a);
  writeFileSync(join(GUIDES, "02-desert.md"), b);
}

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
  rmSync(OUT, { recursive: true, force: true });
  rmSync(GUIDES, { recursive: true, force: true });
});

describe("build-knowledge-pack embeddings cache (named by content)", () => {
  it("re-embeds an edit that keeps the chunk count, and vectors follow text over position", () => {
    rmSync(WORK, { recursive: true, force: true });
    writeGuides(GUIDE_A, GUIDE_B);

    const first = cacheKeyOf(build());
    expect(first.state).toBe("miss");
    const v1 = vectorsByTitle();
    expect(v1.size).toBeGreaterThanOrEqual(2);

    // (a) Edit one chunk of guide A; headings and structure untouched, so
    // the chunk count cannot change.
    expect(GUIDE_A_EDITED).not.toBe(GUIDE_A);
    writeGuides(GUIDE_A_EDITED, GUIDE_B);
    const second = cacheKeyOf(build());
    expect(second.key).not.toBe(first.key);
    expect(second.state).toBe("miss");
    const v2 = vectorsByTitle();
    expect(v2.size).toBe(v1.size);
    let aChanged = false;
    for (const [title, vec] of v2) {
      if (title.startsWith("Rivers of the north")) {
        if (vec !== v1.get(title)) aChanged = true;
      } else {
        expect(vec, `untouched chunk changed: ${title}`).toBe(v1.get(title));
      }
    }
    expect(aChanged, "the edited chunk kept its old vector").toBe(true);

    // (b) Swap the guides' order: same texts as the first build, opposite
    // positions. Every vector must follow its text.
    writeGuides(GUIDE_B, GUIDE_A);
    const third = cacheKeyOf(build());
    expect(third.key).not.toBe(first.key);
    expect(third.state).toBe("miss");
    const v3 = vectorsByTitle();
    expect(v3.size).toBe(v1.size);
    for (const [title, vec] of v1) expect(v3.get(title), `vector followed position, not text: ${title}`).toBe(vec);

    // (c) Identical content again: the cache must hit and compute nothing.
    const fourth = cacheKeyOf(build());
    expect(fourth.key).toBe(third.key);
    expect(fourth.state).toBe("hit");
  }, 900000);
});
