/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Model + corpus catalog. Every asset the app can use is declared here with
 * an expected sha256 so ModelManager can verify integrity and the total
 * footprint can be audited against the 50GB storage cap.
 *
 * `required: true` entries are the default LLM + embedding model. They are
 * NOT bundled inside the app build (that keeps the installable app small
 * and fast to build/ship — see modules/bundled-assets + plugins/withBundledModels.js
 * for an alternate fully-bundled build path, still available but not used
 * by default). Instead, on first launch the app shows a mandatory setup
 * screen (src/ui/ModelSetupScreen.tsx in "required" mode) that downloads
 * them — the ONLY time the app needs network access. Once downloaded, the
 * app works fully offline from then on, matching the bounty's "work
 * completely offline once installed" requirement (installed = app +
 * one-time model setup complete).
 *
 * `required: false` entries are optional extras a user can fetch later from
 * the same Models/Settings screen in its normal (non-blocking) mode — either
 * an alternate LLM, or a corpus pack (see TIERS below).
 */

import type { ModelCapabilities } from "../routing/types";
import { DownloadFailure } from "./downloadErrors";

export type AssetKind = "llm" | "embedding" | "corpus";
export type SetupTier = "minimum" | "standard" | "full" | "encyclopedia";

export interface CatalogModel {
  id: string;
  kind: AssetKind;
  label: string;
  /** Relative path under FileSystem.documentDirectory once installed */
  filename: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string;
  /**
   * NIDO: pinned upstream revision (commit hash) for the file behind
   * sourceUrl. Applies ONLY to branch-pointer source contracts — a
   * `/resolve/main/` (Hugging Face) or `/main/` (raw.githubusercontent.com)
   * URL can serve different bytes tomorrow, so when set, ModelManager
   * downloads from `pinnedSourceUrl()` instead. NOT applicable to
   * `github-release-asset` contracts: those are immutable publish artifacts
   * and the field is ignored for them (see SourceContract).
   */
  revision?: string;
  license: string;
  description: string;
  /** Must be downloaded before the app can be used; the default model for its kind. */
  required: boolean;
  /**
   * Ships inside the app build itself (see plugins/withBundledModels.js).
   * Not used by default — see module doc comment — but kept available.
   */
  bundled?: boolean;
  /**
   * Which adaptive-routing roles this model is hand-curated as suitable
   * for (see src/routing/types.ts's ModelCapabilities doc comment — a
   * maintainer's judgment call based on parameter count/class, not a
   * benchmark result). Absent/undefined for entries added before this field
   * existed — routing resolution must treat "no capabilities" as "not yet
   * assessed", never assume a role.
   */
  capabilities?: ModelCapabilities;
  /**
   * Transformer architecture profile for the RAM pre-flight
   * (src/inference/ramBudget.ts): layer count, GQA KV-head count and head
   * dimension drive the KV-cache term. Verified against the model's
   * config.json. When absent, the pre-flight falls back to the bundled
   * default's profile — fine for the catalog's historical entries, but every
   * model that can become the active default MUST declare it.
   */
  arch?: { nLayer: number; nKvHeads: number; headDim: number };
  /**
   * Recommended llama.cpp context length for this model. The engine uses it
   * when the caller doesn't pass an explicit nCtx (see LlamaEngine.load).
   * Smaller models ship with a smaller default: context is the second
   * biggest RAM term after the weights, and short on-device chat doesn't
   * need 4k.
   */
  defaultNCtx?: number;
  /**
   * For kind "corpus": "json" (default) is a list of documents indexed on the
   * phone after download; "sqlite-pack" is a knowledge pack built on a computer
   * (scripts/build-knowledge-pack.mjs) with its own search index and
   * embeddings, opened directly (src/rag/packs.ts).
   */
  format?: "json" | "sqlite-pack";
}

export const STORAGE_BUDGET_BYTES = 50 * 1024 * 1024 * 1024; // 50GB
export const RAM_BUDGET_BYTES = 12 * 1024 * 1024 * 1024; // 12GB

/**
 * NIDO: the URL actually fetched for an asset. If the entry pins a
 * revision, the `/resolve/main/` branch pointer (Hugging Face) or the
 * `/main/` branch pointer (raw.githubusercontent.com) is replaced with the
 * pinned commit so downloads are reproducible and match the sha256.
 */
