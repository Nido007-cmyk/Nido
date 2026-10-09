/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * memoryMigrations.ts — registro de migraciones de `nido_memory.db`.
 *
 * L1: vacío. No existen migraciones v1→v2 todavía (`MEMORY_DB_SCHEMA_VERSION`
 * sigue en 1), así que `applyMigrations` se comporta exactamente como el
 * `checkFormatVersion` anterior: acepta v1, rechaza el resto fail-closed.
 *
 * Cuando se necesite un cambio de esquema no aditivo:
 *  1. subir `MEMORY_DB_SCHEMA_VERSION` en `formatVersion.ts`;
 *  2. añadir aquí `{ from: <vieja>, to: <nueva>, up }` con el DDL/DML;
 *  3. añadir un test en `dbMigrations.test.ts` (o un fixture) que abra una
 *     base vieja y verifique la migración.
 *
 * Ver `docs/architecture/TECH_DEBT.md` TD-5.
 */

import type { DbMigration } from "./dbMigrations";

/** Migraciones de nido_memory.db, en orden de aplicación. Vacío en L1. */
export const MEMORY_MIGRATIONS: DbMigration[] = [];
