/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Auditoría 0.1.79 — «Reintentar» tras una respuesta fallida.
 *
 * Antes: la burbuja de error era texto que empezaba por «Error:», y
 *  - se mandaba al modelo como si fuera una respuesta suya en la siguiente
 *    pregunta (historial contaminado);
 *  - «Reintentar» volvía a enviar la pregunta y la dejaba DOS veces en la
 *    conversación (y en el historial guardado, la primera sin respuesta).
 * Ahora el fallo es una marca (`failed`), no un texto, y reintentar quita
 * la pregunta fallida y su error antes de volver a enviarla.
 */

export interface RetryableMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  failed?: boolean;
}

export interface RetryPlan {
  /** La pregunta que se vuelve a enviar. */
  question: string;
  /** Burbujas que salen de la conversación (la pregunta fallida y su error). */
  removeIds: string[];
  /** De ellas, las que estaban guardadas en el historial (la pregunta). */
  deleteFromHistory: string[];
}

/** Qué reintentar: la última pregunta; si falló, se quita junto con su error. */
export function planRetry(messages: RetryableMessage[]): RetryPlan | null {
  let userIdx = -1;
  for (let k = messages.length - 1; k >= 0; k--) {
    if (messages[k].role === "user") {
      userIdx = k;
      break;
    }
  }
  if (userIdx < 0) return null;
  const user = messages[userIdx];
  const after = messages.slice(userIdx + 1);
  const failedAfter = after.filter((m) => m.role === "assistant" && m.failed);
  if (failedAfter.length === 0) return { question: user.text, removeIds: [], deleteFromHistory: [] };
  return {
    question: user.text,
    removeIds: [user.id, ...failedAfter.map((m) => m.id)],
    deleteFromHistory: [user.id],
  };
}

/** Lo que el modelo ve como conversación previa: sin errores ni preguntas que no tuvieron respuesta. */
export function historyForModel<T extends RetryableMessage>(messages: T[]): T[] {
  const out: T[] = [];
  for (let k = 0; k < messages.length; k++) {
    const m = messages[k];
    if (m.text.length === 0 || m.failed) continue;
    const next = messages[k + 1];
    if (m.role === "user" && next?.role === "assistant" && next.failed) continue;
    out.push(m);
  }
  return out;
}
