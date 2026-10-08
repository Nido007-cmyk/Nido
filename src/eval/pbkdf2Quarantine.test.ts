/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * QUARANTINE TRIPWIRE — PBKDF2 benchmark candidate.
 *
 * The candidate (scripts/benchmarks/pbkdf2-candidate/) is a measurement
 * instrument, NOT reviewed production crypto. This test fails the suite if
 * any production file outside the allowed set imports the candidate or the
 * benchmark task — so wiring the candidate into real crypto flows turns the
 * build red instead of silently becoming "already-done L3".
 *
 * Allowed importers of the CANDIDATE (pbkdf2-candidate):
 *   - src/eval/pbkdf2Bench.ts (the single quarantined task)
 *   - *.test.ts (correctness/quarantine tests — not production)
 *   - scripts/** (tooling)
 * Allowed importers of the TASK (eval/pbkdf2Bench):
 *   - src/eval/**, src/ui/EvaluationScreen.tsx (the quarantined entry point)
 *   - *.test.ts
 * Everything else — especially src/agent, src/p2p, src/security, src/rag,
 * src/services, src/models, and any bundle/export/import module — is forbidden.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PBKDF2_CANDIDATE_SOURCE_SHA256 } from "../../scripts/benchmarks/pbkdf2-candidate/sourceHash";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CANDIDATE_FILE = join(ROOT, "scripts", "benchmarks", "pbkdf2-candidate", "pbkdf2.ts");

const CANDIDATE_NEEDLE = /pbkdf2-candidate/;
const TASK_IMPORT =
  /(?:from\s+["'][^"']*pbkdf2Bench["'])|(?:require\(\s*["'][^"']*pbkdf2Bench["']\s*\))/;

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === "android" || e === "ios") continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const isTest = (p: string) => p.endsWith(".test.ts") || p.endsWith(".test.tsx");

describe("pbkdf2 quarantine tripwire", () => {
  const files = walkTs(join(ROOT, "src")).concat(walkTs(join(ROOT, "scripts")));

  it("candidate is imported only by the quarantined task, tests, and scripts", () => {
    const bad = files
      .filter((f) => CANDIDATE_NEEDLE.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter(
        (p) =>
          p !== "src/eval/pbkdf2Bench.ts" && !isTest(p) && !p.startsWith("scripts/")
      );
    expect(bad).toEqual([]);
  });

  it("benchmark task is imported only from src/eval, EvaluationScreen, and tests", () => {
    const bad = files
      .filter((f) => TASK_IMPORT.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter(
        (p) =>
          !p.startsWith("src/eval/") && p !== "src/ui/EvaluationScreen.tsx" && !isTest(p)
      );
    expect(bad).toEqual([]);
  });

  it("no security-sensitive area imports candidate or task", () => {
    const sensitive = ["src/agent", "src/p2p", "src/security", "src/rag", "src/services", "src/models"];
    const hits = files
      .filter((f) => sensitive.some((d) => rel(f).startsWith(d + "/")))
      .filter((f) => {
        const c = readFileSync(f, "utf8");
        return CANDIDATE_NEEDLE.test(c) || TASK_IMPORT.test(c);
      })
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("candidate imports only the pinned sha256 primitive from src/", () => {
    const content = readFileSync(CANDIDATE_FILE, "utf8");
    const imports = [...content.matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map((m) => m[1]);
    const srcImports = imports.filter((s) => !s.startsWith(".") || s.includes("/src/"));
    expect(srcImports).toEqual(["../../../src/models/sha256"]);
  });

  it("candidate source hash matches the committed bytes", () => {
    const bytes = readFileSync(CANDIDATE_FILE);
    const actual = createHash("sha256").update(bytes).digest("hex");
    expect(actual).toBe(PBKDF2_CANDIDATE_SOURCE_SHA256);
  });

  it("no bundle/export/import module exists that could adopt the candidate", () => {
    const names = files.map(rel);
    const suspects = names.filter((p) => /bundle|migrationBundle|exportBundle|importBundle/i.test(p));
    expect(suspects).toEqual([]);
  });
});
