/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Simulación de una red de teléfonos NIDO sin internet, para medir qué
 * aportan los mensajes de amigo en amigo frente a la entrega directa.
 * Solo la usan las pruebas. Usa el almacén real (CarryStore) con sobres
 * de forma real; no descifra nada (eso lo prueba carryCrypto.test.ts).
 *
 * El modelo: barrios de vecinos que se cruzan a menudo, y algún contacto
 * en otro barrio con quien uno se cruza poco. Los teléfonos solo hablan
 * con sus contactos (de amigo en amigo, como NIDO). Cada hora, cada
 * pareja de contactos se cruza con cierta probabilidad.
 */

import { carryTag, type CarryEnvelope } from "./carryCrypto";
import { CarryStore, STORE_LIMITS } from "./carryStore";

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface SimConfig {
  neighbourhoods: number;
  perNeighbourhood: number;
  /** Contactos de cada persona en su barrio y fuera. */
  localContacts: number;
  remoteContacts: number;
  /** Probabilidad por hora de cruzarse con un contacto del barrio / de fuera. */
  pLocal: number;
  pRemote: number;
  /** Fracción de personas que aceptan llevar sobres. */
  carriers: number;
  messages: number;
  hours: number;
  relay: boolean;
  seed: number;
}

export interface SimResult {
  sent: number;
  deliveredBy: Record<number, number>;
  /** Copias que llegaron a hacerse por mensaje (media). */
  meanCopies: number;
  /** Sobres que llegó a guardar el teléfono más cargado. */
  maxHeld: number;
}

/** Un sobre de forma válida, con eid y etiqueta propios (el contenido da igual aquí). */
function fakeEnvelope(template: CarryEnvelope, eid: string, tag: string, exp: number): CarryEnvelope {
  return { ...template, eid, tag, exp };
}

export function simulate(cfg: SimConfig, template: CarryEnvelope): SimResult {
  const r = rng(cfg.seed);
  const n = cfg.neighbourhoods * cfg.perNeighbourhood;
  const hood = (i: number) => Math.floor(i / cfg.perNeighbourhood);
  const contacts: Array<Set<number>> = Array.from({ length: n }, () => new Set());
  const link = (a: number, b: number) => {
    if (a === b) return;
    contacts[a].add(b);
    contacts[b].add(a);
  };
  for (let i = 0; i < n; i++) {
    const h = hood(i);
    let guard = 0;
    while ([...contacts[i]].filter((c) => hood(c) === h).length < cfg.localContacts && guard++ < 100) {
      link(i, h * cfg.perNeighbourhood + Math.floor(r() * cfg.perNeighbourhood));
    }
    guard = 0;
    while ([...contacts[i]].filter((c) => hood(c) !== h).length < cfg.remoteContacts && guard++ < 100) {
      const other = Math.floor(r() * n);
      if (hood(other) !== h) link(i, other);
    }
  }
  const carries = Array.from({ length: n }, () => r() < cfg.carriers);
  // El modelo no simula días: una etiqueta fija por persona basta para el reparto.
  const tagOf = (i: number) => carryTag(i.toString(16).padStart(32, "0"), 0);
  const stores = Array.from({ length: n }, () => new CarryStore(STORE_LIMITS));
  const T0 = 1_800_000_000_000;
  const HOUR = 3600_000;

  // Mensajes: de alguien a un contacto de otro barrio (los que están separados).
  const msgs: Array<{ from: number; to: number; eid: string; delivered: number | null; copies: number }> = [];
  for (let k = 0; k < cfg.messages; k++) {
    const from = Math.floor(r() * n);
    const remote = [...contacts[from]].filter((c) => hood(c) !== hood(from));
    const pool = remote.length ? remote : [...contacts[from]];
    const to = pool[Math.floor(r() * pool.length)];
    const eid = k.toString(16).padStart(32, "0");
    msgs.push({ from, to, eid, delivered: null, copies: 0 });
    if (cfg.relay) stores[from].addOwn(fakeEnvelope(template, eid, tagOf(to), T0 + 72 * HOUR), T0);
  }
  const byEid = new Map(msgs.map((m) => [m.eid, m]));
  let maxHeld = 0;

  for (let h = 0; h < cfg.hours; h++) {
    const now = T0 + h * HOUR;
    for (let a = 0; a < n; a++) {
      for (const b of contacts[a]) {
        if (b < a) continue;
        const p = hood(a) === hood(b) ? cfg.pLocal : cfg.pRemote;
        if (r() >= p) continue;
        // a y b se cruzan: entrega directa de lo que tengan pendiente entre ellos.
        for (const m of msgs) {
          if (m.delivered === null && ((m.from === a && m.to === b) || (m.from === b && m.to === a))) m.delivered = h;
        }
        if (!cfg.relay) continue;
        for (const [x, y] of [[a, b], [b, a]] as const) {
          const out = stores[x].handoff(y.toString(16).padStart(64, "0"), new Set([tagOf(y)]), carries[y], now);
          for (const e of out.deliver) {
            const m = byEid.get(e.eid)!;
            if (m.delivered === null) m.delivered = h;
          }
          for (const e of out.carry) {
            if (stores[y].accept(e, x.toString(16).padStart(64, "0"), now) === "stored") byEid.get(e.eid)!.copies++;
          }
        }
      }
    }
    // Lo entregado deja de llevarse (en la fase 2, con el acuse que vuelve).
    for (const m of msgs) if (m.delivered !== null) for (const s of stores) s.forget(m.eid, T0 + 72 * HOUR);
    for (const s of stores) maxHeld = Math.max(maxHeld, s.size());
  }
  const deliveredBy: Record<number, number> = {};
  for (const limit of [6, 24, 72]) deliveredBy[limit] = msgs.filter((m) => m.delivered !== null && m.delivered < limit).length;
  return {
    sent: msgs.length,
    deliveredBy,
    meanCopies: msgs.reduce((a, m) => a + m.copies, 0) / msgs.length,
    maxHeld,
  };
}
