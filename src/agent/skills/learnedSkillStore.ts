/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * learnedSkillStore.ts - NIDO: persistencia de learned skills en SQLCipher.
 *
 * Usa el DatabaseManager centralizado (`src/security/databaseManager.ts`):
 * - Una sola conexión a `nido_memory.db`
 * - Escrituras serializadas globales
 * - Wipe gate y epoch centralizados
 *
 * La lógica pura (LearnedSkillStore en memoria) vive en `learned.ts`;
 * aquí solo la persistencia. El registry combina built-in + aprendidas.
 */

import type { LearnedSkill } from "./learned";
import {
  getDatabase,
  safeJsonParse,
  writeTransaction,
} from "../../security/databaseManager";

function rowToSkill(row: any): LearnedSkill {
  return {
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    learnedAt: row.learned_at,
    useCount: row.use_count,
    totalUses: row.total_uses,
    learnedFrom: row.learned_from,
    refinements: safeJsonParse<string[]>(row.refinements, []),
  };
}

/** Guarda o actualiza una skill aprendida. */
export async function saveLearnedSkill(skill: LearnedSkill): Promise<void> {
  await writeTransaction(async (database) => {
    await database.runAsync(
      `INSERT INTO learned_skills
        (name, description, instructions, learned_at,
         use_count, total_uses, learned_from, refinements)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
        description=excluded.description,
        instructions=excluded.instructions,
        use_count=excluded.use_count,
        total_uses=excluded.total_uses,
        refinements=excluded.refinements`,
      [
        skill.name,
        skill.description,
        skill.instructions,
        skill.learnedAt,
        skill.useCount,
        skill.totalUses,
        skill.learnedFrom,
        JSON.stringify(skill.refinements),
      ]
    );
  });
}

/** Obtiene una skill por nombre (insensible a mayúsculas). */
export async function getLearnedSkill(name: string): Promise<LearnedSkill | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<any>(
    "SELECT * FROM learned_skills WHERE lower(name) = lower(?)",
    [name]
  );
  return row ? rowToSkill(row) : null;
}

/** Lista todas las skills aprendidas. */
export async function listLearnedSkills(): Promise<LearnedSkill[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    "SELECT * FROM learned_skills ORDER BY use_count DESC, learned_at DESC"
  );
  return rows.map(rowToSkill);
}

/** Elimina una skill aprendida (el usuario puede borrarlas). */
export async function deleteLearnedSkill(name: string): Promise<void> {
  await writeTransaction(async (database) => {
    await database.runAsync(
      "DELETE FROM learned_skills WHERE lower(name) = lower(?)",
      [name]
    );
  });
}

/** Incrementa contadores de uso. */
export async function recordSkillUse(name: string, success: boolean): Promise<void> {
  await writeTransaction(async (database) => {
    await database.runAsync(
      `UPDATE learned_skills
       SET total_uses = total_uses + 1,
           use_count = use_count + ?
       WHERE lower(name) = lower(?)`,
      [success ? 1 : 0, name]
    );
  });
}

/**
 * @deprecated Usar closeDatabase() del DatabaseManager.
 * Mantenido para compatibilidad; ahora es no-op.
 */
export async function closeLearnedSkillStore(): Promise<void> {
  // El DatabaseManager centraliza el cierre.
}
