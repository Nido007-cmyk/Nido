/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Shared helpers for the Esencial clinical re-verification program
// (checks (a)-(c) of rule R00-5, gate R-00 of 2026-11-02).
//
// The clinical hash (rule R00-4, closed at the gate) is SHA-256 over
// title, category, lang, `sources:` and the guide body with the
// section-question comments (`<!-- preguntas/preguntas/questions: … -->`)
// removed from the computation, line endings normalized to \n. It does
// NOT cover `id`, `verified` or the header `questions:` — a retrieval
// seat can never silently invalidate a seal, and a seal never claims
// to cover one. The exact serialization fixed here, so every future
// check reproduces the same bytes:
//
//   title + "\n" + category + "\n" + lang + "\n" + sources + "\n" + body
//
// where body is the raw text after the closing front-matter fence with
// every section-question comment line dropped (the same lines
// parseGuide treats as search-only questions, never as reader text).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ESENCIAL_REL = "knowledge-packs/nido-esencial";
export const LEDGER_FILE = "verification-ledger.json";
export const BASELINE_FILE = "seal-baseline.json";
export const LANGS = ["es", "en", "pt"];

const SECTION_QUESTION_LINE = /^\s*<!--\s*(?:preguntas|questions|perguntas)\s*:.*-->\s*$/i;