export function pinnedSourceUrl(asset: CatalogModel): string {
  if (!asset.revision) return asset.sourceUrl;
  return asset.sourceUrl
    .replace("/resolve/main/", `/resolve/${asset.revision}/`)
    .replace(
      /^(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)main\//,
      `$1${asset.revision}/`
    );
}

/**
 * Source contracts (R1, 2026-09-28). The C/F2 immutable-source guard must
 * not treat every catalog entry identically: a Hugging Face model served
 * through a mutable branch pointer and a GitHub release asset are not the
 * same source contract.
 *
 * - "hf-branch": `huggingface.co/…/resolve/main/…` — a MUTABLE branch
 *   pointer. Immutable only when the catalog entry pins a `revision`
 *   commit; the downloader fetches `/resolve/<revision>/` instead.
 * - "github-raw-branch": `raw.githubusercontent.com/<org>/<repo>/main/…` —
 *   a MUTABLE branch pointer. Same pinning requirement as "hf-branch".
 * - "github-release-asset":
 *   `github.com/<org>/<repo>/releases/download/<tag>/<file>` — a PUBLISHED
 *   artifact. Release assets are fixed at publish time; the
 *   `/releases/download/<tag>/<file>` path cannot be silently re-pointed
 *   at different bytes the way a branch pointer can (replacing it is a
 *   deliberate, visible publish action). The catalog's sha256 — verified
 *   post-download by ModelManager for EVERY asset — completes the
 *   immutability contract, so `revision` is not applicable here.
 * - "unknown": anything else — fail closed, never downloaded.
 */
export type SourceContract =
  | "hf-branch"
  | "github-raw-branch"
  | "github-release-asset"
  | "unknown";

const HF_RESOLVE_MAIN_RE = /\/resolve\/main\//;
const RAW_GITHUB_MAIN_RE = /^\/[^/]+\/[^/]+\/main\//;
const GITHUB_RELEASE_ASSET_RE = /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/;

/**
 * Classifies a source URL into its immutability contract. Pure function —
 * the URL is the ground truth (no separate field to drift out of sync).
 * Anything unrecognized is "unknown" (fail closed).
 */
export function sourceContractOf(sourceUrl: string): SourceContract {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return "unknown";
  }
  if (url.protocol !== "https:") return "unknown";
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  if (
    (host === "huggingface.co" || host.endsWith(".huggingface.co")) &&
    HF_RESOLVE_MAIN_RE.test(path)
  ) {
    return "hf-branch";
  }
  if (host === "raw.githubusercontent.com" && RAW_GITHUB_MAIN_RE.test(path)) {
    return "github-raw-branch";
  }
  if (host === "github.com" && GITHUB_RELEASE_ASSET_RE.test(path)) {
    return "github-release-asset";
  }
  return "unknown";
}

export interface ImmutableSourceGate {
  /** The recognized source contract — never "unknown" on success. */
  readonly contract: Exclude<SourceContract, "unknown">;
  /**
   * The exact URL the downloader may fetch. For branch-pointer contracts
   * this is the revision-pinned URL (no branch pointer survives); for
   * release assets it is the sourceUrl unchanged.
   */
  readonly fetchUrl: string;
}

/**
 * The single pre-network source gate for catalog downloads (R1, 2026-09-28).
 *
 * ModelManager.downloadCatalogModel() — the path SetupWizard actually uses —
 * calls this FIRST, before any journal record or network I/O.
 *
 * - "hf-branch" / "github-raw-branch": mutable branch pointer; the entry
 *   MUST pin a `revision`, or this throws a permanent
 *   DownloadFailure("unpinnedSource") before anything is written or fetched.
 * - "github-release-asset": published artifact, immutable by host contract;
 *   no revision is applicable. The catalog sha256 (verified post-download
 *   by ModelManager like every other asset) completes the contract.
 * - anything else: throws a permanent
 *   DownloadFailure("unknownSourceContract").
 *
 * This is strictly no weaker than the old guard: it passes every asset the
 * old guard passed (pinned branch-pointer URLs), and additionally passes
 * only release-asset URLs the old guard wrongly bricked (R1). It can never
 * return a mutable branch-pointer URL for fetching.
 */
