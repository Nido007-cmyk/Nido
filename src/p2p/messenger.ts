/**
 * messenger.ts — NIDO P2P: API de alto nivel (Fase E).
 *
 * - ensureIdentity(): crea o recupera la identidad del dispositivo.
 * - pairWith(qr): empareja un contacto escaneando su QR.
 * - sendChat(contactName, text): encola (y envía si hay transporte).
 * - establishSession(...): tras el handshake del transporte.
 * - handleFrame(...): procesa frames entrantes → bandeja de entrada.
 *
 * Regla NIDO-a-NIDO: los `agent_task` entrantes NUNCA se auto-ejecutan;
 * se guardan para que el usuario los apruebe explícitamente.
 */

import {
  fingerprint,
  generateEphemeral,
  generateIdentity,
  toHex,
} from "./crypto";
import { decodePairingPayload, encodePairingPayload } from "./pairing";
import {
  deriveAckSessionTag,
  FrameReassembler,
  P2PEnvelope,
  P2PMessageType,
  P2PSession,
  makeEnvelope,
  type AgentTaskPayload,
  type DeliveryAckPayload,
} from "./protocol";
import {
  archiveAndClearP2PIdentity,
  clearRepairIntent,
  commitRepair,
  deleteContact,
  resolveContactByName,
  failAllOutbox,
  findContactByPk,
  findContactRowAny,
  getDeliveryAckLogEntry,
  getIdentity,
  getLateAckRecord,
  getLiveSuccessorPk,
  getOutboundMessage,
  getOutbox,
  getSentOutbox,
  getSigningKeypair,
  getUnreadInbox,
  incrementAckAttempts,
  listContacts,
  markMessageStatus,
  markOutboundDelivered,
  markOutboundFailed,
  markOutboundSent,
  messageExists,
  pruneDeliveryAckLog,
  recordLateAck,
  recoverSentOutboxToQueued,
  resetOutboundForRetry,
  runP2PBootRepair,
  saveIdentity,
  saveInboundMessageWithAckLog,
  saveMessage,
  StaleReplaceConflictError,
  type N6FailureReason,
  type P2PContact,
  type P2PIdentityArchiveRecord,
  type P2PStoredMessage,
} from "./store";
import { normalizeContactName } from "./contactName";
import { LoopbackTransport, type P2PTransport, type P2PTransportEvents, type P2PPeerInfo } from "./transport";
import { createPlatformTransport } from "./nativeTransport";
import nacl from "tweetnacl";

/**
 * N6 — constantes temporales del protocolo de ACK.
 *
 * **PROVISIONAL** (owner gate): no están congeladas; las pruebas físicas
 * sobre enlaces Bluetooth reales deben decidirlas. ACK_TIMEOUT_MS es el
 * tiempo de espera por intento; ACK_MAX_ATTEMPTS, el presupuesto de
 * TIMEOUTS (no de envíos): el envío inicial no consume presupuesto; cada
 * timeout con sesión viva incrementa `ack_attempts` y reintenta mientras
 * `ack_attempts <= ACK_MAX_ATTEMPTS`; el timeout que lo llevaría a
 * `ACK_MAX_ATTEMPTS + 1` es terminal → `failed(timeout)` (packet §4.2:
 * "on timeout … Increment ack_attempts … when ack_attempts >
 * ACK_MAX_ATTEMPTS"). Con el valor 3: 1 envío inicial + hasta 3 reintentos
 * = 4 transmisiones como máximo, 4 timeouts observados;
 * DEDUP_RETENTION_DAYS, el horizonte contractual de dedup (dentro del
 * horizonte, un retry manual reusa el mismo message_id; más allá, es un
 * envío nuevo con id fresco — §7).
 */
export const ACK_TIMEOUT_MS = 30_000;
export const ACK_MAX_ATTEMPTS = 3;
export const DEDUP_RETENTION_DAYS = 90;

/**
 * N6 §3.2 — tipos de envelope con semántica ACK: el receptor solo emite
 * ACK después del commit de persistencia, y el emisor solo alcanza
 * "delivered" con un ACK validado.
 */
const N6_ACK_TYPES: ReadonlySet<string> = new Set(["chat", "agent_task"]);

/**
 * N6 §3.2: validación de forma EXACTA del payload de un delivery_ack.
 * Sin claves extra, sin tipos laxos: cualquier desviación se rechaza.
 * Exportado para tests; el path de producción lo usa processDeliveryAck.
 */
export function isValidAckPayload(p: unknown): p is DeliveryAckPayload {
  if (typeof p !== "object" || p === null) return false;
  const q = p as Record<string, unknown>;
  // Forma EXACTA: ni una clave de más ni de menos (D3/cross-session replay).
  const keys = Object.keys(q).sort();
  if (keys.length !== 5 || keys.join(",") !== "attest,for_id,for_type,persisted_at,session_tag") {
    return false;
  }
  return (
    typeof q.for_id === "string" && q.for_id.length > 0 &&
    typeof q.for_type === "string" && N6_ACK_TYPES.has(q.for_type) &&
    typeof q.persisted_at === "number" && Number.isFinite(q.persisted_at) && q.persisted_at >= 0 &&
    typeof q.session_tag === "string" && /^[0-9a-f]{128}$/.test(q.session_tag) &&
    q.attest === "persisted"
  );
}

/**
 * Textos visibles de errores de sendChat (M-4), localizados vía i18n
 * (inglés primero). Si la resolución falla se usa el inglés como respaldo
 * para no mostrar nunca una clave cruda. Patrón: lazy-require, nunca
 * import de nivel superior (ver downloadErrors.ts).
 */
const EN_P2P_FALLBACK: Record<string, string> = {
  "p2p.sendChatEmpty": "The message is empty.",
  "p2p.sendChatTooLong": "Message too long (max 4000 characters).",
  "p2p.sendChatContactNotFound":
    "You have no NIDO contact named “{{name}}”. Pair first by scanning their QR code.",
  "p2p.sendChatContactAmbiguous":
    "There are {{count}} NIDO contacts named “{{name}}”. I don't know which one you mean; choose one:\n{{options}}",
};
function p2pT(key: string, vars?: Record<string, string>): string {
  let s: string | undefined;
  try {
    const i18n = require("../i18n").default as {
      t(k: string, o?: unknown): string;
    };
    const r = i18n.t(key, vars);
    if (r && r !== key) s = r;
  } catch {
    // respaldo en inglés
  }
  s = s ?? EN_P2P_FALLBACK[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.split(`{{${k}}}`).join(v);
  return s;
}

/**
 * ID de mensaje (UUID v4). Usa nacl.randomBytes — CSPRNG respaldado por el
 * PRNG seguro instalado en T-009 — y NO Math.random: los IDs alimentan el
 * anti-replay (seenIds por sesión + dedup persistente), así que IDs
 * predecibles o con colisiones entre reinicios harían que mensajes
 * legítimos se descartaran en silencio.
 */
function newId(): string {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // versión 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return (
    `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-` +
    `${h.slice(16, 20)}-${h.slice(20, 32)}`
  );
}

/**
 * UNIT B (R2): elección explícita de desambiguación en el emparejamiento.
 * Mismo nombre ≠ misma identidad: cuando el QR escaneado colisiona en
 * nombre normalizado con un contacto VIVO de otra pk, el usuario DEBE
 * elegir. Sin elección explícita, pairWith falla cerrado (nunca "Replace").
 */
export type PairDisambiguation = "replace" | "different_person" | "cancel";

export interface PairWithOptions {
  /** Elección de desambiguación (requerida si hay colisión de nombre). */
  disambiguation?: PairDisambiguation;
  /** Requerido con "different_person": nombre único para el contacto nuevo. */
  newName?: string;
  /**
   * UNIT B concurrency closure: pks viejas EXACTAS que la ceremonia mostró
   * y el usuario confirmó retirar con "replace". Fija el supersede-set por
   * PK, no por nombre. Cada una debe seguir viva al confirmar; si alguna
   * ya murió, falla cerrado (StaleReplaceConflictError). Sin este campo,
   * el conjunto se deriva de la colisión viva actual (compatibilidad).
   */
  replaceTargets?: string[];
}

