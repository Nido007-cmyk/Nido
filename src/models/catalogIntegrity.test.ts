import { describe, it, expect } from "vitest";
import {
  assertImmutableSourcePreDownload,
  CORPUS_CATALOG,
  MODEL_CATALOG,
  REQUIRED_MODELS,
  sourceContractOf,
  TIERS,
  type CatalogModel,
} from "./manifest";
import { DownloadFailure } from "./downloadErrors";

/**
 * catalogIntegrity.test.ts — R1 (2026-09-28) cross-component assertion.
 *
 * Per the owner's rule ("passing component tests is not sufficient evidence
 * of system correctness"), this is an INTEGRATION test over the REAL complete
 * MODEL_CATALOG — not synthetic entries. It runs every catalog entry through
 * assertImmutableSourcePreDownload(), the exact pre-network gate
 * ModelManager.downloadCatalogModel() calls first (the path SetupWizard
 * reaches downloads through), and proves:
 *
 *   1. every real entry passes pre-network source validation — including
 *      wiki-vital5, whose bricking made the Encyclopedia tier uninstallable
 *      and trapped SetupWizard at step 3 (allAssetsPresent structurally
 *      impossible);
 *   2. each entry's immutability contract matches its source type
 *      (branch-pointer URLs carry a real revision pin; release assets need
 *      none because they are published artifacts);
 *   3. the gate is fail-closed for contracts it does not recognize.
 *
 * If a future catalog edit adds an entry that cannot be downloaded, this
 * test — not a user report from SetupWizard step 3 — catches it.
 */

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

function expectGateFailure(asset: Partial<CatalogModel> & { id: string; sourceUrl: string }, code: string) {
  const full: CatalogModel = {
    kind: "llm",
    label: asset.id,
    filename: `models/${asset.id}.gguf`,
    sizeBytes: 1024,
    sha256: "0".repeat(64),
    license: "test",
    description: "test",
    required: false,
    ...asset,
  } as CatalogModel;
  try {
    assertImmutableSourcePreDownload(full);
  } catch (e) {
    expect(e).toBeInstanceOf(DownloadFailure);
    expect((e as DownloadFailure).code).toBe(code);
    expect((e as DownloadFailure).kind).toBe("permanent");
    expect((e as DownloadFailure).canResume).toBe(false);
    return;
  }
  throw new Error(`expected gate to reject ${asset.id}, but it passed`);
}

describe("sourceContractOf — classification", () => {
  it("classifies the three real catalog URL shapes", () => {
    expect(
      sourceContractOf(
        "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"
      )
    ).toBe("hf-branch");
    expect(
      sourceContractOf(
        "https://raw.githubusercontent.com/rferrari/boar-app/main/assets/corpus/corpus-standard.json"
      )
    ).toBe("github-raw-branch");
    expect(
      sourceContractOf(
        "https://github.com/rferrari/boar-app/releases/download/knowledge-pack-v1/wiki-vital5.sqlite"
      )
    ).toBe("github-release-asset");
  });

  it("is fail-closed: unknown hosts, non-https, and malformed URLs are 'unknown'", () => {
    expect(sourceContractOf("https://example.com/models/x.gguf")).toBe("unknown");
    expect(sourceContractOf("http://huggingface.co/x/resolve/main/y.gguf")).toBe("unknown");
    expect(sourceContractOf("not a url at all")).toBe("unknown");
    expect(sourceContractOf("")).toBe("unknown");
    // A raw.githubusercontent URL pinned to a commit is not a recognized
    // branch-pointer contract — fail closed rather than assume.
    expect(
      sourceContractOf(
        "https://raw.githubusercontent.com/rferrari/boar-app/9898b35e92bf42984a62c62a1d5f4b5895372b27/assets/corpus/corpus-standard.json"
      )
    ).toBe("unknown");
    // HF already-pinned /resolve/<commit>/ is not the /resolve/main/
    // contract — fail closed rather than assume.
    expect(
      sourceContractOf("https://huggingface.co/x/y/resolve/deadbeef/model.gguf")
    ).toBe("unknown");
  });
});

