/// <reference types="node" />
import { describe, it, expect, beforeAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildLexicalQuery,
  countMatchedTerms,
  filterByTermCoverage,
  fuseRetrievalResults,
  requiredTermMatches,
} from "./pure";
import type { RetrievedChunk } from "./retrieve.types";

/**
 * Lexical retrieval against a REAL SQLite FTS5 index (Node's built-in
 * node:sqlite) of the real bundled corpus — the same 5,300 docs the app
 * seeds, same default unicode61 tokenizer as src/rag/db.ts. The SQL is a
 * simplified copy of retrieve.ts's lexicalSearch (no chunks /
 * custom_collections join, which only filters inactive user collections);
 * the query building and coverage gate are the exact pure.ts functions it
 * calls. Assertions reflect measured results on this corpus.
 */

const CANDIDATE_MULTIPLIER = 4;

let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED, title, body)");
  const insert = db.prepare("INSERT INTO chunks_fts (chunk_id, title, body) VALUES (?, ?, ?)");
  const corpusDir = join(__dirname, "../../assets/corpus");
  for (const file of ["corpus.json", "corpus-standard.json", "corpus-full.json"]) {
    const docs = JSON.parse(readFileSync(join(corpusDir, file), "utf8")) as Array<{ title: string; body: string }>;
    docs.forEach((d, i) => insert.run(`${file}:${i}`, d.title, d.body));
  }
});

type Row = { chunk_id: string; title: string; body: string; rank: number };

function ftsQuery(match: string, limit: number): Row[] {
  return db
    .prepare("SELECT chunk_id, title, body, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?")
    .all(match, limit) as Row[];
}

function lexicalSearch(query: string, limit = 12): RetrievedChunk[] {
  const q = buildLexicalQuery(query);
  if (!q) return [];
  return filterByTermCoverage(ftsQuery(q.match, limit * CANDIDATE_MULTIPLIER), q.terms)
    .slice(0, limit)
    .map((r) => ({ chunkId: r.chunk_id, docId: r.chunk_id, title: r.title, body: r.body, score: -r.rank, matchType: "lexical" as const }));
}

function oldPhraseSearch(query: string): Row[] {
  return ftsQuery(`"${query.replace(/"/g, '""')}"`, 12);
}

const titles = (chunks: Array<{ title: string }>) => chunks.map((c) => c.title);

describe("buildLexicalQuery", () => {
  it("keeps content words and drops question framing", () => {
    expect(buildLexicalQuery("what is a black hole?")?.match).toBe('"black" OR "hole"');
    expect(buildLexicalQuery("Compare the French Revolution and the Industrial Revolution")?.match).toBe(
      '"french" OR "revolution" OR "industrial"'
    );
  });

  it("adds the singular of plural words, but not of words that only look plural", () => {
    expect(buildLexicalQuery("how do vaccines work")?.match).toBe('"vaccines" OR "vaccine"');
    expect(buildLexicalQuery("theories about viruses")?.match).toBe(
      '"theories" OR "theory" OR "viruses" OR "viruse" OR "virus"'
    );
    expect(buildLexicalQuery("volcanoes")?.terms[0].forms).toContain("volcano");
    expect(buildLexicalQuery("explain photosynthesis")?.match).toBe('"photosynthesis"');
    expect(buildLexicalQuery("virus analysis gas")?.match).toBe('"virus" OR "analysis" OR "gas"');
  });

  it("returns null when nothing but filler is left, so lexical search is skipped", () => {
    expect(buildLexicalQuery("tell me something")).toBeNull();
    expect(buildLexicalQuery("what is it?")).toBeNull();
    expect(buildLexicalQuery("   ?!  ")).toBeNull();
  });

  it("quotes every term, so FTS5 operator syntax in user input can't break the query", () => {
    const q = buildLexicalQuery('NEAR(black hole) AND "quasar" OR -pulsar* ^star');
    expect(q?.match).toBe('"near" OR "black" OR "hole" OR "quasar" OR "pulsar" OR "star"');
    expect(() => ftsQuery(q!.match, 5)).not.toThrow();
  });

  it("dedupes terms and caps their number", () => {
    expect(buildLexicalQuery("volcano volcano volcanoes")?.terms).toEqual([{ forms: ["volcano"] }]);
    const long = Array.from({ length: 20 }, (_, i) => `term${i}`).join(" ");
    expect(buildLexicalQuery(long)?.terms).toHaveLength(12);
  });
});

