import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

/**
 * installReliability.test.ts — Priority 2 failure-mode coverage.
 *
 * Simulates the real-world failures behind the on-device "stuck at 96%"
 * incident: interrupted transfers, app kill mid-download, stalls, hash
 * mismatch, truncation, HTTP errors, and disk-full — against an in-memory
 * fake of expo-file-system/legacy with fault injection on the download
 * resumable.
 *
 * What each test proves is stated in its name; the suite's contract is:
 * a partial/unverified file is NEVER treated as installed, integrity
 * (size + SHA-256) is enforced before promotion, and every failure is
 * classified honestly (transient / permanent / resource) with a
 * recoverable next step.
 */

// ---------- deterministic "server" content ----------
function serverBytes(size: number, seed: number): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31 + seed) % 251;
  return b;
}
const shaOf = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ---------- controllable server + fault injection ----------
let serverSize = 0;
let serverSeed = 7;
type Behavior =
  | { kind: "ok"; status?: number } // C/F1: resume scenarios model a real 206 (Partial Content); default 200
  | { kind: "stall" }
  | { kind: "stallAfter"; bytes: number } // writes `bytes`, then stalls (pause keeps partial staging)
  | { kind: "throw"; afterBytes: number; message: string }
  | { kind: "wrongBytes" }
  | { kind: "truncate"; atBytes: number }
  | { kind: "http"; status: number };
let behavior: Behavior = { kind: "ok" };
let behaviorFor: (fileUri: string) => Behavior = () => behavior;
let sizeFor: (fileUri: string) => number = () => serverSize;const callLog: Array<"downloadAsync" | "resumeAsync" | "pauseAsync" | "createResumable"> = [];
let resumablesCreated = 0;
// URLs handed to createDownloadResumable — proves which endpoint (pinned or
// mutable) the downloader actually fetches (C/F2).
const createdResumableUrls: string[] = [];

// C/F1: track every staging/token delete the downloader performs, so tests
// can prove a successful 206 resume never discards valid staging.
const hoisted = vi.hoisted(() => ({ deletedPaths: [] as string[] }));

// ---------- in-memory filesystem ----------
const files = new Map<string, Uint8Array>();
let freeDiskBytes: number | null = 8 * 1024 ** 3;
const te = new TextEncoder();
const td = new TextDecoder();