export function assertImmutableSourcePreDownload(
  asset: CatalogModel
): ImmutableSourceGate {
  const contract = sourceContractOf(asset.sourceUrl);
  if (contract === "hf-branch" || contract === "github-raw-branch") {
    if (!asset.revision) {
      throw new DownloadFailure({
        code: "unpinnedSource",
        kind: "permanent",
        canResume: false, // nothing was written; there is nothing to resume
        assetId: asset.id,
        bytesReceived: 0,
        bytesExpected: asset.sizeBytes,
        detail: `asset ${asset.id} points at a mutable branch URL with no pinned revision — refusing to download`,
      });
    }
    const fetchUrl = pinnedSourceUrl(asset);
    // Defense in depth: pinning is pointless if a branch pointer survived
    // in the exact position the revision was supposed to replace.
    if (
      HF_RESOLVE_MAIN_RE.test(fetchUrl) ||
      /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\//.test(fetchUrl)
    ) {
      throw new DownloadFailure({
        code: "unpinnedSource",
        kind: "permanent",
        canResume: false,
        assetId: asset.id,
        bytesReceived: 0,
        bytesExpected: asset.sizeBytes,
        detail: `asset ${asset.id} claims revision ${asset.revision} but a branch pointer survived in the pinned URL — refusing to download`,
      });
    }
    return { contract, fetchUrl };
  }
  if (contract === "github-release-asset") {
    return { contract, fetchUrl: asset.sourceUrl };
  }
  throw new DownloadFailure({
    code: "unknownSourceContract",
    kind: "permanent",
    canResume: false, // nothing was written; there is nothing to resume
    assetId: asset.id,
    bytesReceived: 0,
    bytesExpected: asset.sizeBytes,
    detail: `asset ${asset.id} source URL is not a recognized immutable-source contract (${asset.sourceUrl}) — refusing to download`,
  });
}

/**
 * See docs/MODELS.md for the rationale behind each pick (licensing,
 * size/RAM tradeoffs). Model checksums verified against the files fetched
 * by scripts/setup-models.sh; corpus pack checksums verified against files
 * built by scripts/build-corpus-tier.mjs and committed to this repo (hosted
 * for download via raw.githubusercontent.com — no separate server needed).
 */
