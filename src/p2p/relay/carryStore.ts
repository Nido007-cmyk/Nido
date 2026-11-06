/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Mensajes de amigo en amigo (fase 1) — qué guarda un teléfono y a quién
 * da cada sobre. Puro, sin base de datos: la fase 2 lo persiste en
 * SQLCipher con las mismas reglas.
 *
 * Reglas (todas con tope, para que nadie pueda llenar el teléfono de otro):
 * - Solo se aceptan sobres de **contactos** con sesión verificada (lo
 *   comprueba quien llama). De amigo en amigo, nunca de desconocidos.
 * - Forma correcta, sin caducar, con saltos por delante, sin repetir
 *   (también se recuerdan los ya entregados o tirados hasta su caducidad).
 * - Topes: 200 sobres, 2 MB, 30 por contacto que los trae.
 * - Copias limitadas («spray and wait»): quien escribe da su sobre a 8
 *   contactos como mucho; un mensajero, a 3 más (y nunca más de 3 saltos). El destinatario siempre
 *   lo recibe en cuanto aparece, y el sobre se borra al entregárselo.
 * - Nunca se devuelve un sobre a quien lo trajo.
 */

import { envelopeBytes, isWellFormedEnvelope, type CarryEnvelope } from "./carryCrypto";

export const STORE_LIMITS = {
  maxEnvelopes: 200,
  maxBytes: 2 * 1024 * 1024,
  maxPerSource: 30,
  /**
   * Copias: medido con carrySimulation (60 teléfonos en 6 barrios, 72 h):
   * 3/1 entregaba a las 24 h un 22 % más que el envío directo; 8/3, un
   * 65 % más, con unos 10 sobres de unos KB por mensaje en toda la red y
   * el teléfono más cargado guardando menos de 30. Ver docs/RELAY.md.
   */
  originCopies: 8,
  carrierCopies: 3,
};

export type AcceptResult = "stored" | "duplicate" | "expired" | "no_hops" | "malformed" | "full" | "source_full";

interface Held {
  env: CarryEnvelope;
  /** Contacto que lo trajo; null si lo escribí yo. */
  from: string | null;
  copiesLeft: number;
  givenTo: Set<string>;
  bytes: number;
}

export class CarryStore {
  private held = new Map<string, Held>();
  /** eid → caducidad: sobres ya vistos (entregados o tirados). */
  private seen = new Map<string, number>();

  constructor(private readonly limits = STORE_LIMITS) {}

  size(): number {
    return this.held.size;
  }

  bytes(): number {
    let n = 0;
    for (const h of this.held.values()) n += h.bytes;
    return n;
  }

  has(eid: string): boolean {
    return this.held.has(eid);
  }

  /** Ya lo tengo o ya lo vi (entregado, abierto o tirado). */
  known(eid: string): boolean {
    return this.held.has(eid) || this.seen.has(eid);
  }

  /** Quita lo caducado. Devuelve cuántos sobres se tiraron. */
  sweep(now: number): number {
    let n = 0;
    for (const [eid, h] of this.held) {
      if (h.env.exp <= now) {
        this.held.delete(eid);
        n++;
      }
    }
    for (const [eid, exp] of this.seen) if (exp <= now) this.seen.delete(eid);
    return n;
  }

  /** Un sobre que escribí yo. */
  addOwn(env: CarryEnvelope, now: number): AcceptResult {
    return this.put(env, null, now, this.limits.originCopies);
  }

  /** Un sobre que me trae un contacto (ya autenticado por la sesión). */
  accept(env: unknown, fromPk: string, now: number): AcceptResult {
    return this.put(env, fromPk.toLowerCase(), now, this.limits.carrierCopies);
  }