class FakeResumable {
  private paused = false;
  private stallGate: (() => void) | null = null;
  private resumeData?: string;
  constructor(
    private url: string,
    private fileUri: string,
    private options: any,
    private cb: ((d: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) | undefined,
    resumeData?: string
  ) {
    this.resumeData = resumeData;
    resumablesCreated++;
    callLog.push("createResumable");
    createdResumableUrls.push(url);
  }
  async pauseAsync() {
    callLog.push("pauseAsync");
    this.paused = true;
    this.resumeData = `resume-token:${this.fileUri}`;
    this.stallGate?.();
  }
  savable() {
    return {
      url: this.url,
      fileUri: this.fileUri,
      options: this.options ?? {},
      resumeData: this.resumeData,
    };
  }
  async resumeAsync(): Promise<{ uri: string; status: number } | undefined> {
    callLog.push("resumeAsync");
    return this.run(true);
  }
  async downloadAsync(): Promise<{ uri: string; status: number } | undefined> {
    callLog.push("downloadAsync");
    return this.run(false);
  }
  private async run(isResume: boolean): Promise<{ uri: string; status: number } | undefined> {
    // Behavior is read fresh on every run: a retry reuses the same resumable
    // instance (genuine resume), while the test's fault injection can change
    // between attempts.
    const b = behaviorFor(this.fileUri);
    // resumeAsync re-arms a paused resumable — like the native implementation.
    this.paused = false;
    if (b.kind === "http") return { uri: this.fileUri, status: b.status };
    if (b.kind === "stall") {
      // Native downloadAsync creates the destination file before stalling;
      // it just never progresses. The partial (possibly empty) file is kept.
      files.set(this.fileUri, new Uint8Array(0));
      // Never progresses; resolves undefined only when pauseAsync fires
      // (the inactivity timer), mirroring the native pause path.
      await new Promise<void>((resolve) => {
        this.stallGate = () => resolve();
      });
      return undefined;
    }
    const totalSize = sizeFor(this.fileUri);
    const seed = b.kind === "wrongBytes" ? serverSeed + 1 : serverSeed;
    const content = serverBytes(totalSize, seed);
    let written = 0;
    if (isResume && this.resumeData) {
      written = files.get(this.fileUri)?.length ?? 0;
    } else {
      files.set(this.fileUri, new Uint8Array(0));
    }
    const CHUNK = 256;
    const limit = b.kind === "truncate" ? Math.min(b.atBytes, totalSize) : totalSize;
    const stallAt = b.kind === "stallAfter" ? b.bytes : Infinity;
    while (written < limit) {
      if (this.paused) return undefined;
      if (written >= stallAt) {
        // Reached the stall point: stop progressing and wait for pauseAsync,
        // like a connection that goes quiet mid-transfer.
        await new Promise<void>((resolve) => {
          this.stallGate = () => resolve();
        });
        return undefined;
      }
      const step = Math.min(CHUNK, limit - written);
      const cur = files.get(this.fileUri) ?? new Uint8Array(0);
      const next = new Uint8Array(written + step);
      next.set(cur.subarray(0, Math.min(cur.length, written + step)));
      next.set(content.subarray(written, written + step), written);
      files.set(this.fileUri, next);
      written += step;
      this.cb?.({ totalBytesWritten: written, totalBytesExpectedToWrite: serverSize });
      if (b.kind === "throw" && written >= b.afterBytes) throw new Error(b.message);
      await new Promise((r) => setTimeout(r, 0));
    }
    // C/F1: the fake models a real server — a resumed transfer the server
    // honors resolves with 206 (Partial Content), not 200. The status is
    // explicit per scenario; nothing here forces 200.
    return { uri: this.fileUri, status: b.kind === "ok" ? b.status ?? 200 : 200 };
  }
}

vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: "file:///docs/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: vi.fn(async (path: string) => {
    const b = files.get(path);
    return b
      ? { exists: true, isDirectory: false, size: b.length }
      : { exists: false, isDirectory: false, size: 0 };
  }),
  readAsStringAsync: vi.fn(async (path: string, opts?: any) => {
    const b = files.get(path);
    if (!b) throw new Error(`not found: ${path}`);
    if (opts?.encoding === "base64") {
      const pos = opts.position ?? 0;
      const len = opts.length ?? b.length - pos;
      return Buffer.from(b.subarray(pos, pos + len)).toString("base64");
    }
    return td.decode(b);
  }),
  writeAsStringAsync: vi.fn(async (path: string, content: string) => {
    files.set(path, te.encode(content));
  }),
  deleteAsync: vi.fn(async (path: string) => {
    hoisted.deletedPaths.push(path);
    files.delete(path);
  }),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    const b = files.get(from);
    if (!b) throw new Error(`move: not found ${from}`);
    files.delete(from);
    files.set(to, b);
  }),
  makeDirectoryAsync: vi.fn(async () => {}),
  getFreeDiskStorageAsync: vi.fn(async () => {
    if (freeDiskBytes === null) throw new Error("unknown");
    return freeDiskBytes;
  }),
  readDirectoryAsync: vi.fn(async (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const names: string[] = [];
    for (const k of files.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        if (rest && !rest.includes("/")) names.push(rest);
      }
    }
    return names;
  }),
  createDownloadResumable: (
    url: string,
    fileUri: string,
    options: any,
    cb: ((d: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) | undefined,
    resumeData?: string
  ) => new FakeResumable(url, fileUri, options, cb, resumeData),
}));

vi.mock("bundled-assets", () => ({ copyBundledAssetToFile: async () => 0 }));
vi.mock("../privacy/networkAudit", () => ({
  networkAudit: { log: () => {} },
  sanitizeEndpoint: (u: string) => u,
}));

import {
  ModelManager,
  stagingPathFor,
  resumeTokenPathFor,
  resetInstallReconcileForTests,
  DownloadProgress,
} from "./ModelManager";
import { getInstallRecord, recordInstall } from "./installState";
import { DownloadFailure, downloadFailureUserMessage } from "./downloadErrors";
import type { CatalogModel } from "./manifest";

