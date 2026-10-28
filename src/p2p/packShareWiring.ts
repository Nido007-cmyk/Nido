/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packShareWiring.ts — 0.1.55: conecta el Pack Sharing NIDO↔NIDO con los
 * packs de verdad (antes el servicio existía pero la app no le daba ni
 * bytes ni importador, y la pantalla lo decía).
 *
 * Regla de confianza: solo viajan packs del CATÁLOGO de NIDO (los que tienen
 * SHA-256 en el catálogo firmado). El que recibe instala el pack SOLO si sus
 * bytes dan exactamente ese SHA-256: es decir, recibe el mismo archivo que
 * habría descargado de internet, aunque se lo pase un vecino sin internet.
 * Un pack hecho a mano o modificado (p. ej. con consejos médicos cambiados)
 * no se ofrece ni se instala.
 *
 * Puro salvo por las dependencias inyectadas (archivos, cierre del pack,
 * índices): se prueba sin teléfono.
 */
import type { CatalogModel } from "../models/manifest";
import { sha256Hex } from "../models/sha256";
import { decodeBase64 } from "./base64";
import { MAX_PACK_SIZE_BYTES, type PackAdvertisement } from "./packSharing";
import type { PackDataProvider, PackImporter } from "./packShareService";

export interface PackShareDeps {
  /** Packs conocidos (catálogo + locales): rag/packs.knowledgePacks. */
  listPacks(): Promise<CatalogModel[]>;
  /** Carpeta de documentos de la app (con / al final). */
  docDir: string;
  readBase64(path: string): Promise<string>;
  writeBase64(path: string, data: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Cierra el pack abierto antes de sustituir su archivo. */
  closePack(id: string): Promise<void>;
  /** Tras instalar: preparar su índice de búsqueda, refrescar pantallas… */
  afterImport?(pack: CatalogModel): Promise<void> | void;
}

const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * ¿Se puede compartir este pack? Solo packs del catálogo (no los locales
 * hechos a mano), en formato sqlite-pack, con SHA-256 y tamaño conocidos
 * y dentro del máximo de una transferencia.
 */
export function shareablePack(packs: CatalogModel[], packId: string): CatalogModel | null {
  const p = packs.find((m) => m.id === packId);
  if (!p) return null;
  if (p.format !== "sqlite-pack" || p.id.startsWith("local-")) return null;
  if (!SHA_RE.test((p.sha256 ?? "").toLowerCase())) return null;
  if (!(p.sizeBytes > 0) || p.sizeBytes > MAX_PACK_SIZE_BYTES) return null;
  return p;
}

/**
 * Filtro de ofertas entrantes: solo se enseñan las de packs del catálogo,
 * con el tamaño del catálogo. (El SHA-256 de la oferta es el del texto
 * base64, no el del archivo: el del archivo se comprueba al instalar.)
 */
export function isAcceptableOffer(packs: CatalogModel[], adv: PackAdvertisement): boolean {
  const p = shareablePack(packs, adv.id);
  if (!p) return false;
  // createSendSession estima el tamaño desde el base64 (redondea hacia
  // arriba, hasta 2 bytes de más por el relleno).
  return adv.sizeBytes >= p.sizeBytes && adv.sizeBytes <= p.sizeBytes + 2;
}

/** Bytes del pack a enviar, solo si el archivo instalado es el del catálogo. */
export function makePackDataProvider(deps: PackShareDeps): PackDataProvider {
  return async (packId) => {
    const pack = shareablePack(await deps.listPacks(), packId);
    if (!pack) return null;
    let base64: string;
    try {
      base64 = await deps.readBase64(`${deps.docDir}${pack.filename}`);
    } catch {
      return null; // no está instalado
    }
    const bytes = decodeBase64(base64);
    if (bytes.length !== pack.sizeBytes || sha256Hex(bytes) !== pack.sha256.toLowerCase()) {
      return null; // archivo dañado o cambiado: no se reparte
    }
    return { base64Data: base64, name: pack.label, description: pack.description };
  };
}

/**
 * Instala un pack recibido SOLO si es idéntico al del catálogo. Escribe
 * primero a un archivo temporal y lo mueve al final; el pack anterior se
 * aparta y vuelve si algo falla: un fallo a mitad no deja un pack roto ni
 * borra el que había.
 */
export function makePackImporter(deps: PackShareDeps): PackImporter {
  return async (packId, _name, base64Data) => {
    const pack = shareablePack(await deps.listPacks(), packId);
    if (!pack) return false;
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(base64Data);
    } catch {
      return false;
    }
    if (bytes.length !== pack.sizeBytes) return false;
    if (sha256Hex(bytes) !== pack.sha256.toLowerCase()) return false;
    const target = `${deps.docDir}${pack.filename}`;
    const part = `${target}.p2p-part`;
    const old = `${target}.p2p-old`;
    try {
      await deps.writeBase64(part, base64Data);
    } catch {
      await deps.remove(part).catch(() => {});
      return false;
    }
    await deps.closePack(pack.id).catch(() => {});
    // El pack que hubiera se aparta (no se borra) hasta que el nuevo esté
    // en su sitio: si algo falla, vuelve.
    let hadOld = false;
    try {
      await deps.move(target, old);
      hadOld = true;
    } catch {
      hadOld = false; // no había pack instalado
    }
    try {
      await deps.move(part, target);
    } catch {
      if (hadOld) await deps.move(old, target).catch(() => {});
      await deps.remove(part).catch(() => {});
      return false;
    }
    if (hadOld) await deps.remove(old).catch(() => {});
    try {
      await deps.afterImport?.(pack);
    } catch {
      /* el pack ya está instalado; el índice se prepara en el próximo arranque */
    }
    return true;
  };
}
