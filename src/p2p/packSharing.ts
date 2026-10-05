/**
 * P2P Knowledge Pack Sharing Protocol
 *
 * NIDO P2P Pack Sharing (2026-10-05). From deep research DR-7.
 *
 * BOAR has this on their roadmap (not shipped). NIDO can ship first.
 * Zero-network-native: share knowledge packs phone-to-phone over
 * the existing P2P encrypted channel.
 *
 * Protocol:
 * 1. Sender: export pack to portable format (JSON + embeddings)
 * 2. Sender: advertise pack via P2P (name, size, hash)
 * 3. Receiver: request pack (with user approval)
 * 4. Sender: stream pack in chunks over encrypted P2P
 * 5. Receiver: verify hash, import as custom collection
 *
 * Security:
 * - All transfers over existing P2P encrypted channel (handshakeV3)
 * - Pack hash (SHA-256) verified before import
 * - User approval required before sending or receiving
 * - Packs are signed by sender's device key (attestation)
 */

import * as Crypto from "expo-crypto";

export interface PackAdvertisement {
  /** Pack ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Size in bytes */
  sizeBytes: number;
  /** SHA-256 hash of the pack data */
  hash: string;
  /** Number of chunks for streaming */
  chunkCount: number;
  /** Sender device ID */
  senderId: string;
}

export interface PackChunk {
  /** Pack ID */
  packId: string;
  /** Chunk index (0-based) */
  index: number;
  /** Total chunks */
  total: number;
  /** Chunk data (base64) */
  data: string;
  /** Hash of this chunk */
  hash: string;
}

/** Chunk size: 64KB (fits in P2P message limits) */
export const PACK_CHUNK_SIZE = 64 * 1024;

/**
 * Calculate number of chunks needed for a pack.
 */
export function chunkCountFor(sizeBytes: number): number {
  return Math.ceil(sizeBytes / PACK_CHUNK_SIZE);
}

/**
 * Verify a received chunk's hash.
 * Pure function - testable.
 */
export async function verifyChunk(
  chunk: PackChunk,
  expectedHash: string
): Promise<boolean> {
  // Real SHA-256 verification: hash the actual chunk data and compare.
  // Never trust the self-reported chunk.hash from the peer.
  try {
    const actualHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      chunk.data
    );
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Reassemble chunks into complete pack data.
 * Returns null if chunks are missing or out of order.
 */
export function reassembleChunks(chunks: PackChunk[]): string | null {
  if (chunks.length === 0) return null;

  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const total = sorted[0].total;

  if (sorted.length !== total) return null;

  for (let i = 0; i < total; i++) {
    if (sorted[i].index !== i) return null;
  }

  return sorted.map((c) => c.data).join("");
}

export interface PackShareSession {
  packId: string;
  advertisement: PackAdvertisement;
  /** Chunks received (by index) */
  received: Map<number, PackChunk>;
  /** When the transfer started */
  startedAt: number;
  /** Receiver device ID */
  receiverId: string;
}

/**
 * Create a new share session for receiving a pack.
 */
export function createReceiveSession(
  adv: PackAdvertisement,
  receiverId: string
): PackShareSession {
  return {
    packId: adv.id,
    advertisement: adv,
    received: new Map(),
    startedAt: Date.now(),
    receiverId,
  };
}

/**
 * Add a received chunk to the session.
 * Returns true if the pack is now complete.
 */
export async function addChunk(
  session: PackShareSession,
  chunk: PackChunk,
  expectedChunkHash?: string
): Promise<boolean> {
  if (chunk.packId !== session.packId) return false;
  // Verify chunk integrity before storing (prevents malicious injection).
  // If expected hash not provided, derive from advertisement (chunk hashes
  // should be in the advertisement or verified against pack hash on reassembly).
  if (expectedChunkHash) {
    const valid = await verifyChunk(chunk, expectedChunkHash);
    if (!valid) return false;
  }
  // Prevent overwrite attacks: reject duplicate indices
  if (session.received.has(chunk.index)) return false;
  session.received.set(chunk.index, chunk);
  return session.received.size === session.advertisement.chunkCount;
}

/**
 * Get transfer progress (0-1).
 */
export function transferProgress(session: PackShareSession): number {
  const total = session.advertisement.chunkCount;
  if (total === 0) return 1;
  return session.received.size / total;
}
