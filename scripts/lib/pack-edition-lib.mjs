/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La ficha de edición de un pack (programa «Lo mejor de la bounty»,
 * tanda 5; pieza 08 de la colección: el estándar de catálogo de
 * Blobs, nonomnonom, Apache-2.0 — ver ATTRIBUTION.md).
 *
 * NIDO ya garantizaba la integridad (el catálogo firmado nombra los
 * bytes exactos) y la inmutabilidad (knowledge-packs/release-ledger
 * .json: un fichero publicado nunca se reemplaza; una versión nueva
 * es una línea nueva). Lo que no existía es el rastro EDITORIAL de
 * cada edición: de qué edición de la fuente sale, con qué derechos,
 * qué casos de recuperación la prueban y qué limitaciones se le
 * conocen. Eso es la ficha.
 *
 * La ficha vive JUNTO A LA FIRMA: el constructor la escribe como
 * `<pack>.sqlite.edition.json` y mete su huella (y la edición y su
 * estado) en el resumen `<pack>.sqlite.json`, que es el documento
 * del que el catálogo firmado toma tamaño y SHA-256. Quien firma el
 * catálogo firma también, por esa huella, la ficha que describe la
 * edición.
 *
 * Dos mitades, como en Blobs:
 *  - El DESCRIPTOR (`edition.json` en el árbol del pack, o --edition
 *    FILE): lo humano — edición de la fuente, derechos, editor,
 *    política de actualización, limitaciones conocidas y los
 *    ficheros de casos que prueban la edición.
 *  - Lo CALCULADO: recuentos, idiomas presentes, tamaño, huella del
 *    paquete y huella normalizada de los registros (la «huella de
 *    registros» de Blobs: identifica el conjunto de registros sin
 *    hashear gigabytes en el teléfono; aquí se calcula al construir).
 *
 * Estado: «release-ready» solo si la validación no encuentra ningún
 * campo ausente o inválido; si no, «draft» — el registro distingue
 * lo planeado/borrador de lo revisado y listo, y un borrador nunca
 * se presenta como edición lista.
 */

import { createHash } from "node:crypto";

const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Huella normalizada de los registros: SHA-256 de cada registro
 * (título + cuerpo), ordenados y vueltos a hashear. Independiente
 * del orden de construcción; cambia si cambia cualquier registro.
 */
export function recordsDigest(records) {
  const per = records.map((r) => sha256Hex(`${r.title}\n${r.body}`)).sort();
  return sha256Hex(per.join("\n"));
}

/** JSON canónico: claves ordenadas en profundidad, sin espacios. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** La huella de la ficha (lo que el resumen firmado nombra). */
export function editionCardDigest(card) {
  return sha256Hex(canonicalJson(card));
}

const REQUIRED_TEXT = ["edition", "sourceEdition", "rights", "publisher", "updatePolicy", "knownLimitations"];

/**
 * Valida una ficha. Devuelve la lista de problemas (vacía = lista
 * para publicar). Cada problema dice el campo, para que el asiento
 * en el registro sea accionable.
 */
export function validateEditionCard(card) {
  const errors = [];
  for (const field of REQUIRED_TEXT) {
    if (typeof card?.[field] !== "string" || card[field].trim() === "") {
      errors.push(`${field}: falta el texto del descriptor`);
    }
  }
  if (!Array.isArray(card?.languages) || card.languages.length === 0) {
    errors.push("languages: la edición no declara ningún idioma presente");
  }
  if (!Number.isInteger(card?.documentCount) || card.documentCount <= 0) {
    errors.push("documentCount: debe ser un entero positivo");
  }
  if (!Number.isInteger(card?.recordCount) || card.recordCount <= 0) {
    errors.push("recordCount: debe ser un entero positivo");
  }
  if (!Number.isInteger(card?.archiveSizeBytes) || card.archiveSizeBytes <= 0) {
    errors.push("archiveSizeBytes: debe ser un entero positivo");
  }
  for (const field of ["packageSha256", "recordsSha256", "sourceLock"]) {
    if (field === "sourceLock") continue; // el bloqueo puede ser una referencia, no solo una huella
    if (typeof card?.[field] !== "string" || !HEX64.test(card[field])) {
      errors.push(`${field}: debe ser un SHA-256 en hex`);
    }
  }
  if (typeof card?.sourceLock !== "string" || card.sourceLock.trim() === "") {
    errors.push("sourceLock: falta el bloqueo de la fuente");
  }
  if (!Array.isArray(card?.retrievalCases) || card.retrievalCases.length === 0) {
    errors.push("retrievalCases: una edición lista nombra al menos un fichero de casos que la prueba");
  } else {
    for (const c of card.retrievalCases) {
      if (typeof c?.file !== "string" || !HEX64.test(c?.sha256 ?? "") || !Number.isInteger(c?.cases) || c.cases <= 0) {
        errors.push(`retrievalCases: el caso ${c?.file ?? "?"} necesita fichero, su SHA-256 y su recuento`);
      }
    }
  }
  if (typeof card?.attribution !== "string" || card.attribution.trim() === "") {
    errors.push("attribution: falta la atribución que el pack ya lleva en su meta");
  }
  return errors;
}

/**
 * Compone la ficha desde el descriptor humano y lo calculado por el
 * constructor. `computed.checks` llega ya con la huella y el
 * recuento de cada fichero de casos. La ficha incluye su estado; el
 * llamador decide qué hacer con un borrador (el constructor lo
 * escribe igualmente, marcado: el registro también guarda los
 * borradores, como planeados que son).
 */
export function buildEditionCard({ descriptor = {}, computed }) {
  const card = {
    packId: computed.packId,
    edition: descriptor.edition ?? null,
    state: "draft",
    builtAt: computed.builtAt,
    sourceEdition: descriptor.sourceEdition ?? null,
    // El bloqueo de la fuente: el del descriptor (una revisión
    // fijada, una lista con hash) o, en su defecto, la huella de
    // los registros construidos — la fuente queda fijada por lo
    // que de ella entró en el paquete.
    sourceLock: descriptor.sourceLock ?? `records:${computed.recordsSha256}`,
    rights: descriptor.rights ?? computed.license ?? null,
    languages: computed.languages,
    ...(descriptor.scope ? { scope: descriptor.scope } : {}),
    publisher: descriptor.publisher ?? "NIDO",
    updatePolicy: descriptor.updatePolicy ?? null,
    documentCount: computed.documentCount,
    recordCount: computed.recordCount,
    ...(computed.factsCount !== undefined ? { factsCount: computed.factsCount } : {}),
    archiveSizeBytes: computed.archiveSizeBytes,
    packageSha256: computed.packageSha256,
    recordsSha256: computed.recordsSha256,
    attribution: computed.attribution ?? null,
    knownLimitations: descriptor.knownLimitations ?? null,
    retrievalCases: computed.checks ?? [],
    embeddingModel: computed.embeddingModel,
    embeddingModelSha256: computed.embeddingModelSha256,
  };
  const errors = validateEditionCard(card);
  card.state = errors.length === 0 ? "release-ready" : "draft";
  return { card, errors };
}
