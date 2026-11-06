/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Mensajes de amigo en amigo, fase 2 — el estado del teléfono y las
 * decisiones, separados del messenger (que solo los llama en cuatro
 * puntos: sesión viva, frame «carry» entrante, mensaje que no pudo salir
 * directo y acuse recibido).
 *
 * Qué guarda (en la base SQLCipher de siempre, tabla p2p_relay_kv; ver
 * sqliteKv): mis claves de buzón (con sus secretos), las de mis contactos
 * y si llevan sobres, el almacén de sobres (CarryStore), qué mensajes míos
 * van también por amigos y qué mensajes llegaron así. Todo se borra con
 * «Borrar todos los datos» (es la misma base).
 *
 * Reglas de privacidad:
 * - Llevar sobres de otros es opcional y viene apagado.
 * - Los mensajes de una conversación con mensajes temporales no viajan
 *   por amigos (una copia cifrada quedaría hasta 72 h en otros teléfonos).
 * - Mis claves de buzón caducadas se borran (secretos incluidos).
 */

import { fromHex, toHex } from "../crypto";
import {
  carryTagsFor,
  envelopeBytes,
  generateCarryPrekey,
  isWellFormedEnvelope,
  MAX_CARRY_TEXT,
  needsRotation,
  openCarry,
  sealCarry,
  verifyCarryPrekey,
  type CarryEnvelope,
  type CarryPrekeyPublic,
  type CarryPrekeySecret,
  type OpenedCarry,
} from "./carryCrypto";
import { CarryStore, STORE_LIMITS } from "./carryStore";

/* ---------------------------------------------------------------- KV */

export interface RelayKv {
  /** Lanza si no se puede leer (y entonces no se escribe nada encima). */
  get(k: string): Promise<string | null>;
  /** Escribe varias claves de una vez, todas o ninguna. */
  setMany(entries: ReadonlyArray<readonly [string, string]>): Promise<void>;
}

async function sqliteKv(): Promise<RelayKv> {
  const { getMemoryDb, writeMemoryTransaction } = await import("../../agent/memory/memoryStore");
  const ddl = "CREATE TABLE IF NOT EXISTS p2p_relay_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)";
  return {
    async get(k) {
      const db = await getMemoryDb();
      await db.execAsync(ddl);
      const row = (await db.getFirstAsync("SELECT v FROM p2p_relay_kv WHERE k = ?", [k])) as { v?: string } | null;
      return row?.v ?? null;
    },
    async setMany(entries) {
      await writeMemoryTransaction(async (db) => {
        await db.execAsync(ddl);
        for (const [k, v] of entries) await db.runAsync("INSERT OR REPLACE INTO p2p_relay_kv (k, v) VALUES (?, ?)", [k, v]);
      });
    },
  };
}

let kvForTests: (() => RelayKv) | null = null;
/** Pruebas: un KV en memoria por teléfono (null vuelve a SQLCipher). */
export function setRelayKvForTests(fn: (() => RelayKv) | null): void {
  kvForTests = fn;
}

export function memoryKv(): RelayKv {
  const m = new Map<string, string>();
  return {
    async get(k) {
      return m.get(k) ?? null;
    },
    async setMany(entries) {
      for (const [k, v] of entries) m.set(k, v);
    },
  };
}

async function kv(): Promise<RelayKv> {
  return kvForTests ? kvForTests() : sqliteKv();
}

/* ------------------------------------------------------------- estado */

interface MineRow {
  pub: CarryPrekeyPublic;
  x: string;
  k: string;
}

interface PeerRow {
  prekeys: CarryPrekeyPublic[];
  carries: boolean;
  /** Lo último que le dije: mi clave de buzón, si llevo sobres, y cuándo. */
  sent?: { prekeyId: string; carries: boolean; at: number };
}

interface HeldRow {
  env: CarryEnvelope;
  from: string | null;
  copiesLeft: number;
  givenTo: string[];
}

interface RelayState {
  enabled: boolean;
  mine: MineRow[];
  peers: Record<string, PeerRow>;
  held: HeldRow[];
  seen: Array<[string, number]>;
  /** id de mensaje mío → eid y caducidad del sobre que lo lleva. */
  own: Record<string, { eid: string; exp: number }>;
  /** id de mensaje → "in" (llegó por amigos) | "out" (salió también por amigos). */
  flags: Record<string, "in" | "out">;
}

