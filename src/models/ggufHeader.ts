/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ggufHeader.ts — validación estructural de la cabecera GGUF en JS puro
 * (M-37, auditoría completa 2026-11-13, F2-M2).
 *
 * Hasta la 0.1.98 la única defensa de formato antes del parser nativo era
 * el SHA-256 del catálogo: nada en JS comprobaba que los bytes fueran un
 * GGUF bien formado. Este módulo recorre la cabecera entera — magic,
 * versión, pares clave-valor de metadatos e infos de tensores — sin
 * cargar el modelo, y devuelve sus hechos (versión, conteos, offset de
 * datos). modelTrust.ts lo usa en dos sitios:
 *
 *  - La vía lenta: tras casar el SHA, un fichero cuya cabecera no se
 *    puede recorrer NO es de fiar aunque sus bytes sean los del catálogo
 *    (el catálogo también puede equivocarse), y los hechos quedan
 *    anotados en el diario de instalación.
 *  - La vía rápida: los hechos anotados se comparan contra la cabecera
 *    actual (prefijo + SHA de la región de cabecera) sin re-hashear los
 *    gigabytes de pesos — un fichero sustituido con el mismo tamaño y el
 *    mismo mtime ya no cuela si su cabecera no es la verificada.
 *
 * Formato (ggml-org/gguf, versiones 2 y 3): magic «GGUF», u32 versión,
 * u64 nº de tensores, u64 nº de pares KV; cada par es clave (u64 longitud
 * + bytes UTF-8), u32 tipo y valor según el tipo; cada info de tensor es
 * nombre, u32 nº de dimensiones, dimensiones u64, u32 tipo ggml y u64
 * offset. Los datos de tensores empiezan alineados a `general.alignment`
 * (32 por defecto).
 *
 * Puro y sin dependencias: el llamador aporta los bytes (los que tenga;
 * si la cabecera sigue más allá, el veredicto es «incomplete» y puede
 * reintentar con más) y el tamaño total del fichero, que acota cada
 * longitud declarada — una longitud que no cabe en el fichero es
 * invalidez probada, no falta de bytes.
 */

export interface GgufFacts {
  version: number;
  tensorCount: number;
  metadataCount: number;
  /** Offset donde empieza el bloque de datos de tensores. */
  dataOffset: number;
}

export type GgufHeaderVerdict =
  | { status: "ok"; facts: GgufFacts }
  | { status: "invalid"; reason: string }
  | { status: "incomplete" };

const MAGIC = [0x47, 0x47, 0x55, 0x46]; // "GGUF"
/** Tamaño fijo por tipo de valor GGUF; 8 = cadena, 9 = array (variables). */
const VALUE_SIZES: Record<number, number> = {
  0: 1, // UINT8
  1: 1, // INT8
  2: 2, // UINT16
  3: 2, // INT16
  4: 4, // UINT32
  5: 4, // INT32
  6: 4, // FLOAT32
  7: 1, // BOOL
  10: 8, // UINT64
  11: 8, // INT64
  12: 8, // FLOAT64
};
const TYPE_STRING = 8;
const TYPE_ARRAY = 9;
const TYPE_UINT32 = 4;
/** Topes de cordura: ningún fichero del catálogo se acerca. */
const MAX_COUNT = 1_000_000;
const MAX_DIMS = 4; // GGML_MAX_DIMS en llama.cpp

class NeedMore extends Error {}
class Invalid extends Error {}