const DOC = "file:///docs/";
const finalPath = (id: string) => `${DOC}models/${id}.gguf`;

function makeAsset(id: string, size: number, seed = 7): CatalogModel {
  return {
    id,
    kind: "llm",
    label: id,
    filename: `models/${id}.gguf`,
    sizeBytes: size,
    sha256: shaOf(serverBytes(size, seed)),
    sourceUrl: "https://huggingface.co/test-org/test-model/resolve/main/test.gguf",
    // C/F2: test assets are pinned by default so the downloader gate passes;
    // the unpinned-source test builds its asset without this field.
    // R1 (2026-09-28): the default URL must be a recognized source contract
    // (here: an hf-branch URL with a revision pin), since the pre-network
    // gate is fail-closed for unknown contracts.
    revision: "0123456789abcdef0123456789abcdef01234567",
    license: "test",
    description: "test",
    required: false,
  };
}

function newManager(catalog: CatalogModel[]) {
  // Short inactivity timeout keeps the stall test fast; production uses 60s.
  return new ModelManager(catalog, { inactivityTimeoutMs: 150 });
}

async function expectDownloadFailure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DownloadFailure);
    return e as DownloadFailure;
  }
  throw new Error("expected download to fail, but it succeeded");
}

beforeEach(() => {
  files.clear();
  callLog.length = 0;
  resumablesCreated = 0;
  createdResumableUrls.length = 0;
  hoisted.deletedPaths.length = 0;
  behavior = { kind: "ok" };
  behaviorFor = () => behavior;
  sizeFor = () => serverSize;
  freeDiskBytes = 8 * 1024 ** 3;
  serverSeed = 7;
  resetInstallReconcileForTests();
});

describe("interrupted download", () => {
  it("transfer throwing mid-write → interrupted/transient, staging deleted, final never created", async () => {
    const asset = makeAsset("dl-interrupt", 4096);
    serverSize = 4096;
    behavior = { kind: "throw", afterBytes: 1024, message: "socket hang up" };
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("interrupted");
    expect(f.kind).toBe("transient");
    expect(f.canResume).toBe(false);
    expect(files.has(stagingPathFor(asset))).toBe(false);
    expect(files.has(finalPath("dl-interrupt"))).toBe(false);
    expect((await getInstallRecord(asset.id))?.status).toBe("failed");

    // Retry converges to exactly one verified artifact.
    behavior = { kind: "ok" };
    await mgr.downloadCatalogModel(asset);
    expect(files.has(finalPath("dl-interrupt"))).toBe(true);
    expect(shaOf(files.get(finalPath("dl-interrupt"))!)).toBe(asset.sha256);
    expect((await getInstallRecord(asset.id))?.status).toBe("installed");
    const st = await mgr.statusOf(asset);
    expect(st.present).toBe(true);
    expect(st.checksumOk).toBe(true);
  });

  it("interrupted user message honestly says retry starts from the beginning", async () => {
    const asset = makeAsset("dl-interrupt-msg", 2048);
    serverSize = 2048;
    behavior = { kind: "throw", afterBytes: 512, message: "connection reset" };
    const mgr = newManager([asset]);
    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    const msg = downloadFailureUserMessage(f);
    expect(msg).toMatch(/starts from the beginning/i);
    expect(msg).not.toMatch(/resume/i);
  });
});