const EMPTY: RelayState = { enabled: false, mine: [], peers: {}, held: [], seen: [], own: {}, flags: {} };
const KEY = "relay_state_v1";
const MAX_FLAGS = 2000;

/**
 * Generación: sube cuando cambia algo que puede hacer que haya que darle
 * algo nuevo a un contacto (un sobre nuevo, su clave de buzón, mi ajuste).
 * El messenger solo sincroniza una sesión cuando cambió, así un frame
 * entrante normal no carga el estado del relay.
 */
let generation = 1;
function bump(): void {
  generation++;
}
export function relayGeneration(): number {
  return generation;
}

/** Cerrojo: una operación del relay a la vez (lee, decide, guarda). */
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const FLAGS_KEY = "relay_flags_v1";

function parseFlags(raw: string | null): RelayState["flags"] {
  const out: RelayState["flags"] = {};
  try {
    const f = raw ? (JSON.parse(raw) as unknown) : null;
    if (f && typeof f === "object" && !Array.isArray(f)) {
      for (const [id, v] of Object.entries(f as Record<string, unknown>)) if (v === "in" || v === "out") out[id] = v;
    }
  } catch {
    /* dañado: sin marcas (solo es una etiqueta en pantalla) */
  }
  return out;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/**
 * Lo guardado, comprobado campo a campo: un disco dañado no puede colar
 * tipos raros. Si la LECTURA falla (base bloqueada, etc.) se lanza: la
 * operación se cancela y no se escribe un estado vacío encima (eso
 * borraría mis claves de buzón y los sobres que llevo).
 */
async function load(): Promise<RelayState> {
  const store = await kv();
  const raw = await store.get(KEY);
  const flags = parseFlags(await store.get(FLAGS_KEY));
  let b: Record<string, unknown> = {};
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (isObj(parsed)) b = parsed;
  } catch {
    b = {};
  }
  const s: RelayState = structuredClone(EMPTY);
  s.flags = flags;
  s.enabled = b.enabled === true;
  if (Array.isArray(b.mine)) {
    s.mine = (b.mine as unknown[]).filter(
      (m): m is MineRow => isObj(m) && isObj(m.pub) && typeof m.x === "string" && typeof m.k === "string",
    );
  }
  if (isObj(b.peers)) {
    for (const [pk, row] of Object.entries(b.peers)) {
      if (!isObj(row) || !Array.isArray(row.prekeys)) continue;
      const sent = isObj(row.sent) && typeof row.sent.prekeyId === "string" && typeof row.sent.carries === "boolean" && typeof row.sent.at === "number"
        ? { prekeyId: row.sent.prekeyId, carries: row.sent.carries, at: row.sent.at }
        : undefined;
      s.peers[pk] = { prekeys: (row.prekeys as unknown[]).filter(isObj) as unknown as CarryPrekeyPublic[], carries: row.carries === true, ...(sent ? { sent } : {}) };
    }
  }
  if (Array.isArray(b.held)) s.held = (b.held as unknown[]).filter(isObj) as unknown as HeldRow[];
  if (Array.isArray(b.seen)) s.seen = (b.seen as unknown[]).filter(Array.isArray) as Array<[string, number]>;
  if (isObj(b.own)) {
    for (const [id, o] of Object.entries(b.own)) {
      if (isObj(o) && typeof o.eid === "string" && typeof o.exp === "number") s.own[id] = { eid: o.eid, exp: o.exp };
    }
  }
  return s;
}

/**
 * Las marcas «vía amigos» van en otra clave (la pantalla las lee a menudo
 * y no debe cargar los sobres), pero se escriben en la misma transacción.
 */
async function save(s: RelayState): Promise<void> {
  const ids = Object.keys(s.flags);
  if (ids.length > MAX_FLAGS) for (const id of ids.slice(0, ids.length - MAX_FLAGS)) delete s.flags[id];
  const { flags, ...rest } = s;
  await (await kv()).setMany([
    [KEY, JSON.stringify(rest)],
    [FLAGS_KEY, JSON.stringify(flags)],
  ]);
}

function storeFrom(s: RelayState): CarryStore {
  const st = new CarryStore(STORE_LIMITS);
  st.restore(s.held, s.seen);
  return st;
}

