/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * irreversibleTools.ts — LA lista de herramientas irreversibles.
 *
 * T-11 (0.1.99, m-12): hasta esta tanda la lista vivía DUPLICADA en
 * policyEngine.ts y en authorization.ts. Coincidían (12 nombres)
 * porque un test las comparaba, no por construcción: el día que una
 * copia se editara sin la otra, una de las dos rutas de decisión
 * dejaría de frenar una acción irreversible sin que nada lo notara en
 * el momento del cambio. Este módulo es la única fuente: no importa
 * nada (módulo hoja) para que policyEngine y authorization puedan
 * importarlo sin crear un ciclo (authorization ya importa de
 * policyEngine).
 *
 * Los nombres coinciden con el manifiesto de herramientas
 * (../tools/manifest.ts) y con las herramientas del protocolo P2P.
 */
export const IRREVERSIBLE_TOOLS: ReadonlySet<string> = new Set([
  "send_sms",
  "nido_send_message",
  "place_call",
  "nido_pair",
  "nido_approve_task",
  "send_email",
  "purchase",
  "delete_file",
  "delete_memory",
  "factory_reset",
  // 0.1.20 (P3-9): borrar notas/recordatorios es irreversible → confirma.
  "delete_note",
  "delete_reminder",
]);
