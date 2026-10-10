/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * branding.ts — Configuración central de marca NIDO.
 *
 * REBRAND-2026-10-07: Toda la marca visible al usuario vive aquí. Si en el
 * futuro se necesita cambiar el nombre (p. ej. por un conflicto legal),
 * se cambia en este archivo y en los archivos listados en docs/internal/REBRAND.md.
 *
 * REGLA CRÍTICA: Los identificadores de protocolo (`nido-hello`,
 * `nido-confirm`, UUIDs Bluetooth, etc.) NO están aquí y NO deben cambiar
 * con un rebrand. Son parte del protocolo wire y cambiarlos rompería la
 * compatibilidad entre dispositivos. Ver `src/p2p/protocol.ts`.
 */

/** Nombre de la app visible al usuario. */
export const APP_NAME = "NIDO";

/** Tagline / eslogan. */
export const APP_TAGLINE = "your agent, your world";

/** Nombre para el system prompt del agente ("Eres NIDO..."). */
export const AGENT_NAME = "NIDO";

/** Descripción corta para stores y metadatos. */
export const APP_DESCRIPTION =
  "NIDO — your agent, your world. Privacy-first offline personal AI assistant for Android.";

/** Identidad del asistente en respuestas ("Soy NIDO, tu asistente..."). */
export function agentIdentity(lang: "es" | "en" | "pt" = "es"): string {
  switch (lang) {
    case "en":
      return `I am ${AGENT_NAME}, your offline personal assistant.`;
    case "pt":
      return `Sou ${AGENT_NAME}, seu assistente pessoal offline.`;
    default:
      return `Soy ${AGENT_NAME}, tu asistente personal offline.`;
  }
}
