/**
 * nonceCache.test.ts — R4: el backend en memoria de la cache anti-replay
 * implementa la misma semántica atómica que el backend persistente
 * (SQLCipher): un claim, un dueño; el segundo claim del mismo par es
 * replay.
 */
import { describe, it, expect, vi } from "vitest";
// Este test solo ejercita el backend en memoria; el backend persistente
// (SQLCipher) se prueba en store.test.ts. Se mockea ./store para no cargar
// su cadena de dependencias nativas (memoryStore → react-native).
vi.mock("./store", () => ({
  claimHelloNonce: async () => true,
  pruneHelloNonceCache: async () => {},
}));
import { makeMemoryHelloNonceCache } from "./nonceCache";

describe("nonceCache en memoria: semántica atómica del claim", () => {
  it("claim una vez → true; segunda vez → false; prune por antigüedad", async () => {
    const cache = makeMemoryHelloNonceCache();
    const pk = "ab".repeat(32);
    const n1 = "11".repeat(16);
    const n2 = "22".repeat(16);
    expect(await cache.claim(pk, n1, 1000)).toBe(true);
    expect(await cache.claim(pk, n1, 1001)).toBe(false); // replay
    expect(await cache.claim(pk, n2, 1002)).toBe(true); // otro nonce: ok
    // Otro pk con el mismo nonce: par distinto, ok.
    expect(await cache.claim("cd".repeat(32), n1, 1003)).toBe(true);
    expect(cache.size()).toBe(3);
    await cache.prune(1002);
    expect(cache.size()).toBe(2);
    // Tras el prune, el nonce podado puede reclamarse (su HELLO ya es
    // inválido por ts de todos modos: la poda es segura por construcción).
    expect(await cache.claim(pk, n1, 2000)).toBe(true);
  });

  it("normaliza pk y nonce a minúsculas", async () => {
    const cache = makeMemoryHelloNonceCache();
    expect(await cache.claim("AB".repeat(32), "11".repeat(16), 1000)).toBe(true);
    expect(await cache.claim("ab".repeat(32), "11".repeat(16), 1001)).toBe(false);
  });
});
