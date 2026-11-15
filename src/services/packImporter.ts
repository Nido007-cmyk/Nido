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
 * its signed companion manifest (`<pack>.sqlite.json`) comes with it —
 * when the first selection brings the .sqlite without it, a second
 * picker asks for the manifest alone before anything is checked
 * (0.1.86: the SAF selector cannot reach the sibling file on its own,
 * and picking both files in one gesture was the only door before).
 * NOTHING is copied into corpus/ until the checks of PI-2 have all passed,
 * in this order, on the picked (cache) copies:
 *
 *   1. the manifest is present and legible;
 *   2. the file's SHA-256 is exactly the hash the manifest declares;
 *   3. the manifest proves one of our two origins (models/packImport.ts:
 *      a SALVORA PACKS Ed25519 signature, or a NIDO catalog pin);
 *   4. the file is a knowledge pack by the same meta checks openPack
 *      applies when it opens one;
 *   5. its internal schema is the one the readers query — the tables
 *      and columns of its format version, with row counts under the
 *      caps (M-35/m-91: the meta alone used to pass).
 *
 * Only then does the caller confirm (the UI shows who signed, A.3 chain 3)
 * and the file is promoted into corpus/ with a rename, never half-copied —
 * the same discipline as a catalog download (ModelManager.ts).
 *
 * The origin the door verified is recorded in a small registry inside
 * corpus/ (imported-packs.json, models/importedPacksRegistry.ts): the
 * "Signed by" mark in the list is shown only for packs this door
 * verified, and the total wipe already deletes the whole corpus/
 * directory (appReset.ts), registry included. Since M-35 the registry
 * is also the pack's pin: the engine (packs.ts) lists an imported pack
 * from its record and the open gate verifies its bytes against the
 * recorded hash, so neither a file dropped into corpus/ by anything
 * else nor a verified file rewritten afterwards opens as a pack. The
 * door also seats the pack in the install journal at promotion, so the
 * first open takes the same proven fast path as a catalog install;
 * imports from before that seat themselves on their first open, by
 * re-hash against the registry pin (the migration is the gate's slow
 * path, not a special case).
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
  validatePackSchema,
  verifyPackOrigin,
  type PackMetaSummary,
  type PackOrigin,
  type PackSchemaDescriptor,
} from "../models/packImport";
import { packFileState, sameSha, sha256OfFile } from "../models/modelTrust";
import {
  readImportedPacks,
  writeImportedPacks,
  type ImportedPackRecord,
} from "../models/importedPacksRegistry";
import { clearInstallRecord, recordInstall } from "../models/installState";
import { CORPUS_CATALOG, type CatalogModel } from "../models/manifest";
import { closePack } from "../rag/packs";
import { deletePackIndexes } from "../rag/vectorIndex";

const CORPUS_DIR = "corpus/";

