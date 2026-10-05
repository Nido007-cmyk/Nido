/**
 * Knowledge Graph - Entity/Relation Memory Layer
 *
 * NIDO Knowledge Graph (2026-10-05). From deep research DR-6.
 *
 * Adds a graph layer on top of NIDO's flat memory store:
 * - Entities: people, places, concepts, events
 * - Relations: typed connections between entities
 * - Decay: unused relations fade over time
 * - Hybrid retrieval: BM25 + vector + graph activation
 *
 * Pattern from DroidClaw (open source). Stored encrypted alongside
 * other memory. All user-visible and deletable.
 */

export type EntityType = "person" | "place" | "concept" | "event" | "object";

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  /** Aliases for matching ("Bob", "Robert") */
  aliases: string[];
  /** When first seen */
  createdAt: number;
  /** Last time this entity was referenced */
  lastSeenAt: number;
  /** Number of times referenced (for decay calculation) */
  mentionCount: number;
}

export type RelationType =
  | "knows"        // person knows person
  | "likes"        // person likes something
  | "dislikes"     // person dislikes something
  | "works_at"     // person works at place
  | "lives_in"     // person lives in place
  | "happened_at"  // event happened at place/time
  | "involves"     // event involves person
  | "prefers"      // person prefers something
  | "owns"         // person owns object
  | "related_to";  // generic relation

export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  type: RelationType;
  /** Strength 0-1 (decays over time if not reinforced) */
  strength: number;
  /** When created */
  createdAt: number;
  /** Last reinforced */
  lastReinforcedAt: number;
  /** Source: user stated, inferred, observed */
  source: "user" | "inferred" | "observed";
}

/**
 * In-memory knowledge graph.
 * Production persists to encrypted SQLite.
 * Pure logic - testable.
 */
export class KnowledgeGraph {
  private entities = new Map<string, Entity>();
  private relations = new Map<string, Relation>();
  private byName = new Map<string, string>(); // normalized name -> id

  /**
   * Add or get an entity. Returns the entity ID.
   */
  addEntity(
    type: EntityType,
    name: string,
    aliases: string[] = []
  ): string {
    const normalized = name.toLowerCase().trim();
    const existingId = this.byName.get(normalized);
    if (existingId) {
      const entity = this.entities.get(existingId)!;
      entity.lastSeenAt = Date.now();
      entity.mentionCount++;
      // Add new aliases
      for (const alias of aliases) {
        const aNorm = alias.toLowerCase().trim();
        if (!entity.aliases.includes(alias) && !this.byName.has(aNorm)) {
          entity.aliases.push(alias);
          this.byName.set(aNorm, existingId);
        }
      }
      return existingId;
    }

    const id = `ent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const entity: Entity = {
      id,
      type,
      name,
      aliases,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      mentionCount: 1,
    };
    this.entities.set(id, entity);
    this.byName.set(normalized, id);
    for (const alias of aliases) {
      this.byName.set(alias.toLowerCase().trim(), id);
    }
    return id;
  }

  /**
   * Add a relation between two entities.
   */
  addRelation(
    fromId: string,
    toId: string,
    type: RelationType,
    source: "user" | "inferred" | "observed" = "inferred",
    initialStrength = 0.5
  ): string | null {
    if (!this.entities.has(fromId) || !this.entities.has(toId)) {
      return null;
    }
    // Check for existing relation
    for (const rel of this.relations.values()) {
      if (rel.fromId === fromId && rel.toId === toId && rel.type === type) {
        // Reinforce existing
        rel.strength = Math.min(1, rel.strength + 0.1);
        rel.lastReinforcedAt = Date.now();
        return rel.id;
      }
    }

    const id = `rel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.relations.set(id, {
      id,
      fromId,
      toId,
      type,
      strength: initialStrength,
      createdAt: Date.now(),
      lastReinforcedAt: Date.now(),
      source,
    });
    return id;
  }

  /**
   * Get entity by name (or alias).
   */
  getEntity(name: string): Entity | null {
    const id = this.byName.get(name.toLowerCase().trim());
    return id ? this.entities.get(id) ?? null : null;
  }

  /**
   * Get all relations for an entity.
   */
  getRelations(entityId: string): Relation[] {
    return Array.from(this.relations.values()).filter(
      (r) => r.fromId === entityId || r.toId === entityId
    );
  }

  /**
   * Find entities related to the given entity (1-hop).
   */
  getNeighbors(entityId: string, minStrength = 0.1): Entity[] {
    const relations = this.getRelations(entityId);
    const neighborIds = new Set<string>();
    for (const rel of relations) {
      if (rel.strength >= minStrength) {
        neighborIds.add(rel.fromId === entityId ? rel.toId : rel.fromId);
      }
    }
    return Array.from(neighborIds)
      .map((id) => this.entities.get(id)!)
      .filter(Boolean);
  }

  /**
   * Apply decay to relations not recently reinforced.
   * Strength decays by decayRate per day since last reinforcement.
   * Relations below minStrength are removed.
   */
  applyDecay(decayRate = 0.05, minStrength = 0.1): number {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [id, rel] of this.relations) {
      const daysSince = (now - rel.lastReinforcedAt) / DAY;
      rel.strength = Math.max(0, rel.strength - decayRate * daysSince);
      if (rel.strength < minStrength) {
        this.relations.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get graph statistics.
   */
  stats(): { entities: number; relations: number } {
    return {
      entities: this.entities.size,
      relations: this.relations.size,
    };
  }
}
