/**
 * Tests for P2P Pack Sharing (DR-7)
 */

import { describe, it, expect } from "vitest";
import {
  chunkCountFor,
  reassembleChunks,
  createReceiveSession,
  addChunk,
  transferProgress,
  PACK_CHUNK_SIZE,
  PackAdvertisement,
  PackChunk,
} from "./packSharing";

describe("chunkCountFor", () => {
  it("calculates chunks correctly", () => {
    expect(chunkCountFor(0)).toBe(0);
    expect(chunkCountFor(100)).toBe(1);
    expect(chunkCountFor(PACK_CHUNK_SIZE)).toBe(1);
    expect(chunkCountFor(PACK_CHUNK_SIZE + 1)).toBe(2);
    expect(chunkCountFor(PACK_CHUNK_SIZE * 3)).toBe(3);
  });
});

describe("reassembleChunks", () => {
  it("reassembles in order", () => {
    const chunks: PackChunk[] = [
      { packId: "p1", index: 0, total: 3, data: "aaa", hash: "h0" },
      { packId: "p1", index: 1, total: 3, data: "bbb", hash: "h1" },
      { packId: "p1", index: 2, total: 3, data: "ccc", hash: "h2" },
    ];
    expect(reassembleChunks(chunks)).toBe("aaabbbccc");
  });

  it("handles out-of-order chunks", () => {
    const chunks: PackChunk[] = [
      { packId: "p1", index: 2, total: 3, data: "ccc", hash: "h2" },
      { packId: "p1", index: 0, total: 3, data: "aaa", hash: "h0" },
      { packId: "p1", index: 1, total: 3, data: "bbb", hash: "h1" },
    ];
    expect(reassembleChunks(chunks)).toBe("aaabbbccc");
  });

  it("returns null for missing chunks", () => {
    const chunks: PackChunk[] = [
      { packId: "p1", index: 0, total: 3, data: "aaa", hash: "h0" },
      { packId: "p1", index: 2, total: 3, data: "ccc", hash: "h2" },
    ];
    expect(reassembleChunks(chunks)).toBeNull();
  });

  it("returns null for empty", () => {
    expect(reassembleChunks([])).toBeNull();
  });
});

describe("pack sharing session", () => {
  const adv: PackAdvertisement = {
    id: "pack1",
    name: "Test Pack",
    description: "A test",
    sizeBytes: 1000,
    hash: "abc123",
    chunkCount: 2,
    senderId: "device1",
  };

  it("creates receive session", () => {
    const session = createReceiveSession(adv, "device2");
    expect(session.packId).toBe("pack1");
    expect(session.received.size).toBe(0);
    expect(transferProgress(session)).toBe(0);
  });

  it("tracks progress", () => {
    const session = createReceiveSession(adv, "device2");
    const chunk1: PackChunk = {
      packId: "pack1",
      index: 0,
      total: 2,
      data: "aaa",
      hash: "h0",
    };
    const complete = addChunk(session, chunk1);
    expect(complete).toBe(false);
    expect(transferProgress(session)).toBe(0.5);

    const chunk2: PackChunk = {
      packId: "pack1",
      index: 1,
      total: 2,
      data: "bbb",
      hash: "h1",
    };
    const complete2 = addChunk(session, chunk2);
    expect(complete2).toBe(true);
    expect(transferProgress(session)).toBe(1);
  });

  it("rejects wrong pack ID", () => {
    const session = createReceiveSession(adv, "device2");
    const chunk: PackChunk = {
      packId: "wrong",
      index: 0,
      total: 2,
      data: "aaa",
      hash: "h0",
    };
    expect(addChunk(session, chunk)).toBe(false);
  });
});
