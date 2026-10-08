/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * registry.ts - NIDO: registro de skills.
 *
 * Puro, sin dependencias. El loop agéntico lista las descripciones en el
 * prompt del sistema y carga las instrucciones completas bajo demanda
 * con la herramienta `use_skill`.
 *
 * Combina built-in (síncronas) + aprendidas (persistidas en SQLCipher).
 */

import type { Skill } from "./types";
import { BUILT_IN_SKILLS } from "./builtIn";
import { listLearnedSkills } from "./learnedSkillStore";

const byName = new Map<string, Skill>(
  BUILT_IN_SKILLS.map((s) => [s.name.toLowerCase(), s])
);

/** Nombres y descripciones para el prompt del sistema (solo built-in, síncrono). */
export function listSkills(): { name: string; description: string }[] {
  return BUILT_IN_SKILLS.map((s) => ({ name: s.name, description: s.description }));
}

/**
 * Lista todas las skills: built-in + aprendidas (desde SQLCipher).
 * Para el prompt del sistema cuando se puede hacer async.
 */
export async function listAllSkills(): Promise<{ name: string; description: string }[]> {
  const builtIn = listSkills();
  try {
    const learned = await listLearnedSkills();
    const learnedList = learned.map((s) => ({
      name: s.name,
      description: `${s.description} (aprendida)`,
    }));
    return [...builtIn, ...learnedList];
  } catch {
    // Si la DB no está disponible, solo built-in.
    return builtIn;
  }
}

/** Carga una skill por nombre (insensible a mayúsculas). Null si no existe. */
export function loadSkill(name: string): Skill | null {
  return byName.get((name ?? "").trim().toLowerCase()) ?? null;
}

/**
 * Carga una skill por nombre, buscando también en aprendidas.
 * Para la herramienta `use_skill` cuando se puede hacer async.
 */
export async function loadSkillAsync(name: string): Promise<Skill | null> {
  const builtIn = loadSkill(name);
  if (builtIn) return builtIn;
  try {
    const { getLearnedSkill } = await import("./learnedSkillStore");
    return (await getLearnedSkill(name)) ?? null;
  } catch {
    return null;
  }
}

/** Bloque para el prompt del sistema del agente (solo built-in, síncrono). */
export function describeSkillsForPrompt(): string {
  const skills = listSkills();
  if (skills.length === 0) return "(sin skills registradas)";
  return (
    "Puedes cargar instrucciones detalladas con la herramienta `use_skill`:\n" +
    skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
  );
}

/**
 * Bloque para el prompt del sistema incluyendo aprendidas.
 * Para usar cuando el loop puede hacer async antes de construir el prompt.
 */
export async function describeAllSkillsForPrompt(): Promise<string> {
  const skills = await listAllSkills();
  if (skills.length === 0) return "(sin skills registradas)";
  return (
    "Puedes cargar instrucciones detalladas con la herramienta `use_skill`:\n" +
    skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
  );
}
