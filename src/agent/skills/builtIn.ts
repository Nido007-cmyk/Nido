/**
 * builtIn.ts — NIDO: skills integradas (Fase D).
 *
 * Instrucciones curadas en español para tareas recurrentes. El agente las
 * descubre por su descripción y las carga con la herramienta `use_skill`.
 * Todo lo que hacen usa herramientas locales: cero red.
 */

import type { Skill } from "./types";

export const BUILT_IN_SKILLS: Skill[] = [
  {
    name: "analiza-datos",
    description: "Analizar archivos de datos tabulares (CSV/TSV): estadísticas, filtros y respuestas con cifras exactas.",
    instructions: [
      "# Skill: analiza-datos",
      "",
      "Cuando el usuario te pida analizar datos tabulares (CSV, TSV o similar):",
      "",
      "1. Si aún no tienes el contenido, usa `read_picked_file` para que el usuario elija el archivo (máx. 200 KB).",
      "2. Pasa el texto a `analyze_table`. Te devuelve columnas, tipos inferidos, estadísticas por columna y las primeras filas.",
      "3. Para preguntas específicas usa sus parámetros:",
      '   - `filter`: "producto=pan", "importe>100"; combina con ";" (Y lógico).',
      "   - `sort_by`: columna (usa \"-columna\" para descendente).",
      "   - `top_n`: cuántas filas mostrar.",
      "4. Responde con las cifras exactas del análisis y una conclusión breve en español.",
      "5. Nunca inventes números: si el análisis no trae un dato, dilo y sugiere cómo obtenerlo.",
    ].join("\n"),
  },
  {
    name: "planifica-mi-dia",
    description: "Armar el plan del día: combina calendario, hora actual y notas para proponer un orden por horas.",
    instructions: [
      "# Skill: planifica-mi-dia",
      "",
      "Cuando el usuario te pida planificar u organizar su día:",
      "",
      "1. Llama `device_time` para ubicarte en fecha y hora.",
      "2. Llama `list_calendar_events` para hoy (from/to con la fecha de hoy).",
      "3. Llama `list_notes` por si hay pendientes anotados relevantes.",
      "4. Propón un plan por bloques horarios en español: eventos fijos primero, luego tareas, con pausas.",
      "5. Si falta información clave (p.ej. a qué hora empieza a trabajar), pregunta antes de inventar horarios.",
      "6. Cierra ofreciendo crear recordatorios o eventos con `create_reminder` / `create_calendar_event` si el usuario quiere.",
    ].join("\n"),
  },
  {
    name: "resume-archivo",
    description: "Resumir un archivo que el usuario elija: de qué trata, puntos clave y acción sugerida.",
    instructions: [
      "# Skill: resume-archivo",
      "",
      "Cuando el usuario te pida resumir o explicar un archivo:",
      "",
      "1. Usa `read_picked_file` para que elija el archivo (máx. 200 KB de texto).",
      "2. Si parece una tabla (CSV), considera la skill `analiza-datos` en su lugar.",
      "3. Resume en español con esta estructura:",
      "   - De qué trata (1 línea).",
      "   - 3–5 puntos clave.",
      "   - Qué acción sugiere, si aplica.",
      "4. No pegues el texto completo: cita fragmentos cortos solo si aportan.",
    ].join("\n"),
  },
];