describe("stalled download (inactivity timeout)", () => {
  it("stall after partial bytes → stalled/transient, canResume=true; staging kept; resume token persisted", async () => {
    const asset = makeAsset("dl-stall", 4096);
    serverSize = 4096;
    behavior = { kind: "stallAfter", bytes: 1024 };
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("stalled");
    expect(f.kind).toBe("transient");
    expect(f.canResume).toBe(true);
    expect(f.bytesReceived).toBe(1024); // honest byte accounting, not 0
    // Partial staging bytes are kept, nothing promoted, resume token on disk.
    const staged = files.get(stagingPathFor(asset));
    expect(staged?.length).toBe(1024);
    expect(files.has(finalPath("dl-stall"))).toBe(false);
    const tokenRaw = td.decode(files.get(resumeTokenPathFor(asset))!);
    const token = JSON.parse(tokenRaw);
    expect(typeof token.resumeData).toBe("string");
    expect(token.resumeData.length).toBeGreaterThan(0);
    expect((await getInstallRecord(asset.id))?.status).toBe("paused");

    // Same-process retry reuses the paused resumable (resumeAsync) and
    // genuinely continues from the 1024 staged bytes.
    callLog.length = 0;
    behavior = { kind: "ok" };
    await mgr.downloadCatalogModel(asset);
    expect(callLog).toContain("resumeAsync");
    expect(callLog).not.toContain("downloadAsync");
    expect(shaOf(files.get(finalPath("dl-stall"))!)).toBe(asset.sha256);
    expect((await getInstallRecord(asset.id))?.status).toBe("installed");
    expect(files.has(resumeTokenPathFor(asset))).toBe(false); // token cleaned up
  });

  it("app killed while paused → restart restores the token and genuinely resumes", async () => {
    const asset = makeAsset("dl-stall-restart", 4096);
    serverSize = 4096;
    behavior = { kind: "stallAfter", bytes: 1024 };
    const mgr = newManager([asset]);
    await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect((await getInstallRecord(asset.id))?.status).toBe("paused");

    // "Process death": a brand-new ModelManager, empty in-memory state,
    // reconcile runs again — paused + staging + token must be KEPT.
    resetInstallReconcileForTests();
    const mgr2 = newManager([asset]);
    const st = await mgr2.statusOf(asset); // triggers reconcile
    expect(st.present).toBe(false);
    expect(files.get(stagingPathFor(asset))?.length).toBe(1024);
    expect(files.has(resumeTokenPathFor(asset))).toBe(true);

    // Next attempt rebuilds the resumable from the token and continues
    // the byte range (resumeAsync, not downloadAsync).
    callLog.length = 0;
    behavior = { kind: "ok" };
    await mgr2.downloadCatalogModel(asset);
    expect(callLog).toContain("resumeAsync");
    expect(callLog).not.toContain("downloadAsync");
    expect(shaOf(files.get(finalPath("dl-stall-restart"))!)).toBe(asset.sha256);
  });

  it("corrupt resume token → honest restart from zero, never a fake resume", async () => {
    const asset = makeAsset("dl-stall-badtoken", 4096);
    serverSize = 4096;
    behavior = { kind: "stallAfter", bytes: 1024 };
    const mgr = newManager([asset]);
    await expectDownloadFailure(mgr.downloadCatalogModel(asset));

    // Corrupt the token on disk, then "restart".
    files.set(resumeTokenPathFor(asset), te.encode("not-json{{{"));
    resetInstallReconcileForTests();
    const mgr2 = newManager([asset]);
    callLog.length = 0;
    behavior = { kind: "ok" };
    await mgr2.downloadCatalogModel(asset);
    expect(callLog).toContain("downloadAsync");
    expect(callLog).not.toContain("resumeAsync");
    expect(shaOf(files.get(finalPath("dl-stall-badtoken"))!)).toBe(asset.sha256);
  });
});