/**
 * UNIT B (R2): se lanzó porque el QR colisiona en nombre con otro
 * contacto vivo y no se dio una elección explícita de desambiguación.
 * Fail-closed: nada se escribió. El path del agente lo traduce a
 * "cancelled" (default = cancel, nunca "Replace").
 */
export class PairingDisambiguationRequiredError extends Error {
  readonly code = "NIDO_PAIR_DISAMBIGUATION_REQUIRED";
  readonly candidates: P2PContact[];
  constructor(candidates: P2PContact[]) {
    super(
      "Pairing ambiguous: the scanned code collides by name with " +
        `${candidates.length} live contact(s) with a different identity. ` +
        "An explicit disambiguation choice (replace | different_person | cancel) is required; " +
        "defaulting to cancel — nothing was written.",
    );
    this.name = "PairingDisambiguationRequiredError";
    this.candidates = candidates;
  }
}

/**
 * UNIT B (§7): por qué el reintento fue rechazado.
 * - peer_superseded: la identidad destino murió por Replace explícito; el
 *   mensaje solo puede reenviarse como nuevo envío a la identidad viva
 *   (resendToSupersedingIdentity), nunca revivir el mensaje viejo.
 * - orphaned_destination: la causa real se desconoce (R3); reintentar
 *   podría enviar a una identidad equivocada.
 * - user_cancelled: la cancelación es terminal para la intención; solo un
 *   gesto explícito NUEVO del usuario puede reenviar (y siempre con
 *   message_id fresco, R4).
 */
export type RetryRefusalKind = "peer_superseded" | "orphaned_destination" | "user_cancelled";

export type RetryOutcome =
  | { id: string; freshId: boolean }
  | { refused: RetryRefusalKind; supersededBy?: string | null };


export class NidoMessenger {
  private transport: P2PTransport;
  private sessions = new Map<string, P2PSession>();
  /**
   * N6: timers de espera de ACK por message_id saliente. Un timer vivo
   * significa "esperando confirmación del peer"; al expirar se reintenta
   * (mismo message_id, envelope id fresco) o se marca failed(timeout).
   * `lastAttemptAt` guarda el epoch ms del último intento (para reanudar
   * la espera tras una desconexión sin consumir presupuesto).
   */
  private ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastAttemptAt = new Map<string, number>();
  /**
   * N6 §4.4: la recuperación del outbox tras reinicio (sent→queued) corre
   * una sola vez por instancia, al activar el enlace.
   */
  private linkRecovered = false;
  /**
   * Sesiones CANDIDATAS (H-8): un handshake nuevo NO sustituye la sesión viva
   * hasta que el peer demuestre liveness con un frame válido bajo la clave
   * de la candidata. Así, un HELLO repetido por un atacante (o un handshake
   * a medias) jamás desaloja una sesión viva: la candidata solo se
   * promociona en `handleFrame` tras una autenticación exitosa.
   */
  private pendingSessions = new Map<string, P2PSession>();
  private reassemblers = new Map<string, FrameReassembler>();
  private myPk: Uint8Array | null = null;
  /**
   * R6 (wipe-terminal): una vez destruida (Clear All Data), la instancia no
   * puede seguir operando: ni descifrar/procesar frames, ni enviar, ni
   * reanudar sesiones. El uso legítimo posterior requiere una instancia
   * nueva (ver invalidateSharedNidoMessenger).
   */
  private destroyed = false;

  constructor(transport?: P2PTransport) {
    // En producción: el mejor transporte disponible (Bluetooth nativo si el
    // módulo está compilado; si no, stub que falla explícito). En tests/UI:
    // se inyecta LoopbackTransport.
    this.transport = transport ?? createPlatformTransport();
  }

  private assertLive(): void {
    if (this.destroyed) {
      throw new Error(
        "NidoMessenger invalidado por Clear All Data: se requiere una instancia nueva."
      );
    }
  }

