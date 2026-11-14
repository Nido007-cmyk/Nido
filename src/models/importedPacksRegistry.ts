/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * importedPacksRegistry.ts — the registry of packs the signed door
 * verified (`corpus/imported-packs.json`), shared by the door
 * (services/packImporter.ts, which writes it) and the engine
 * (rag/packs.ts, which reads it).
 *
 * M-35 (auditoría 2026-11-13, carril 07 · F-03/B2): this registry is the
 * ONLY thing that makes a non-catalog file in corpus/ a pack. Each
 * record carries the SHA-256 and size the door verified at import, and
 * that pair is the pack's pin: knowledgePacks() builds the pack's
 * catalog-shaped entry from it, and the open gate (modelTrust's
 * packFileState) verifies the bytes against it exactly like a catalog
 * pin. A `.sqlite` file with no record here is not a pack — being
 * present in the directory proves nothing, the same rule the GGUF gate
 * applies to models (no pin, not usable).
 *
 * The file format is the one the door has written since Pieza A
 * ({ version: 1, packs: { [filename]: record } }); records written by
 * older versions keep working unchanged — the pin was always recorded,
 * it just was never consulted at open time before M-35.
 */
import * as FileSystem from "expo-file-system/legacy";
import type { PackOrigin } from "./packImport";

export const IMPORTED_PACKS_REGISTRY_NAME = "imported-packs.json";

export interface ImportedPackRecord {
  origin: PackOrigin;
  sha256: string;
  sizeBytes: number;
  name: string;
  importedAt: string;
}

export function importedPacksRegistryUri(): string {
  return `${FileSystem.documentDirectory}corpus/${IMPORTED_PACKS_REGISTRY_NAME}`;
}

/**
 * Every record the door left, keyed by file name. An unreadable or
 * malformed registry reads as empty: no record, no pack — the failure
 * direction is closed, never open.
 */
export async function readImportedPacks(): Promise<Record<string, ImportedPackRecord>> {
  try {
    const text = await FileSystem.readAsStringAsync(importedPacksRegistryUri());
    const parsed = JSON.parse(text) as { packs?: Record<string, ImportedPackRecord> };
    if (parsed && typeof parsed === "object" && parsed.packs && typeof parsed.packs === "object") {
      return parsed.packs;
    }
  } catch {
    // No registry yet (or unreadable): no pack carries an import record.
  }
  return {};
}

export async function writeImportedPacks(packs: Record<string, ImportedPackRecord>): Promise<void> {
  await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}corpus/`, {
    intermediates: true,
  }).catch(() => {});
  await FileSystem.writeAsStringAsync(importedPacksRegistryUri(), JSON.stringify({ version: 1, packs }));
}