function storeInto(s: RelayState, st: CarryStore): void {
  const snap = st.snapshot();
  s.held = snap.held;
  s.seen = snap.seen;
}

function mySecrets(s: RelayState, myPkHex: string, now: number): CarryPrekeySecret[] {
  const me = myPkHex.toLowerCase();
  return s.mine
    .filter((m) => m.pub.expiresAt > now && m.pub.owner === me)
    .map((m) => ({ id: m.pub.id, x25519Sk: fromHex(m.x), kemSk: fromHex(m.k), expiresAt: m.pub.expiresAt }));
}

function peerTags(s: RelayState, peer: string, now: number): Set<string> {
  return new Set((s.peers[peer]?.prekeys ?? []).filter((p) => p.expiresAt > now).flatMap((p) => carryTagsFor(p.id, now)));
}

/* --------------------------------------------------------------- API */

export async function isCarryEnabled(): Promise<boolean> {
  return (await load()).enabled;
}

export async function setCarryEnabled(on: boolean): Promise<void> {
  await locked(async () => {
    const s = await load();
    s.enabled = on;
    if (!on) {
      // Al apagarlo se tiran los sobres de otros que llevaba (los míos se quedan).
      s.held = s.held.filter((h) => h.from === null);
    }
    await save(s);
    bump();
  });
}

export interface RelayUsage {
  envelopes: number;
  bytes: number;
  enabled: boolean;
}

export async function relayUsage(): Promise<RelayUsage> {
  const s = await load();
  const st = storeFrom(s);
  return { envelopes: st.size(), bytes: st.bytes(), enabled: s.enabled };
}

/** Qué mensajes de esta lista llegaron o salieron por amigos. */
export async function relayFlags(ids: readonly string[]): Promise<Record<string, "in" | "out">> {
  const flags = parseFlags(await (await kv()).get(FLAGS_KEY));
  const out: Record<string, "in" | "out"> = {};
  for (const id of ids) if (Object.prototype.hasOwnProperty.call(flags, id)) out[id] = flags[id];
  return out;
}

export interface Me {
  pkHex: string;
  signSecretKey: Uint8Array;
}

/** Repetir el saludo aunque no haya cambiado (por si el último se perdió por radio). */
export const HELLO_REFRESH_MS = 24 * 3600 * 1000;

export interface Hello {
  prekey: CarryPrekeyPublic;
  carries: boolean;
  /** false si ya se lo dije hace menos de un día y no cambió nada. */
  needed: boolean;
}

/**
 * Mi clave de buzón vigente (la crea la primera vez, rota a mitad de vida
 * y borra las caducadas o de otra identidad) y si llevo sobres. Con
 * `peerPk`, dice además si hace falta decírselo a ese contacto.
 */
export async function helloFor(me: Me, now: number, peerPk?: string): Promise<Hello> {
  return locked(async () => {
    const s = await load();
    const myPk = me.pkHex.toLowerCase();
    s.mine = s.mine.filter((m) => m.pub.expiresAt > now && m.pub.owner === myPk);
    const newest = s.mine.reduce<MineRow | null>((a, m) => (!a || m.pub.createdAt > a.pub.createdAt ? m : a), null);
    let pub = newest?.pub ?? null;
    const rotated = needsRotation(newest?.pub ?? null, now);
    if (rotated) {
      const g = generateCarryPrekey(myPk, me.signSecretKey, now);
      s.mine.push({ pub: g.pub, x: toHex(g.secret.x25519Sk), k: toHex(g.secret.kemSk) });
      g.secret.x25519Sk.fill(0);
      g.secret.kemSk.fill(0);
      pub = g.pub;
    }
    await save(s);
    if (rotated) bump();
    const prekey = pub as CarryPrekeyPublic;
    const sent = peerPk ? s.peers[peerPk.toLowerCase()]?.sent : undefined;
    const needed = !sent || sent.prekeyId !== prekey.id || sent.carries !== s.enabled || now - sent.at >= HELLO_REFRESH_MS || now < sent.at;
    return { prekey, carries: s.enabled, needed };
  });
}

/** Compatibilidad con las pruebas de la fase 1: el saludo sin contacto. */
export async function helloPayload(me: Me, now: number): Promise<{ prekey: CarryPrekeyPublic; carries: boolean }> {
  const h = await helloFor(me, now);
  return { prekey: h.prekey, carries: h.carries };
}

