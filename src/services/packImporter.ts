/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packImporter.ts — the signed-pack door (Pieza A, PI-1/PI-2/PI-4).
 *
 * One gesture in Settings > Knowledge Base adds a knowledge pack from a
 * file (e.g. one bought at SALVORA PACKS). The pack never travels alone:
 * its signed companion manifest (`<pack>.sqlite.json`) comes with it, and
 * NOTHING is copied into corpus/ until the checks of PI-2 have all passed,
 * in this order, on the picked (cache) copies:
 *
 *   1. the manifest is present and legible;
 *   2. the file's SHA-256 is exactly the hash the manifest declares;
 *   3. the manifest proves one of our two origins (models/packImport.ts:
 *      a SALVORA PACKS Ed25519 signature, or a NIDO catalog pin);
 *   4. the file is a knowledge pack by the same meta checks openPack
 *      applies when it opens one.
 *
 * Only then does the caller confirm (the UI shows who signed, A.3 chain 3)
 * and the file is promoted into corpus/ with a rename, never half-copied —
 * the same discipline as a catalog download (ModelManager.ts). The engine
 * accepts any pack file it finds in corpus/ (packs.ts), so this door is
 * where all of the piece's trust is earned: it is the only user-reachable
 * path that writes pack files there besides the catalog itself (whose
 * downloads are checksum-verified against the signed catalog) and the
 * friend-to-friend importer (which only installs catalog-identical bytes).
 *
 * The origin the door verified is recorded in a small registry inside
 * corpus/ (imported-packs.json): the "Signed by" mark in the list is shown
 * only for packs this door verified, and the total wipe already deletes
 * the whole corpus/ directory (appReset.ts), registry included.
 *
 * Everything here is local: no network, no account, no new dependency.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import * as DocumentPicker from "expo-document-picker";
import {
  PACK_IMPORT_MAX_BYTES,
  parsePackManifest,
  summarizePackMeta,
  verifyPackOrigin,
  type PackMetaSummary,
  type PackOrigin,
} from "../models/packImport";
import { sameSha, sha256OfFile } from "../models/modelTrust";
import { CORPUS_CATALOG, type CatalogModel } from "../models/manifest";
import { closePack } from "../rag/packs";
import { deletePackIndexes } from "../rag/vectorIndex";

const CORPUS_DIR = "corpus/";
const REGISTRY_NAME = "imported-packs.json";

export interface ImportedPackItem {
  filename: string;
  /** Display name: the pack's own meta.name when it declares one. */
  name: string;
  origin: PackOrigin;
  sizeBytes: number;
  sha256: string;
}

interface ImportedPackRecord {
  origin: PackOrigin;
  sha256: string;
  sizeBytes: number;
  name: string;
  importedAt: string;
}

export type PackImportRejectionReason =
  | "missing-manifest"
  | "hash-mismatch"
  | "not-signed-by-us"
  | "not-a-pack"
  | "damaged"
  | "too-large";

export type PackImportOutcome =
  | { status: "imported"; item: ImportedPackItem }
  | { status: "already-imported"; item: ImportedPackItem }
  | { status: "cancelled" }
  | { status: "rejected"; reason: PackImportRejectionReason };

const corpusUri = () => `${FileSystem.documentDirectory}${CORPUS_DIR}`;
const registryUri = () => `${corpusUri()}${REGISTRY_NAME}`;
/** The id knowledgePacks() gives a non-catalog pack file (packs.ts). */
const localPackId = (filename: string) => `local-${filename.replace(/\.sqlite$/, "")}`;

function catalogEntryForFilename(filename: string): CatalogModel | undefined {
  return CORPUS_CATALOG.find((m) => m.filename === `${CORPUS_DIR}${filename}`);
}