/** Splits a guide file into its raw front-matter map and its body. */
export function parseFrontMatter(text, file = "guide") {
  const m = String(text).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

/** The body as the clinical hash sees it: section-question comment lines out. */
export function clinicalBody(body) {
  return body.split("\n").filter((line) => !SECTION_QUESTION_LINE.test(line)).join("\n");
}

/** The exact byte string the clinical hash covers (rule R00-4). */
export function clinicalText(text, file = "guide") {
  const { meta, body } = parseFrontMatter(text, file);
  for (const k of ["title", "category", "lang", "sources"]) {
    if (meta[k] === undefined) throw new Error(`${file}: front matter needs "${k}" for the clinical hash`);
  }
  return [meta.title, meta.category, meta.lang, meta.sources].join("\n") + "\n" + clinicalBody(body);
}

/** SHA-256 (hex) of a guide file's clinical content. */
export function clinicalHash(text, file = "guide") {
  return createHash("sha256").update(clinicalText(text, file), "utf8").digest("hex");
}

/** Every guide file of the pack: [{ lang, file, rel, topic }] in a stable order. */
export function listGuideFiles(root) {
  const out = [];
  for (const lang of LANGS) {
    const dir = join(root, ESENCIAL_REL, lang);
    for (const file of readdirSync(dir).sort()) {
      if (/^\d{2}-.+\.md$/.test(file)) out.push({ lang, file, rel: `${ESENCIAL_REL}/${lang}/${file}`, topic: file.slice(0, 2) });
    }
  }
  return out;
}

export function readGuide(root, rel) {
  const raw = readFileSync(join(root, rel), "utf8");
  const { meta, body } = parseFrontMatter(raw, rel);
  return { raw, meta, body };
}

/** Guides currently carrying the seal: [{ guideId, verified, rel, lang }]. */
export function sealedGuides(root) {
  const out = [];
  for (const g of listGuideFiles(root)) {
    const { meta } = readGuide(root, g.rel);
    if (meta.id && meta.verified) out.push({ guideId: meta.id, verified: meta.verified, rel: g.rel, lang: g.lang });
  }
  return out;
}

export function ledgerPath(root) {
  return join(root, ESENCIAL_REL, LEDGER_FILE);
}

export function baselinePath(root) {
  return join(root, ESENCIAL_REL, BASELINE_FILE);
}

/** The machine ledger, or null when no tanda has sealed yet. */
export function loadLedger(root) {
  const p = ledgerPath(root);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/** The ratchet baseline (guideIds sealed at the last committed tanda), or null. */
export function loadBaseline(root) {
  const p = baselinePath(root);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export const DESENLACES = [
  "sostenida",
  "sostenida con contexto",
  "corregida desde la fuente",
  "retirada por no sostenida",
  "NO ENCONTRADO",
  "sustituida",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Structural validation of one assertion row (check (c), offline run).
 * Returns a list of problems; an empty list means the row is well formed.
 */
export function validateRow(row, where = "fila") {
  const problems = [];
  const need = (k) => {
    if (row?.[k] === undefined || String(row[k]).trim() === "") problems.push(`${where}: falta "${k}"`);
  };
  for (const k of ["tema", "guia", "idioma", "afirmacionId", "textoLiteral", "tipo", "institucion", "documento", "edicion", "identificador", "localizador", "citaLiteral", "fechaComprobacion", "desenlace"]) need(k);
  if (row && !DESENLACES.includes(row.desenlace)) problems.push(`${where}: desenlace fuera del vocabulario: ${row.desenlace}`);
  if (row && !DATE_RE.test(row.fechaComprobacion ?? "")) problems.push(`${where}: fechaComprobacion no es YYYY-MM-DD`);
  if (row?.desenlace === "NO ENCONTRADO") {
    if (!Array.isArray(row.fuentesConsultadas) || row.fuentesConsultadas.length === 0) {
      problems.push(`${where}: NO ENCONTRADO sin fuentesConsultadas`);
    }
  }
  if (row?.desenlace === "corregida desde la fuente" && !row.antesDespues) {
    problems.push(`${where}: corregida desde la fuente sin antesDespues`);
  }
  return problems;
}

/** Structural validation of the whole ledger document. */
export function validateLedger(doc, file = LEDGER_FILE) {
  const problems = [];
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.guides)) {
    return [`${file}: no es un objeto con una lista "guides"`];
  }
  const seen = new Set();
  for (const entry of doc.guides) {
    const where = `${file}: ${entry?.guideId ?? "?"}/${entry?.idioma ?? "?"}`;
    for (const k of ["guideId", "idioma", "ruta", "verified", "hashClinico", "preparador", "auditor"]) {
      if (entry?.[k] === undefined || String(entry[k]).trim() === "") problems.push(`${where}: falta "${k}"`);
    }
    if (entry && !DATE_RE.test(entry.verified ?? "")) problems.push(`${where}: verified no es YYYY-MM-DD`);
    if (entry && !/^[0-9a-f]{64}$/.test(entry.hashClinico ?? "")) problems.push(`${where}: hashClinico no es un SHA-256 hex`);
    if (entry && entry.preparador && entry.auditor && entry.preparador === entry.auditor) {
      problems.push(`${where}: preparador y auditor son la misma persona`);
    }
    const key = `${entry?.guideId}|${entry?.idioma}`;
    if (seen.has(key)) problems.push(`${where}: entrada duplicada`);
    seen.add(key);
    if (!Array.isArray(entry?.filas) || entry.filas.length === 0) {
      problems.push(`${where}: sin filas de afirmación`);
    } else {
      entry.filas.forEach((row, i) => problems.push(...validateRow(row, `${where} fila ${row?.afirmacionId ?? i}`)));
    }
  }
  return problems;
}

/**
 * Compares the ledger against the files on disk (check (b)'s core):
 * every entry's file exists, still carries the seal with the same id
 * and date, and its clinical hash still equals the sealed one; every
 * sealed file has its entry. Returns a list of problems.
 */
export function ledgerProblems(root, doc) {
  const problems = [];
  const byKey = new Map();
  for (const entry of doc?.guides ?? []) byKey.set(`${entry.guideId}|${entry.idioma}`, entry);
  for (const entry of doc?.guides ?? []) {
    const full = join(root, entry.ruta);
    if (!existsSync(full)) {
      problems.push(`${entry.guideId}/${entry.idioma}: no existe ${entry.ruta}`);
      continue;
    }
    const { raw, meta } = readGuide(root, entry.ruta);
    if (meta.id !== entry.guideId) problems.push(`${entry.guideId}/${entry.idioma}: el fichero lleva id "${meta.id ?? ""}"`);
    if ((meta.verified ?? "") !== entry.verified) problems.push(`${entry.guideId}/${entry.idioma}: verified del fichero (${meta.verified ?? "sin fecha"}) ≠ ledger (${entry.verified})`);
    const h = clinicalHash(raw, entry.ruta);
    if (h !== entry.hashClinico) problems.push(`${entry.guideId}/${entry.idioma}: hash clínico ${h.slice(0, 12)}… ≠ sellado ${String(entry.hashClinico).slice(0, 12)}… (el texto clínico cambió sin fila ni fecha nuevas, o sin retirar el sello)`);
  }
  for (const s of sealedGuides(root)) {
    if (!byKey.has(`${s.guideId}|${s.lang}`)) problems.push(`${s.guideId}/${s.lang}: sellada en el fichero pero sin entrada en el ledger`);
  }
  return problems;
}

/**
 * The ratchet's core (check (a)): the baseline set can only have grown.
 * Every baseline guideId must still be sealed, and every seal must be
 * backed by a ledger entry. Returns a list of problems.
 */
export function ratchetProblems(root, baseline, doc) {
  const problems = [];
  const sealed = sealedGuides(root);
  const sealedIds = new Set(sealed.map((s) => s.guideId));
  for (const id of baseline?.guides ?? []) {
    if (!sealedIds.has(id)) problems.push(`ratchet: ${id} estaba sellada en la línea base y ya no lo está (un sello desapareció sin retirada asentada)`);
  }
  const inLedger = new Set((doc?.guides ?? []).map((e) => e.guideId));
  for (const s of sealed) {
    if (!inLedger.has(s.guideId)) problems.push(`ratchet: ${s.guideId}/${s.lang} lleva sello pero el ledger no la registra`);
  }
  return problems;
}
