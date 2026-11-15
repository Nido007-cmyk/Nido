/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * modelTrustLoadPath.test.ts — regresión de la reversa 0.1.102
 * (orden del dueño, 2026-11-15): la carga vuelve a comportarse como
 * en la 0.1.98.
 *
 * La vara que fija este test: con un diario heredado de la era 0.1.98
 * (registro «installed» con tamaño, huella y mtime verificados en la
 * instalación, SIN hechos estructurales de ninguna clase), la puerta
 * de carga fía y resuelve SIN leer ni un solo byte del fichero del
 * modelo y SIN esperar ni agendar verificación alguna.
 *
 * En la 0.1.100/0.1.101 esta misma puerta recorría la cabecera GGUF
 * del fichero antes de fiar (lecturas base64 de la ruta del modelo) y
 * agendaba una adopción en segundo plano que re-hasheaba el fichero
 * entero compitiendo con la carga en el único hilo JS: en la tablet
 * del dueño la carga no terminaba nunca y la interfaz respondía con
 * retraso. La verificación completa vive en la instalación (descarga
 * e importador la ejecutan antes de anotar «installed»), como en la
 * 0.1.98; la carga no paga ninguna verificación.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Mock filesystem (mismo patrón que modelTrust.test.ts): el estado vive
// en vi.hoisted() y cada lectura base64 de una ruta queda registrada —
// leer bytes del fichero del modelo ES hashear o recorrer su cabecera.
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const td = new TextDecoder();
  const te = new TextEncoder();
  const DOCS = "file:///docs/";
  const JOURNAL = `${DOCS}nido-install-state.json`;
  interface MockFile {
    /** Bytes servidos en lecturas (la cabecera basta: nadie debe leer). */
    bytes: Uint8Array;
    /** Tamaño que getInfoAsync declara (puede ser el real del catálogo). */
    size: number;
    mtimeSec: number;
  }
  const files = new Map<string, MockFile>();
  const base64Reads: string[] = [];
  return {
    td,
    te,
    DOCS,
    JOURNAL,
    files,
    base64Reads,
    writeFile: (path: string, bytes: Uint8Array, mtimeSec = 1700, size?: number): void => {
      files.set(path, { bytes: bytes.slice(), mtimeSec, size: size ?? bytes.length });
    },
  };
});

vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: hoisted.DOCS,
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: async (path: string) => {
    const f = hoisted.files.get(path);
    if (!f) return { exists: false, isDirectory: false, uri: path };
    return {
      exists: true,
      isDirectory: false,
      uri: path,
      size: f.size,
      modificationTime: f.mtimeSec,
    };
  },
  readAsStringAsync: async (
    path: string,
    opts?: { encoding?: string; position?: number; length?: number }
  ) => {
    const f = hoisted.files.get(path);
    if (!f) throw new Error(`mock FS: no such file ${path}`);
    if (opts?.encoding === "base64") {
      hoisted.base64Reads.push(path);
      const pos = opts?.position ?? 0;
      const len = opts?.length ?? f.size - pos;
      const out = new Uint8Array(len);
      out.set(f.bytes.subarray(pos, Math.min(pos + len, f.bytes.length)));
      return Buffer.from(out).toString("base64");
    }
    return hoisted.td.decode(f.bytes);
  },
  writeAsStringAsync: async (path: string, data: string) => {
    const prev = hoisted.files.get(path);
    hoisted.files.set(path, {
      bytes: hoisted.te.encode(data),
      mtimeSec: prev?.mtimeSec ?? 1700,
      size: data.length,
    });
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const f = hoisted.files.get(from);
    if (!f) throw new Error(`mock FS: cannot move missing ${from}`);
    hoisted.files.set(to, f);
    hoisted.files.delete(from);
  },
  deleteAsync: async (path: string) => {
    hoisted.files.delete(path);
  },
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async () => [] as string[],
}));

