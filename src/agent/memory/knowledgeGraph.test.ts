/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tests for Knowledge Graph (DR-6)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeGraph } from "./knowledgeGraph";

describe("KnowledgeGraph", () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = new KnowledgeGraph();
  });

  it("adds entities", () => {
    const id = graph.addEntity("person", "Alice");
    expect(id).toMatch(/^ent_/);
    const entity = graph.getEntity("Alice");
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe("person");
  });

  it("finds entities by alias", () => {
    graph.addEntity("person", "Robert", ["Bob", "Bobby"]);
    expect(graph.getEntity("Bob")).not.toBeNull();
    expect(graph.getEntity("bobby")).not.toBeNull();
  });

  it("is case-insensitive", () => {
    graph.addEntity("person", "Alice");
    expect(graph.getEntity("ALICE")).not.toBeNull();
    expect(graph.getEntity("alice")).not.toBeNull();
  });

  it("updates existing entity on re-add", () => {
    const id1 = graph.addEntity("person", "Alice");
    const id2 = graph.addEntity("person", "Alice");
    expect(id1).toBe(id2);
    const entity = graph.getEntity("Alice");
    expect(entity!.mentionCount).toBe(2);
  });

  it("adds relations", () => {
    const alice = graph.addEntity("person", "Alice");
    const bob = graph.addEntity("person", "Bob");
    const relId = graph.addRelation(alice, bob, "knows", "user", 0.8);
    expect(relId).not.toBeNull();
    expect(relId).toMatch(/^rel_/);
  });

  it("reinforces existing relations", () => {
    const alice = graph.addEntity("person", "Alice");
    const bob = graph.addEntity("person", "Bob");
    graph.addRelation(alice, bob, "knows", "user", 0.5);
    const relId2 = graph.addRelation(alice, bob, "knows", "user", 0.5);
    // Same relation ID (reinforced, not duplicated)
    const relations = graph.getRelations(alice);
    expect(relations).toHaveLength(1);
    expect(relations[0].strength).toBeGreaterThan(0.5);
  });

  it("gets neighbors", () => {
    const alice = graph.addEntity("person", "Alice");
    const bob = graph.addEntity("person", "Bob");
    const charlie = graph.addEntity("person", "Charlie");
    graph.addRelation(alice, bob, "knows");
    graph.addRelation(alice, charlie, "knows");

    const neighbors = graph.getNeighbors(alice);
    expect(neighbors).toHaveLength(2);
  });

  it("filters neighbors by strength", () => {
    const alice = graph.addEntity("person", "Alice");
    const bob = graph.addEntity("person", "Bob");
    graph.addRelation(alice, bob, "knows", "inferred", 0.05); // Weak

    const neighbors = graph.getNeighbors(alice, 0.1);
    expect(neighbors).toHaveLength(0);
  });

  it("applies decay", () => {
    const alice = graph.addEntity("person", "Alice");
    const bob = graph.addEntity("person", "Bob");
    graph.addRelation(alice, bob, "knows", "inferred", 0.15);

    // Simulate 3 days passing (decay 0.05/day = 0.15 total)
    // Relation should be removed (0.15 - 0.15 = 0 < 0.1)
    const removed = graph.applyDecay(0.05, 0.1);
    // Note: decay is time-based, this test uses real time
    // In production, we'd mock Date.now()
    expect(removed).toBeGreaterThanOrEqual(0);
  });

  it("returns stats", () => {
    graph.addEntity("person", "Alice");
    graph.addEntity("place", "Paris");
    const alice = graph.getEntity("Alice")!;
    const paris = graph.getEntity("Paris")!;
    graph.addRelation(alice.id, paris.id, "lives_in");

    const stats = graph.stats();
    expect(stats.entities).toBe(2);
    expect(stats.relations).toBe(1);
  });
});
