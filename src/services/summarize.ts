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
 */

export async function summarizeConversation(
  turns: ConversationTurn[],
  previousSummary?: string | null
): Promise<string> {
  // C3-2026-10-06: truncar el transcript a un presupuesto antes de resumir.
  // En sesiones largas son decenas de miles de tokens → throw determinístico
  // desperdiciando batería. Se conservan los turnos más recientes.
  const MAX_TRANSCRIPT_CHARS = 6000; // ~1500 tokens
  let transcript = turns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
    .join("\n");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
    // Evitar empezar a mitad de una línea.
    const nl = transcript.indexOf("\n");
    if (nl > 0) transcript = transcript.slice(nl + 1);
  }
  const instruction =
    `Summarize the key facts, constraints, and user preferences from this ` +
    `conversation into 2-3 bullet points.`;
  const userContent =
    `${previousSummary ? `Existing summary:\n${previousSummary}\n\n` : ""}` +
    `${transcript}`;
  // P1.4: messages+jinja when the GGUF ships a template, else the legacy
  // hand-built prompt.
  const promptParams = llamaEngine.hasEmbeddedChatTemplate()
    ? {
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: userContent },
        ],
      }
    : {
        prompt: `${instruction}\n${userContent}\n\nSummary:`,
      };
  const text = await llamaEngine.generate({ ...promptParams, nPredict: 150, temperature: 0.3, samplingPreset: "factual" });
  return text.trim();
}
