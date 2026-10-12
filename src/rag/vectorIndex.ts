/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Full vector search over a knowledge pack, through the native nido-vectors
 * module (modules/nido-vectors). Needed for multilingual search: a Spanish
 * question shares no keywords with an English article, so the keyword-first
 * pack search (FTS5 candidates, then vectors) can never find it.
 *
 * The first time a pack is used, its int8 vectors are copied once into a
 * flat index file next to it (`corpus/<pack>.<key>.nvi`, ~44 MB for the
 * Vital pack). Until that file exists, callers fall back to the keyword-first
 * search, so nothing waits on it.
 *
 * Without the native module (tests, an older build) everything here reports
 * "unavailable" and the app behaves exactly as before.
 */
import * as FileSystem from "expo-file-system/legacy";
import type { CatalogModel } from "../models/manifest";

export interface PackVectorHits {
  ids: number[];
  scores: number[];
  gatedCount: number;
  gatedMin: number | null;
}

interface NativeVectors {
  buildIndex(sqlitePath: string, indexPath: string, dims: number): Promise<number>;
  search(indexPath: string, query: number[], floor: number, limit: number): Promise<PackVectorHits & { count: number }>;
  release(indexPath: string): boolean;
}

let native: NativeVectors | null | undefined;

function nativeVectors(): NativeVectors | null {
  if (native === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      native = (require("nido-vectors") as { default: NativeVectors }).default ?? null;
    } catch {
      native = null;
    }
  }
  return native;
}

/** Test hook. */
export function __setNativeVectorsForTest(n: NativeVectors | null | undefined): void {
  native = n;
  building.clear();
  ready.clear();
}

export function nativeVectorSearchAvailable(): boolean {
  return nativeVectors() !== null;
}

/** Vector size when a pack doesn't say (every NIDO pack so far: 384). */
const DEFAULT_DIMS = 384;
const building = new Map<string, Promise<string | null>>();
const ready = new Set<string>();

function stripScheme(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

/** Index file for this pack; the key changes when the pack file does. */
export function indexUriFor(pack: CatalogModel, packSizeBytes: number): string {
  const key = (pack.sha256 || `size${packSizeBytes}`).slice(0, 16);
  return `${FileSystem.documentDirectory}${pack.filename.replace(/\.sqlite$/, "")}.${key}.nvi`;
}

async function removeIndexes(pack: CatalogModel, keep: string | null): Promise<void> {
  const fileUri = `${FileSystem.documentDirectory}${pack.filename}`;
  const slash = fileUri.lastIndexOf("/");
  const dir = fileUri.slice(0, slash + 1);
  const base = fileUri.slice(slash + 1).replace(/\.sqlite$/, "");
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  for (const n of names) {
    if (!n.startsWith(`${base}.`) || !(n.endsWith(".nvi") || n.endsWith(".nvi.tmp"))) continue;
    const uri = `${dir}${n}`;
    if (uri === keep) continue;
    nativeVectors()?.release(stripScheme(uri));
    ready.delete(uri);
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

/**
 * The pack's index if it's built; otherwise starts building it in the
 * background (once) and returns null so this question uses the fallback.
 */
export async function packIndexIfReady(
  pack: CatalogModel,
  packSizeBytes: number,
  dims: number = DEFAULT_DIMS
): Promise<string | null> {
  const n = nativeVectors();
  if (!n) return null;
  const uri = indexUriFor(pack, packSizeBytes);
  if (ready.has(uri)) return uri;
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    ready.add(uri);
    return uri;
  }
  void buildPackIndex(pack, packSizeBytes, dims);
  return null;
}

/** Builds (once) the pack's index; resolves to its uri, or null if it failed. */
export function buildPackIndex(
  pack: CatalogModel,
  packSizeBytes: number,
  dims: number = DEFAULT_DIMS
): Promise<string | null> {
  const n = nativeVectors();
  if (!n) return Promise.resolve(null);
  const uri = indexUriFor(pack, packSizeBytes);
  const pending = building.get(uri);
  if (pending) return pending;
  const job = (async () => {
    try {
      await removeIndexes(pack, null);
      const packPath = stripScheme(`${FileSystem.documentDirectory}${pack.filename}`);
      await n.buildIndex(packPath, stripScheme(uri), dims);
      ready.add(uri);
      return uri;
    } catch (e) {
      console.warn(`[vectorIndex] ${pack.id}: index build failed:`, e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      building.delete(uri);
    }
  })();
  building.set(uri, job);
  return job;
}

/** Forgets every mapped index (packs closed, app reset): the next search re-checks the files. */
export function releaseAllIndexes(): void {
  const n = nativeVectors();
  for (const uri of ready) n?.release(stripScheme(uri));
  ready.clear();
}

/** Deletes a pack's index files (when the pack is removed). */
export async function deletePackIndexes(pack: CatalogModel): Promise<void> {
  await removeIndexes(pack, null);
}

export async function searchPackIndex(
  indexUri: string,
  queryVec: Float32Array,
  floor: number,
  limit: number
): Promise<PackVectorHits | null> {
  const n = nativeVectors();
  if (!n) return null;
  return n.search(stripScheme(indexUri), Array.from(queryVec), floor, limit);
}

/** Disk used by pack vector indexes (corpus/*.nvi), for the storage breakdown. */
export async function vectorIndexBytes(): Promise<number> {
  const dir = `${FileSystem.documentDirectory}corpus/`;
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  let total = 0;
  for (const n of names) {
    if (!n.endsWith(".nvi")) continue;
    const info = await FileSystem.getInfoAsync(`${dir}${n}`).catch(() => null);
    if (info?.exists) total += (info as { size?: number }).size ?? 0;
  }
  return total;
}
