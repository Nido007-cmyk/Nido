/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { llamaEngine } from "../inference/LlamaEngine";
import { ConversationTurn } from "../rag/pure";

/**
 * summarizeConversation reuses the single shared llama.cpp context
 * (llamaEngine), which runs one completion at a time: it is NOT
 * safe to run concurrently with the main chat generation. Callers
 * (ChatScreen) are responsible for treating it as a cancellable
 * background task: if the user sends a new message while it is
 * still running, call llamaEngine.stop() first (see ChatScreen's
 * backgroundTaskRef handling). (El motor además serializa los
 * generate() desde la auditoría de 2026-10-31, M-6.)
 *
 * Auditoría completa 2026-10-31 (I-1): generateSessionTitle, la
 * vía muerta de títulos por modelo sustituida en 0.1.61 por
 * titleFromQuestion, se retira: ningún llamante la usaba y su
 * presencia sugería una ruta viva que no existe. La historia
 * queda en git y en los comentarios de selfKnowledge.ts.
 *
 * Núcleo 3 · N-09 (auditoría 2026-11-01): la ventana de historial.
 * El resumen corría sobre el transcript RECORTADO POR LA COLA a
 * 6.000 caracteres (C3-2026-10-06): en una conversación larga los
 * turnos viejos jamás entraban en ninguna pasada y sus datos se
 * perdían del resumen en silencio — justo los que el resumen
 * existe para conservar. Ahora el transcript se resume en trozos
 * secuenciales DESDE EL PRINCIPIO y cada pasada encadena el
 * resumen anterior: todo turno entra en alguna pasada. Residuo
 * declarado: una sola línea mayor que el trozo se recorta a su
 * principio dentro de su propio trozo. Y la instrucción va en el
 * idioma de la conversación (antes solo inglés, con la respuesta
 * derivando a inglés en sesiones es/pt).
 *
 * Retraso declarado de una ronda (diseño, no defecto): el resumen
 * que un turno usa como contexto es el calculado en la ronda
 * anterior; el nuevo se calcula en segundo plano DESPUÉS de la
 * respuesta y rige desde el turno siguiente.
 */

export type SummaryLang = "es" | "en" | "pt";

const SUMMARY_TEXT: Record<SummaryLang, { instruction: string; existingLabel: string }> = {
  // La instrucción EN es la original, byte a byte.
  en: {
    instruction:
      "Summarize the key facts, constraints, and user preferences from this " +
      "conversation into 2-3 bullet points.",
    existingLabel: "Existing summary:",
  },
  es: {
    instruction:
      "Resume los datos clave, las restricciones y las preferencias del usuario de esta " +
      "conversación en 2-3 puntos.",
    existingLabel: "Resumen existente:",
  },
  pt: {
    instruction:
      "Resuma os fatos principais, as restrições e as preferências do usuário desta " +
      "conversa em 2-3 tópicos.",
    existingLabel: "Resumo existente:",
  },
};

// C3-2026-10-06: presupuesto por pasada al motor (en sesiones largas
// el transcript entero son decenas de miles de tokens → throw
// determinístico desperdiciando batería). El presupuesto se queda;
// lo que cambia con N-09 es que acota CADA TROZO, no el total.
const MAX_TRANSCRIPT_CHARS = 6000; // ~1500 tokens

/** Parte las líneas del transcript en trozos de ≤ MAX desde el principio. */
function chunkTranscriptLines(lines: string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const line of lines) {
    const piece = line.length > MAX_TRANSCRIPT_CHARS ? line.slice(0, MAX_TRANSCRIPT_CHARS) : line;
    if (current.length > 0 && currentLen + piece.length + 1 > MAX_TRANSCRIPT_CHARS) {
      chunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
    current.push(piece);
    currentLen += piece.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

export async function summarizeConversation(
  turns: ConversationTurn[],
  previousSummary?: string | null,
  lang: SummaryLang = "en"
): Promise<string> {
  const txt = SUMMARY_TEXT[lang] ?? SUMMARY_TEXT.en;
  const lines = turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`);
  const chunks = chunkTranscriptLines(lines);
  // Sin líneas (nadie llama así hoy; el llamante guarda la lista
  // vacía) se conserva la conducta anterior: una pasada vacía.
  const effectiveChunks = chunks.length > 0 ? chunks : [""];

  let running: string | null = previousSummary ?? null;
  for (const chunk of effectiveChunks) {
    const userContent = `${running ? `${txt.existingLabel}\n${running}\n\n` : ""}${chunk}`;
    // P1.4: messages+jinja when the GGUF ships a template, else the legacy
    // hand-built prompt.
    const promptParams = llamaEngine.hasEmbeddedChatTemplate()
      ? {
          messages: [
            { role: "system", content: txt.instruction },
            { role: "user", content: userContent },
          ],
        }
      : {
          prompt: `${txt.instruction}\n${userContent}\n\nSummary:`,
        };
    const text = await llamaEngine.generate({ ...promptParams, nPredict: 150, temperature: 0.3, samplingPreset: "factual" });
    running = text.trim();
  }
  return (running ?? "").trim();
}