/** El saludo salió hacia `peerPk`. */
export async function markHelloSent(peerPk: string, hello: Pick<Hello, "prekey" | "carries">, now: number): Promise<void> {
  await locked(async () => {
    const s = await load();
    const peer = peerPk.toLowerCase();
    const row = s.peers[peer] ?? { prekeys: [], carries: false };
    row.sent = { prekeyId: hello.prekey.id, carries: hello.carries, at: now };
    s.peers[peer] = row;
    await save(s);
  });
}

export interface CarryIncoming {
  /** Mensajes para mí que llegaron por amigos (ya verificados). */
  chats: OpenedCarry[];
  /** Acuses: ids de mensajes míos que llegaron a su destino. */
  receipts: Array<{ from: string; id: string }>;
  /** Sobres que guardo para llevar. */
  stored: number;
}

/**
 * Un frame «carry» de un contacto con sesión verificada.
 * @param sigPkOf firma Ed25519 (del QR) de un contacto mío, o null si no lo es
 */
export async function receive(
  peerPk: string,
  payload: unknown,
  me: Me,
  sigPkOf: (pkHex: string) => string | null,
  now: number,
): Promise<CarryIncoming> {
  return locked(async () => {
    const peer = peerPk.toLowerCase();
    const s = await load();
    const p = (isObj(payload) ? payload : {}) as { prekey?: unknown; carries?: unknown; put?: unknown };
    const peerSig = sigPkOf(peer);
    let changed = false;
    if (!peerSig) return { chats: [], receipts: [], stored: 0 };
    if (p.prekey !== undefined || p.carries !== undefined) {
      const row = s.peers[peer] ?? { prekeys: [], carries: false };
      if (p.prekey !== undefined && verifyCarryPrekey(p.prekey, peer, peerSig, now)) {
        const pk = p.prekey as CarryPrekeyPublic;
        if (!row.prekeys.some((x) => x.id === pk.id)) row.prekeys.push(pk);
      }
      row.prekeys = row.prekeys.filter((x) => x.expiresAt > now).slice(-3);
      if (typeof p.carries === "boolean") row.carries = p.carries;
      s.peers[peer] = row;
      changed = true;
    }
    const out: CarryIncoming = { chats: [], receipts: [], stored: 0 };
    const list = Array.isArray(p.put) ? p.put.slice(0, STORE_LIMITS.maxPerSource) : [];
    if (list.length) {
      const st = storeFrom(s);
      const secrets = mySecrets(s, me.pkHex, now);
      for (const e of list) {
        if (!isWellFormedEnvelope(e) || st.known(e.eid)) continue;
        const opened = openCarry(e, secrets, me.pkHex, sigPkOf, now);
        if (opened) {
          st.forget(e.eid, e.exp);
          if (opened.kind === "chat") {
            // La marca «vía amigos» la pone quien lo guarda, y solo si es nuevo
            // (si ya había llegado directo, no llegó por amigos): markArrivedViaFriends.
            out.chats.push(opened);
          } else if (opened.kind === "receipt") {
            out.receipts.push({ from: opened.from, id: opened.text });
          }
          continue;
        }
        if (s.enabled && st.accept(e, peer, now) === "stored") out.stored++;
      }
      storeInto(s, st);
      for (const sec of secrets) {
        sec.x25519Sk.fill(0);
        sec.kemSk.fill(0);
      }
    }
    await save(s);
    if (changed || out.stored > 0) bump();
    return out;
  });
}

export interface Handoff {
  /** Sobres para mandarle ahora. */
  envelopes: CarryEnvelope[];
  /** Ids de sobre entregados a su destinatario y llevados como mensajero. */
  delivered: string[];
  carried: string[];
}

/**
 * Sobres para dar a `peerPk` ahora (los suyos y, si lleva, los de otros).
 * No cambia nada: cuando salen de verdad, se confirma con `confirmHandoff`.
 * Si el envío falla, siguen aquí para la próxima vez.
 */
