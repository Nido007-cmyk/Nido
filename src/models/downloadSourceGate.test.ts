/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// downloadSourceGate.test.ts — T-09 (0.1.99), asientos M-34 (F-02) del
// acta de auditoría 2026-11-14.
//
// La puerta de fuente validaba la FORMA de la URL (host conocido +
// puntero de rama + revisión fijada), no una lista fijada de orígenes:
// una entrada de catálogo firmada por error — o un origen retorcido que
// imitara la forma — podía apuntar a un repo de terceros que la app
// nunca aprobó, y la puerta lo dejaba pasar. Estas sondas fijan la
// cura: la puerta exige pertenencia a PINNED_SOURCE_REPOS (host exacto
// + org/repo), y el censo derivado del catálogo real debe coincidir
// con la lista fijada, sin extras y sin faltas.

import { describe, it, expect } from "vitest";
import * as manifest from "./manifest";
import {
  assertImmutableSourcePreDownload,
  MODEL_CATALOG,
  type CatalogModel,
} from "./manifest";
import { DownloadFailure } from "./downloadErrors";

const REV = "0123456789abcdef0123456789abcdef01234567";

function synthetic(partial: Partial<CatalogModel> & { id: string; sourceUrl: string }): CatalogModel {
  return {
    kind: "llm",
    label: partial.id,
    filename: `models/${partial.id}.gguf`,
    sizeBytes: 1024,
    sha256: "0".repeat(64),
    license: "test",
    description: "test",
    required: false,
    ...partial,
  } as CatalogModel;
}

function expectGateFailure(asset: CatalogModel, code: string) {
  try {
    assertImmutableSourcePreDownload(asset);
  } catch (e) {
    expect(e).toBeInstanceOf(DownloadFailure);
    expect((e as DownloadFailure).code).toBe(code);
    expect((e as DownloadFailure).kind).toBe("permanent");
    expect((e as DownloadFailure).canResume).toBe(false);
    return;
  }
  throw new Error(`expected gate to reject ${asset.id}, but it passed`);
}

describe("M-34: la puerta exige un origen fijado, no solo la forma", () => {
  it("repo HF bien formado y con revisión fijada, pero NO fijado en la lista → unknownSourceContract", () => {
    expectGateFailure(
      synthetic({
        id: "syn-hf-unpinned-repo",
        sourceUrl:
          "https://huggingface.co/attacker/FreeModels-GGUF/resolve/main/model.gguf",
        revision: REV,
      }),
      "unknownSourceContract"
    );
  });

  it("asset de release de GitHub de una org no fijada → unknownSourceContract", () => {
    expectGateFailure(
      synthetic({
        id: "syn-gh-unpinned-org",
        kind: "corpus",
        filename: "corpus/syn.sqlite",
        sourceUrl:
          "https://github.com/attacker/free-packs/releases/download/v1/data.sqlite",
      }),
      "unknownSourceContract"
    );
  });

  it("raw.githubusercontent de un repo no fijado, con revisión fijada → unknownSourceContract", () => {
    expectGateFailure(
      synthetic({
        id: "syn-raw-unpinned-repo",
        kind: "corpus",
        filename: "corpus/syn.json",
        sourceUrl:
          "https://raw.githubusercontent.com/attacker/free-packs/main/assets/corpus.json",
        revision: REV,
      }),
      "unknownSourceContract"
    );
  });

  it("subdominio que imita a huggingface.co con repo fijado → unknownSourceContract", () => {
    expectGateFailure(
      synthetic({
        id: "syn-hf-subdomain",
        sourceUrl:
          "https://mirror.huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/model.gguf",
        revision: REV,
      }),
      "unknownSourceContract"
    );
  });

  it("control: un repo fijado con su revisión pasa la puerta y la URL sale fijada al commit", () => {
    const gate = assertImmutableSourcePreDownload(
      synthetic({
        id: "syn-hf-pinned-ok",
        sourceUrl:
          "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/model.gguf",
        revision: REV,
      })
    );
    expect(gate.contract).toBe("hf-branch");
    expect(gate.fetchUrl).toBe(
      `https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/${REV}/model.gguf`
    );
  });

  it("control: el asset de release del repo propio pasa la puerta sin revisión", () => {
    const gate = assertImmutableSourcePreDownload(
      synthetic({
        id: "syn-gh-pinned-ok",
        kind: "corpus",
        filename: "corpus/syn.sqlite",
        sourceUrl:
          "https://github.com/Nido007-cmyk/Nido/releases/download/v1/data.sqlite",
      })
    );
    expect(gate.contract).toBe("github-release-asset");
  });

  it("censo: la lista fijada coincide exactamente con los orígenes del catálogo real", () => {
    const pinned = (manifest as unknown as { PINNED_SOURCE_REPOS?: Record<string, readonly string[]> })
      .PINNED_SOURCE_REPOS;
    expect(pinned, "PINNED_SOURCE_REPOS debe existir en manifest.ts").toBeDefined();
    const derived = new Map<string, Set<string>>();
    for (const asset of MODEL_CATALOG) {
      const url = new URL(asset.sourceUrl);
      const host = url.hostname.toLowerCase();
      const repo = url.pathname.split("/").filter(Boolean).slice(0, 2).join("/").toLowerCase();
      if (!derived.has(host)) derived.set(host, new Set());
      derived.get(host)!.add(repo);
    }
    const pinnedSets = new Map<string, Set<string>>();
    for (const [host, repos] of Object.entries(pinned!)) {
      pinnedSets.set(host.toLowerCase(), new Set(repos.map((r) => r.toLowerCase())));
    }
    expect(pinnedSets).toEqual(derived);
  });

  it("control: cada entrada real del catálogo sigue pasando la puerta", () => {
    for (const asset of MODEL_CATALOG) {
      const gate = assertImmutableSourcePreDownload(asset);
      expect(gate.contract).not.toBe("unknown");
      expect(gate.fetchUrl.startsWith("https://")).toBe(true);
    }
  });
});