describe("HTTP 206 resume semantics (C/F1)", () => {
  it("resume + HTTP 206 → continues to completion: staging kept, size+SHA-256 verified, promoted", async () => {
    const asset = makeAsset("dl-resume-206", 4096);
    serverSize = 4096;
    behavior = { kind: "stallAfter", bytes: 1024 };
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("stalled");
    expect(f.canResume).toBe(true);

    // The server honors the byte-range resume: native resumeAsync resolves
    // with 206 (Partial Content) — modeled explicitly here, never forced
    // to 200. This is the C/F1 scenario: a 206 must be treated as success.
    callLog.length = 0;
    behavior = { kind: "ok", status: 206 };
    await mgr.downloadCatalogModel(asset);
    expect(callLog).toContain("resumeAsync");
    expect(callLog).not.toContain("downloadAsync");
    expect(shaOf(files.get(finalPath("dl-resume-206"))!)).toBe(asset.sha256);
    expect((await getInstallRecord(asset.id))?.status).toBe("installed");
  });

  it("valid staging is never deleted on a successful 206 resume", async () => {
    const asset = makeAsset("dl-206-nodiscard", 4096);
    serverSize = 4096;
    behavior = { kind: "stallAfter", bytes: 1024 };
    const mgr = newManager([asset]);
    await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(files.get(stagingPathFor(asset))?.length).toBe(1024);

    // Watch every delete from here on: a successful 206 must never discard
    // the staging file — only the atomic promote (moveAsync) takes it away.
    hoisted.deletedPaths.length = 0;
    const staged = stagingPathFor(asset);
    callLog.length = 0;
    behavior = { kind: "ok", status: 206 };
    await mgr.downloadCatalogModel(asset);
    expect(hoisted.deletedPaths).not.toContain(staged);
    expect(callLog).not.toContain("createResumable"); // genuine resume, no restart-from-zero
    expect(shaOf(files.get(finalPath("dl-206-nodiscard"))!)).toBe(asset.sha256);
  });

  it("resume + genuine 4xx/5xx → honest failure: staging deleted, canResume=false, correct kind", async () => {
    const asset = makeAsset("dl-resume-503", 4096);
    serverSize = 4096;
    behavior = { kind: "stallAfter", bytes: 1024 };
    const mgr = newManager([asset]);
    await expectDownloadFailure(mgr.downloadCatalogModel(asset));

    // The server refuses the resume: 503 is a genuine transient failure,
    // not a successful partial response — staging is discarded honestly.
    callLog.length = 0;
    behavior = { kind: "http", status: 503 };
    const f503 = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(callLog).toContain("resumeAsync");
    expect(f503.code).toBe("httpError");
    expect(f503.kind).toBe("transient");
    expect(f503.httpStatus).toBe(503);
    expect(f503.canResume).toBe(false);
    expect(files.has(stagingPathFor(asset))).toBe(false);
    expect(files.has(finalPath("dl-resume-503"))).toBe(false);
    expect((await getInstallRecord(asset.id))?.status).toBe("failed");

    // 404 on resume → permanent, never mislabeled transient.
    const asset404 = makeAsset("dl-resume-404", 1024);
    serverSize = 1024;
    behavior = { kind: "http", status: 404 };
    const mgr2 = newManager([asset404]);
    const f404 = await expectDownloadFailure(mgr2.downloadCatalogModel(asset404));
    expect(f404.code).toBe("notFound");
    expect(f404.kind).toBe("permanent");
    expect(f404.canResume).toBe(false);
  });
});