export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: "phi-3.5-mini-instruct-q4km",
    kind: "llm",
    label: "Phi-3.5-mini-instruct (Q4_K_M)",
    filename: "models/primary-llm.gguf",
    sizeBytes: 2393232672,
    sha256: "e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5",
    sourceUrl:
      "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above — LFS oid verified via the HF API at
    // that commit. The downloader fetches /resolve/<revision>/, never the
    // mutable /resolve/main/ branch pointer.
    revision: "6d70da17e749a471ccb62ade694486011a75cda3",
    license: "MIT",
    description: "Powerful. Best for complex reasoning and detailed analysis. Slower, uses more storage (~2.4GB).",
    required: false,
    capabilities: { roles: ["general", "reasoning"] },
  },
  {
    id: "bge-small-en-v1.5-q8",
    kind: "embedding",
    label: "bge-small-en-v1.5 (Q8_0)",
    filename: "models/embedding.gguf",
    sizeBytes: 36806944,
    sha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
    sourceUrl:
      "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "d32f8c040ea3b516330eeb75b72bcc2d3a780ab7",
    license: "MIT",
    description: "33M, sentence embeddings for the local vector index. Default.",
    required: true,
    capabilities: { roles: ["embedding"] },
  },
  {
    id: "qwen2.5-1.5b-instruct-q4km",
    kind: "llm",
    label: "Qwen2.5-1.5B-Instruct (Q4_K_M)",
    filename: "models/qwen2.5-1.5b-instruct-q4km.gguf",
    sizeBytes: 986048768,
    sha256: "1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "9eadc66189c7641e1ddd226b8267a9119b2ce2d4",
    license: "Apache-2.0",
    description: "Fast. Perfect for daily tasks. Light and quick, stays on your device (~1.0GB).",
    required: true,
    // RAM pre-flight profile (verified against config.json): 28 layers,
    // GQA with 2 KV heads, head dim 128. Declared so estimateContextBytes
    // uses this model's real architecture instead of the fallback.
    arch: { nLayer: 28, nKvHeads: 2, headDim: 128 },
    // Real-device Phase 9 test ("whats up?" -> a long, rambling,
    // free-associated multi-question response) traced to the app's
    // hand-built "Question: ...\n\nAnswer:" prompt shape being outside
    // Qwen2.5-Instruct's own fine-tuned ChatML template — see
    // routing/types.ts's ModelCapabilities.usesChatTemplate doc comment.
    capabilities: { roles: ["fast"], usesChatTemplate: true },
  },
  {
    id: "qwen2.5-0.5b-instruct-q4km",
    kind: "llm",
    label: "Qwen2.5-0.5B-Instruct (Q4_K_M)",
    filename: "models/qwen2.5-0.5b-instruct-q4km.gguf",
    sizeBytes: 397808192,
    sha256: "6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
    // C/F2 (2026-10-05): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API at
    // that commit). The downloader fetches /resolve/<revision>/, never the
    // mutable /resolve/main/ branch pointer.
    revision: "41ba88dbac95fed2528c92514c131d73eb5a174b",
    license: "Apache-2.0",
    description:
      "Light. The fastest on-device chat, for phones with less RAM (~0.4GB). Best for quick everyday questions; weaker at complex reasoning.",
    required: false,
    // RAM pre-flight profile (verified against config.json): 24 layers,
    // GQA with 2 KV heads, head dim 64.
    arch: { nLayer: 24, nKvHeads: 2, headDim: 64 },
    // 4096 para el agent-loop: el system prompt con las 24 herramientas ocupa
    // ~2k tokens, y con n_ctx=2048 el prompt desbordaba antes de generar
    // ("Context is full" en dispositivo, T-contexto-2026-10-06). KV cache:
    // 2*24 capas*2 KV heads*64 head dim*2 bytes*4096 ≈ 48 MiB (+128 MiB de
    // cómputo); sigue cabiendo en teléfonos de gama baja con margen.
    // Qwen2.5 soporta nativamente hasta 32K, así que 4096 no es problema
    // para el modelo ni para llama.cpp/llama.rn.
    defaultNCtx: 4096,
    // Same Qwen2.5 family as the 1.5B default: same ChatML template and
    // stop sequences, so the existing prompt engineering applies unchanged.
    capabilities: { roles: ["fast"], usesChatTemplate: true },
  },
  {
    id: "qwen2.5-7b-instruct-q4km",
    kind: "llm",
    label: "Qwen2.5-7B-Instruct (Q4_K_M)",
    filename: "models/qwen2.5-7b-instruct-q4km.gguf",
    sizeBytes: 4683074240,
    sha256: "65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "8911e8a47f92bac19d6f5c64a2e2095bd2f7d031",
    license: "Apache-2.0",
    description: "Powerful. Strongest reasoning for complex tasks. Needs more resources (~4.7GB).",
    required: false,
    capabilities: { roles: ["reasoning", "verifier"] },
  },
  // Tested on a real phone (docs/DEVICE_EVALUATION.md) and offered as suggestions so users
  // don't have to search for them. No routing roles yet: they're used when picked with
  // "Select & Use" (adaptive routing off). Filenames match what the Hugging Face browser
  // saves for the same file, so a copy downloaded through search counts as installed.
  {
    id: "lfm2.5-8b-a1b-q4km",
    kind: "llm",
    label: "LFM2.5-8B-A1B (Q4_K_M)",
    filename: "models/hf-liquidai-lfm2-5-8b-a1b-gguf-lfm2-5-8b-a1b-q4-k-m-gguf.gguf",
    sizeBytes: 5155564768,
    sha256: "4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0",
    sourceUrl: "https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/main/LFM2.5-8B-A1B-Q4_K_M.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "49c14831707011e64d70b2ebd8462ba08d608434",
    license: "LFM Open License v1.0",
    description:
      "Mixture of experts: 8B total, ~1.5B active per token. Fastest in our benchmark (~15 tok/s) and the best reasoning, but it thinks before answering, so give it a bigger answer budget. ~5.2GB.",
    required: false,
  },
  {
    id: "gemma-4-e4b-it-q4_0",
    kind: "llm",
    label: "Gemma 4 E4B (QAT Q4_0)",
    filename: "models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf",
    sizeBytes: 5154941280,
    sha256: "676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee",
    sourceUrl: "https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/main/gemma-4-E4B_q4_0-it.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "4b4a2c1d584be7264f87aac328a1bc739ce81b6c",
    license: "Apache-2.0",
    description: "Private Local. Google's on-device model. Balanced performance and privacy (~5.2GB).",
    required: false,
  },
  {
    id: "corpus-standard",
    kind: "corpus",
    label: "Standard knowledge base (+1,000 topics)",
    filename: "corpus/corpus-standard.json",
    sizeBytes: 614084,
    sha256: "2aeff76db48098851e1304fb37dc8013d9facf9214395897e7e05f276f85d2ff",
    sourceUrl:
      "https://raw.githubusercontent.com/Nido007-cmyk/Nido/main/assets/packs/corpus-standard.json",
    // NIDO-hosted (Fase 2, 2026-10-05): CC BY-SA 4.0 Wikipedia content,
    // redistributed with attribution (assets/packs/ATTRIBUTION.txt).
    // Pinned to the NIDO commit whose file bytes match the sha256 above.
    // Integrity does not depend on the host: ModelManager verifies sha256
    // after download.
    revision: "d1e9cb7b1ba331c524cecdb85270e8f86954e814",
    license: "CC BY-SA 4.0 (Wikipedia)",
    description: "1,000 additional Wikipedia-derived topics for local RAG. ~600KB.",
    required: false,
  },
  {
    id: "corpus-full",
    kind: "corpus",
    label: "Full knowledge base (+4,000 topics)",
    filename: "corpus/corpus-full.json",
    sizeBytes: 2530725,
    sha256: "6d602003bb9da59200e3e55b75b9e15bb073a4b9b1357da2c2d47b2803c570be",
    sourceUrl:
      "https://raw.githubusercontent.com/Nido007-cmyk/Nido/main/assets/packs/corpus-full.json",
    // NIDO-hosted (Fase 2, 2026-10-05): CC BY-SA 4.0 Wikipedia content,
    // redistributed with attribution (assets/packs/ATTRIBUTION.txt).
    // Pinned to the NIDO commit whose file bytes match the sha256 above.
    // Integrity does not depend on the host: ModelManager verifies sha256
    // after download.
    revision: "d1e9cb7b1ba331c524cecdb85270e8f86954e814",
    license: "CC BY-SA 4.0 (Wikipedia)",
    description: "4,000 more Wikipedia-derived topics for local RAG. ~2.4MB.",
    required: false,
  },
  {
    // Built by scripts/build-knowledge-pack.mjs (docs/KNOWLEDGE_PACKS.md) and
    // published as a GitHub Release asset; too large for the repository.
    id: "wiki-vital5",
    kind: "corpus",
    format: "sqlite-pack",
    label: "Wikipedia Vital Articles (+50,000 articles)",
    filename: "corpus/wiki-vital5.sqlite",
    sizeBytes: 163647488,
    sha256: "d3b87d562baba3489f6878bf99783f50d504db94c347029771e53f6d1aecc666",
    sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v1/wiki-vital5.sqlite",
    // NIDO-hosted (Fase 2, 2026-10-05): CC BY-SA 4.0 Wikipedia content,
    // redistributed with attribution (ATTRIBUTION.txt in release assets).
    // Release assets are immutable per tag. Integrity does not depend on
    // the host: ModelManager verifies sha256 after download.
    license: "CC BY-SA 4.0 (Wikipedia)",
    description: "Introductions of Wikipedia's ~50,000 Vital Articles (level 5), searchable offline. ~164MB.",
    required: false,
  },
  // Add more tested candidates / corpus packs here later (each needs a
  // unique `id` and `filename`). They ship with `required: false` and
  // appear in the Settings screen as optional downloads.
];

