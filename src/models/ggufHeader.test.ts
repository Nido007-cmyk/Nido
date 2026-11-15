/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { parseGgufHeader, ggufPrefixMatches, type GgufFacts } from "./ggufHeader";

/** Escritor de bytes mínimo para construir cabeceras GGUF de mentira. */
class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u32(v: number) {
    for (let i = 0; i < 4; i++) this.bytes.push((v >>> (8 * i)) & 0xff);
    return this;
  }
  u64(v: number) {
    let x = BigInt(v);
    for (let i = 0; i < 8; i++) {
      this.bytes.push(Number(x & 0xffn));
      x >>= 8n;
    }
    return this;
  }
  raw(bs: number[] | Uint8Array) {
    for (const b of bs) this.bytes.push(b);
    return this;
  }
  str(s: string) {
    const enc = new TextEncoder().encode(s);
    this.u64(enc.length);
    return this.raw(enc);
  }
  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

const T = {
  UINT8: 0,
  INT32: 5,
  UINT32: 4,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
} as const;

function header(opts?: {
  version?: number;
  kv?: Array<[string, number, (w: Writer) => void]>;
  tensors?: string[];
  alignment?: number;
}): { bytes: Uint8Array; headerEnd: number } {
  const w = new Writer();
  w.raw([0x47, 0x47, 0x55, 0x46]); // "GGUF"
  w.u32(opts?.version ?? 3);
  const tensors = opts?.tensors ?? ["token_embd.weight"];
  const kv: Array<[string, number, (w: Writer) => void]> = [
    ["general.name", T.STRING, (x) => x.str("modelo de prueba")],
    ...(opts?.alignment !== undefined
      ? [["general.alignment", T.UINT32, (x: Writer) => x.u32(opts.alignment!)] as [string, number, (w: Writer) => void]]
      : []),
    ...(opts?.kv ?? []),
  ];
  w.u64(tensors.length);
  w.u64(kv.length);
  for (const [key, type, write] of kv) {
    w.str(key);
    w.u32(type);
    write(w);
  }
  for (const name of tensors) {
    w.str(name);
    w.u32(2); // n_dims
    w.u64(4);
    w.u64(8); // dims
    w.u32(0); // ggml type f32
    w.u64(0); // offset
  }
  return { bytes: w.build(), headerEnd: w.bytes.length };
}

describe("parseGgufHeader (M-37: validación estructural GGUF)", () => {
  it("una cabecera v3 válida se recorre entera y da sus hechos", () => {
    const { bytes, headerEnd } = header({ tensors: ["a.weight", "b.weight"] });
    const file = new Uint8Array(4096);
    file.set(bytes);
    const v = parseGgufHeader(file, file.length);
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.facts.version).toBe(3);
    expect(v.facts.tensorCount).toBe(2);
    expect(v.facts.metadataCount).toBe(1);
    // Sin general.alignment declarado, el dato empieza en el siguiente
    // múltiplo de 32 tras el final de las infos de tensores.
    const expected = Math.ceil(headerEnd / 32) * 32;
    expect(v.facts.dataOffset).toBe(expected);
  });

  it("general.alignment manda sobre el offset de datos", () => {
    const { bytes, headerEnd } = header({ alignment: 64 });
    const file = new Uint8Array(8192);
    file.set(bytes);
    const v = parseGgufHeader(file, file.length);
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.facts.dataOffset).toBe(Math.ceil(headerEnd / 64) * 64);
  });

  it("magic que no es GGUF: inválido", () => {
    const file = new Uint8Array(4096);
    file.set([0x50, 0x4b, 0x03, 0x04]); // un ZIP
    expect(parseGgufHeader(file, file.length).status).toBe("invalid");
  });

  it("versión fuera de {2,3}: inválido", () => {
    const { bytes } = header({ version: 1 });
    const file = new Uint8Array(4096);
    file.set(bytes);
    expect(parseGgufHeader(file, file.length).status).toBe("invalid");
  });

  it("conteos absurdos: inválido sin recorrer nada", () => {
    const w = new Writer();
    w.raw([0x47, 0x47, 0x55, 0x46]);
    w.u32(3);
    w.u64(1_000_000_000); // tensores imposibles para el tamaño declarado
    w.u64(0);
    const bytes = w.build();
    expect(parseGgufHeader(bytes, 4096).status).toBe("invalid");
  });

  it("cortada a media cabecera con más fichero detrás: incompleto, no inválido", () => {
    const { bytes } = header({});
    const cut = bytes.slice(0, bytes.length - 5);
    const v = parseGgufHeader(cut, 4096); // el fichero dice tener más
    expect(v.status).toBe("incomplete");
  });

  it("cortada a media cabecera y el fichero acaba ahí: inválido", () => {
    const { bytes } = header({});
    const cut = bytes.slice(0, bytes.length - 5);
    expect(parseGgufHeader(cut, cut.length).status).toBe("invalid");
  });

  it("un array de cadenas (el vocabulario del tokenizador) se recorre bien", () => {
    const { bytes } = header({
      kv: [
        [
          "tokenizer.ggml.tokens",
          T.ARRAY,
          (x) => {
            x.u32(T.STRING);
            x.u64(3);
            x.str("a");
            x.str("bb");
            x.str("ccc");
          },
        ],
        ["tokenizer.ggml.bos_token_id", T.UINT32, (x) => x.u32(1)],
      ],
    });
    const file = new Uint8Array(8192);
    file.set(bytes);
    const v = parseGgufHeader(file, file.length);
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.facts.metadataCount).toBe(3);
  });

  it("una longitud de cadena que excede el fichero: inválido", () => {
    const w = new Writer();
    w.raw([0x47, 0x47, 0x55, 0x46]);
    w.u32(3);
    w.u64(1);
    w.u64(1);
    w.u64(999_999); // la clave «mide» casi un mega en un fichero de 4 KiB
    const bytes = w.build();
    const file = new Uint8Array(4096);
    file.set(bytes);
    expect(parseGgufHeader(file, file.length).status).toBe("invalid");
  });

  it("sin tensores no hay modelo: inválido", () => {
    const { bytes } = header({ tensors: [] });
    const file = new Uint8Array(4096);
    file.set(bytes);
    expect(parseGgufHeader(file, file.length).status).toBe("invalid");
  });
});

describe("ggufPrefixMatches (la comparación barata de la vía rápida)", () => {
  const facts: GgufFacts = { version: 3, tensorCount: 2, metadataCount: 5, dataOffset: 128 };

  it("el prefijo de 24 bytes con los mismos hechos casa", () => {
    const w = new Writer();
    w.raw([0x47, 0x47, 0x55, 0x46]);
    w.u32(3);
    w.u64(2);
    w.u64(5);
    expect(ggufPrefixMatches(w.build(), facts)).toBe(true);
  });

  it("otro conteo de tensores en el prefijo: no casa", () => {
    const w = new Writer();
    w.raw([0x47, 0x47, 0x55, 0x46]);
    w.u32(3);
    w.u64(7);
    w.u64(5);
    expect(ggufPrefixMatches(w.build(), facts)).toBe(false);
  });

  it("prefijo corto o magic mala: no casa", () => {
    expect(ggufPrefixMatches(new Uint8Array(10), facts)).toBe(false);
    const w = new Writer();
    w.raw([0x50, 0x4b, 0x03, 0x04]);
    w.u32(3);
    w.u64(2);
    w.u64(5);
    expect(ggufPrefixMatches(w.build(), facts)).toBe(false);
  });
});
