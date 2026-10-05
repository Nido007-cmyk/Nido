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
  const prompt =
    `Generate a short 3-5 word title (no punctuation, no quotes) for a chat ` +
    `that starts with this message:\n"${firstUserMessage}"\n\nTitle:`;
  const text = await llamaEngine.generate({ prompt, nPredict: 16, temperature: 0.3 });
  const title = text.trim().replace(/^["']|["']$/g, "").split("\n")[0].slice(0, 60);
  return title || "New chat";
}

export async function summarizeConversation(
  turns: ConversationTurn[],
  previousSummary?: string | null
): Promise<string> {
  const transcript = turns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
    .join("\n");
  const prompt =
    `${previousSummary ? `Existing summary:\n${previousSummary}\n\n` : ""}` +
    `Summarize the key facts, constraints, and user preferences from this ` +
    `conversation into 2-3 bullet points:\n\n${transcript}\n\nSummary:`;
  const text = await llamaEngine.generate({ prompt, nPredict: 150, temperature: 0.3 });
  return text.trim();
}