describe("revision pinning (C/F2)", () => {
  it("asset without a pinned revision → unpinnedSource/permanent; no network attempted", async () => {
    const asset = makeAsset("dl-unpinned", 1024);
    asset.revision = undefined; // the C/F2 violation: mutable URL must not be fetched
    // R1 (2026-09-28): the unpinnedSource code is reserved for mutable
    // BRANCH-POINTER contracts. The test asset must therefore use a
    // branch-pointer URL (not example.com, which is an unknown contract).
    asset.sourceUrl =
      "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf";
    serverSize = 1024;
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("unpinnedSource");
    expect(f.kind).toBe("permanent");
    expect(f.canResume).toBe(false);
    expect(resumablesCreated).toBe(0); // refused BEFORE any network I/O
    expect(callLog).not.toContain("createResumable");
    const rec = await getInstallRecord(asset.id);
    expect(rec?.status).toBe("failed");
    expect(rec?.failureCode).toBe("unpinnedSource");
    const msg = downloadFailureUserMessage(f);
    expect(msg).toMatch(/pinned/);
    expect(msg).toMatch(/no network request was made/i);
  });

  it("unrecognized source contract → unknownSourceContract/permanent; no network attempted (fail closed)", async () => {
    const asset = makeAsset("dl-unknown-contract", 1024);
    asset.revision = undefined;
    asset.sourceUrl = "https://example.com/models/x.gguf"; // not a known immutable-source contract
    serverSize = 1024;
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("unknownSourceContract");
    expect(f.kind).toBe("permanent");
    expect(f.canResume).toBe(false);
    expect(resumablesCreated).toBe(0); // refused BEFORE any network I/O
    expect(callLog).not.toContain("createResumable");
    const rec = await getInstallRecord(asset.id);
    expect(rec?.status).toBe("failed");
    expect(rec?.failureCode).toBe("unknownSourceContract");
    const msg = downloadFailureUserMessage(f);
    expect(msg).toMatch(/recognized safe source/);
    expect(msg).toMatch(/no network request was made/i);
  });

  it("GitHub release-asset URL without revision passes the pre-network gate (R1): download reaches the network", async () => {
    // R1: wiki-vital5's contract — a published release asset is immutable
    // by host contract, so no revision is applicable. The gate must NOT
    // throw pre-network; the failure below is the mocked HTTP 404, proving
    // the downloader was genuinely reached.
    const asset = makeAsset("dl-release-asset", 1024);
    asset.revision = undefined;
    asset.sourceUrl =
      "https://github.com/rferrari/boar-app/releases/download/knowledge-pack-v1/wiki-vital5.sqlite";
    serverSize = 1024;
    behavior = { kind: "http", status: 404 };
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("notFound"); // gate passed — the mocked server answered
    expect(f.kind).toBe("permanent");
    expect(callLog).toContain("createResumable"); // network WAS attempted
    expect(createdResumableUrls).toHaveLength(1);
    expect(createdResumableUrls[0]).toBe(asset.sourceUrl); // fetched as-is: no mutable pointer to pin
  });

  it("pinned asset reaches the downloader with the immutable revision URL, never /resolve/main/", async () => {
    const asset = makeAsset("dl-pinned-url", 1024);
    asset.revision = "feedface".repeat(5); // 40-hex commit SHA
    asset.sourceUrl =
      "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf";
    serverSize = 1024;
    const mgr = newManager([asset]);
    await mgr.downloadCatalogModel(asset);
    expect(createdResumableUrls).toHaveLength(1);
    expect(createdResumableUrls[0]).toBe(
      "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/feedfacefeedfacefeedfacefeedfacefeedface/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"
    );
    expect(createdResumableUrls[0]).not.toContain("/resolve/main/");
  });
});

describe("app terminated mid-download (restart honesty)", () => {
  it("crash during transfer → reconcile discards staging, marks failed; next attempt restarts from zero", async () => {
    const asset = makeAsset("dl-crash", 4096);
    serverSize = 4096;
    const staging = stagingPathFor(asset);
    // Simulate the crash: journal left "downloading", staging bytes on disk.
    files.set(staging, serverBytes(1024, serverSeed));
    await recordInstall(asset.id, {
      status: "downloading",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      bytesWritten: 1024,
    });

    const mgr = newManager([asset]);
    const st = await mgr.statusOf(asset); // triggers reconcile
    expect(st.present).toBe(false);
    expect(files.has(staging)).toBe(false);
    const rec = await getInstallRecord(asset.id);
    expect(rec?.status).toBe("failed");
    expect(rec?.failureCode).toBe("interrupted");

    // Next attempt honestly restarts from zero (downloadAsync, fresh file).
    callLog.length = 0;
    behavior = { kind: "ok" };
    await mgr.downloadCatalogModel(asset);
    expect(callLog).toContain("downloadAsync");
    expect(callLog).not.toContain("resumeAsync");
    expect(shaOf(files.get(finalPath("dl-crash"))!)).toBe(asset.sha256);
  });

  it("crash after atomic promote but before journal write → final re-verified, never blindly trusted", async () => {
    const asset = makeAsset("dl-crash-promote", 2048);
    serverSize = 2048;
    // Move succeeded, journal write didn't: final has the right bytes.
    files.set(finalPath("dl-crash-promote"), serverBytes(2048, serverSeed));
    await recordInstall(asset.id, { status: "verifying", sizeBytes: asset.sizeBytes, sha256: asset.sha256 });

    const mgr = newManager([asset]);
    const st = await mgr.statusOf(asset);
    expect(st.present).toBe(true);
    expect(st.checksumOk).toBe(true);
    expect((await getInstallRecord(asset.id))?.status).toBe("installed");
  });

  it("crash leaving a corrupt same-size file at final path → detected and deleted, not trusted", async () => {
    const asset = makeAsset("dl-crash-corrupt", 2048);
    serverSize = 2048;
    // Torn/corrupt file with the "right" size at the final path.
    files.set(finalPath("dl-crash-corrupt"), serverBytes(2048, serverSeed + 1));
    await recordInstall(asset.id, { status: "verifying", sizeBytes: asset.sizeBytes, sha256: asset.sha256 });

    const mgr = newManager([asset]);
    const st = await mgr.statusOf(asset);
    expect(st.present).toBe(false);
    expect(files.has(finalPath("dl-crash-corrupt"))).toBe(false);
  });
});