/** The CatalogModel knowledgePacks() fabricates for a local pack file. */
function localPackModel(filename: string): CatalogModel {
  return (
    catalogEntryForFilename(filename) ?? {
      id: localPackId(filename),
      kind: "corpus",
      format: "sqlite-pack",
      label: filename,
      filename: `${CORPUS_DIR}${filename}`,
      sizeBytes: 0,
      sha256: "",
      sourceUrl: "",
      license: "",
      description: "",
      required: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Registry of what this door verified (origin marks live here, nowhere else)
// ---------------------------------------------------------------------------

async function readRegistry(): Promise<Record<string, ImportedPackRecord>> {
  try {
    const text = await FileSystem.readAsStringAsync(registryUri());
    const parsed = JSON.parse(text) as { packs?: Record<string, ImportedPackRecord> };
    if (parsed && typeof parsed === "object" && parsed.packs && typeof parsed.packs === "object") {
      return parsed.packs;
    }
  } catch {
    // No registry yet (or unreadable): no pack carries an origin mark.
  }
  return {};
}

async function writeRegistry(packs: Record<string, ImportedPackRecord>): Promise<void> {
  await FileSystem.makeDirectoryAsync(corpusUri(), { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(registryUri(), JSON.stringify({ version: 1, packs }));
}

/**
 * Packs the door verified, keyed by the id knowledgePacks() gives them
 * (`local-<file base>`), for readers that need the origin mark without the
 * list's presentation rules (e.g. the literal guide route in
 * rag/guideAnswerRun.ts, which serves a verified imported pack's guides
 * word for word like the built-in first-aid packs). A pack recorded under
 * a catalog file name presents as the catalog item, never as an import,
 * so it is not reported here; a record whose file is gone is stale and
 * is not reported either.
 */
export async function verifiedImportedPacks(): Promise<Map<string, { name: string; origin: PackOrigin }>> {
  const registry = await readRegistry();
  const out = new Map<string, { name: string; origin: PackOrigin }>();
  for (const [filename, record] of Object.entries(registry)) {
    if (catalogEntryForFilename(filename)) continue;
    const info = await FileSystem.getInfoAsync(`${corpusUri()}${filename}`).catch(() => null);
    if (!info?.exists || info.isDirectory) continue;
    out.set(localPackId(filename), { name: record.name, origin: record.origin });
  }
  return out;
}

/**
 * Packs this door imported and verified, still on disk. A pack whose file
 * name is a catalog file name is NOT listed here: it presents as the
 * catalog item it byte-for-byte is, in the downloadable packs list.
 */
export async function listImportedPacks(): Promise<ImportedPackItem[]> {
  const registry = await readRegistry();
  const items: ImportedPackItem[] = [];
  for (const [filename, record] of Object.entries(registry)) {
    if (catalogEntryForFilename(filename)) continue;
    const info = await FileSystem.getInfoAsync(`${corpusUri()}${filename}`).catch(() => null);
    if (!info?.exists || info.isDirectory) continue;
    items.push({
      filename,
      name: record.name,
      origin: record.origin,
      sizeBytes: info.size ?? record.sizeBytes,
      sha256: record.sha256,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/** Reads a picked file's meta table with the same path handling packs.ts uses. */
async function readPackMeta(uri: string): Promise<Record<string, string> | null> {
  const path = uri.replace(/^file:\/\//, "");
  const slash = path.lastIndexOf("/");
  if (slash < 0) return null;
  let db: SQLite.SQLiteDatabase | null = null;
  try {
    db = await SQLite.openDatabaseAsync(path.slice(slash + 1), { useNewConnection: true }, path.slice(0, slash));
    const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM meta");
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return null;
  } finally {
    await db?.closeAsync().catch(() => {});
  }
}

/**
 * Runs the whole gesture: pick the pack + its manifest (one selection,
 * both files — the store's download brings them side by side), verify,
 * confirm, promote. `confirm` is the UI's chain-3 dialog: it receives the
 * verified origin and resolves true only when the user accepts; nothing
 * is copied before it resolves true, and a rejection never copies either.
 */
export async function importPackFromFile(
  confirm: (origin: PackOrigin) => Promise<boolean>
): Promise<PackImportOutcome> {
  const picked = await DocumentPicker.getDocumentAsync({
    // Android's picker cannot be trusted to offer a SQLite MIME type, so
    // any file may be picked and the extensions decide (PI-1).
    type: "*/*",
    multiple: true,
    copyToCacheDirectory: true,
  }).catch(() => null);
  if (!picked || picked.canceled || picked.assets.length === 0) return { status: "cancelled" };

  const assets = picked.assets;
  const sqliteAsset = assets.find((a) => a.name.toLowerCase().endsWith(".sqlite"));
  if (!sqliteAsset) return { status: "rejected", reason: "not-a-pack" };
  const filename = sqliteAsset.name.split("/").pop() ?? sqliteAsset.name;

  // RI-2: the size cap is checked before any hashing or copying work.
  const pickedInfo = await FileSystem.getInfoAsync(sqliteAsset.uri).catch(() => null);
  const sizeBytes = sqliteAsset.size ?? (pickedInfo?.exists ? pickedInfo.size ?? 0 : 0);
  if (sizeBytes > PACK_IMPORT_MAX_BYTES) return { status: "rejected", reason: "too-large" };
  if (!pickedInfo?.exists || sizeBytes <= 0) return { status: "rejected", reason: "damaged" };

  // PI-2 · 1 — manifest present and legible.
  const manifestAsset = assets.find((a) => a.name === `${filename}.json`);
  if (!manifestAsset) return { status: "rejected", reason: "missing-manifest" };
  const manifestText = await FileSystem.readAsStringAsync(manifestAsset.uri).catch(() => null);
  const manifest = manifestText ? parsePackManifest(manifestText) : null;
  if (!manifest) return { status: "rejected", reason: "missing-manifest" };

  // PI-2 · 2+3 — hash, then origin (the pure core, models/packImport.ts).
  const fileSha256 = await sha256OfFile(sqliteAsset.uri).catch(() => null);
  if (!fileSha256) return { status: "rejected", reason: "damaged" };
  const originResult = verifyPackOrigin(manifest, fileSha256);
  if (!originResult.ok) return { status: "rejected", reason: originResult.reason };
  const origin = originResult.origin;

  // PI-2 · 4 — the same format acceptance openPack applies.
  const meta = await readPackMeta(sqliteAsset.uri);
  if (!meta) return { status: "rejected", reason: "damaged" };
  const summary: PackMetaSummary | null = summarizePackMeta(meta);
  if (!summary) return { status: "rejected", reason: "not-a-pack" };

  // RI-3 — duplicates are defined, never silent: the same verified bytes
  // already in place are simply already imported; different verified
  // bytes under the same file name replace the old pack (an updated
  // edition), after the same confirmation as any import.
  const registry = await readRegistry();
  const targetUri = `${corpusUri()}${filename}`;
  const targetInfo = await FileSystem.getInfoAsync(targetUri).catch(() => null);
  const existing = registry[filename];
  if (existing && targetInfo?.exists && sameSha(existing.sha256, fileSha256)) {
    return {
      status: "already-imported",
      item: { filename, name: existing.name, origin: existing.origin, sizeBytes, sha256: fileSha256 },
    };
  }

  if (!(await confirm(origin))) return { status: "cancelled" };

  // Promotion at the end, by rename — a cut mid-copy leaves no pack.
  const model = localPackModel(filename);
  await closePack(model.id).catch(() => {});
  if (model.id !== localPackId(filename)) await closePack(localPackId(filename)).catch(() => {});
  if (targetInfo?.exists) {
    await deletePackIndexes(model).catch(() => {});
    await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {});
  }
  await FileSystem.makeDirectoryAsync(corpusUri(), { intermediates: true }).catch(() => {});
  await FileSystem.moveAsync({ from: sqliteAsset.uri, to: targetUri });

  const record: ImportedPackRecord = {
    origin,
    sha256: fileSha256,
    sizeBytes,
    name: summary.name ?? (typeof manifest.id === "string" ? manifest.id : filename),
    importedAt: new Date().toISOString(),
  };
  registry[filename] = record;
  await writeRegistry(registry);
  return {
    status: "imported",
    item: { filename, name: record.name, origin, sizeBytes, sha256: fileSha256 },
  };
}

/**
 * PI-4: removing an imported pack deletes its file (it disappears from the
 * list and from search results, since the engine only searches files that
 * exist) and drops its origin record. Re-adding the same file afterwards
 * works exactly like the first time.
 */
export async function removeImportedPack(filename: string): Promise<void> {
  const model = localPackModel(filename);
  await closePack(model.id).catch(() => {});
  if (model.id !== localPackId(filename)) await closePack(localPackId(filename)).catch(() => {});
  await deletePackIndexes(model).catch(() => {});
  await FileSystem.deleteAsync(`${corpusUri()}${filename}`, { idempotent: true });
  const registry = await readRegistry();
  if (registry[filename]) {
    delete registry[filename];
    await writeRegistry(registry);
  }
}
