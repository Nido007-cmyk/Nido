/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { networkAudit, sanitizeEndpoint } from "./networkAudit";

describe("networkAudit — log limits and eviction", () => {
  it("caps the log at 500 entries, evicting the oldest first", () => {
    for (let i = 0; i < 510; i++) {
      networkAudit.log({
        kind: "download_start",
        endpoint: `huggingface.co/model-${i}.gguf`,
        assetId: `m${i}`,
        bytesExpected: 1000,
        bytesReceived: 0,
      });
    }
    const entries = networkAudit.list();
    expect(entries).toHaveLength(500);
    // newest first: the last logged entry is on top, the first 10 are gone
    expect(entries[0].assetId).toBe("m509");
    expect(entries[entries.length - 1].assetId).toBe("m10");
    expect(entries.some((e) => e.assetId === "m0")).toBe(false);
    networkAudit.clear();
  });

  it("isPristine tracks whether any network request happened this session", () => {
    expect(networkAudit.isPristine()).toBe(true);
    networkAudit.log({
      kind: "download_failed",
      endpoint: "huggingface.co/x.gguf",
      assetId: "x",
      bytesExpected: 1,
      bytesReceived: 0,
      error: "boom",
    });
    expect(networkAudit.isPristine()).toBe(false);
    networkAudit.clear();
    expect(networkAudit.isPristine()).toBe(true);
  });

  it("clear() wipes the log (used by the delete-my-data flow)", () => {
    networkAudit.log({
      kind: "download_complete",
      endpoint: "huggingface.co/x.gguf",
      assetId: "x",
      bytesExpected: 1,
      bytesReceived: 1,
    });
    networkAudit.clear();
    expect(networkAudit.list()).toHaveLength(0);
  });
});

describe("sanitizeEndpoint — hostile inputs", () => {
  it("keeps the port but drops userinfo, query and fragment", () => {
    expect(
      sanitizeEndpoint("https://user:pass@huggingface.co:8443/a/b.gguf?token=secret#frag")
    ).toBe("huggingface.co:8443/a/b.gguf");
  });

  it("normalizes uppercase hosts", () => {
    expect(sanitizeEndpoint("HTTPS://HUGGINGFACE.CO/A/B.GGUF")).toBe(
      "huggingface.co/A/B.GGUF"
    );
  });

  it("tolerates empty and non-URL strings without leaking them", () => {
    expect(sanitizeEndpoint("")).toBe("(invalid-url)");
    expect(sanitizeEndpoint("not a url")).toBe("(invalid-url)");
  });

  it("never emits the query string that could carry tokens", () => {
    const out = sanitizeEndpoint(
      "https://cdn.example.com/f.gguf?X-Amz-Signature=supersecret&token=abc"
    );
    expect(out).not.toContain("supersecret");
    expect(out).not.toContain("?");
  });
});
