/**
 * types.ts — NIDO: definición de Skill.
 *
 * Una skill es un paquete reutilizable de instrucciones en español que le
 * dice al agente *cómo* resolver una clase de tarea paso a paso, usando
 * sus herramientas locales. Las built-in viven en builtIn.ts; el registro
 * (registry.ts) las expone al loop agéntico.
 */

export interface Skill {
  /** Nombre único, p.ej. "analiza-datos". */
  name: string;
  /** Una línea: cuándo usarla. Aparece en el prompt del sistema. */
  description: string;
  /** Instrucciones detalladas que el agente sigue paso a paso. */
  instructions: string;
}
