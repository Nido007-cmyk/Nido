import { describe, it, expect, vi } from "vitest";
import { parseHello, buildHello, extractMac } from "./nativeTransport";

// parseHello/buildHello/extractMac are pure, but nativeTransport.ts pulls
// ./store -> agent/memory/memoryStore -> native modules at import time.
// Mock the store like nativeTransport.test.ts does to keep this a pure unit test.
vi.mock("./store", () => ({
  getIdentity: async () => null,
  getSigningKeypair: async () => null,
  findContactByPk: async () => null,
}));

const PK = "a".repeat(64);
const EPH = "b".repeat(64);
const NONCE = "c".repeat(32);
const SIG = "d".repeat(128);
const TS = 1780000000;

function helloBody(overrides: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ t: "nido-hello", v: 3, pk: PK, eph: EPH, nonce: NONCE, ts: TS, sig: SIG, ...overrides })
  );
}

describe("parseHello — malformed/adversarial inputs", () => {
  it("round-trips a locally built HELLO", () => {
    const parsed = parseHello(buildHello(PK, EPH, NONCE, TS, SIG));
    expect(parsed).toEqual({ pk: PK, eph: EPH, nonce: NONCE, ts: TS, sig: SIG });
  });

  it("rejects non-JSON without throwing a raw SyntaxError", () => {
    expect(() => parseHello(new TextEncoder().encode("not json"))).toThrow(
      "HELLO no es JSON."
    );
  });

  it("rejects an empty body", () => {
    expect(() => parseHello(new Uint8Array(0))).toThrow("HELLO no es JSON.");
  });

  it("rejects a JSON array and other non-objects", () => {
    for (const bad of ["[]", "null", "42", '"str"']) {
      expect(() => parseHello(new TextEncoder().encode(bad))).toThrow();
    }
  });

  it("rejects the wrong frame type", () => {
    expect(() => parseHello(helloBody({ t: "nido-bye" }))).toThrow(
      "HELLO de tipo desconocido."
    );
  });

  it("rejects the legacy unsigned v1 handshake with an upgrade hint", () => {
    expect(() => parseHello(helloBody({ v: 1 }))).toThrow(/actualiza su app/);
  });

  it("rejects the v2 handshake with an upgrade hint (hard cut, no compat window)", () => {
    expect(() => parseHello(helloBody({ v: 2 }))).toThrow(/actualiza su app/);
  });

  it("rejects unknown versions", () => {
    expect(() => parseHello(helloBody({ v: 99 }))).toThrow(
      "HELLO de versión desconocida."
    );
  });

  it("rejects missing or malformed ts", () => {
    for (const badTs of [undefined, null, "1780000000", 0, -5, 1.5, 2 ** 40]) {
      const { ts: _drop, ...noTs } = {
        t: "nido-hello",
        v: 3,
        pk: PK,
        eph: EPH,
        nonce: NONCE,
        ts: badTs,
        sig: SIG,
      };
      void _drop;
      const body =
        badTs === undefined
          ? new TextEncoder().encode(JSON.stringify(noTs))
          : helloBody({ ts: badTs });
      expect(() => parseHello(body)).toThrow("HELLO sin timestamp válido.");
    }
  });

  it("rejects short, long and non-hex keys", () => {
    expect(() => parseHello(helloBody({ pk: "a".repeat(63) }))).toThrow(
      "HELLO sin pk válida."
    );
    expect(() => parseHello(helloBody({ eph: "z".repeat(64) }))).toThrow(
      "HELLO sin efímera válida."
    );
    expect(() => parseHello(helloBody({ nonce: "c".repeat(31) }))).toThrow(
      "HELLO sin nonce válido."
    );
    expect(() => parseHello(helloBody({ sig: "d".repeat(127) }))).toThrow(
      "HELLO sin firma válida."
    );
  });

  it("rejects non-string key fields", () => {
    expect(() => parseHello(helloBody({ pk: 12345 }))).toThrow("HELLO sin pk válida.");
    const withPk = { t: "nido-hello", v: 3, pk: PK, eph: EPH, nonce: NONCE, ts: TS, sig: SIG };
    const { pk: _drop, ...noPk } = withPk;
    void _drop;
    expect(() => parseHello(new TextEncoder().encode(JSON.stringify(noPk)))).toThrow(
      "HELLO sin pk válida."
    );
  });

  it("accepts uppercase hex and normalizes to lowercase", () => {
    const parsed = parseHello(helloBody({ pk: "A".repeat(64) }));
    expect(parsed.pk).toBe("a".repeat(64));
  });

  it("ignores extra unknown fields instead of failing", () => {
    expect(() => parseHello(helloBody({ evil: "x".repeat(10000) }))).not.toThrow();
  });
});

describe("extractMac — alias parsing", () => {
  it("extracts a MAC from a discovery alias", () => {
    expect(extractMac("NIDO-AB:CD:EF:12:34:56")).toBe("AB:CD:EF:12:34:56");
  });

  it("uppercases lowercase MACs", () => {
    expect(extractMac("peer aa:bb:cc:dd:ee:ff")).toBe("AA:BB:CC:DD:EE:FF");
  });

  it("returns null when there is no MAC", () => {
    expect(extractMac("just a name")).toBeNull();
    expect(extractMac("")).toBeNull();
  });

  it("does not match a truncated MAC", () => {
    expect(extractMac("AB:CD:EF:12:34")).toBeNull();
  });
});