describe("integrity enforcement", () => {
  it("SHA-256 mismatch (right size, wrong bytes) → checksumMismatch/permanent; never promoted", async () => {
    const asset = makeAsset("dl-badhash", 4096);
    serverSize = 4096;
    behavior = { kind: "wrongBytes" };
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("checksumMismatch");
    expect(f.kind).toBe("permanent");
    expect(f.canResume).toBe(false);
    expect(files.has(stagingPathFor(asset))).toBe(false);
    expect(files.has(finalPath("dl-badhash"))).toBe(false);
  });

  it("truncated file (HTTP 200, fewer bytes) → sizeMismatch/permanent; deleted", async () => {
    const asset = makeAsset("dl-trunc", 4096);
    serverSize = 4096;
    behavior = { kind: "truncate", atBytes: 1000 };
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("sizeMismatch");
    expect(f.kind).toBe("permanent");
    expect(files.has(stagingPathFor(asset))).toBe(false);
    expect(files.has(finalPath("dl-trunc"))).toBe(false);
  });

  it("HTTP 404 → notFound/permanent; HTTP 503 → httpError/transient", async () => {
    const a404 = makeAsset("dl-404", 1024);
    serverSize = 1024;
    behavior = { kind: "http", status: 404 };
    const mgr = newManager([a404]);
    const f404 = await expectDownloadFailure(mgr.downloadCatalogModel(a404));
    expect(f404.code).toBe("notFound");
    expect(f404.kind).toBe("permanent");

    const a503 = makeAsset("dl-503", 1024);
    behavior = { kind: "http", status: 503 };
    const mgr2 = newManager([a503]);
    const f503 = await expectDownloadFailure(mgr2.downloadCatalogModel(a503));
    expect(f503.code).toBe("httpError");
    expect(f503.kind).toBe("transient");
  });

  it("legacy install (size matches, no journal record) is hash-verified once before being trusted", async () => {
    const asset = makeAsset("dl-legacy", 2048);
    serverSize = 2048;
    files.set(finalPath("dl-legacy"), serverBytes(2048, serverSeed));
    const mgr = newManager([asset]);
    const st = await mgr.statusOf(asset);
    expect(st.present).toBe(true);
    expect(st.checksumOk).toBe(true);
    // …and the record prevents re-verification: second statusOf is a journal hit.
    const st2 = await mgr.statusOf(asset);
    expect(st2.present).toBe(true);
  });

  it("legacy file with wrong bytes is deleted, not trusted", async () => {
    const asset = makeAsset("dl-legacy-bad", 2048);
    files.set(finalPath("dl-legacy-bad"), serverBytes(2048, serverSeed + 1));
    const mgr = newManager([asset]);
    const st = await mgr.statusOf(asset);
    expect(st.present).toBe(false);
    expect(files.has(finalPath("dl-legacy-bad"))).toBe(false);
  });
});