  private put(env: unknown, from: string | null, now: number, copies: number): AcceptResult {
    if (!isWellFormedEnvelope(env)) return "malformed";
    if (this.held.has(env.eid) || this.seen.has(env.eid)) return "duplicate";
    if (env.exp <= now) return "expired";
    if (env.hops < 1) return "no_hops";
    this.sweep(now);
    const bytes = envelopeBytes(env);
    if (this.held.size >= this.limits.maxEnvelopes || this.bytes() + bytes > this.limits.maxBytes) return "full";
    if (from !== null) {
      let fromSame = 0;
      for (const h of this.held.values()) if (h.from === from) fromSame++;
      if (fromSame >= this.limits.maxPerSource) return "source_full";
    }
    // La caducidad de fuera la pone quien escribe; un mensajero no puede
    // alargarla más allá del máximo contando desde que llega aquí.
    this.held.set(env.eid, { env: { ...env }, from, copiesLeft: copies, givenTo: new Set(), bytes });
    return "stored";
  }

  /**
   * Qué dar a `peerPk` ahora que hay sesión con él. `peerTags` son las
   * etiquetas de sus claves de buzón (las conozco porque es contacto mío):
   * si un sobre es para él, se le entrega y se borra de aquí. Si no, y
   * quedan copias y saltos, se le da como mensajero (con un salto menos).
   */
  handoff(peerPk: string, peerTags: ReadonlySet<string>, peerCarries: boolean, now: number): { deliver: CarryEnvelope[]; carry: CarryEnvelope[] } {
    const peer = peerPk.toLowerCase();
    this.sweep(now);
    const deliver: CarryEnvelope[] = [];
    const carry: CarryEnvelope[] = [];
    for (const [eid, h] of this.held) {
      if (peerTags.has(h.env.tag)) {
        deliver.push({ ...h.env, hops: 0 });
        this.held.delete(eid);
        this.seen.set(eid, h.env.exp);
        continue;
      }
      if (!peerCarries || h.from === peer || h.givenTo.has(peer)) continue;
      if (h.copiesLeft < 1 || h.env.hops <= 1) continue;
      h.copiesLeft--;
      h.givenTo.add(peer);
      carry.push({ ...h.env, hops: h.env.hops - 1 });
    }
    return { deliver, carry };
  }

  /** Para guardar en disco (JSON). */
  snapshot(): {
    held: Array<{ env: CarryEnvelope; from: string | null; copiesLeft: number; givenTo: string[] }>;
    seen: Array<[string, number]>;
  } {
    return {
      held: [...this.held.values()].map((h) => ({ env: { ...h.env }, from: h.from, copiesLeft: h.copiesLeft, givenTo: [...h.givenTo] })),
      seen: [...this.seen.entries()],
    };
  }

  /** Lo contrario de snapshot; descarta filas mal formadas (disco dañado). */
  restore(
    held: ReadonlyArray<{ env: unknown; from: unknown; copiesLeft: unknown; givenTo: unknown }>,
    seen: ReadonlyArray<[unknown, unknown]>,
  ): void {
    this.held.clear();
    this.seen.clear();
    for (const h of held ?? []) {
      if (!isWellFormedEnvelope(h?.env)) continue;
      if (h.from !== null && typeof h.from !== "string") continue;
      const copies = typeof h.copiesLeft === "number" && Number.isFinite(h.copiesLeft) ? Math.max(0, Math.floor(h.copiesLeft)) : 0;
      const given = Array.isArray(h.givenTo) ? h.givenTo.filter((x): x is string => typeof x === "string") : [];
      if (this.held.size >= this.limits.maxEnvelopes) break;
      this.held.set(h.env.eid, { env: { ...h.env }, from: h.from, copiesLeft: copies, givenTo: new Set(given), bytes: envelopeBytes(h.env) });
    }
    for (const s of seen ?? []) {
      if (Array.isArray(s) && typeof s[0] === "string" && typeof s[1] === "number") this.seen.set(s[0], s[1]);
    }
  }

  /** El sobre llegó a su destino por otro camino (acuse): ya no hace falta llevarlo. */
  forget(eid: string, exp: number): void {
    this.held.delete(eid);
    this.seen.set(eid, exp);
  }
}