export async function handoffFor(peerPk: string, now: number): Promise<Handoff> {
  return locked(async () => {
    const peer = peerPk.toLowerCase();
    const s = await load();
    const st = storeFrom(s);
    // Mis mensajes de chat no se entregan en sobre a su destinatario cuando
    // nos cruzamos: salen directos (con su acuse normal). Así no llegan dos
    // veces ni se marcan «vía amigos» sin haber pasado por nadie.
    const mineDirect = new Set(Object.values(s.own).map((o) => o.eid));
    const { deliver, carry } = st.planHandoff(peer, peerTags(s, peer, now), s.peers[peer]?.carries === true, now, mineDirect);
    return { envelopes: [...deliver, ...carry], delivered: deliver.map((e) => e.eid), carried: carry.map((e) => e.eid) };
  });
}

/** Los sobres de `handoffFor` (todos o una parte) ya salieron hacia `peerPk`. */
export async function confirmHandoff(peerPk: string, delivered: readonly string[], carried: readonly string[]): Promise<void> {
  if (!delivered.length && !carried.length) return;
  await locked(async () => {
    const s = await load();
    const st = storeFrom(s);
    st.commitHandoff(peerPk, delivered, carried);
    const given = new Set([...delivered, ...carried]);
    for (const [id, o] of Object.entries(s.own)) if (given.has(o.eid)) s.flags[id] = "out";
    storeInto(s, st);
    await save(s);
  });
}

/**
 * Un mensaje mío que no pudo salir directo: si el destinatario me dio una
 * clave de buzón vigente, sale también en sobre. Devuelve true si se selló.
 */
export async function sealOwn(
  me: Me,
  recipientPk: string,
  id: string,
  kind: "chat" | "receipt",
  text: string,
  now: number,
): Promise<boolean> {
  if (text.length > MAX_CARRY_TEXT) return false;
  return locked(async () => {
    const to = recipientPk.toLowerCase();
    const s = await load();
    // Sobres míos ya caducados: no hay nada que olvidar.
    for (const [mid, o] of Object.entries(s.own)) if (o.exp <= now) delete s.own[mid];
    if (kind === "chat" && s.own[id]) return true;
    const pk = (s.peers[to]?.prekeys ?? [])
      .filter((p) => p.expiresAt > now + 3600_000)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!pk) return false;
    let env: CarryEnvelope;
    try {
      env = sealCarry({ recipient: pk, senderPkHex: me.pkHex, senderSignSecretKey: me.signSecretKey, id, kind, text, now });
    } catch {
      return false;
    }
    const st = storeFrom(s);
    if (st.addOwn(env, now) !== "stored") return false;
    storeInto(s, st);
    // La marca «viajando por amigos» se pone cuando un contacto se lo lleva (handoffFor).
    if (kind === "chat") s.own[id] = { eid: env.eid, exp: env.exp };
    await save(s);
    bump();
    return true;
  });
}

/** Un mensaje de amigo en amigo que se guardó como nuevo (etiqueta «vía amigos»). */
export async function markArrivedViaFriends(id: string): Promise<void> {
  await locked(async () => {
    const s = await load();
    s.flags[id] = "in";
    await save(s);
  });
}

/** Mi mensaje llegó (directo o por acuse): deja de viajar desde aquí. */
export async function forgetOwn(id: string): Promise<void> {
  await locked(async () => {
    const s = await load();
    const o = s.own[id];
    if (!o) return;
    const st = storeFrom(s);
    st.forget(o.eid, o.exp);
    storeInto(s, st);
    delete s.own[id];
    await save(s);
  });
}

/** Bytes por frame de sobres (el frame P2P admite 256 KB). */
export const PUT_BATCH_BYTES = 160 * 1024;

/** Parte una lista de sobres en tandas que caben en un frame. */
export function batches(list: readonly CarryEnvelope[], maxBytes = PUT_BATCH_BYTES): CarryEnvelope[][] {
  const out: CarryEnvelope[][] = [];
  let cur: CarryEnvelope[] = [];
  let n = 0;
  for (const e of list) {
    const b = envelopeBytes(e) + 1;
    if (cur.length && (n + b > maxBytes || cur.length >= STORE_LIMITS.maxPerSource)) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(e);
    n += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Al cambiar o borrar mi identidad: fuera todo (claves, sobres, marcas). */
export async function resetRelay(): Promise<void> {
  await locked(async () => {
    await save(structuredClone(EMPTY));
  });
}