  /**
   * Invalidación terminal (la llama appReset durante Clear All Data):
   * 1. marca la instancia como destruida PRIMERO (síncrono): desde aquí
   *    ningún método puede seguir operando como si la identidad existiera;
   * 2. detiene el transporte (discovery/servidor) best-effort: ningún frame
   *    nuevo debe entrar;
   * 3. B/F4: termina el lado nativo (sockets RFCOMM + servidor) best-effort
   *    vía `transport.shutdownNative?.()`. Orden: primero stopDiscovery()
   *    (desuscribe listeners, rechaza HELLOs pendientes, limpia rutas) y
   *    DESPUÉS el apagado nativo, para que los eventos onDisconnected que
   *    emite el nativo al cerrar caigan sobre un emitter ya desuscrito.
   *    Si el nativo lanza, el resultado nativo es DESCONOCIDO pero la
   *    invalidación en memoria ya es efectiva: el wipe sigue fail-closed y
   *    la recuperación es una instancia fresca (post-wipe siempre se crea
   *    una nueva). stopLink() NO invoca este paso: es un apagado temporal.
   * 4. descarta sesiones cifradas vivas, candidatas, reensambladores y la
   *    identidad en memoria: la sesión criptográfica anterior no sobrevive
   *    en memoria.
   *
   * Invariante B/F4: destruir el P2P termina las conexiones RFCOMM nativas
   * además del estado JS de rutas/sesiones y del discovery/servidor.
   *
   * Después de esto, un frame entrante se descarta (los métodos públicos
   * fallan explícito vía assertLive; el callback del transporte lo traga y
   * el frame se pierde, fail closed).
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    // N6: ningún timer de ACK puede sobrevivir a la invalidación.
    for (const t of this.ackTimers.values()) clearTimeout(t);
    this.ackTimers.clear();
    this.lastAttemptAt.clear();
    try {
      await this.transport.stopDiscovery();
    } catch {
      /* best-effort: la invalidación en memoria ya es efectiva */
    }
    try {
      await this.transport.shutdownNative?.();
    } catch {
      /* best-effort: ver paso 3 — el wipe sigue fail-closed */
    }
    this.sessions.clear();
    this.pendingSessions.clear();
    this.reassemblers.clear();
    this.myPk = null;
  }

  /**
   * Activa el enlace P2P: servidor RFCOMM + discovery + handshake automático.
   * La UI lo llama una vez al entrar a la pantalla NIDO; `stopLink` al salir.
   */
  async startLink(events?: Omit<P2PTransportEvents, "onHandshakeComplete" | "onFrame">): Promise<void> {
    this.assertLive();
    await this.ensureIdentity();
    // Post-await: el messenger pudo ser destruido mientras se resolvía la
    // identidad; no arrancar discovery sobre una instancia muerta.
    this.assertLive();
    // UNIT B (§6): boot repair ANTES de recoverOutbox. Si un re-pair murió
    // entre el commit y los efectos in-memory (o hay filas huérfanas de un
    // crash anterior), el repair falla las filas stranded como
    // peer_superseded/orphaned_destination PRIMERO: recoverOutbox jamás
    // puede revivir una fila failed, así que el orden garantiza que las
    // huérfanas no resuciten como 'queued'.
    if (!this.linkRecovered) {
      this.linkRecovered = true;
      await runP2PBootRepair();
      this.assertLive();
      await this.recoverOutbox();
      this.assertLive();
    }
    await this.transport.startDiscovery({
      onPeerFound: events?.onPeerFound,
      onPeerLost: (pkHex) => {
        this.handleDisconnect(pkHex);
        events?.onPeerLost?.(pkHex);
      },
      onHandshakeComplete: (peerPkHex, myEphSecret, theirEphPk, myNonce, theirNonce) => {
        void this.completeHandshake(peerPkHex, myEphSecret, theirEphPk, myNonce, theirNonce).catch(() => {});
      },
      onFrame: (peerPkHex, frame) => {
        void this.handleFrame(peerPkHex, frame).catch(() => {});
      },
      onError: events?.onError,
    });
  }

  /** Detiene discovery y servidor. */
  async stopLink(): Promise<void> {
    await this.transport.stopDiscovery();
  }

  /**
   * DIAG-2026-10-07: estado del servidor RFCOMM nativo para la UI de
   * diagnóstico. Null si el transporte no lo expone.
   */
  serverStatus(): { alive: boolean; acceptedCount: number; lastAcceptAt: number } | null {
    this.assertLive();
    return this.transport.readServerStatus ? this.transport.readServerStatus() : null;
  }

  /**
   * Conecta con un dispositivo descubierto (alias con MAC, p. ej. lo que
   * muestra la lista de cercanos) y hace el handshake. Resuelve con la
   * identidad verificada del peer (debe ser un contacto emparejado por QR).
   */
  async connectPeer(alias: string): Promise<P2PPeerInfo> {
    this.assertLive();
    await this.ensureIdentity();
    this.assertLive();
    return this.transport.connect(alias);
  }

  /**
   * BUG-5-2026-10-06: desconecta un peer por su pkHex. Necesario para el
   * barrido de MACs en NidoScreen: si el handshake tiene éxito pero es
   * otro peer (no el contacto paired objetivo), hay que cerrar esa
   * conexión antes de probar la siguiente MAC. Sin esto, las conexiones
   * con peers equivocados quedan abiertas acumulándose.
   */
  async disconnectPeer(peerPkHex: string): Promise<void> {
    this.assertLive();
    await this.transport.disconnect(peerPkHex);
  }

  /**
   * BRIAR-2026-10-06: rol de dial determinístico para evitar colisiones
   * de dial simultáneo en la fuente.
   *
   * Briar (briarproject.org) resolvió este problema con commitment-ordering:
   * ambos lados acuerdan independientemente quién marca y quién escucha,
   * sin coordinación extra. Adaptado a NIDO: al momento del pairing QR
   * ambos ya intercambian pkHex, así que la regla es determinística:
   *
   *   dialer = (myPkHex < peerPkHex) ? yo : peer
   *
   * Solo el dialer inicia connect(); el otro solo mantiene su servidor
   * escuchando. Esto elimina la condición de carrera de sockets RFCOMM
   * cuando ambas tablets tocan Connect al mismo tiempo.
   *
   * @returns true si este dispositivo debe iniciar la conexión saliente.
   */
  async shouldDialPeer(peerPkHex: string): Promise<boolean> {
    this.assertLive();
    const identity = await getIdentity();
    if (!identity) throw new Error("No hay identidad P2P.");
    const myPkHex = toHex(identity.publicKey).toLowerCase();
    const target = peerPkHex.toLowerCase();
    return myPkHex < target;
  }

  /**
   * Crea la identidad si no existe y la deja en memoria.
   *
   * M-2 (fail-closed): si el Keystore falla al leer, getIdentity() lanza y
   * el error se propaga — esta función solo genera cuando la identidad está
   * genuinamente ausente, nunca ante un fallo de lectura.
   *
   * F-2 (fail-closed): si la fila durable existe pero falta algún secreto
   * del Keystore, getIdentity() lanza P2PIdentityKeyLossError — NUNCA se
   * genera una identidad nueva en silencio (eso sería un fork silencioso).
   * La clave de firma Ed25519 nace JUNTO con la identidad: así la regla
   * "fila existe + secreto ausente = KEY_LOSS" vale también para ella y no
   * hay ventana en la que una pérdida pase por "aún no generada".
   */
  async ensureIdentity(name = "Mi NIDO"): Promise<{ pkHex: string; fingerprint: string }> {
    this.assertLive();
    let identity = await getIdentity();
    this.assertLive();
    if (!identity) {
      const kp = generateIdentity();
      await saveIdentity(kp.publicKey, kp.secretKey, name);
      this.assertLive();
      identity = { publicKey: kp.publicKey, secretKey: kp.secretKey, name };
      // F-2: la firma nace con la identidad; su ausencia futura = KEY_LOSS.
      await getSigningKeypair();
      this.assertLive();
    }
    this.myPk = identity.publicKey;
    return { pkHex: toHex(identity.publicKey), fingerprint: fingerprint(identity.publicKey) };
  }

  /**
   * F-2 — Recovery honesto tras pérdida de claves de identidad P2P.
   *
   * Requiere `confirmed: true`: solo se invoca tras la confirmación
   * EXPLÍCITA (doble) del usuario en la pantalla de recovery. Sin
   * confirmación, lanza: jamás hay regeneración silenciosa.
   *
   * Qué hace, en orden:
   * 1. Archiva la identidad vieja (p2p_identity_archive — N4: los datos no
   *    fueron borrados) y limpia fila + Keystore + cache de nonces.
   * 2. Invalida sesiones en memoria (criptográficamente muertas), timers
   *    de ACK y la cache de identidad del transporte.
   * 3. Falla el outbox pendiente como identity_changed: se envió bajo una
   *    identidad que ya no existe; los peers no nos reconocerán hasta
   *    re-emparejar. Reintentable por el usuario tras el re-pair.
   * 4. Crea la identidad nueva (first-run real ahora).
   *
   * La UI debe decirlo claro: los peers emparejados ya no reconocerán este
   * NIDO; hay que re-emparejar. Decisión documentada (F-13): la clave de
   * firma Ed25519 también rota con la identidad — no se reutiliza la
   * superviviente, para que el recovery sea un corte criptográfico limpio
   * sin enlace forense entre la identidad vieja y la nueva.
   */
  async recoverP2PIdentityAfterKeyLoss(confirmed: boolean): Promise<{
    oldPkHex: string | null;
    newPkHex: string;
    failedOutbox: number;
  }> {
    this.assertLive();
    if (!confirmed) {
      throw new Error(
        "recoverP2PIdentityAfterKeyLoss: requiere confirmación explícita del " +
          "usuario (aviso de pérdida de identidad). NIDO nunca regenera la " +
          "identidad P2P en silencio.",
      );
    }
    this.assertLive();
    const archived = await archiveAndClearP2PIdentity("p2p-identity-keystore-key-loss");
    this.assertLive();
    // Sesiones muertas: la identidad que las firmó ya no existe.
    for (const t of this.ackTimers.values()) clearTimeout(t);
    this.ackTimers.clear();
    this.lastAttemptAt.clear();
    this.sessions.clear();
    this.pendingSessions.clear();
    this.reassemblers.clear();
    this.myPk = null;
    this.transport.resetMyIdentityCache?.();
    const failedOutbox = await failAllOutbox("identity_changed");
    this.assertLive();
    const id = await this.ensureIdentity();
    return { oldPkHex: archived?.oldPkHex ?? null, newPkHex: id.pkHex, failedOutbox };
  }

  /** Mi QR de emparejamiento (texto para renderizar como QR en la UI). */
  async myPairingCode(): Promise<string> {
    this.assertLive();
    const identity = await getIdentity();
    this.assertLive();
    if (!identity) throw new Error("Primero crea tu identidad NIDO.");
    const signing = await getSigningKeypair();
    this.assertLive();
    return encodePairingPayload(identity.name, identity.publicKey, signing.publicKey);
  }

  /**
   * Escanea el QR del otro NIDO y lo guarda como contacto verificado.
   *
   * UNIT B — ceremonia con desambiguación (R2) y commit atómico (§3.1):
   * - self-QR se rechaza (sin cambios);
   * - pk ya emparejada y VIVA → binding conocido: idempotente, sin
   *   preguntas de supersesión;
   * - mismo nombre normalizado + pk DISTINTA y viva → exige elección
   *   explícita: "replace" (confirmación destructiva: retira la identidad
   *   vieja), "different_person" (conviven; exige nombre nuevo único) o
   *   "cancel" (dismiss = cancel: no se escribe nada);
   * - el commit durable es UNA transacción (commitRepair): supersede +
   *   upsert + fail del outbox viejo + higiene de nonces + journal;
   * - post-commit: teardown in-memory (timers, sesiones, ruta) y borrado
   *   del intent journalizado.
   *
   * Devuelve null si el usuario eligió "cancel" (nada escrito).
   */
  async pairWith(qrText: string, opts?: PairWithOptions): Promise<P2PContact | null> {
    this.assertLive();
    const payload = decodePairingPayload(qrText);
    const me = await getIdentity();
    this.assertLive();
    if (me && payload.pk === toHex(me.publicKey)) {
      throw new Error("Ese es tu propio QR.");
    }
    const newPkLower = payload.pk.toLowerCase();
    // Binding conocido y vivo: re-escaneo idempotente, sin desambiguación.
    // (El upsert con supersede-set vacío también cubre "la identidad
    // volvió": si la pk estaba superseded, la ceremonia explícita la
    // restaura — §8 Q10.)
    const knownLive = await findContactByPk(payload.pk);
    this.assertLive();
    if (knownLive) {
      await commitRepair({
        oldPkHexes: [],
        newPkHex: payload.pk,
        name: payload.name,
        sigPkHex: payload.spk ?? null,
      });
      this.assertLive();
      const contact = await findContactByPk(payload.pk);
      this.assertLive();
      if (!contact) throw new Error("No se pudo guardar el contacto.");
      return contact;
    }
    // UNIT B (R2): mismo nombre normalizado + pk distinta y VIVA →
    // desambiguación explícita. El nombre no prueba continuidad de
    // identidad: jamás se infiere reemplazo del nombre.
    const existingSameName = (await listContacts()).filter(
      (c) =>
        normalizeContactName(c.name) === normalizeContactName(payload.name) &&
        c.pkHex.toLowerCase() !== newPkLower,
    );
    this.assertLive();
    let supersedeSet: string[] = [];
    let contactName = payload.name;
    if (existingSameName.length > 0) {
      const choice = opts?.disambiguation;
      if (!choice) throw new PairingDisambiguationRequiredError(existingSameName);
      if (choice === "cancel") return null; // dismiss = cancel: nada escrito
      if (choice === "replace") {
        // Confirmación destructiva explícita: retira la(s) identidad(es)
        // vieja(s). Solo este camino puede superseder.
        //
        // UNIT B concurrency closure: el supersede-set se fija por PK, no
        // por nombre. Si la ceremonia fijó los objetivos (las pks exactas
        // que el usuario vio y confirmó), cada uno debe seguir vivo AHORA;
        // si alguno ya murió, otro Replace ganó la carrera → fail closed,
        // jamás se retira en silencio otra identidad con el mismo nombre.
        // La guarda SQL de commitRepair cubre la ventana entre este
        // pre-check y el commit (ella es la autoridad).
        const pinned = (opts?.replaceTargets ?? []).map((p) => p.toLowerCase());
        if (pinned.length > 0) {
          for (const p of pinned) {
            const row = await findContactRowAny(p);
            this.assertLive();
            if (!row || row.supersededBy) {
              throw new StaleReplaceConflictError(pinned, row?.supersededBy ?? null);
            }
          }
          supersedeSet = pinned;
        } else {
          supersedeSet = existingSameName.map((c) => c.pkHex);
        }
        if (supersedeSet.length === 0) {
          // La(s) identidad(es) que se pretendía(n) reemplazar ya no
          // está(n) viva(s): otro Replace ganó la carrera (o el mundo
          // cambió entre la ceremonia y el confirm). Fail closed: nada
          // escrito, nunca se convierte en silencio en un emparejamiento
          // plano.
          throw new StaleReplaceConflictError([], null);
        }
      } else {
        // different_person: conviven; el contacto nuevo exige un nombre
        // único entre los vivos (la ceremonia lo pide; aquí se valida en
        // defensa en profundidad).
        const newName = (opts?.newName ?? "").trim().slice(0, 40);
        if (!newName) {
          throw new Error(
            "Para emparejar como persona distinta, el contacto nuevo necesita un nombre único.",
          );
        }
        const liveNames = new Set(
          (await listContacts()).map((c) => normalizeContactName(c.name)),
        );
        this.assertLive();
        if (liveNames.has(normalizeContactName(newName))) {
          throw new Error(`Ya tienes un contacto vivo llamado «${newName}». Elige otro nombre.`);
        }
        contactName = newName;
      }
    }
    this.assertLive();
    const { superseded } = await commitRepair({
      oldPkHexes: supersedeSet,
      newPkHex: payload.pk,
      name: contactName,
      sigPkHex: payload.spk ?? null,
    });
    this.assertLive();
    // Post-commit, orden fijo: teardown in-memory por identidad retirada,
    // luego borrado del intent journalizado.
    for (const oldPk of superseded) {
      await this.teardownSupersededPeer(oldPk);
      this.assertLive();
      await clearRepairIntent(oldPk);
      this.assertLive();
    }
    // Búsqueda por clave pública, no por nombre: la resolución por nombre
    // (M-4) es exacta y puede ser ambigua; aquí la clave es única.
    const contact = await findContactByPk(payload.pk);
    this.assertLive();
    if (!contact) throw new Error("No se pudo guardar el contacto.");
    return contact;
  }

  /**
   * UNIT B (§3.3): teardown in-memory post-commit de una identidad
   * superseded: timers de ACK, sesiones (vivas y candidatas),
   * reensambladores y ruta de transporte. La muerte durable ya la decidió
   * el SQL; esto solo limpia la memoria.
   */
  private async teardownSupersededPeer(oldPeerPkHex: string): Promise<void> {
    const key = oldPeerPkHex.toLowerCase();
    // Cancela los timers de ese peer antes de soltar las sesiones.
    const sent = await getSentOutbox();
    for (const m of sent) {
      if (m.peerPk.toLowerCase() === key) this.cancelAckTimer(m.id);
    }
    this.sessions.delete(key);
    this.pendingSessions.delete(key);
    this.reassemblers.get(key)?.reset();
    try {
      // R5: teardown obligatorio; el transporte real lo implementa.
      // Post-commit: un fallo se registra, no revierte (Q9).
      await this.transport.teardownRouteForPeer(oldPeerPkHex);
    } catch {
      /* logged-not-fatal: la muerte SQL ya es autoritativa */
    }
  }

  async contacts(): Promise<P2PContact[]> {
    this.assertLive();
    return listContacts();
  }

  /**
   * Elimina un contacto pareado (desparear). Limpia sus mensajes y nonces.
   */
  async removeContact(pkHex: string): Promise<void> {
    this.assertLive();
    // Desconectar si hay una conexión activa con este peer.
    try {
      await this.transport.disconnect?.(pkHex).catch(() => {});
    } catch {
      /* best-effort */
    }
    await deleteContact(pkHex);
  }

  /**
   * Completa el handshake v3 tras el intercambio HELLO + CONFIRM firmados:
   * 1. `const eph = messenger.newHandshakeEphemeral()` → se envía `eph.publicKey` al peer.
   * 2. Se recibe `theirEphemeralPk` + `theirNonce` del peer.
   * 3. El transporte verifica el CONFIRM del peer (liveness en esta conexión).
   * 4. `await messenger.completeHandshake(peerPkHex, eph.secretKey, theirEphemeralPk, myNonce, theirNonce)`.
   *
   * La sesión queda ligada a ambos nonces: un HELLO repetido no resucita
   * sesiones pasadas (ver docs/HANDSHAKE_THREAT_MODEL.md).
   *
   * N6 §3.3 (D3): además deriva el session_tag desde los pares canónicos
   * identidad↔nonce — `myNonce` es el nonce del HELLO de MI identidad y
   * `theirNonce` el del HELLO del peer (asociación que el transporte R4 ya
   * estableció). Puramente aditivo y read-only: no toca el KDF, los bytes
   * del handshake, el CONFIRM ni el establecimiento de la ruta. Sin tag,
   * los ACK se rechazan fail-closed.
   *
   * H-8: la sesión derivada queda como CANDIDATA (`pendingSessions`). La
   * sesión viva existente, si la hay, NO se sustituye aquí: solo se
   * promociona la candidata cuando `handleFrame` recibe un frame válido
   * bajo su clave (liveness demostrada por el peer).
   */
  async completeHandshake(
    peerPkHex: string,
    myEphemeralSecret: Uint8Array,
    theirEphemeralPk: Uint8Array,
    myNonce: Uint8Array,
    theirNonce: Uint8Array,
  ): Promise<void> {
    this.assertLive();
    const session = P2PSession.fromHandshakeV2(
      myEphemeralSecret,
      theirEphemeralPk,
      peerPkHex,
      myNonce,
      theirNonce,
    );
    if (this.myPk) {
      session.expectRecipient(toHex(this.myPk));
      // N6: derivación read-only del session_tag (R4 congelado).
      try {
        session.setSessionTag(
          deriveAckSessionTag(toHex(this.myPk), peerPkHex, myNonce, theirNonce),
        );
      } catch {
        // Tag inválido: queda null y los ACK se rechazan fail-closed.
      }
    }
    const key = peerPkHex.toLowerCase();
    // H-8: candidata, no sustitución. La sesión viva sigue en `sessions`.
    this.pendingSessions.set(key, session);
    // Confirmación de sesión: un frame autenticado que demuestra al peer
    // que conozco la clave. La cola NO se vacía aquí: solo cuando el peer
    // confirma a su vez (liveness) y la candidata se promociona. Así, un
    // HELLO repetido por un atacante crea una sesión fantasma bajo la cual
    // jamás llega un frame válido y ningún mensaje encolado se pierde en ella.
    if (this.myPk && this.transport.available) {
      try {
        const confirm = makeEnvelope("session_confirm", newId(), this.myPk, peerPkHex, {});
        this.assertLive();
        await this.transport.sendFrame(key, session.pack(confirm));
      } catch {
        // Si el envío falla, el confirm del peer activará el flush igual.
      }
    }
  }

  /** El transporte debe llamar esto al cerrarse un socket: descarta bytes a medias. */
  handleDisconnect(peerPkHex: string): void {
    const key = peerPkHex.toLowerCase();
    this.reassemblers.get(key)?.reset();
  }

  /** Crea mi par efímero para iniciar un handshake (el transporte lo envía). */
  newHandshakeEphemeral(): { publicKey: Uint8Array; secretKey: Uint8Array } {
    return generateEphemeral();
  }

  /**
   * Envía un mensaje de chat a un contacto (por nombre).
   *
   * N6 §4.2 (P1, persist-first): la fila del outbox se persiste en estado
   * 'queued' ANTES de cualquier I/O de red. Un crash antes del envío deja
   * 'queued' → reintento limpio. 'sent' significa solo "entregado al stack
   * Bluetooth local" (honesto: sin checkmark); 'delivered' solo llega vía
   * ACK validado (§4.5).
   */
  async sendChat(contactName: string, text: string): Promise<{ id: string; queued: boolean }> {
    this.assertLive();
    const clean = text.trim();
    if (!clean) throw new Error(p2pT("p2p.sendChatEmpty"));
    if (clean.length > 4000) throw new Error(p2pT("p2p.sendChatTooLong"));
    // M-4: resolución exacta por nombre; nunca se adivina el destinatario.
    const resolution = await resolveContactByName(contactName);
    this.assertLive();
    if (resolution.kind === "not_found") {
      throw new Error(p2pT("p2p.sendChatContactNotFound", { name: contactName }));
    }
    if (resolution.kind === "ambiguous") {
      const options = resolution.candidates
        .map((c) => `• ${c.name} (id ${c.pkHex.slice(0, 8)}…)`)
        .join("\n");
      throw new Error(
        p2pT("p2p.sendChatContactAmbiguous", {
          count: String(resolution.candidates.length),
          name: contactName,
          options,
        }),
      );
    }
    const contact = resolution.contact;
    if (!this.myPk) {
      const identity = await getIdentity();
      this.assertLive();
      if (!identity) throw new Error("Primero crea tu identidad NIDO.");
      this.myPk = identity.publicKey;
    }
    const id = newId(); // N6: message_id estable en todos los reintentos (§5.1, Tier 2)
    // P1: persistir ANTES del primer intento de envío.
    this.assertLive();
    await saveMessage({
      id,
      dir: "out",
      peerPk: contact.pkHex,
      type: "chat",
      text: clean,
      status: "queued",
      ts: Date.now(),
      ackAttempts: 0,
    });
    const sent = await this.attemptOutboundSend(id);
    return { id, queued: !sent };
  }

  /**
   * N6 §5.1 — payload saliente: el `message_id` es estable en todos los
   * intentos; el envelope id (transmisión) se re-acuña fresco en cada
   * intento. El contenido del payload es byte-idéntico entre reintentos
   * (N2 parity preservado sobre el payload).
   */
  private buildOutboundPayload(msg: P2PStoredMessage): Record<string, unknown> {
    return { text: msg.text, message_id: msg.id };
  }

  /**
   * N6: un intento de envío de una fila del outbox. Devuelve true si los
   * bytes salieron al transporte (→ estado 'sent' + timer de ACK).
   * Envío directo solo con sesión viva: el peer ya demostró conocer la
   * clave de esta sesión (confirmación mutua tras el handshake).
   */
  private async attemptOutboundSend(id: string): Promise<boolean> {
    const msg = await getOutboundMessage(id);
    this.assertLive();
    if (!msg || !this.myPk) return false;
    const key = msg.peerPk.toLowerCase();
    const session = this.sessions.get(key);
    if (!session || !session.isPeerLive || !this.transport.available) return false;
    try {
      const envelope = makeEnvelope(
        msg.type as P2PMessageType,
        newId(), // N6 §5.1: envelope id = nonce de transmisión, fresco por intento (Tier 1)
        this.myPk,
        key,
        this.buildOutboundPayload(msg),
      );
      this.assertLive();
      await this.transport.sendFrame(key, session.pack(envelope));
    } catch {
      return false; // el peer no está al alcance: queda en cola
    }
    // Post-await: no marcar nada desde una instancia destruida.
    this.assertLive();
    // F-1: la transición a 'sent' es GUARDADA en SQL. Si la fila alcanzó un
    // estado terminal mientras los bytes estaban en vuelo (cancel del
    // usuario, re-pair, o delivered por un ACK ya procesado), esta
    // transición pierde y el estado terminal gana: no se arma el timer ni
    // se toca failure_reason. La BD decide la carrera, no un re-check en JS
    // (que seguiría siendo vencible por otro await).
    const won = await markOutboundSent(msg.id);
    if (!won) return false; // bytes ya salidos al OS; la terminal mandó
    this.startAckTimer(msg.id);
    return true;
  }

  /**
   * N6: cancela un mensaje saliente por decisión explícita del usuario.
   * queued|sent → failed(user_cancelled). La cancelación es terminal para
   * la intención del usuario: un ACK tardío genuino se registra
   * internamente pero NUNCA cambia el estado visible (D7).
   */
  async cancelOutboundMessage(id: string): Promise<boolean> {
    this.assertLive();
    const msg = await getOutboundMessage(id);
    this.assertLive();
    if (!msg || (msg.status !== "queued" && msg.status !== "sent")) return false;
    this.cancelAckTimer(id);
    return markOutboundFailed(id, "user_cancelled");
  }

  /**
   * N6 §4.3 / §7 + UNIT B (§7): reintento manual desde 'failed', con la
   * matriz de causas de UNIT B:
   * - identity_changed/peer_superseded → rechazado; usar
   *   resendToSupersedingIdentity (nuevo envío, nuevo message_id).
   * - identity_changed/orphaned_destination (o causa legacy nula) →
   *   rechazado (R3: nunca inventar una supersesión).
   * - identity_changed/own_identity_recovered → permitido (el peer sigue
   *   siendo legítimo; el reintento espera su re-pair).
   * - user_cancelled → rechazado salvo gesto explícito NUEVO
   *   ({explicitGesture: true}), y entonces SIEMPRE con message_id fresco
   *   (R4); la fila vieja queda failed para siempre.
   * - timeout → permitido (gate SQL: resetOutboundForRetry).
   *
   * El gate autoritativo es SQL (resetOutboundForRetry); este despacho
   * produce el rechazo tipado antes de tocar la BD.
   */
  async retryOutboundMessage(
    id: string,
    opts?: { explicitGesture?: boolean },
  ): Promise<RetryOutcome | null> {
    this.assertLive();
    const msg = await getOutboundMessage(id);
    this.assertLive();
    if (!msg || msg.status !== "failed") return null;
    if (msg.failureReason === "identity_changed") {
      const cause = msg.identityChangeCause;
      if (cause === "peer_superseded") {
        const supersededBy = await getLiveSuccessorPk(msg.peerPk);
        this.assertLive();
        return { refused: "peer_superseded", supersededBy };
      }
      if (cause === "orphaned_destination" || cause === null) {
        // R3: causa real desconocida — nunca inventar una supersesión.
        return { refused: "orphaned_destination" };
      }
      // own_identity_recovered: permitido — sigue el camino normal.
    }
    if (msg.failureReason === "user_cancelled") {
      // R4: la cancelación es terminal para la intención. Solo un gesto
      // explícito nuevo del usuario la reenvía, y SIEMPRE con message_id
      // fresco: la fila vieja nunca se muta.
      if (!opts?.explicitGesture) return { refused: "user_cancelled" };
      return this.resendAsFreshMessage(msg);
    }
    const horizonMs = DEDUP_RETENTION_DAYS * 86_400_000;
    if (Date.now() - msg.ts > horizonMs) {
      // Más allá del horizonte: nuevo envío con id fresco.
      return this.resendAsFreshMessage(msg);
    }
    const ok = await resetOutboundForRetry(id);
    if (!ok) {
      // El gate SQL no reseteó. Dos posibilidades: (a) rechazo genuino
      // (peer_superseded/orphaned_destination); (b) carrera benigna — otro
      // retry concurrente ya movió la fila (N6: el mismo message_id
      // compartido es benigno por diseño). Se relee la fila para
      // distinguir: solo un 'failed' con causa que rechaza es un rechazo.
      const cur = await getOutboundMessage(id);
      this.assertLive();
      if (cur && cur.status === "failed") {
        if (cur.failureReason === "identity_changed") {
          const cause = cur.identityChangeCause;
          if (cause === "peer_superseded") {
            return {
              refused: "peer_superseded",
              supersededBy: await getLiveSuccessorPk(cur.peerPk),
            };
          }
          return { refused: "orphaned_destination" };
        }
        if (cur.failureReason === "user_cancelled") {
          // Una cancelación que aterrizó en medio del retry gana.
          return { refused: "user_cancelled" };
        }
      }
      // (b): el reintento ya está en curso por el ganador de la carrera.
      return { id, freshId: false };
    }
    this.assertLive();
    await this.attemptOutboundSend(id);
    return { id, freshId: false };
  }

  /**
   * UNIT B (R4): crea un envío NUEVO del mismo contenido con message_id
   * FRESCO; la fila original queda 'failed' para siempre. Usado para el
   * reenvío explícito tras user_cancelled y para envíos más allá del
   * horizonte de dedup.
   */
  private async resendAsFreshMessage(msg: P2PStoredMessage): Promise<RetryOutcome> {
    const freshId = newId();
    await saveMessage({
      id: freshId,
      dir: "out",
      peerPk: msg.peerPk,
      type: msg.type,
      text: msg.text,
      status: "queued",
      ts: Date.now(),
      ackAttempts: 0,
    });
    this.assertLive();
    await this.attemptOutboundSend(freshId);
    return { id: freshId, freshId: true };
  }

  /**
   * UNIT B (§7.1): reenvío explícito de una fila fallada por
   * peer_superseded a la identidad viva sucesora. NO es un retry: crea una
   * fila NUEVA con message_id FRESCO dirigida a la pk viva; la fila vieja
   * NUNCA se muta (su causa peer_superseded queda como historia). Requiere
   * sucesor vivo (one-hop: sin perseguir cadenas).
   */
  async resendToSupersedingIdentity(
    failedId: string,
  ): Promise<{ id: string } | { refused: "not_peer_superseded" | "no_live_successor" }> {
    this.assertLive();
    const msg = await getOutboundMessage(failedId);
    this.assertLive();
    if (
      !msg ||
      msg.status !== "failed" ||
      msg.failureReason !== "identity_changed" ||
      msg.identityChangeCause !== "peer_superseded"
    ) {
      return { refused: "not_peer_superseded" };
    }
    const successor = await getLiveSuccessorPk(msg.peerPk);
    this.assertLive();
    if (!successor) return { refused: "no_live_successor" };
    const freshId = newId();
    await saveMessage({
      id: freshId,
      dir: "out",
      peerPk: successor,
      type: msg.type,
      text: msg.text,
      status: "queued",
      ts: Date.now(),
      ackAttempts: 0,
    });
    this.assertLive();
    await this.attemptOutboundSend(freshId);
    return { id: freshId };
  }

  /**
   * N6 §4.4: recuperación tras reinicio/crash del emisor. Toda fila 'sent'
   * vuelve a 'queued' — NUNCA 'delivered'. El reenvío usa el mismo
   * message_id; el receptor hace dedup.
   */
  async recoverOutbox(): Promise<number> {
    this.assertLive();
    return recoverSentOutboxToQueued();
  }

  /** N6: arranca (o re-arranca) el timer de espera de ACK para un message_id. */
  private startAckTimer(id: string): void {
    this.cancelAckTimer(id);
    this.lastAttemptAt.set(id, Date.now());
    const t = setTimeout(() => {
      void this.onAckTimeout(id).catch(() => {});
    }, ACK_TIMEOUT_MS);
    // En tests (fake timers) o entornos sin unref, no bloquear la salida.
    if (typeof (t as unknown as { unref?: () => void }).unref === "function") {
      (t as unknown as { unref: () => void }).unref();
    }
    this.ackTimers.set(id, t);
  }

  /** N6: cancela el timer de ACK (entrega confirmada, cancelación o fallo terminal). */
  private cancelAckTimer(id: string): void {
    const t = this.ackTimers.get(id);
    if (t) clearTimeout(t);
    this.ackTimers.delete(id);
    this.lastAttemptAt.delete(id);
  }

  /**
   * N6 §4.3: expiración de la espera de ACK.
   * - Sin sesión viva: el timer se PAUSA (no consume presupuesto); el
   *   reintento ocurre al reconectar (flushOutbox barre 'sent' expirados).
   * - Con sesión viva: reintento (mismo message_id, envelope fresco) hasta
   *   agotar ACK_MAX_ATTEMPTS → failed(timeout).
   */
  private async onAckTimeout(id: string): Promise<void> {
    this.ackTimers.delete(id);
    const msg = await getOutboundMessage(id);
    if (!msg || msg.status !== "sent") return;
    const key = msg.peerPk.toLowerCase();
    const session = this.sessions.get(key);
    const live = !!session?.isPeerLive && this.transport.available;
    if (!live) return; // timer pausado: no consume presupuesto
    const attempts = await incrementAckAttempts(id);
    if (attempts > ACK_MAX_ATTEMPTS) {
      await markOutboundFailed(id, "timeout");
      return;
    }
    await this.attemptOutboundSend(id);
  }

  /**
   * N6: barrido determinista de ACKs expirados (para tests y para el
   * timer). Expira los 'sent' cuyo último intento superó ACK_TIMEOUT_MS.
   */
  async runAckSweep(nowMs = Date.now()): Promise<void> {
    this.assertLive();
    const sent = await getSentOutbox();
    this.assertLive();
    for (const m of sent) {
      const last = this.lastAttemptAt.get(m.id);
      if (last === undefined || nowMs - last >= ACK_TIMEOUT_MS) {
        this.cancelAckTimer(m.id);
        await this.onAckTimeout(m.id);
      }
    }
  }

  /** Procesa bytes crudos del transporte (chunks arbitrarios). */
  async handleBytes(peerPkHex: string, chunk: Uint8Array): Promise<P2PEnvelope[]> {
    this.assertLive();
    const key = peerPkHex.toLowerCase();
    let re = this.reassemblers.get(key);
    if (!re) {
      re = new FrameReassembler();
      this.reassemblers.set(key, re);
    }
    const frames = re.push(chunk);
    const received: P2PEnvelope[] = [];
    for (const frame of frames) {
      const env = await this.handleFrame(key, frame);
      if (env) received.push(env);
    }
    return received;
  }

  /**
   * Procesa un frame completo ya reensamblado.
   *
   * N6 §5 / §5.1 — ruta de recepción en dos niveles:
   * - Tier 1: `unpack` ya aplicó anti-replay sobre el envelope id
   *   (transmisión), sin excepciones, para todos los tipos de frame.
   * - Tier 2: para tipos ACK-enabled (chat, agent_task), el dedup gate
   *   sobre el payload `message_id` decide entre ruta dedup/re-ACK
   *   (id conocido: sin insert, sin efectos, ACK fresco igual) y ruta de
   *   proceso (id nuevo: persistir PRIMERO, y solo tras el commit emitir
   *   el ACK — D4).
   */
  async handleFrame(peerPkHex: string, frame: Uint8Array): Promise<P2PEnvelope | null> {
    this.assertLive();
    const key = peerPkHex.toLowerCase();
    let session = this.sessions.get(key) ?? null;
    let env = session?.unpack(frame) ?? null;
    if (!env) {
      // ¿Es un frame válido bajo la sesión CANDIDATA? Si sí, el peer
      // demostró conocer la clave del nuevo handshake: liveness → se
      // promociona y SUSTITUYE a la viva. Hasta este momento, la viva
      // anterior siguió intacta (H-8): un HELLO repetido no la desaloja.
      const candidate = this.pendingSessions.get(key);
      const candEnv = candidate?.unpack(frame) ?? null;
      if (candidate && candEnv) {
        this.sessions.set(key, candidate);
        this.pendingSessions.delete(key);
        session = candidate;
        env = candEnv;
      } else {
        return null; // sin sesión válida: manipulado, replay o corrupto; se descarta en silencio
      }
    }
    if (env.type === "delivery_ack") {
      // N6 §3.2/§4.5: un ACK nunca va al inbox, nunca dispara flushOutbox
      // y nunca marca la sesión como viva por sí solo (la liveness ya la
      // dio unpack). Solo puede mover la máquina de estados del emisor.
      this.assertLive();
      if (!session) return null; // inalcanzable: env no nulo implica sesión
      await this.processDeliveryAck(key, env, session);
      return env;
    }
    if (env.type === "session_confirm") {
      // Confirmación de sesión: no va a la bandeja. El peer demostró
      // conocer la clave → la sesión está viva → se vacía la cola.
      this.assertLive();
      await this.flushOutbox(key);
      return env;
    }
    if (env.type === "negotiation") {
      // v2 (2026-10-05): routing real de negociación NIDO↔NIDO.
      // Antes processIncomingProposal() tenía cero callers; ahora el
      // transporte lo invoca via NegotiationService.
      // No va al inbox de mensajes: tiene su propia state machine y UI.
      this.assertLive();
      const { negotiationService } = await import("./negotiationService");
      await negotiationService.handleEnvelope(env);
      // Cualquier frame válido confirma la sesión.
      await this.flushOutbox(key);
      return env;
    }
    if (env.type === "pack_share") {
      // v2.1 (2026-10-05): routing real de Pack Sharing NIDO↔NIDO.
      // Antes packSharing.ts tenía cero callers fuera de tests; ahora el
      // transporte lo invoca via PackShareService.
      // No va al inbox de mensajes: tiene su propia state machine y UI.
      this.assertLive();
      const { packShareService } = await import("./packShareService");
      await packShareService.handleEnvelope(env);
      // Cualquier frame válido confirma la sesión.
      await this.flushOutbox(key);
      return env;
    }
    const payload = env.payload as unknown as AgentTaskPayload & { message_id?: unknown; text?: unknown };
    if (N6_ACK_TYPES.has(env.type)) {
      // N6 §5.1: el message_id del payload (estable entre reintentos);
      // fallback al envelope id para peers sin soporte N6.
      const messageId =
        typeof payload.message_id === "string" && payload.message_id.length > 0
          ? payload.message_id
          : env.id;
      const known =
        (await messageExists(messageId)) || (await getDeliveryAckLogEntry(messageId)) !== null;
      this.assertLive();
      if (!session) return null; // inalcanzable: env no nulo implica sesión
      if (known) {
        // Ruta dedup/re-ACK: NO se reinserta, NO se construyen efectos
        // (agent_task no puede ejecutarse dos veces — prueba en §5.1),
        // pero SIEMPRE se emite un ACK fresco bajo el tag de la sesión
        // actual (D11). Es el lynchpin del caso persist→crash→retry.
        await this.emitDeliveryAck(key, session, messageId, env.type);
        return null;
      }
      return this.processInboundMessage(key, session, env, messageId);
    }
    // Tipos sin ACK (agent_result, receipt): ruta legacy con env.id.
    // M-6: la tarea queda en la bandeja de aprobación con su contexto
    // (kind + args resumidos); nunca se auto-ejecuta.
    const kind = String(payload.kind ?? "tarea");
    const taskText = String(payload.text ?? "");
    const argsJson = payload.args ? JSON.stringify(payload.args).slice(0, 300) : "";
    const text =
      env.type === "chat"
        ? String((env.payload as { text?: unknown }).text ?? "")
        : env.type === "agent_task"
          ? `[Tarea de su NIDO · ${kind}] ${taskText}${argsJson ? ` (datos: ${argsJson})` : ""}`
          : "";
    // No persistir frames desde una instancia destruida a mitad del
    // procesamiento (el guard de epoch de la base lo rechazaría tras un
    // wipe, pero la instancia muerta no debe ni intentarlo).
    this.assertLive();
    const isNew = await saveMessage({
      id: env.id,
      dir: "in",
      peerPk: key,
      type: env.type,
      text,
      status: env.type === "agent_task" ? "queued" : "delivered",
      ts: env.ts,
    });
    if (!isNew) return null; // duplicado persistente (p. ej. tras reinicio): no reprocesar
    // Cualquier frame válido confirma la sesión: es seguro vaciar la cola.
    this.assertLive();
    await this.flushOutbox(key);
    return env;
  }

  /**
   * N6 §5: ruta de proceso para un message_id nuevo. Construye el texto
   * (misma lógica que el path legacy), persiste el mensaje + entrada del
   * ack log EN LA MISMA TRANSACCIÓN, y SOLO DESPUÉS del commit emite el
   * ACK (D4: ACK únicamente post-commit).
   */
  private async processInboundMessage(
    key: string,
    session: P2PSession,
    env: P2PEnvelope,
    messageId: string,
  ): Promise<P2PEnvelope | null> {
    const payload = env.payload as unknown as AgentTaskPayload & { text?: unknown };
    const kind = String(payload.kind ?? "tarea");
    const taskText = String(payload.text ?? "");
    const argsJson = payload.args ? JSON.stringify(payload.args).slice(0, 300) : "";
    const text =
      env.type === "chat"
        ? String((env.payload as { text?: unknown }).text ?? "")
        : env.type === "agent_task"
          ? `[Tarea de su NIDO · ${kind}] ${taskText}${argsJson ? ` (datos: ${argsJson})` : ""}`
          : "";
    this.assertLive();
    const tag = session.sessionTag;
    let isNew: boolean;
    if (tag) {
      // D4: mensaje + entrada del ack log EN LA MISMA TRANSACCIÓN; el ACK
      // solo se emite después de que este commit resuelva.
      isNew = await saveInboundMessageWithAckLog({
        id: messageId,
        peerPk: key,
        type: env.type,
        text,
        status: env.type === "agent_task" ? "queued" : "delivered",
        ts: env.ts,
        sessionTag: tag,
        persistedAt: Date.now(),
      });
    } else {
      // Fail-closed en el ACK, no en el mensaje: sin tag no podemos
      // atestiguar la sesión, pero el frame es auténtico y el mensaje es
      // real. Se persiste sin entrada de ack log (el emisor expirará a
      // failed honestamente; su reintento hará dedup por inbox).
      isNew = await saveMessage({
        id: messageId,
        dir: "in",
        peerPk: key,
        type: env.type,
        text,
        status: env.type === "agent_task" ? "queued" : "delivered",
        ts: env.ts,
      });
    }
    if (!isNew) {
      // Carrera ganada por otro procesamiento: ruta dedup.
      await this.emitDeliveryAck(key, session, messageId, env.type);
      return null;
    }
    if (tag) {
      await this.emitDeliveryAck(key, session, messageId, env.type);
    }
    // Cualquier frame válido confirma la sesión: es seguro vaciar la cola.
    this.assertLive();
    await this.flushOutbox(key);
    return env;
  }

  /**
   * N6 §5 paso 4 / D11: emite un (re-)ACK. El session_tag se lee SIEMPRE
   * del objeto de sesión actualmente establecido; el tag guardado en el
   * ack log es solo auditoría y jamás se copia a un envelope.
   */
  private async emitDeliveryAck(
    peerKey: string,
    session: P2PSession,
    messageId: string,
    forType: string,
  ): Promise<void> {
    const tag = session.sessionTag;
    if (!tag || !this.myPk || !this.transport.available) return;
    const ackPayload: DeliveryAckPayload = {
      for_id: messageId,
      for_type: forType,
      persisted_at: Date.now(),
      session_tag: tag,
      attest: "persisted",
    };
    try {
      const envelope = makeEnvelope(
        "delivery_ack",
        newId(), // cada ACK lleva envelope id fresco (Tier 1 lo protege)
        this.myPk,
        peerKey,
        ackPayload as unknown as Record<string, unknown>,
      );
      await this.transport.sendFrame(peerKey, session.pack(envelope));
    } catch {
      // Si el ACK no sale, el emisor reintentará y el dedup lo re-ACKeará.
    }
  }

  /**
   * N6 §3.2 + §4.5: procesa un delivery_ack entrante. Las 5 validaciones:
   * 1. el frame abrió bajo la clave de la sesión ACTUAL (unpack);
   * 2. env.from == peer de la sesión (unpack);
   * 3. forma exacta del payload;
   * 4. session_tag == tag de la sesión actualmente establecida;
   * 5. for_id corresponde a un mensaje saliente conocido en estado no terminal.
   * Cualquier fallo → descarte silencioso, sin cambio de estado (fail closed).
   */
  private async processDeliveryAck(
    peerKey: string,
    env: P2PEnvelope,
    session: P2PSession,
  ): Promise<void> {
    if (!isValidAckPayload(env.payload)) return;
    const ack = env.payload as DeliveryAckPayload;
    const tag = session.sessionTag;
    if (!tag || ack.session_tag !== tag) return; // validación 4: cross-session / stale tag
    const row = await getOutboundMessage(ack.for_id);
    if (!row) return; // validación 5: ACK para un mensaje que nunca enviamos
    if (row.peerPk.toLowerCase() !== peerKey) return; // el mensaje pertenece a otro peer
    // validación 5b (D3 §3.2): el tipo declarado en el ACK debe coincidir con
    // el tipo del mensaje que emitimos. Sin esto, un ACK "válido" para un
    // chat podría cerrar un agent_task y viceversa (confusión de tipos que
    // rompe la semántica de la auditoría).
    if (ack.for_type !== row.type) return;
    this.assertLive();
    if (row.status === "delivered") return; // idempotente: terminal
    if (row.status === "failed") {
      // D7: despacho por causa interna.
      if (row.failureReason === "timeout") {
        // Confirmación tardía genuina: "timeout" significaba "no pude
        // confirmar"; la confirmación llegó. Transición honesta.
        await this.transitionToDelivered(row.id);
      } else if (row.failureReason === "user_cancelled") {
        // La intención del usuario gana: se registra internamente, el
        // estado visible NO cambia.
        await recordLateAck(row.id, ack.session_tag, Date.now());
      }
      // identity_changed: muere aquí (además ya habría fallado la
      // validación 1/4: la clave vieja no existe y el tag no puede coincidir).
      return;
    }
    if (row.status === "queued" || row.status === "sent") {
      await this.transitionToDelivered(row.id);
    }
  }

  /**
   * N6 P2: LA ÚNICA función que puede escribir 'delivered' en un mensaje
   * saliente, y solo se la llama con un ACK ya validado. Estructuralmente
   * imposible que timeout/desconexión/crash produzcan 'delivered'.
   */
  private async transitionToDelivered(id: string): Promise<void> {
    this.cancelAckTimer(id);
    await markOutboundDelivered(id);
  }

  /** Bandeja de entrada sin leer (y la marca como leída). */
  async readInbox(): Promise<P2PStoredMessage[]> {
    this.assertLive();
    const unread = await getUnreadInbox();
    this.assertLive();
    for (const m of unread) {
      // M-6: una agent_task encolada NO se marca como leída al leer la
      // bandeja: sigue pendiente de aprobación explícita. Marcarla "read"
      // la sacaría silenciosamente de la bandeja de aprobación.
      if (m.type === "agent_task" && m.status === "queued") continue;
      await markMessageStatus(m.id, "read");
    }
    return unread;
  }

  async pendingOutbox(): Promise<P2PStoredMessage[]> {
    this.assertLive();
    return getOutbox();
  }

  /**
   * v2.1 (2026-10-05): Envía un envelope pack_share directamente via la
   * sesión P2P (no pasa por el outbox: los chunks necesitan control de
   * flujo propio y la sesión ya aplica anti-replay sobre el envelope id).
   *
   * Usado por PackShareService para OFFER/ACCEPT/DECLINE/CHUNK/CHUNK_ACK/
   * COMPLETE/CANCEL. Si no hay sesión viva, el envío falla silenciosamente
   * (el servicio maneja el reintento/timeout).
   */
  async sendPackShare(
    peerPkHex: string,
    action: "OFFER" | "ACCEPT" | "DECLINE" | "CHUNK" | "CHUNK_ACK" | "COMPLETE" | "CANCEL",
    sessionId: string,
    data: Record<string, unknown>
  ): Promise<boolean> {
    this.assertLive();
    if (!this.myPk) {
      const identity = await getIdentity();
      this.assertLive();
      if (!identity) return false;
      this.myPk = identity.publicKey;
    }
    const key = peerPkHex.toLowerCase();
    const session = this.sessions.get(key);
    if (!session || !session.isPeerLive || !this.transport.available) return false;
    try {
      const envelope = makeEnvelope(
        "pack_share",
        newId(),
        this.myPk,
        key,
        { action, sessionId, data }
      );
      this.assertLive();
      await this.transport.sendFrame(key, session.pack(envelope));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Envía una respuesta de negociación firmada (ACCEPT/DECLINE/COUNTER) al peer.
   * Crea el mensaje firmado con la identidad local, lo envuelve en un
   * P2PEnvelope type="negotiation" y lo envía por el transporte.
   * Retorna true si se envió, false si no hay sesión viva/transporte.
   */
  async sendNegotiationResponse(
    peerPkHex: string,
    action: "ACCEPT" | "DECLINE" | "COUNTER",
    negotiationId: string,
    signed: Record<string, unknown>
  ): Promise<boolean> {
    this.assertLive();
    if (!this.myPk) {
      const identity = await getIdentity();
      this.assertLive();
      if (!identity) return false;
      this.myPk = identity.publicKey;
    }
    const key = peerPkHex.toLowerCase();
    const session = this.sessions.get(key);
    if (!session || !session.isPeerLive || !this.transport.available) return false;
    try {
      const envelope = makeEnvelope(
        "negotiation",
        newId(),
        this.myPk,
        key,
        { action, negotiationId, signed }
      );
      this.assertLive();
      await this.transport.sendFrame(key, session.pack(envelope));
      return true;
    } catch {
      return false;
    }
  }

  private async flushOutbox(peerPkHex: string): Promise<void> {
    const key = peerPkHex.toLowerCase();
    const session = this.sessions.get(key);
    // Solo se vacía hacia sesiones vivas: el peer demostró conocer la
    // clave de esta sesión. Sin liveness, un HELLO repetido podría
    // tragarse mensajes en una sesión que el peer real no comparte.
    if (!session || !session.isPeerLive || !this.transport.available) return;
    const outbox = await getOutbox();
    this.assertLive();
    if (!this.myPk) return;
    // N6: primero los 'queued' (primer intento), luego los 'sent' cuyo
    // timer expiró mientras no había sesión (el timer se pausó en la
    // desconexión — §4.3): reintentan aquí o agotan su presupuesto.
    for (const msg of outbox) {
      if (msg.peerPk.toLowerCase() !== key) continue;
      try {
        const ok = await this.attemptOutboundSend(msg.id);
        if (!ok) break; // se perdió el peer; el resto sigue en cola
      } catch {
        break;
      }
    }
    const now = Date.now();
    for (const msg of await getSentOutbox()) {
      if (msg.peerPk.toLowerCase() !== key) continue;
      const last = this.lastAttemptAt.get(msg.id);
      if (last !== undefined && now - last < ACK_TIMEOUT_MS) continue; // timer aún vivo
      this.cancelAckTimer(msg.id);
      const attempts = await incrementAckAttempts(msg.id);
      this.assertLive();
      if (attempts > ACK_MAX_ATTEMPTS) {
        await markOutboundFailed(msg.id, "timeout");
        continue;
      }
      try {
        const ok = await this.attemptOutboundSend(msg.id);
        if (!ok) break;
      } catch {
        break;
      }
    }
  }
}
