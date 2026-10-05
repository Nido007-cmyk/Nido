import { describe, it, expect } from "vitest";
import { chunkIntro, cleanIntro, parseArgs, quantizeInt8, vitalListPages } from "./knowledge-pack-lib.mjs";
import { cosineSimilarity, cosineSimilarityInt8 } from "../../src/rag/pure";

describe("parseArgs", () => {
  it("defaults to Vital Articles level 5", () => {
    expect(parseArgs([])).toMatchObject({ level: 5, id: "wiki-vital5", chunkChars: 600, maxChunks: 3, threads: 4 });
  });
  it("names custom builds and validates values", () => {
    expect(parseArgs(["--titles", "t.txt"])).toMatchObject({ id: "wiki-custom", titlesFile: "t.txt" });
    expect(parseArgs(["--level", "4", "--limit", "100"])).toMatchObject({ level: 4, id: "wiki-vital4", limit: 100 });
    expect(() => parseArgs(["--level", "3"])).toThrow(/4 or 5/);
    expect(() => parseArgs(["--id", "Bad Id"])).toThrow(/lowercase/);
    expect(() => parseArgs(["--threads", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown option/);
  });
});

describe("vitalListPages", () => {
  it("keeps list pages, drops the index, archives and alerts", () => {
    const pages = [
      "Wikipedia:Vital articles/Level 5",
      "Wikipedia:Vital articles/Level 5/Arts",
      "Wikipedia:Vital articles/Level 5/People/Writers and journalists",
      "Wikipedia:Vital articles/Level 5/Article alerts",
      "Wikipedia:Vital articles/Level 5/Article alerts/Archive 1",
      "Wikipedia:Vital articles/Level 4/History",
    ];
    expect(vitalListPages(pages, 5)).toEqual([
      "Wikipedia:Vital articles/Level 5/Arts",
      "Wikipedia:Vital articles/Level 5/People/Writers and journalists",
    ]);
  });
});

describe("chunking", () => {
  it("cleans whitespace and empty paragraphs", () => {
    expect(cleanIntro("  A  b.\n\n\nC   d.  ")).toBe("A b.\nC d.");
  });

  it("splits on sentence boundaries near the target, keeping at most maxChunks", () => {
    const sentence = "This sentence has exactly fifty characters in it. ";
    const text = sentence.repeat(40).trim();
    const chunks = chunkIntro(text, 200, 3);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
      expect(c.endsWith(".")).toBe(true);
    }
  });

  it("keeps a short introduction whole and drops fragments", () => {
    const intro = "Napoleon Bonaparte was a French military and political leader.";
    expect(chunkIntro(intro, 600, 3)).toEqual([intro]);
    expect(chunkIntro("Hi.", 600, 3)).toEqual([]);
  });
});

describe("int8 embeddings", () => {
  it("keep cosine similarity within a hair of the float vectors", () => {
    const dims = 384;
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
    const vectors = Float32Array.from({ length: dims * 3 }, rand);
    const { data, scales } = quantizeInt8(vectors, dims);
    expect(scales).toHaveLength(3);
    const query = Float32Array.from({ length: dims }, rand);
    for (let i = 0; i < 3; i++) {
      const exact = cosineSimilarity(query, vectors.subarray(i * dims, (i + 1) * dims));
      const bytes = new Uint8Array(data.buffer, data.byteOffset + i * dims, dims);
      expect(Math.abs(cosineSimilarityInt8(query, bytes) - exact)).toBeLessThan(0.01);
    }
  });
});