import { assertTrustedModelFile, assertTrustedModelFileByName } from "./modelTrust";
import { MODEL_CATALOG, type CatalogModel } from "./manifest";

/** Cabecera GGUF mínima válida: magia, versión 3, un tensor, cero metadatos. */
function ggufHeadedBytes(total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  bytes.set([0x47, 0x47, 0x55, 0x46], 0); // "GGUF"
  view.setUint32(4, 3, true); // version 3
  view.setBigUint64(8, 1n, true); // tensor count: 1
  view.setBigUint64(16, 0n, true); // metadata count: 0
  // Info del tensor: nombre "t", 1 dimensión, tipo 0, offset 0.
  let cursor = 24;
  view.setBigUint64(cursor, 1n, true);
  cursor += 8;
  bytes[cursor] = 0x74; // "t"
  cursor += 1;
  view.setUint32(cursor, 1, true); // nDims
  cursor += 4;
  view.setBigUint64(cursor, 1n, true); // dim[0]
  cursor += 8;
  view.setUint32(cursor, 0, true); // tipo ggml
  cursor += 4;
  view.setBigUint64(cursor, 0n, true); // offset
  return bytes;
}

const MTIME_SEC = 1700;

function writeLegacyJournal(asset: { id: string; sizeBytes: number; sha256: string }): void {
  const journal = {
    version: 1,
    records: {
      [asset.id]: {
        assetId: asset.id,
        status: "installed",
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        mtimeMs: MTIME_SEC * 1000,
        updatedAt: 1699999,
      },
    },
  };
  hoisted.writeFile(hoisted.JOURNAL, hoisted.te.encode(JSON.stringify(journal)), MTIME_SEC);
}

function modelReads(): string[] {
  return hoisted.base64Reads.filter((p) => p !== hoisted.JOURNAL);
}

beforeEach(() => {
  hoisted.files.clear();
  hoisted.base64Reads.length = 0;
});

/** Deja correr lo que la puerta haya podido agendar al fiar. */
async function settleAgendado(): Promise<void> {
  await new Promise((r) => setTimeout(r, 25));
}

describe("la vía de carga con diario heredado fía sin leer el fichero (vara 0.1.98)", () => {
  it("assertTrustedModelFile resuelve sin ni una lectura del fichero del modelo", async () => {
    const bytes = ggufHeadedBytes(4096);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // Como los GGUF reales del catálogo: kind de modelo y SIN campo format.
    const asset: CatalogModel = {
      id: "load-path-regression",
      kind: "embedding",
      label: "Load path regression",
      filename: "models/embedding.gguf",
      sizeBytes: bytes.length,
      sha256,
      sourceUrl: "",
      license: "",
      description: "",
      required: false,
    };
    hoisted.writeFile(`${hoisted.DOCS}${asset.filename}`, bytes, MTIME_SEC);
    writeLegacyJournal(asset);

    await expect(assertTrustedModelFile(asset)).resolves.toBeUndefined();
    await settleAgendado();
    expect(modelReads()).toEqual([]);
  });

  it("assertTrustedModelFileByName (la puerta de los motores) resuelve sin leer el fichero real del catálogo", async () => {
    const entry = MODEL_CATALOG.find((m) => m.filename === "models/embedding.gguf");
    if (!entry) throw new Error("el catálogo ya no trae el embedding: ajusta el test");
    // El mock declara el tamaño real del catálogo sin guardar 132 MB:
    // basta la cabecera para cualquier lector; la vara es que no haya lector.
    hoisted.writeFile(
      `${hoisted.DOCS}${entry.filename}`,
      ggufHeadedBytes(4096),
      MTIME_SEC,
      entry.sizeBytes
    );
    writeLegacyJournal(entry);

    await expect(assertTrustedModelFileByName("models/embedding.gguf")).resolves.toBeUndefined();
    await settleAgendado();
    expect(modelReads()).toEqual([]);
  });
});
