/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  DownloadFailure,
  classifyHttpStatus,
  downloadFailureUserMessage,
  formatBytes,
  isSuccessfulDownloadStatus,
} from "./downloadErrors";

const base = {
  assetId: "qwen",
  bytesReceived: 1234567,
  bytesExpected: 2500000000,
};

describe("classifyHttpStatus", () => {
  it("404 → notFound / permanent", () => {
    expect(classifyHttpStatus(404)).toEqual({ code: "notFound", kind: "permanent" });
  });
  it("429 and 5xx → httpError / transient", () => {
    for (const s of [429, 500, 502, 503]) {
      expect(classifyHttpStatus(s)).toEqual({ code: "httpError", kind: "transient" });
    }
  });
  it("408 → httpError / transient", () => {
    expect(classifyHttpStatus(408)).toEqual({ code: "httpError", kind: "transient" });
  });
  it("other 4xx → httpError / permanent", () => {
    for (const s of [400, 401, 403]) {
      expect(classifyHttpStatus(s)).toEqual({ code: "httpError", kind: "permanent" });
    }
  });
  it("416 (Range Not Satisfiable) → httpError / permanent: the server cannot honor the range, so the same resume request cannot succeed", () => {
    expect(classifyHttpStatus(416)).toEqual({ code: "httpError", kind: "permanent" });
  });
});

describe("isSuccessfulDownloadStatus (C/F1)", () => {
  it("200 and 206 are success — 206 must never be classified as a failure", () => {
    expect(isSuccessfulDownloadStatus(200)).toBe(true);
    expect(isSuccessfulDownloadStatus(206)).toBe(true); // honored byte-range resume
  });
  it("every other status is a genuine failure, including other 2xx", () => {
    for (const s of [201, 204, 301, 302, 400, 404, 416, 429, 500, 503]) {
      expect(isSuccessfulDownloadStatus(s)).toBe(false);
    }
  });
});

describe("DownloadFailure honesty contract", () => {
  it("stalled keeps canResume=true (partial file + resume token are kept)", () => {
    const f = new DownloadFailure({
      ...base,
      code: "stalled",
      kind: "transient",
      canResume: true,
      extraVars: { seconds: 60 },
    });
    expect(f.canResume).toBe(true);
    expect(f.kind).toBe("transient");
    expect(f.messageKey()).toBe("downloadErrors.stalled");
  });

  it("interrupted has canResume=false (partial file is deleted, retry restarts at 0)", () => {
    const f = new DownloadFailure({
      ...base,
      code: "interrupted",
      kind: "transient",
      canResume: false,
    });
    expect(f.canResume).toBe(false);
    // …and the user message must SAY it restarts from the beginning.
    const msg = downloadFailureUserMessage(f);
    expect(msg).toMatch(/starts from the beginning/i);
    expect(msg).not.toMatch(/resume/i);
  });

  it("stalled user message DOES promise resume (because it really does)", () => {
    const f = new DownloadFailure({
      ...base,
      code: "stalled",
      kind: "transient",
      canResume: true,
      extraVars: { seconds: 60 },
    });
    expect(downloadFailureUserMessage(f)).toMatch(/resumes where it stopped/i);
  });

  it("checksumMismatch is permanent and never resumable", () => {
    const f = new DownloadFailure({
      ...base,
      code: "checksumMismatch",
      kind: "permanent",
      canResume: false,
    });
    expect(f.kind).toBe("permanent");
    expect(f.canResume).toBe(false);
  });

  it("httpError message key splits by kind", () => {
    const t = new DownloadFailure({ ...base, code: "httpError", kind: "transient", canResume: false, httpStatus: 503 });
    const p = new DownloadFailure({ ...base, code: "httpError", kind: "permanent", canResume: false, httpStatus: 403 });
    expect(t.messageKey()).toBe("downloadErrors.httpErrorTransient");
    expect(p.messageKey()).toBe("downloadErrors.httpErrorPermanent");
    expect(downloadFailureUserMessage(t)).toMatch(/may succeed later/i);
    expect(downloadFailureUserMessage(p)).toMatch(/won't help/i);
  });

  it("unpinnedSource is permanent with canResume=false — no network request was ever made", () => {
    const f = new DownloadFailure({
      ...base,
      code: "unpinnedSource",
      kind: "permanent",
      canResume: false,
    });
    expect(f.kind).toBe("permanent");
    expect(f.canResume).toBe(false);
    expect(f.messageKey()).toBe("downloadErrors.unpinnedSource");
    const msg = downloadFailureUserMessage(f);
    expect(msg).toMatch(/no network request was made/i);
    expect(msg).not.toMatch(/resume/i);
  });

  it("messageVars formats bytes readably", () => {
    const f = new DownloadFailure({ ...base, code: "stalled", kind: "transient", canResume: true });
    expect(f.messageVars()).toMatchObject({ received: "1.2 MB", expected: "2.3 GB" });
  });
});

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("handles garbage gracefully", () => {
    expect(formatBytes(NaN)).toBe("?");
    expect(formatBytes(-1)).toBe("?");
  });
});
