/**
 * Reasoning models put their thinking before the answer, marked in a
 * model-specific way: <think>...</think> (LFM2.5, Qwen3 and others) or
 * <|channel>thought ... <channel|> (Gemma 4). This separates the two so the
 * chat can hide the reasoning behind a toggle and keep it out of copied
 * text and history.
 */
export interface SplitThinking {
  /** The answer shown to the user. */
  answer: string;
  /** The reasoning text, or null if the model didn't reason. */
  thinking: string | null;
  /** Still streaming the reasoning: the block opened but hasn't closed yet. */
  thinkingInProgress: boolean;
}

const MARKERS: Array<{ open: string; close: string }> = [
  { open: "<think>", close: "</think>" },
  { open: "<|channel>thought", close: "<channel|>" },
];

function split(text: string, open: string, close: string): SplitThinking | null {
  const o = text.indexOf(open);
  if (o === -1) {
    // Some templates open the block in the prompt, so only the closing marker is generated.
    const c = text.indexOf(close);
    if (c === -1) return null;
    return {
      answer: text.slice(c + close.length).trim(),
      thinking: text.slice(0, c).trim() || null,
      thinkingInProgress: false,
    };
  }
  const before = text.slice(0, o);
  const rest = text.slice(o + open.length);
  const c = rest.indexOf(close);
  if (c === -1) return { answer: before.trim(), thinking: rest.trim() || null, thinkingInProgress: true };
  return {
    answer: `${before}${rest.slice(c + close.length)}`.trim(),
    thinking: rest.slice(0, c).trim() || null,
    thinkingInProgress: false,
  };
}

export function splitThinking(text: string): SplitThinking {
  for (const { open, close } of MARKERS) {
    const result = split(text, open, close);
    if (result) return result;
  }
  // Mid-stream, only part of an opening marker may have arrived ("<|chan").
  const start = text.trimStart();
  if (start.length > 0 && MARKERS.some((m) => m.open.startsWith(start))) {
    return { answer: "", thinking: null, thinkingInProgress: true };
  }
  return { answer: text, thinking: null, thinkingInProgress: false };
}

/** The answer alone, for copying and conversation history. */
export function stripThinking(text: string): string {
  return splitThinking(text).answer;
}
