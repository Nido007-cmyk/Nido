/**
 * knowledgeGraphStore.ts - NIDO: persistencia del knowledge graph en SQLCipher.
 *
 * Entidades y relaciones viven en `nido_memory.db`. Sigue el patrón de
 * `taskStore.ts`: apertura perezosa, escrituras serializadas,
 * SQLCipher fail-closed en release.
 *
 * La lógica pura (KnowledgeGraph en memoria) vive en `knowledgeGraph.ts`;
 * aquí solo la persistencia.
 */

import type { Entity, Relation } from "./knowledgeGraph";
import {
  getDatabase,
  safeJsonParse,
  writeTransaction,
} from "../../security/databaseManager";

function rowToEntity(row: any): Entity {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    aliases: safeJsonParse<string[]>(row.aliases, []),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    mentionCount: row.mention_count,
  };
}

function rowToRelation(row: any): Relation {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    type: row.type,
    strength: row.strength,
    createdAt: row.created_at,
    lastReinforcedAt: row.last_reinforced_at,
    source: row.source,
  };
}

/** Guarda o actualiza una entidad. */
export async function saveEntity(entity: Entity): Promise<void> {
  await writeTransaction(async (database) => {
  await database.runAsync(
        `INSERT INTO kg_entities
          (id, type, name, aliases, created_at, last_seen_at, mention_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, aliases=excluded.aliases,
          last_seen_at=excluded.last_seen_at,
          mention_count=excluded.mention_count`,
        [
          entity.id,
          entity.type,
          entity.name,
          JSON.stringify(entity.aliases),
          entity.createdAt,
          entity.lastSeenAt,
          entity.mentionCount,
        ]
      )
  });
}

/** Obtiene una entidad por ID. */
export async function getEntity(id: string): Promise<Entity | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<any>(
    "SELECT * FROM kg_entities WHERE id = ?",
    [id]
  );
  return row ? rowToEntity(row) : null;
}

/** Busca entidades por nombre o alias (case-insensitive). */
export async function findEntitiesByName(name: string): Promise<Entity[]> {
  const database = await getDatabase();
  const pattern = `%${name.toLowerCase()}%`;
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM kg_entities
     WHERE lower(name) LIKE ? OR lower(aliases) LIKE ?
     ORDER BY mention_count DESC LIMIT 20`,
    [pattern, pattern]
  );
  return rows.map(rowToEntity);
}

/** Lista todas las entidades. */
export async function listEntities(): Promise<Entity[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    "SELECT * FROM kg_entities ORDER BY last_seen_at DESC"
  );
  return rows.map(rowToEntity);
}

/** Elimina una entidad y sus relaciones. */
export async function deleteEntity(id: string): Promise<void> {
  // D2-2026-10-06: sin withTransactionAsync anidado — writeTransaction ya
  // abre la transacción; expo-sqlite no soporta savepoints y el anidado
  // lanzaba "cannot start a transaction within a transaction".
  await writeTransaction(async (database) => {
    await database.runAsync("DELETE FROM kg_relations WHERE from_id = ? OR to_id = ?", [id, id]);
    await database.runAsync("DELETE FROM kg_entities WHERE id = ?", [id]);
  });
}

/** Guarda o actualiza una relación. */
export async function saveRelation(relation: Relation): Promise<void> {
  await writeTransaction(async (database) => {
  await database.runAsync(
        `INSERT INTO kg_relations
          (id, from_id, to_id, type, strength, created_at, last_reinforced_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          strength=excluded.strength,
          last_reinforced_at=excluded.last_reinforced_at`,
        [
          relation.id,
          relation.fromId,
          relation.toId,
          relation.type,
          relation.strength,
          relation.createdAt,
          relation.lastReinforcedAt,
          relation.source,
        ]
      )
  });
}

/** Obtiene relaciones de una entidad (como origen o destino). */
export async function getRelationsForEntity(entityId: string): Promise<Relation[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM kg_relations
     WHERE from_id = ? OR to_id = ?
     ORDER BY strength DESC`,
    [entityId, entityId]
  );
  return rows.map(rowToRelation);
}

/** Elimina una relación. */
export async function deleteRelation(id: string): Promise<void> {
  await writeTransaction(async (database) => {
  await database.runAsync("DELETE FROM kg_relations WHERE id = ?", [id])
  });
}

/** Aplica decaimiento a relaciones no reforzadas (llamar periódicamente). */
export async function applyDecay(
  decayRate: number = 0.01,
  minStrength: number = 0.1
): Promise<number> {
  const result = await writeTransaction(async (database) => {
    return database.runAsync(
      `UPDATE kg_relations
       SET strength = max(?, strength * (1 - ?)),
           last_reinforced_at = last_reinforced_at
       WHERE strength > ?`,
      [minStrength, decayRate, minStrength]
    );
  });
  return result.changes ?? 0;
}

/**
 * @deprecated Usar closeDatabase() del DatabaseManager.
 * Mantenido para compatibilidad; ahora es no-op.
 */
export async function closeKnowledgeGraphStore(): Promise<void> {
  // El DatabaseManager centraliza el cierre.
}
