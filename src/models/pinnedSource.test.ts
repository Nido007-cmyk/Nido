/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { pinnedSourceUrl, MODEL_CATALOG, type CatalogModel } from "./manifest";

const base: CatalogModel = {
  id: "qwen-test",
  kind: "llm",
  label: "Test",
  filename: "test.gguf",
  sizeBytes: 1000,
  sha256: "abc",
  sourceUrl:
    "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
  license: "test",
  description: "test",
  required: false,
};

describe("pinnedSourceUrl — failure paths", () => {
  it("pins /resolve/main/ to the recorded revision commit", () => {
    const url = pinnedSourceUrl({ ...base, revision: "deadbeef1234" });
    expect(url).toBe(
      "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/deadbeef1234/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"
    );
    expect(url).not.toContain("/resolve/main/");
  });

  it("returns the source URL unchanged when no revision is recorded", () => {
    expect(pinnedSourceUrl(base)).toBe(base.sourceUrl);
  });

  it("leaves URLs without a /resolve/main/ segment unchanged even with a revision", () => {
    const asset = {
      ...base,
      revision: "deadbeef",
      sourceUrl: "https://example.com/files/model.gguf",
    };
    expect(pinnedSourceUrl(asset)).toBe("https://example.com/files/model.gguf");
  });

  it("pins raw.githubusercontent.com /main/ corpus URLs to the recorded revision", () => {
    // Q-2: corpus packs live at raw.githubusercontent.com/.../main/... with no
    // /resolve/ segment. pinnedSourceUrl() now rewrites the /main/ branch
    // pointer to the pinned commit, so the manifest's documented guarantee
    // ("a release always fetches the exact bytes the sha256 was computed
    // against") holds for corpus assets too. Defense in depth remains: corpus
    // files are small (<= 256MB) so ModelManager auto-verifies sha256 after
    // download — a changed upstream fails LOUD (deleted + error).
    const asset = {
      ...base,
      revision: "9898b35e92bf42984a62c62a1d5f4b5895372b27",
      sourceUrl:
        "https://raw.githubusercontent.com/rferrari/boar-app/main/assets/corpus/corpus-standard.json",
    };
    expect(pinnedSourceUrl(asset)).toBe(
      "https://raw.githubusercontent.com/rferrari/boar-app/9898b35e92bf42984a62c62a1d5f4b5895372b27/assets/corpus/corpus-standard.json"
    );
    expect(pinnedSourceUrl(asset)).not.toContain("/main/");
  });

  it("does not silently rewrite a URL that already points at a pinned commit", () => {
    const asset = {
      ...base,
      revision: "aaaa",
      sourceUrl: "https://huggingface.co/x/y/resolve/bbbb/model.gguf",
    };
    // replace() only targets "/resolve/main/": an already-pinned URL is untouched,
    // so a stale revision can never silently redirect an already-exact URL.
    expect(pinnedSourceUrl(asset)).toBe(asset.sourceUrl);
  });
});

describe("catalog GGUF pinning (C/F2)", () => {
  // Every downloadable GGUF in the catalog must resolve to an immutable,
  // revision-pinned URL — a mutable /resolve/main/ branch pointer must
  // never reach the downloader.
  const GGUF_IDS = [
    "phi-3.5-mini-instruct-q4km",
    "bge-small-en-v1.5-q8",
    "qwen2.5-1.5b-instruct-q4km",
    "qwen2.5-7b-instruct-q4km",
    "lfm2.5-8b-a1b-q4km",
    "gemma-4-e4b-it-q4_0",
  ];

  it("all 6 catalog GGUFs pin a 40-hex commit revision", () => {
    expect(GGUF_IDS).toHaveLength(6);
    for (const id of GGUF_IDS) {
      const asset = MODEL_CATALOG.find((a) => a.id === id);
      expect(asset).toBeDefined();
      expect(asset!.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("every effective GGUF download URL is immutable — no /resolve/main/ survives", () => {
    for (const id of GGUF_IDS) {
      const asset = MODEL_CATALOG.find((a) => a.id === id)!;
      const url = pinnedSourceUrl(asset);
      expect(url).toContain(`/resolve/${asset.revision}/`);
      expect(url).not.toContain("/resolve/main/");
    }
  });
});
