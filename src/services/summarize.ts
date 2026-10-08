/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { llamaEngine } from "../inference/LlamaEngine";
import { ConversationTurn } from "../rag/pure";

/**
 * Both of these reuse the single shared llama.cpp context (llamaEngine),
 * which can only run one completion at a time — they are NOT safe to run
 * concurrently with the main chat generation or with each other. Callers
 * (ChatScreen) are responsible for treating these as cancellable background
 * tasks: if the user sends a new message while one is still running, call
 * llamaEngine.stop() first (see ChatScreen's backgroundTaskRef handling).
 */

export async function generateSessionTitle(firstUserMessage: string): Promise<string> {
  // P1.4: messages+jinja when the GGUF ships a template, else the legacy
  // hand-built prompt.
  const instruction =
    `Generate a short 3-5 word title (no punctuation, no quotes) for a chat ` +
    `that starts with the message below.`;
  const promptParams = llamaEngine.hasEmbeddedChatTemplate()
    ? {
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: firstUserMessage },
        ],
      }
    : {
        prompt:
          `${instruction}\n"${firstUserMessage}"\n\nTitle:`,
      };
  const text = await llamaEngine.generate({ ...promptParams, nPredict: 16, temperature: 0.3 });
  const title = text.trim().replace(/^["']|["']$/g, "").split("\n")[0].slice(0, 60);
  return title || "New chat";
}

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
  const text = await llamaEngine.generate({ ...promptParams, nPredict: 150, temperature: 0.3 });
  return text.trim();
}
