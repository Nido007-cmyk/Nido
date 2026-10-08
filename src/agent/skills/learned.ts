/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Learned Skills - Agent-created reusable procedures
 *
 * NIDO Learned Skills (2026-10-05). From deep research DR-4.
 *
 * The agent learns from successful task executions and user corrections,
 * creating reusable "skills" that compound in value over time.
 * Month 6 feels smarter than day 1.
 *
 * A learned skill captures:
 * - When to use it (trigger patterns)
 * - How to do it (step-by-step procedure)
 * - What worked (successful examples)
 *
 * Storage: encrypted (SQLCipher) alongside other agent memory.
 * All skills are user-visible and deletable.
 */

import type { Skill } from "./types";

export interface LearnedSkill extends Skill {
  /** When the skill was learned */
  learnedAt: number;
  /** How many times it's been used successfully */
  useCount: number;
  /** How many times it's been used (for success rate) */
  totalUses: number;
  /** Example task that led to learning this skill */
  learnedFrom: string;
  /** User-provided corrections that refined the skill */
  refinements: string[];
}

/**
 * In-memory store for learned skills.
 * In production, this persists to the encrypted DB.
 * Pure logic for testing; storage adapter injected.
 */
export class LearnedSkillStore {
  private skills = new Map<string, LearnedSkill>();

  /**
   * Save a newly learned skill.
   * Returns false if a skill with the same name already exists.
   */
  learn(skill: Omit<LearnedSkill, "learnedAt" | "useCount" | "totalUses" | "refinements">): boolean {
    const key = skill.name.toLowerCase();
    if (this.skills.has(key)) {
      return false;
    }
    this.skills.set(key, {
      ...skill,
      learnedAt: Date.now(),
      useCount: 0,
      totalUses: 0,
      refinements: [],
    });
    return true;
  }

  /**
   * Get a learned skill by name.
   */
  get(name: string): LearnedSkill | null {
    return this.skills.get(name.toLowerCase()) ?? null;
  }

  /**
   * List all learned skills.
   */
  list(): LearnedSkill[] {
    return Array.from(this.skills.values()).sort(
      (a, b) => b.useCount - a.useCount // Most useful first
    );
  }

  /**
   * Record successful use of a skill.
   */
  recordSuccess(name: string): void {
    const skill = this.skills.get(name.toLowerCase());
    if (skill) {
      skill.useCount++;
      skill.totalUses++;
    }
  }

  /**
   * Record failed use of a skill.
   */
  recordFailure(name: string): void {
    const skill = this.skills.get(name.toLowerCase());
    if (skill) {
      skill.totalUses++;
    }
  }

  /**
   * Add a user refinement to a skill.
   * The agent incorporates user corrections into the skill instructions.
   */
  refine(name: string, correction: string): boolean {
    const skill = this.skills.get(name.toLowerCase());
    if (!skill) return false;
    skill.refinements.push(correction);
    return true;
  }

  /**
   * Delete a learned skill (user control).
   */
  delete(name: string): boolean {
    return this.skills.delete(name.toLowerCase());
  }

  /**
   * Get success rate for a skill (0-1, or null if never used).
   */
  successRate(name: string): number | null {
    const skill = this.skills.get(name.toLowerCase());
    if (!skill || skill.totalUses === 0) return null;
    return skill.useCount / skill.totalUses;
  }

  /**
   * Suggest skills that might be relevant for a task description.
   * Simple keyword matching; in production, use embeddings.
   */
  suggestFor(task: string): LearnedSkill[] {
    const words = task.toLowerCase().split(/\s+/);
    return this.list().filter((skill) => {
      const text = `${skill.name} ${skill.description}`.toLowerCase();
      return words.some((w) => w.length > 3 && text.includes(w));
    });
  }
}