describe("insufficient storage", () => {
  it("pre-flight refusal → insufficientStorage/resource; no network attempted; honest message", async () => {
    const asset = makeAsset("dl-nospace", 4096);
    serverSize = 4096;
    freeDiskBytes = 100; // far below the 4KB + margin
    const mgr = newManager([asset]);

    const f = await expectDownloadFailure(mgr.downloadCatalogModel(asset));
    expect(f.code).toBe("insufficientStorage");
    expect(f.kind).toBe("resource");
    expect(resumablesCreated).toBe(0); // refused BEFORE any network I/O
    const msg = downloadFailureUserMessage(f);
    expect(msg).toMatch(/free up space/i);
    expect(msg).not.toMatch(/network/i);
  });

  it("disk filling mid-install → insufficientStorage/resource; previously valid installs untouched", async () => {
    const good = makeAsset("dl-keepme", 2048);
    const bad = makeAsset("dl-enospc", 4096);
    serverSize = 4096;
    // A previously valid install must survive.
    files.set(finalPath("dl-keepme"), serverBytes(2048, serverSeed));
    await recordInstall(good.id, { status: "installed", sizeBytes: good.sizeBytes, sha256: good.sha256 });

    behavior = { kind: "throw", afterBytes: 1024, message: "ENOSPC: no space left on device" };
    const mgr = newManager([good, bad]);
    const f = await expectDownloadFailure(mgr.downloadCatalogModel(bad));
    expect(f.code).toBe("insufficientStorage");
    expect(f.kind).toBe("resource");
    // The good install is byte-identical and still trusted…
    expect(shaOf(files.get(finalPath("dl-keepme"))!)).toBe(good.sha256);
    expect((await mgr.statusOf(good)).present).toBe(true);
    // …and the failed asset left no staging behind.
    expect(files.has(stagingPathFor(bad))).toBe(false);
  });
});

describe("multi-asset installation", () => {
  it("middle asset fails → others intact; retry only the failed one; verified assets not redownloaded", async () => {
    const a1 = makeAsset("multi-a1", 1024);
    const a2 = makeAsset("multi-a2", 2048);
    behaviorFor = (fileUri) => (fileUri.includes("multi-a2") ? { kind: "wrongBytes" } : { kind: "ok" });
    sizeFor = (fileUri) => (fileUri.includes("multi-a1") ? 1024 : 2048);
    const mgr = newManager([a1, a2]);

    await mgr.downloadCatalogModel(a1);
    const f = await expectDownloadFailure(mgr.downloadCatalogModel(a2));
    expect(f.code).toBe("checksumMismatch");
    // a1 is installed and verified; a2 left nothing behind.
    expect(shaOf(files.get(finalPath("multi-a1"))!)).toBe(a1.sha256);
    expect(files.has(finalPath("multi-a2"))).toBe(false);

    // Retry only a2: a1 must NOT be redownloaded.
    behaviorFor = () => ({ kind: "ok" });
    resumablesCreated = 0;
    expect((await mgr.statusOf(a1)).present).toBe(true); // journal hit, no I/O
    await mgr.downloadCatalogModel(a2);
    expect(resumablesCreated).toBe(1); // only a2 fetched
    expect(shaOf(files.get(finalPath("multi-a2"))!)).toBe(a2.sha256);
  });
});

describe("progress accuracy", () => {
  it("verification phase is reported; completion is signaled by promise resolution, not progress callbacks", async () => {
    const asset = makeAsset("dl-progress", 4096);
    serverSize = 4096;
    const seen: DownloadProgress[] = [];
    const mgr = newManager([asset]);
    await mgr.downloadCatalogModel(asset, (p) => seen.push(p));
    const phases = new Set(seen.map((p) => p.phase));
    expect(phases.has("downloading")).toBe(true);
    expect(phases.has("verifying")).toBe(true);
    // No callback may claim the transfer is done while verification runs:
    // every "verifying" report belongs to hashing, and the install is only
    // complete when the promise resolves (journal "installed").
    expect(seen.filter((p) => p.phase === "verifying").length).toBeGreaterThan(0);
    expect((await getInstallRecord(asset.id))?.status).toBe("installed");
  });
});

describe("journal transitions", () => {
  it("successful install records installed with matching size+sha", async () => {
    const asset = makeAsset("dl-journal", 2048);
    serverSize = 2048;
    const mgr = newManager([asset]);
    await mgr.downloadCatalogModel(asset);
    const rec = await getInstallRecord(asset.id);
    expect(rec?.status).toBe("installed");
    expect(rec?.sizeBytes).toBe(asset.sizeBytes);
    expect(rec?.sha256).toBe(asset.sha256);
  });

  it("resume token path helper is stable and distinct from staging", () => {
    const asset = makeAsset("dl-paths", 8);
    expect(stagingPathFor(asset)).toBe(`${DOC}models/dl-paths.gguf.partial`);
    expect(resumeTokenPathFor(asset)).toBe(`${DOC}models/dl-paths.gguf.resume.json`);
  });
});