export interface ImportedPackItem {
  filename: string;
  /** Display name: the pack's own meta.name when it declares one. */
  name: string;
  origin: PackOrigin;
  sizeBytes: number;
  sha256: string;
  /**
   * 0.1.87: the embedding model the pack was built with (its
   * meta.embeddingModelSha256), read when the list is built so the
   * surface can warn when it is not the active search model —
   * until now the list never carried it and no warning was
   * possible. Undefined when the pack's meta cannot be read.
   */
  embeddingModelSha256?: string;
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
// Registry of what this door verified (origin marks live here, nowhere else).
// The read/write itself lives in models/importedPacksRegistry.ts, shared
// with the engine (M-35): the same record that carries the origin mark is
// the pack's pin at open time.
// ---------------------------------------------------------------------------

/** The CatalogModel knowledgePacks() builds for an imported pack: the record is the pin. */
function importedPackModel(filename: string, record: ImportedPackRecord): CatalogModel {
  return { ...localPackModel(filename), sizeBytes: record.sizeBytes, sha256: record.sha256 };
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
 *
 * M-35/B2: existence used to be the whole check, so the mark — and the
 * literal route it feeds — survived any later rewrite of the file. The
 * mark now requires the bytes to verify against the record's hash at
 * read time (packFileState: journal fast path, one re-hash when the
 * file changed or was never seated); a manipulated pack loses the mark
 * exactly as it loses the right to open.
 */
export async function verifiedImportedPacks(): Promise<Map<string, { name: string; origin: PackOrigin }>> {
  const registry = await readImportedPacks();
  const out = new Map<string, { name: string; origin: PackOrigin }>();
  for (const [filename, record] of Object.entries(registry)) {
    if (catalogEntryForFilename(filename)) continue;
    const info = await FileSystem.getInfoAsync(`${corpusUri()}${filename}`).catch(() => null);
    if (!info?.exists || info.isDirectory) continue;
    const state = await packFileState(importedPackModel(filename, record)).catch(() => "unusable" as const);
    if (state !== "current") continue;
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
  const registry = await readImportedPacks();
  const items: ImportedPackItem[] = [];
  for (const [filename, record] of Object.entries(registry)) {
    if (catalogEntryForFilename(filename)) continue;
    const info = await FileSystem.getInfoAsync(`${corpusUri()}${filename}`).catch(() => null);
    if (!info?.exists || info.isDirectory) continue;
    // 0.1.87: la huella de embeddings del pack, de su propia meta,
    // para el aviso de otro modelo en la superficie. Una meta
    // ilegible deja el campo vacío y el aviso calla: no se afirma
    // un desajuste que no se puede leer.
    const meta = await readPackMeta(`${corpusUri()}${filename}`).catch(() => null);
    const embeddingModelSha256 = meta ? summarizePackMeta(meta)?.embeddingModelSha256 : undefined;
    items.push({
      filename,
      name: record.name,
      origin: record.origin,
      sizeBytes: info.size ?? record.sizeBytes,
      sha256: record.sha256,
      ...(embeddingModelSha256 ? { embeddingModelSha256 } : {}),
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
 * M-35/m-91: a picked file's internal schema (which tables exist, their
 * columns, and the content row counts) for the door's step 5, read with
 * the same path handling as readPackMeta. Null when the file cannot be
 * opened as a database at all; a table the PRAGMA finds no columns for
 * simply does not exist.
 */
async function readPackSchema(uri: string): Promise<PackSchemaDescriptor | null> {
  const path = uri.replace(/^file:\/\//, "");
  const slash = path.lastIndexOf("/");
  if (slash < 0) return null;
  let db: SQLite.SQLiteDatabase | null = null;
  try {
    db = await SQLite.openDatabaseAsync(path.slice(slash + 1), { useNewConnection: true }, path.slice(0, slash));
    const database = db;
    const tables: Record<string, string[]> = {};
    for (const table of ["meta", "chunks", "guides", "regions", "facts"]) {
      const cols = await database
        .getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)
        .catch(() => [] as Array<{ name: string }>);
      if (cols.length > 0) tables[table] = cols.map((c) => c.name);
    }
    const count = async (table: string): Promise<number> => {
      if (!tables[table]) return 0;
      const rows = await database
        .getAllAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
        .catch(() => [] as Array<{ n: number }>);
      return rows.length > 0 && Number.isFinite(rows[0].n) ? rows[0].n : 0;
    };
    return {
      tables,
      counts: {
        chunks: await count("chunks"),
        guides: await count("guides"),
        regions: await count("regions"),
        facts: await count("facts"),
      },
    };
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
  let manifestAsset = assets.find((a) => a.name === `${filename}.json`);
  if (!manifestAsset) {
    // 0.1.86: the first selection brought the .sqlite without its
    // manifest. The picker cannot reach the sibling file on its own
    // (SAF only grants what the user picks), so instead of rejecting
    // here, a second picker asks for the manifest alone. Only an
    // asset named exactly `<pack>.sqlite.json` counts; a cancelled
    // pick or any other file leaves the missing-manifest rejection
    // exactly as it was. The rest of the chain (parse, hash, origin,
    // meta, confirmation, promotion) is untouched: the manifest from
    // either gesture travels the same line.
    const second = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: false,
      copyToCacheDirectory: true,
    }).catch(() => null);
    if (second && !second.canceled) {
      manifestAsset = second.assets.find((a) => a.name === `${filename}.json`);
    }
    if (!manifestAsset) return { status: "rejected", reason: "missing-manifest" };
  }
  const manifestText = await FileSystem.readAsStringAsync(manifestAsset.uri).catch(() => null);
  const manifest = manifestText ? parsePackManifest(manifestText) : null;
  if (!manifest) return { status: "rejected", reason: "missing-manifest" };

  // PI-2 · 2+3 — hash, then origin (the pure core, models/packImport.ts).
  const fileSha256 = await sha256OfFile(sqliteAsset.uri).catch(() => null);
  if (!fileSha256) return { status: "rejected", reason: "damaged" };
  const originResult = verifyPackOrigin(manifest, fileSha256);
  if (!originResult.ok) return { status: "rejected", reason: originResult.reason };
  const origin = originResult.origin;

  // Auditoría 0.1.93: el nombre del archivo lo pone quien lo entrega y
  // no va atado a la firma. Un pack verificado pero RENOMBRADO con el
  // nombre de un pack del catálogo (otro pack firmado, u otro pin del
  // catálogo) habría sustituido al del catálogo en disco y se habría
  // presentado como él («presents as the catalog item it byte-for-byte
  // is»), fuera de la lista de añadidos. Un nombre del catálogo solo
  // lo puede ocupar el archivo cuya huella es la de ESA entrada.
  const catalogSlot = catalogEntryForFilename(filename);
  if (catalogSlot && !sameSha(catalogSlot.sha256, fileSha256)) {
    return { status: "rejected", reason: "hash-mismatch" };
  }

  // PI-2 · 4 — the same format acceptance openPack applies.
  const meta = await readPackMeta(sqliteAsset.uri);
  if (!meta) return { status: "rejected", reason: "damaged" };
  const summary: PackMetaSummary | null = summarizePackMeta(meta);
  if (!summary) return { status: "rejected", reason: "not-a-pack" };

  // PI-2 · 5 (M-35/m-91) — the internal schema, not just the meta: the
  // tables and columns the readers query, at least one chunk of
  // content, and the row caps. A signed file whose schema is broken
  // would pass every check above and then fail inside the app pack by
  // pack; here it is simply not a pack.
  const schema = await readPackSchema(sqliteAsset.uri);
  if (!schema || !validatePackSchema(summary.formatVersion, schema)) {
    return { status: "rejected", reason: "not-a-pack" };
  }

  // RI-3 — duplicates are defined, never silent: the same verified bytes
  // already in place are simply already imported; different verified
  // bytes under the same file name replace the old pack (an updated
  // edition), after the same confirmation as any import.
  const registry = await readImportedPacks();
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
  await writeImportedPacks(registry);
  // M-35: seat the pack in the install journal with the bytes just
  // verified, so its first open takes the gate's fast path instead of
  // paying a re-hash — the same proof a catalog install leaves. Best
  // effort like every journal write: without the seat, the first open
  // re-hashes against the registry pin and seats it then.
  const placed = await FileSystem.getInfoAsync(targetUri).catch(() => null);
  await recordInstall(model.id, {
    status: "installed",
    sizeBytes,
    sha256: fileSha256,
    ...(placed?.exists && typeof placed.modificationTime === "number"
      ? { mtimeMs: placed.modificationTime * 1000 }
      : {}),
  }).catch(() => {});
  return {
    status: "imported",
    item: { filename, name: record.name, origin, sizeBytes, sha256: fileSha256 },
  };
}

/**
 * PI-4: removing an imported pack deletes its file (it disappears from
 * the list and from search results: without its registry record it is
 * not a pack at all, M-35) and drops its origin record and its install
 * journal seat. Re-adding the same file afterwards works exactly like
 * the first time.
 */
export async function removeImportedPack(filename: string): Promise<void> {
  const model = localPackModel(filename);
  await closePack(model.id).catch(() => {});
  if (model.id !== localPackId(filename)) await closePack(localPackId(filename)).catch(() => {});
  await deletePackIndexes(model).catch(() => {});
  await FileSystem.deleteAsync(`${corpusUri()}${filename}`, { idempotent: true });
  await clearInstallRecord(model.id).catch(() => {});
  if (model.id !== localPackId(filename)) await clearInstallRecord(localPackId(filename)).catch(() => {});
  const registry = await readImportedPacks();
  if (registry[filename]) {
    delete registry[filename];
    await writeImportedPacks(registry);
  }
}
