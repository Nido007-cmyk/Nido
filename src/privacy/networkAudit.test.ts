import { describe, it, expect, beforeEach } from "vitest";
import { networkAudit, sanitizeEndpoint } from "./networkAudit";

describe("sanitizeEndpoint", () => {
  it("recorta a host + path, sin query ni fragmento", () => {
    expect(
      sanitizeEndpoint("https://huggingface.co/a/b/resolve/main/f.gguf?token=secret#x")
    ).toBe("huggingface.co/a/b/resolve/main/f.gguf");
  });

  it("tolera URLs inválidas", () => {
    expect(sanitizeEndpoint("not a url")).toBe("(invalid-url)");
  });
});

describe("networkAudit", () => {
  beforeEach(() => networkAudit.clear());

  it("empieza prístino y registra eventos", () => {
    expect(networkAudit.isPristine()).toBe(true);
    networkAudit.log({
      kind: "download_start",
      endpoint: "huggingface.co/x/y.gguf",
      assetId: "m1",
      bytesExpected: 100,
      bytesReceived: 0,
    });
    expect(networkAudit.isPristine()).toBe(false);
    const entries = networkAudit.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("download_start");
    expect(entries[0].ts).toBeTruthy();
  });

  it("nunca guarda query strings", () => {
    networkAudit.log({
      kind: "download_start",
      endpoint: sanitizeEndpoint("https://huggingface.co/a?token=abc"),
      assetId: "",
      bytesExpected: 1,
      bytesReceived: 0,
    });
    expect(networkAudit.list()[0].endpoint).not.toMatch(/token/);
  });

  it("los listeners no pueden romper el flujo auditado", () => {
    networkAudit.onEntry(() => {
      throw new Error("listener roto");
    });
    expect(() =>
      networkAudit.log({
        kind: "download_complete",
        endpoint: "h",
        assetId: "",
        bytesExpected: 1,
        bytesReceived: 1,
      })
    ).not.toThrow();
  });
});
