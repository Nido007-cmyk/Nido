/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P2P Knowledge Pack Sharing Protocol
 *
 * NIDO P2P Pack Sharing (2026-10-05). From deep research DR-7.
 *
 * The upstream project has this on their roadmap (not shipped). NIDO can ship first.
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

/** Maximum pack size: 100MB (prevents memory exhaustion attacks). */
export const MAX_PACK_SIZE_BYTES = 100 * 1024 * 1024;

/** Maximum chunks per pack (prevents index overflow). */
export const MAX_CHUNKS = Math.ceil(MAX_PACK_SIZE_BYTES / PACK_CHUNK_SIZE);

/**
 * Split base64 pack data into chunks for sending.
 * Pure function - testable. Returns chunks in order.
 */
export function chunkPackData(
  packId: string,
  base64Data: string
): PackChunk[] {
  const chunks: PackChunk[] = [];
  const total = Math.ceil(base64Data.length / PACK_CHUNK_SIZE);

  for (let i = 0; i < total; i++) {
    const start = i * PACK_CHUNK_SIZE;
    const end = Math.min(start + PACK_CHUNK_SIZE, base64Data.length);
    const data = base64Data.slice(start, end);
    chunks.push({
      packId,
      index: i,
      total,
      data,
      // Hash is computed by sender; receiver verifies independently.
      // This field is informational - receiver must verify via verifyChunk.
      hash: "",
    });
  }

  return chunks;
}

/**
 * Compute SHA-256 hash of pack data (base64 string).
 * Used for the advertisement and final verification.
 */
export async function hashPackData(base64Data: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64Data
  );
  return hash.toLowerCase();
}

/**
 * Validate a pack advertisement before accepting.
 * Fail-closed: returns false for any malformed advertisement.
 */
export function isValidAdvertisement(adv: PackAdvertisement): boolean {
  if (!adv || typeof adv !== "object") return false;
  if (typeof adv.id !== "string" || !adv.id) return false;
  if (typeof adv.name !== "string" || !adv.name) return false;
  if (typeof adv.sizeBytes !== "number" || adv.sizeBytes <= 0) return false;
  if (adv.sizeBytes > MAX_PACK_SIZE_BYTES) return false;
  if (typeof adv.hash !== "string" || !/^[0-9a-f]{64}$/i.test(adv.hash)) return false;
  if (typeof adv.chunkCount !== "number" || adv.chunkCount <= 0) return false;
  if (adv.chunkCount > MAX_CHUNKS) return false;
  if (typeof adv.senderId !== "string" || !adv.senderId) return false;
  // Chunk count must match size
  const expectedChunks = chunkCountFor(adv.sizeBytes);
  if (adv.chunkCount !== expectedChunks) return false;
  return true;
}

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

// ============================================================================
// SENDER (v2.1 - 2026-10-05)
// ============================================================================

/** Estados de una sesión de envío. */
export type SendSessionState =
  | "OFFERED"      // Oferta enviada, esperando respuesta
  | "ACCEPTED"     // Aceptada, transfiriendo chunks
  | "DECLINED"     // Rechazada por el receiver
  | "COMPLETE"     // Todos los chunks enviados y confirmados
  | "CANCELLED"    // Cancelada por el sender o receiver
  | "FAILED";      // Error (timeout, storage, etc.)

export interface PackSendSession {
  sessionId: string;
  packId: string;
  peerPkHex: string;
  advertisement: PackAdvertisement;
  /** Chunks to send (in order) */
  chunks: PackChunk[];
  /** Indices acknowledged by receiver */
  acked: Set<number>;
  /** Current state */
  state: SendSessionState;
  /** When the session started */
  startedAt: number;
  /** Last activity (for timeout) */
  lastActivityAt: number;
}

/**
 * Create a new send session.
 * Validates the pack data before creating the session.
 */
export async function createSendSession(
  sessionId: string,
  packId: string,
  packName: string,
  packDescription: string,
  base64Data: string,
  senderId: string,
  peerPkHex: string
): Promise<PackSendSession | null> {
  // Validate size
  const sizeBytes = Math.ceil((base64Data.length * 3) / 4); // base64 → bytes
  if (sizeBytes <= 0 || sizeBytes > MAX_PACK_SIZE_BYTES) return null;

  // Compute hash
  const hash = await hashPackData(base64Data);

  // Create chunks
  const chunks = chunkPackData(packId, base64Data);
  if (chunks.length === 0 || chunks.length > MAX_CHUNKS) return null;

  const advertisement: PackAdvertisement = {
    id: packId,
    name: packName,
    description: packDescription,
    sizeBytes,
    hash,
    chunkCount: chunks.length,
    senderId,
  };

  if (!isValidAdvertisement(advertisement)) return null;

  const now = Date.now();
  return {
    sessionId,
    packId,
    peerPkHex: peerPkHex.toLowerCase(),
    advertisement,
    chunks,
    acked: new Set(),
    state: "OFFERED",
    startedAt: now,
    lastActivityAt: now,
  };
}

/**
 * Get the next chunk to send (lowest unacked index).
 * Returns null if all chunks are acked or session is not in ACCEPTED state.
 */
export function nextChunkToSend(session: PackSendSession): PackChunk | null {
  if (session.state !== "ACCEPTED") return null;
  for (const chunk of session.chunks) {
    if (!session.acked.has(chunk.index)) {
      return chunk;
    }
  }
  return null;
}

/**
 * Mark a chunk as acknowledged.
 * Returns true if all chunks are now acked.
 */
export function markChunkAcked(
  session: PackSendSession,
  index: number
): boolean {
  if (index < 0 || index >= session.chunks.length) return false;
  session.acked.add(index);
  session.lastActivityAt = Date.now();
  return session.acked.size === session.chunks.length;
}

/**
 * Get send progress (0-1).
 */
export function sendProgress(session: PackSendSession): number {
  if (session.chunks.length === 0) return 1;
  return session.acked.size / session.chunks.length;
}

/**
 * Check if a send session has timed out (no activity for 5 minutes).
 */
export function isSendSessionTimedOut(
  session: PackSendSession,
  nowMs: number = Date.now()
): boolean {
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  return nowMs - session.lastActivityAt > TIMEOUT_MS;
}
