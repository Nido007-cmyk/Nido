/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * formatVersion.ts — contrato de versionado de formatos persistentes (L1).
 *
 * NIDO guarda estado durable en varios formatos: bases SQLCipher
 * (knowledge, memory), ficheros JSON (settings, journal de instalación).
 * Cada formato estampa un identificador de formato + versión major al
 * crearse, y lo EXIGE al abrirse:
 *
 * - major desconocido, ausente donde se espera, o corrupto → fail-closed
 *   con un error nombrado (nunca skip silencioso, nunca "probar suerte");
 * - la mecánica accept/reject vive aquí, en código puro y unit-testeable,
 *   para que no dependa de un dispositivo;
 * - L1 fija major 1 en todos los formatos; no existen migraciones v1→v2.
 *
 * Los errores fijan `name` (p. ej. "KnowledgeDbVersionError") para que sean
 * greppables en logs y en el código. Los nombres son en inglés; el copy de
 * UI que los presente al usuario lo decide otra capa (no UI en L1).
 */

// ── Versiones soportadas (major 1 en todos los formatos, L1) ────────────────

export const KNOWLEDGE_DB_SCHEMA_VERSION = 1;
export const MEMORY_DB_SCHEMA_VERSION = 1;
export const SETTINGS_FORMAT_VERSION = 1;
export const INSTALL_JOURNAL_VERSION = 1;

// ── Errores nombrados ──────────────────────────────────────────────────────

function describeFound(found: unknown): string {
  if (found === undefined) return "missing";
  if (found === null) return "null";
  if (typeof found === "string") return JSON.stringify(found);
  return String(found);
}

export class FormatVersionError extends Error {
  readonly formatId: string;
  readonly found: unknown;
  readonly supportedMajor: number;

  constructor(formatId: string, found: unknown, supportedMajor: number, reason: string) {
    super(
      `[${formatId}] unsupported format version ${describeFound(found)}: ${reason} ` +
        `(supported major: ${supportedMajor})`
    );
    this.name = "FormatVersionError";
    this.formatId = formatId;
    this.found = found;
    this.supportedMajor = supportedMajor;
  }
}

export class KnowledgeDbVersionError extends FormatVersionError {
  constructor(found: unknown, reason: string) {
    super("nido_knowledge.db", found, KNOWLEDGE_DB_SCHEMA_VERSION, reason);
    this.name = "KnowledgeDbVersionError";
  }
}

export class MemoryDbVersionError extends FormatVersionError {
  constructor(found: unknown, reason: string) {
    super("nido_memory.db", found, MEMORY_DB_SCHEMA_VERSION, reason);
    this.name = "MemoryDbVersionError";
  }
}

export class SettingsVersionError extends FormatVersionError {
  constructor(found: unknown, reason: string) {
    super("settings.json", found, SETTINGS_FORMAT_VERSION, reason);
    this.name = "SettingsVersionError";
  }
}

export class InstallJournalVersionError extends FormatVersionError {
  constructor(found: unknown, reason: string) {
    super("nido-install-state.json", found, INSTALL_JOURNAL_VERSION, reason);
    this.name = "InstallJournalVersionError";
  }
}

// ── Chequeo ────────────────────────────────────────────────────────────────

export interface FormatVersionCheck {
  /** Identificador estable del formato (se lo lleva el error). */
  formatId: string;
  /** Valor crudo leído del formato durable. */
  found: unknown;
  /** Major que este lector soporta. */
  supportedMajor: number;
  /** Constructor del error nombrado a lanzar si no se acepta. */
  ErrorClass: new (found: unknown, reason: string) => FormatVersionError;
  /**
   * Si se define, un valor ausente (undefined/null) se acepta como esta
   * versión: grandfathering para datos escritos antes del versionado.
   * Sin esto, ausente = fail-closed ("missing version field").
   */
  allowMissingAs?: number;
}

/**
 * Valida la versión cruda leída de un formato durable.
 *
 * Acepta número entero o string numérico igual al major soportado.
 * Devuelve el major aceptado. Lanza el error nombrado configurado si el
 * valor falta (sin grandfathering), es corrupto (no numérico entero), o es
 * un major distinto del soportado — incluyendo datos MÁS NUEVOS que este
 * lector: nunca se interpreta un formato futuro.
 */
export function checkFormatVersion(check: FormatVersionCheck): number {
  const { found, supportedMajor, ErrorClass, allowMissingAs } = check;

  if (found === undefined || found === null) {
    if (allowMissingAs !== undefined) return allowMissingAs;
    throw new ErrorClass(found, "missing version field");
  }

  let major: number;
  if (typeof found === "number") {
    major = found;
  } else if (typeof found === "string") {
    const trimmed = found.trim();
    if (trimmed === "") throw new ErrorClass(found, "corrupt version value");
    const n = Number(trimmed);
    if (!Number.isInteger(n)) throw new ErrorClass(found, "corrupt version value");
    major = n;
  } else {
    throw new ErrorClass(found, "corrupt version value");
  }

  if (!Number.isInteger(major)) throw new ErrorClass(found, "corrupt version value");
  if (major !== supportedMajor) {
    throw new ErrorClass(
      found,
      major > supportedMajor
        ? "data is newer than this reader supports"
        : "unsupported major version"
    );
  }
  return major;
}