describe("real MODEL_CATALOG — every entry passes the pre-network gate", () => {
  it("assertImmutableSourcePreDownload() accepts every catalog entry (R1: none bricked)", () => {
    expect(MODEL_CATALOG.length).toBeGreaterThan(0);
    for (const asset of MODEL_CATALOG) {
      const gate = assertImmutableSourcePreDownload(asset);
      expect(gate.contract).not.toBe("unknown");
      expect(gate.fetchUrl.startsWith("https://")).toBe(true);
    }
  });

  it("wiki-vital5 passes as a github-release-asset (the R1 regression guard)", () => {
    const wiki = MODEL_CATALOG.find((a) => a.id === "wiki-vital5");
    expect(wiki).toBeDefined();
    const gate = assertImmutableSourcePreDownload(wiki!);
    expect(gate.contract).toBe("github-release-asset");
    // No revision is applicable to a published release asset.
    expect(wiki!.revision).toBeUndefined();
    // The published asset URL is fetched exactly as declared.
    expect(gate.fetchUrl).toBe(wiki!.sourceUrl);
  });

  it("branch-pointer contracts carry a real 40-hex revision pin and the fetch URL contains no branch pointer", () => {
    for (const asset of MODEL_CATALOG) {
      const contract = sourceContractOf(asset.sourceUrl);
      if (contract === "hf-branch" || contract === "github-raw-branch") {
        expect(asset.revision, `${asset.id}: missing revision`).toMatch(COMMIT_SHA_RE);
        const gate = assertImmutableSourcePreDownload(asset);
        expect(gate.fetchUrl).toContain(asset.revision);
        expect(gate.fetchUrl).not.toContain("/resolve/main/");
        expect(gate.fetchUrl).not.toMatch(
          /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\//
        );
      }
    }
  });

  it("every entry declares integrity metadata (sha256 + positive size) — the contract is completed post-download", () => {
    for (const asset of MODEL_CATALOG) {
      expect(asset.sha256, `${asset.id}: sha256`).toMatch(SHA256_RE);
      expect(asset.sizeBytes, `${asset.id}: sizeBytes`).toBeGreaterThan(0);
    }
  });

  it("every tier's assets resolve and pass the gate — allAssetsPresent is not structurally impossible (R1)", () => {
    // Mirrors SetupWizardScreen's tier asset resolution:
    // required models + the tier's corpus packs. If any asset could not
    // pass pre-network validation, the wizard could never leave step 3.
    for (const tier of TIERS) {
      const tierAssets: CatalogModel[] = [
        ...REQUIRED_MODELS,
        ...CORPUS_CATALOG.filter((c) => (tier.corpusPackIds ?? []).includes(c.id)),
      ];
      expect(tierAssets.length).toBeGreaterThan(0);
      // Every referenced corpus pack id must exist in the catalog.
      for (const id of tier.corpusPackIds ?? []) {
        expect(
          CORPUS_CATALOG.some((c) => c.id === id),
          `tier ${tier.id}: corpus pack ${id} not in catalog`
        ).toBe(true);
      }
      for (const asset of tierAssets) {
        expect(
          () => assertImmutableSourcePreDownload(asset),
          `tier ${tier.id}: asset ${asset.id} fails pre-network validation`
        ).not.toThrow();
      }
    }
    // The encyclopedia tier specifically includes wiki-vital5 — the exact
    // composition that was bricked by the old guard.
    const encyclopedia = TIERS.find((t) => t.id === "encyclopedia");
    expect(encyclopedia).toBeDefined();
    expect(encyclopedia!.corpusPackIds).toContain("wiki-vital5");
  });
});

describe("gate fail-closed behavior (synthetic contracts)", () => {
  it("mutable HF branch-pointer URL without revision → unpinnedSource (C/F2 preserved)", () => {
    expectGateFailure(
      {
        id: "syn-hf-unpinned",
        sourceUrl:
          "https://huggingface.co/org/model/resolve/main/model.gguf",
      },
      "unpinnedSource"
    );
  });

  it("mutable raw.githubusercontent branch-pointer URL without revision → unpinnedSource", () => {
    expectGateFailure(
      {
        id: "syn-raw-unpinned",
        sourceUrl:
          "https://raw.githubusercontent.com/org/repo/main/assets/corpus.json",
      },
      "unpinnedSource"
    );
  });

  it("unknown host → unknownSourceContract, before any network", () => {
    expectGateFailure(
      { id: "syn-unknown", sourceUrl: "https://cdn.example.net/x.gguf" },
      "unknownSourceContract"
    );
  });

  it("release-asset URL without revision passes — revision is not applicable to published artifacts", () => {
    const gate = assertImmutableSourcePreDownload({
      id: "syn-release-ok",
      kind: "corpus",
      label: "syn",
      filename: "corpus/syn.sqlite",
      sizeBytes: 1024,
      sha256: "0".repeat(64),
      sourceUrl:
        "https://github.com/org/repo/releases/download/v1/data.sqlite",
      license: "test",
      description: "test",
      required: false,
    });
    expect(gate.contract).toBe("github-release-asset");
    expect(gate.fetchUrl).toBe("https://github.com/org/repo/releases/download/v1/data.sqlite");
  });
});
