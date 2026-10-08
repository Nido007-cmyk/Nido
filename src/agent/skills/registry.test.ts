/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { listSkills, loadSkill, describeSkillsForPrompt } from "./registry";

describe("skill registry", () => {
  it("lista las skills integradas con nombre y descripción", () => {
    const skills = listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(3);
    const names = skills.map((s) => s.name);
    expect(names).toContain("analiza-datos");
    expect(names).toContain("planifica-mi-dia");
    expect(names).toContain("resume-archivo");
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(10);
    }
  });

  it("carga por nombre insensible a mayúsculas", () => {
    const s = loadSkill("Analiza-Datos");
    expect(s).not.toBeNull();
    expect(s!.instructions).toContain("analyze_table");
  });

  it("devuelve null con nombre desconocido o vacío", () => {
    expect(loadSkill("no-existe")).toBeNull();
    expect(loadSkill("")).toBeNull();
  });

  it("describe para el prompt", () => {
    const text = describeSkillsForPrompt();
    expect(text).toContain("use_skill");
    expect(text).toContain("analiza-datos");
  });
});