export function parseGgufHeader(bytes: Uint8Array, fileSize: number): GgufHeaderVerdict {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;

  /** Exige n bytes más: incompleto si el fichero los tiene, inválido si no. */
  const need = (n: number): void => {
    if (cursor + n <= bytes.length) return;
    if (cursor + n <= fileSize) throw new NeedMore();
    throw new Invalid(`la cabecera se sale del fichero en ${cursor}+${n} > ${fileSize}`);
  };
  const u32 = (): number => {
    need(4);
    const v = view.getUint32(cursor, true);
    cursor += 4;
    return v;
  };
  const u64 = (): number => {
    need(8);
    const v = view.getBigUint64(cursor, true);
    cursor += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Invalid("conteo u64 fuera de rango");
    return Number(v);
  };
  const skip = (n: number): void => {
    if (n < 0 || n > fileSize) throw new Invalid(`salto imposible de ${n} bytes`);
    need(n);
    cursor += n;
  };
  /** Recorre una cadena (u64 longitud + bytes) y devuelve su inicio y longitud. */
  const stringSpan = (): { start: number; length: number } => {
    const length = u64();
    if (length > fileSize) throw new Invalid(`cadena de ${length} bytes en un fichero de ${fileSize}`);
    need(length);
    const start = cursor;
    cursor += length;
    return { start, length };
  };
  const keyEquals = (span: { start: number; length: number }, expected: string): boolean => {
    if (span.length !== expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (bytes[span.start + i] !== expected.charCodeAt(i)) return false;
    }
    return true;
  };
  const skipValue = (type: number): void => {
    if (type === TYPE_STRING) {
      stringSpan();
      return;
    }
    if (type === TYPE_ARRAY) {
      const elemType = u32();
      const count = u64();
      if (count > MAX_COUNT * 100) throw new Invalid(`array de ${count} elementos`);
      if (elemType === TYPE_STRING) {
        for (let i = 0; i < count; i++) stringSpan();
        return;
      }
      const elemSize = VALUE_SIZES[elemType];
      if (elemSize === undefined) throw new Invalid(`tipo de array desconocido ${elemType}`);
      skip(count * elemSize);
      return;
    }
    const size = VALUE_SIZES[type];
    if (size === undefined) throw new Invalid(`tipo de valor desconocido ${type}`);
    skip(size);
  };

  try {
    need(24);
    for (let i = 0; i < 4; i++) {
      if (bytes[i] !== MAGIC[i]) throw new Invalid("magic no es GGUF");
    }
    cursor = 4;
    const version = u32();
    if (version !== 2 && version !== 3) throw new Invalid(`versión GGUF ${version}`);
    const tensorCount = u64();
    const metadataCount = u64();
    if (tensorCount < 1 || tensorCount > MAX_COUNT) throw new Invalid(`nº de tensores ${tensorCount}`);
    if (metadataCount > MAX_COUNT) throw new Invalid(`nº de metadatos ${metadataCount}`);
    // Cada par KV ocupa al menos 13 bytes (8 de longitud + 1 de clave + 4
    // de tipo) y cada info de tensor al menos 25: un conteo que no cabe
    // ni vacío en el fichero es invalidez inmediata.
    if (metadataCount * 13 > fileSize) throw new Invalid("los metadatos no caben en el fichero");
    if (tensorCount * 25 > fileSize) throw new Invalid("las infos de tensores no caben en el fichero");

    let alignment = 32;
    for (let i = 0; i < metadataCount; i++) {
      const key = stringSpan();
      const type = u32();
      if (type === TYPE_UINT32 && keyEquals(key, "general.alignment")) {
        need(4);
        alignment = view.getUint32(cursor, true);
        cursor += 4;
        if (alignment < 1 || alignment > 4096 || (alignment & (alignment - 1)) !== 0) {
          throw new Invalid(`general.alignment ${alignment} no es potencia de dos válida`);
        }
        continue;
      }
      skipValue(type);
    }
    for (let i = 0; i < tensorCount; i++) {
      stringSpan(); // nombre
      const nDims = u32();
      if (nDims < 1 || nDims > MAX_DIMS) throw new Invalid(`tensor con ${nDims} dimensiones`);
      skip(nDims * 8); // dimensiones
      u32(); // tipo ggml
      u64(); // offset
    }
    const dataOffset = Math.ceil(cursor / alignment) * alignment;
    if (dataOffset >= fileSize) throw new Invalid("no queda sitio para los datos de tensores");
    return { status: "ok", facts: { version, tensorCount, metadataCount, dataOffset } };
  } catch (e) {
    if (e instanceof NeedMore) return { status: "incomplete" };
    if (e instanceof Invalid) return { status: "invalid", reason: e.message };
    throw e;
  }
}

/**
 * La comparación de 24 bytes de la vía rápida: magic, versión y los dos
 * conteos contra los hechos anotados en el diario. Barata a propósito —
 * la comparación fuerte de la cabecera entera es el SHA que modelTrust
 * guarda junto a estos hechos; esto dirime sin leer más que el prefijo.
 */
export function ggufPrefixMatches(prefix: Uint8Array, facts: GgufFacts): boolean {
  if (prefix.length < 24) return false;
  for (let i = 0; i < 4; i++) {
    if (prefix[i] !== MAGIC[i]) return false;
  }
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  if (view.getUint32(4, true) !== facts.version) return false;
  if (view.getBigUint64(8, true) !== BigInt(facts.tensorCount)) return false;
  if (view.getBigUint64(16, true) !== BigInt(facts.metadataCount)) return false;
  return true;
}
