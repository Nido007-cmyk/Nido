import { describe, expect, it } from "vitest";
import {
  localRetrievalRowsToJsonl,
  localRetrievalSummaryText,
  retrieveLocalLexical,
  runLocalRetrievalEval,
  scoreLocalLexical,
  summarizeLocalRetrieval,
  type LocalCorpusDoc,
} from "./localRetrieval.pure";
import { buildLexicalQuery } from "../rag/pure";
import { EVAL_SET_VERSION, type EvalQuery } from "./evalSet";

const DOCS: LocalCorpusDoc[] = [
  { id: "d1", title: "Photosynthesis", body: "Plants convert light energy into chemical energy. Chlorophyll absorbs light." },
  { id: "d2", title: "Vaccine", body: "A vaccine trains the immune system to recognize a pathogen." },
  { id: "d3", title: "Black Sea", body: "The Black Sea is a marginal sea of the Atlantic Ocean." },
  { id: "d4", title: "Black hole", body: "A black hole is a region of spacetime where gravity is extreme." },
];

function q(id: string, query: string, expectedKbTitles: string[], category: EvalQuery["category"] = "factual"): EvalQuery {
  return { id, category, query, expectedKbTitles, gradingNotes: "" };
}

describe("scoreLocalLexical", () => {
  it("ranks the document with more term matches first", () => {
    const lq = buildLexicalQuery("How do vaccines work?")!;
    const ranked = scoreLocalLexical(lq.terms, DOCS);
    expect(ranked[0].doc.title).toBe("Vaccine");
  });

  it("prefers title matches over body-only matches", () => {
    const docs: LocalCorpusDoc[] = [
      { id: "a", title: "Unrelated", body: "black hole sighting reported" },
      { id: "b", title: "Black hole", body: "nothing relevant here" },
    ];
    const lq = buildLexicalQuery("What is a black hole?")!;
    const ranked = scoreLocalLexical(lq.terms, docs);
    expect(ranked[0].doc.id).toBe("b");
  });

  it("breaks score ties deterministically by document id", () => {
    const docs: LocalCorpusDoc[] = [
      { id: "z", title: "Same", body: "identical words here" },
      { id: "a", title: "Same", body: "identical words here" },
    ];
    const lq = buildLexicalQuery("identical words")!;
    const first = scoreLocalLexical(lq.terms, docs).map((s) => s.doc.id);
    const second = scoreLocalLexical(lq.terms, docs).map((s) => s.doc.id);
    expect(first).toEqual(["a", "z"]);
    expect(first).toEqual(second);
  });
});

describe("retrieveLocalLexical", () => {
  it("returns [] when the query reduces to stopwords only", () => {
    expect(retrieveLocalLexical("tell me something", DOCS, 6)).toEqual([]);
  });

  it("applies the term-coverage gate: Black Sea is rejected for a black-hole query", () => {
    const out = retrieveLocalLexical("What is a black hole and how does one form?", DOCS, 6);
    const titles = out.map((d) => d.title);
    expect(titles).toContain("Black hole");
    expect(titles).not.toContain("Black Sea");
  });

  it("caps results at topK", () => {
    const out = retrieveLocalLexical("energy light", DOCS, 1);
    expect(out.length).toBeLessThanOrEqual(1);
  });
});

describe("runLocalRetrievalEval", () => {
  const queries = [
    q("q1", "What is a black hole and how does one form?", ["Black hole"], "retrieval-grounded"),
    q("q2", "hey, what's up?", []),
  ];

  it("computes hit metrics and nulls when nothing is expected", () => {
    const rows = runLocalRetrievalEval(DOCS, queries, 6, "test-corpus");
    const hit = rows[0];
    expect(hit.retrievedTitles).toContain("Black hole");
    expect(hit.hitAt1).toBe(true);
    expect(hit.allExpectedHit).toBe(true);
    expect(hit.reciprocalRank).toBe(1);
    expect(hit.latencyMs).toBeGreaterThanOrEqual(0);

    const noExp = rows[1];
    expect(noExp.hitAt1).toBeNull();
    expect(noExp.hitAt6).toBeNull();
    expect(noExp.allExpectedHit).toBeNull();
    expect(noExp.reciprocalRank).toBeNull();
  });

  it("reports a miss with reciprocalRank 0", () => {
    const rows = runLocalRetrievalEval(DOCS, [q("q3", "Tell me about quantum tunneling", ["Quantum tunneling"])], 6, "test-corpus");
    expect(rows[0].hitAt6).toBe(false);
    expect(rows[0].reciprocalRank).toBe(0);
  });

  it("stamps eval set version, corpus id and channel on every row", () => {
    const rows = runLocalRetrievalEval(DOCS, queries, 6, "corpus-x");
    for (const r of rows) {
      expect(r.evalSetVersion).toBe(EVAL_SET_VERSION);
      expect(r.corpusId).toBe("corpus-x");
      expect(r.channel).toBe("lexical-local");
    }
  });
});

describe("summarizeLocalRetrieval", () => {
  it("aggregates hit rates, MRR, latency and no-hit ids", () => {
    const queries = [
      q("q1", "What is a black hole and how does one form?", ["Black hole"], "retrieval-grounded"),
      q("q2", "Tell me about quantum tunneling", ["Quantum tunneling"], "retrieval-grounded"),
      q("q3", "hey", [], "greeting"),
    ];
    const rows = runLocalRetrievalEval(DOCS, queries, 6, "test-corpus");
    const s = summarizeLocalRetrieval(rows, "test-corpus", 6);
    expect(s.queryCount).toBe(3);
    expect(s.scoredQueryCount).toBe(2);
    expect(s.hitRateAt6).toBe(0.5);
    expect(s.meanReciprocalRank).toBe(0.5);
    expect(s.noHitQueryIds).toEqual(["q2"]);
    expect(s.byCategory["retrieval-grounded"].hitRateAt6).toBe(0.5);
    expect(s.byCategory["greeting"].scored).toBe(0);
  });
});

describe("report formatting", () => {
  it("jsonl has one object per line", () => {
    const rows = runLocalRetrievalEval(DOCS, [q("q1", "vaccines", ["Vaccine"])], 6, "c");
    const jsonl = localRetrievalRowsToJsonl(rows);
    const lines = jsonl.split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).queryId).toBe("q1");
  });

  it("summary text mentions the key numbers", () => {
    const rows = runLocalRetrievalEval(DOCS, [q("q1", "What is a black hole?", ["Black hole"])], 6, "c");
    const text = localRetrievalSummaryText(summarizeLocalRetrieval(rows, "c", 6));
    expect(text).toContain("hit@6 100.0%");
    expect(text).toContain("topK=6");
  });
});