export const REQUIRED_MODELS = MODEL_CATALOG.filter((m) => m.required);
export const CORPUS_CATALOG = MODEL_CATALOG.filter((m) => m.kind === "corpus");

export interface TierDefinition {
  id: SetupTier;
  label: string;
  description: string;
  /** ids of CORPUS_CATALOG entries this tier downloads, in addition to the required models. */
  corpusPackIds: string[];
}

export const TIERS: TierDefinition[] = [
  {
    id: "minimum",
    label: "Minimum",
    description: "Models only. Uses the built-in 300-topic knowledge base — no extra download.",
    corpusPackIds: [],
  },
  {
    id: "standard",
    label: "Standard",
    description: "+ 1,000 more Wikipedia-derived topics (~600KB extra download).",
    corpusPackIds: ["corpus-standard"],
  },
  {
    id: "full",
    label: "Full",
    description: "+ 5,000 more Wikipedia-derived topics total (~3MB extra download).",
    corpusPackIds: ["corpus-standard", "corpus-full"],
  },
  {
    id: "encyclopedia",
    label: "Encyclopedia",
    description: "Full, plus Wikipedia's ~50,000 Vital Articles (~164MB extra download).",
    corpusPackIds: ["corpus-standard", "corpus-full", "wiki-vital5"],
  },
];

export function totalManifestBytes(models: CatalogModel[]): number {
  return models.reduce((sum, m) => sum + m.sizeBytes, 0);
}