describe("term coverage gate", () => {
  it("requires every term for short queries and at least half for longer ones", () => {
    expect([1, 2, 3, 4, 5].map(requiredTermMatches)).toEqual([1, 2, 2, 2, 3]);
  });

  it("counts a term as matched when any of its forms appears", () => {
    const terms = buildLexicalQuery("vaccines and viruses")!.terms;
    expect(countMatchedTerms("A vaccine trains immunity against a virus.", terms)).toBe(2);
    expect(countMatchedTerms("Vaccines protect against viruses.", terms)).toBe(2);
    expect(countMatchedTerms("A vaccine trains immunity.", terms)).toBe(1);
  });
});

describe("lexical retrieval on the real corpus", () => {
  it.each([
    ["what is a black hole?", "Black hole"],
    ["how do vaccines work", "Vaccine"],
    ["explain photosynthesis", "Photosynthesis"],
    ["Why did the Roman Empire fall?", "Fall of the Western Roman Empire"],
  ])("finds the relevant article for %j", (query, expected) => {
    expect(titles(lexicalSearch(query)).slice(0, 3)).toContain(expected);
  });

  it("finds both sides of a comparison question", () => {
    const top = titles(lexicalSearch("compare the French Revolution and the Industrial Revolution")).slice(0, 2);
    expect(top).toEqual(expect.arrayContaining(["French Revolution", "Industrial Revolution"]));
  });

  it("regression: the old exact-phrase query found none of these", () => {
    for (const q of ["what is a black hole?", "how do vaccines work", "Why did the Roman Empire fall?"]) {
      expect(oldPhraseSearch(q)).toEqual([]);
    }
  });

  it("returns nothing for gibberish or questions the corpus has nothing on", () => {
    expect(lexicalSearch("asdfghjkl qwerty")).toEqual([]);
    expect(lexicalSearch("what is the airspeed velocity of an unladen swallow")).toEqual([]);
    expect(lexicalSearch("what is the best pizza topping in Tokyo?")).toEqual([]);
    expect(lexicalSearch("tell me something")).toEqual([]);
  });

  it("does not accept documents sharing only one word of a two-word topic", () => {
    const q = buildLexicalQuery("black holes")!;
    const hits = lexicalSearch("black holes");
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(countMatchedTerms(`${h.title} ${h.body}`, q.terms)).toBe(2);
  });

  it("never returns more than the requested limit", () => {
    expect(lexicalSearch("Why did the Roman Empire fall?", 3).length).toBeLessThanOrEqual(3);
  });

  it("is deterministic", () => {
    expect(lexicalSearch("Why did the Roman Empire fall?")).toEqual(lexicalSearch("Why did the Roman Empire fall?"));
  });
});

describe("hybrid ranking with real lexical hits", () => {
  it("ranks a chunk found by both lexical and semantic search first, as hybrid", () => {
    const lexical = lexicalSearch("what is a black hole?", 12);
    const blackHole = lexical.find((c) => c.title === "Black hole")!;
    const semantic: RetrievedChunk[] = [
      { ...blackHole, score: 0.62, matchType: "semantic" },
      { chunkId: "sem-only", docId: "sem-only", title: "Neutron star", body: "", score: 0.55, matchType: "semantic" },
    ];
    const fused = fuseRetrievalResults(lexical.slice(0, 12), semantic, 6);
    expect(fused[0].title).toBe("Black hole");
    expect(fused[0].matchType).toBe("hybrid");
    expect(fused.length).toBeLessThanOrEqual(6);
  });

  it("keeps a semantic-only match when lexical search has nothing", () => {
    const semantic: RetrievedChunk[] = [
      { chunkId: "s1", docId: "s1", title: "DNA", body: "", score: 0.5, matchType: "semantic" },
    ];
    expect(lexicalSearch("How does DNA replication work?")).toEqual([]);
    expect(titles(fuseRetrievalResults([], semantic, 6))).toEqual(["DNA"]);
  });
});
