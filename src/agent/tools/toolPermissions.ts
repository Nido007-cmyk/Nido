/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * toolPermissions.ts — herramientas que el usuario desactivó.
 *
 * El usuario puede apagar cualquier herramienta del agente. Solo se puede
 * restringir: no existe un modo «permitir sin preguntar», así que este
 * ajuste nunca relaja la política de seguridad ni las confirmaciones.
 *
 * El conjunto vive en memoria (consulta síncrona desde el despachador) y la
 * capa de ajustes lo carga al arrancar y lo guarda al cambiar.
 */

let disabled = new Set<string>();

export function isToolDisabled(name: string): boolean {
  return disabled.has(name);
}

export function getDisabledTools(): string[] {
  return [...disabled].sort();
}

/** Sustituye el conjunto completo (carga desde ajustes, tests). */
export function setDisabledTools(names: readonly string[]): void {
  disabled = new Set(names.filter((n) => typeof n === "string" && n.length > 0));
}

export function setToolDisabled(name: string, off: boolean): string[] {
  const next = new Set(disabled);
  if (off) next.add(name);
  else next.delete(name);
  disabled = next;
  return getDisabledTools();
}
