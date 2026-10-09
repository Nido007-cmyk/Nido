/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * nativeTransport.ts — NIDO: transporte Bluetooth real sobre el módulo
 * nativo `nido-p2p` (Kotlin RFCOMM).
 *
 * El módulo nativo solo mueve bytes con framing [u32 BE][payload] y emite
 * frames completos en base64. Este adaptador implementa `P2PTransport`:
 * direcciona conexiones por MAC, hace el handshake de presentación
 * (HELLO v3 + CONFIRM v1) y entrega a `NidoMessenger` solo peers con
 * sesión válida.
 *
 * Handshake v3 autenticado con context binding (R4; ver
 * docs/HANDSHAKE_THREAT_MODEL.md y
 * ~/workspace/audits/r4-hello-v2-design-packet-2026-09-28.md):
 *  1. Al establecerse el socket (saliente o entrante), cada lado envía un
 *     frame HELLO en claro: {"t":"nido-hello","v":3,"pk","eph","nonce","ts","sig"}.
 *  2. `sig` es Ed25519 sobre ("nido-hello-v3"|pk|eph|nonce|ts) con la clave
 *     de firma entregada en el QR de emparejamiento. Sin firma válida no
 *     hay sesión: un MITM no puede sustituir el efímero ni "refrescar" el ts.
 *  3. Tras validar el HELLO del peer (incluido el INSERT atómico anti-replay
 *     en la cache persistente), cada lado envía CONFIRM v1:
 *     {"t":"nido-confirm","v":1,"pk","cn","pn","sig"}, firmando AMBOS nonces
 *     (el propio y el del peer) con su clave Ed25519. Esto liga la
 *     confirmación al transcript vivo de ESTA conexión: un HELLO capturado
 *     de otro contexto no puede producir el CONFIRM correspondiente.
 *  4. INVARIANTE CENTRAL (R4): un HELLO solo NUNCA modifica pkToMac/macToPk.
 *     La ruta y la sesión se establecen ÚNICAMENTE después de verificar un
 *     CONFIRM válido ligado a ambos nonces de esa conexión.
 *  5. Se notifica `onHandshakeComplete(pk, myEphSecret, theirEphPk,
 *     myNonce, theirNonce)` para que el messenger derive la sesión ligada
 *     a ambos nonces (un HELLO repetido no resucita sesiones).
 *  6. Cooldown por peer: un segundo handshake con ruta viva dentro de 10 s
 *     se rechaza (anti-spam de HELLO repetidos).
 */
import type {
  P2PTransport,
  P2PTransportEvents,
  P2PPeerInfo,
} from "./transport";
import { NativeP2PTransport } from "./transport";
import {
  buildHelloSignMessageV3,
  buildConfirmSignMessage,
  fromHex,
  generateEphemeral,
  HANDSHAKE_NONCE_BYTES,
  randomNonce,
  signDetached,
  toHex,
  verifyDetached,
} from "./crypto";
import { getIdentity, getSigningKeypair, findContactByPk } from "./store";
import { defaultHelloNonceCache, type HelloNonceCache } from "./nonceCache";
import {
  buildConfirmV1,
  CONFIRM_WAIT_MS,
  HELLO_TS_SKEW_S,
  HELLO_TYPE_V3,
  HELLO_VERSION,
  NONCE_CACHE_WINDOW_S,
  parseConfirm,
  tieBreakKey,
} from "./handshakeV3";
import { encodeBase64, decodeBase64 } from "./base64";
import { withPermissionRequest } from "./permissionGuard";

/** Subconjunto estructural de los bindings de `nido-p2p` (sin expo en tests). */
export interface NidoP2PBindings {
  isBluetoothEnabled(): boolean;
  requestPermissions(): Promise<boolean>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  requestDiscoverable?(): Promise<void>;
  startServer(): Promise<void>;
  stopServer(): Promise<void>;
  /**
   * DIAG-2026-10-07: estado del servidor RFCOMM nativo. Síncrona.
   * { alive: el accept loop está vivo; acceptedCount: conexiones aceptadas;
   *   lastAcceptAt: epoch ms del último accept (0 si ninguno). }
   * Opcional: módulos viejos sin este diagnóstico devuelven undefined.
   */
  getServerStatus?(): { alive: boolean; acceptedCount: number; lastAcceptAt: number };
  connect(address: string): Promise<{ address: string; name: string | null }>;
  sendFrame(address: string, base64: string): Promise<void>;
  disconnect(address: string): Promise<void>;
  /**
   * Apagado nativo total (B/F4): detiene discovery/servidor y CIERRA los
   * sockets RFCOMM activos en el módulo Kotlin. Existe en
   * `modules/nido-p2p/src/index.ts`; este binding estructural lo expone
   * para que `NidoBluetoothTransport.shutdownNative()` pueda invocarlo
   * desde la destrucción terminal del messenger.
   */
  shutdown(): Promise<void>;
  /**
   * BUG-6-2026-10-07: dispositivos emparejados a nivel OS (no requieren
   * discovery). El barrido de handleConnectPaired solo probaba MACs
   * descubiertas; como la app nunca pide visibilidad Bluetooth, la tablet
   * peer jamás aparecía en "nearby" y el barrido probaba ~20 aparatos
   * ajenos sin llegar nunca a la receptora (que no mostraba nada).
   */
  getBondedDevices(): Promise<Array<{ address: string; name: string | null }>>;
  addListener(event: "onDeviceFound", fn: (d: { address: string; name: string | null }) => void): () => void;
  addListener(event: "onDiscoveryFinished", fn: () => void): () => void;
  addListener(
    event: "onConnected",
    fn: (e: { address: string; name: string | null; incoming: boolean }) => void,
  ): () => void;
  addListener(event: "onFrame", fn: (e: { address: string; base64: string }) => void): () => void;
  addListener(event: "onDisconnected", fn: (e: { address: string }) => void): () => void;
  addListener(event: "onError", fn: (e: { message: string }) => void): () => void;
}

let bindingsCache: NidoP2PBindings | null | undefined;

/** Carga perezosa de los bindings; null si el módulo nativo no está compilado. */
export function loadNidoP2PBindings(): NidoP2PBindings | null {
  if (bindingsCache !== undefined) return bindingsCache;
  try {
    // `require` perezoso: en tests/node (sin expo) esto lanza y se tolera.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    bindingsCache = require("nido-p2p") as NidoP2PBindings;
  } catch {
    bindingsCache = null;
  }
  return bindingsCache;
}

/** Mejor transporte disponible: Bluetooth real o stub que falla explícito. */
export function createPlatformTransport(): P2PTransport {
  const b = loadNidoP2PBindings();
  return b ? new NidoBluetoothTransport(b) : new NativeP2PTransport();
}

const MAC_RE = /([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/;
const HELLO_TIMEOUT_MS = 15_000;
/**
 * Cooldown anti-spam: si ya hay una ruta viva con el peer y su handshake
 * se completó hace menos de esto, un HELLO nuevo se rechaza. Un HELLO
 * repetido (replay) nunca puede sustituir una sesión en uso.
 */
const HANDSHAKE_COOLDOWN_MS = 10_000;

/**
 * R8: cuota de handshakes ENTRANTES por MAC (defensa pre-autenticación).
 * Sin esto, cualquier dispositivo cercano abre un socket RFCOMM, manda un
 * byte y nos fuerza a generar un efímero + firmar (Ed25519), repitiéndolo
 * sin cota: drenaje de batería/CPU, y cada socket vive hasta el timeout
 * de 15 s. 5 intentos por MAC cada 60 s es holgado para uso legítimo (un
 * handshake por conexión; reintentos con backoff) y convierte el abuso en
 * un goteo acotado.
 */
const INBOUND_HANDSHAKE_WINDOW_MS = 60_000;
const INBOUND_HANDSHAKE_MAX_PER_WINDOW = 5;

/**
 * Handshake pendiente por MAC (R4: máquina de estados de dos fases).
 * - "waiting-socket": connect() registrado, aún sin evento onConnected.
 * - "hello-starting": R7: slot reservado sincrónicamente por beginHello
 *   antes del primer await; nuestro HELLO aún no salió. Un frame que llegue
 *   en esta ventana espera a helloReady en vez de perderse (perder el HELLO
 *   del peer = deadlock: él esperaría nuestro CONFIRM eternamente).
 * - "hello-sent": nuestro HELLO v3 ya salió; esperamos el HELLO del peer.
 * - "confirm-sent": HELLO del peer validado y nuestro CONFIRM v1 enviado;
 *   esperamos el CONFIRM del peer. SOLO tras verificarlo se establece la
 *   ruta (invariante central R4).
 */
interface PendingHello {
  stage: "waiting-socket" | "hello-starting" | "hello-sent" | "confirm-sent";
  myEphSecret: Uint8Array;
  myNonce: Uint8Array;
  myNonceHex: string;
  /**
   * R7: promesa del beginHello en vuelo. onNativeFrame la espera cuando el
   * stage es "hello-starting", en vez de ignorar el frame o iniciar un
   * segundo handshake huérfano (carrera original: dos efímeros, uno huérfano
   * sin borrar, dos HELLOs enviados).
   */
  helloReady?: Promise<void>;
  /** Campos del peer (rellenados al validar su HELLO, fase confirm-sent). */
  peerPk?: string;
  peerEphPkHex?: string;
  peerNonceHex?: string;
  /** Clave de firma Ed25519 del contacto (capturada al validar su HELLO). */
  peerSigPkHex?: string;
  // FIX 2026-10-09 (B2): multicast en vez de resolve/reject único. Antes un
  // segundo connect() SOBREESCRIBÍA estos y la primera promise quedaba
  // colgada para siempre (spinner "Connecting…" eterno).
  waiters: Set<{
    resolve: (info: P2PPeerInfo) => void;
    reject: (err: Error) => void;
  }>;
  timer: ReturnType<typeof setTimeout>;
}

export interface HelloPayload {
  pk: string;
  eph: string;
  nonce: string;
  /** Segundos Unix del reloj del remitente (firmado). */
  ts: number;
  sig: string;
}

/**
 * Valida y parsea un frame HELLO v3 (cuerpo JSON en claro). Lanza si es
 * inválido. El hard cut (§7.1 del packet): v:2 se rechaza en parse con
 * mensaje accionable ("actualiza su app"); v:1 conserva su mensaje
 * heredado. La frescura del `ts` se chequea en handleHello (necesita "now").
 */
export function parseHello(body: Uint8Array): HelloPayload {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  } catch {
    throw new Error("HELLO no es JSON.");
  }
  if (obj.t !== HELLO_TYPE_V3) throw new Error("HELLO de tipo desconocido.");
  if (obj.v === 1) {
    throw new Error(
      "El otro NIDO usa el handshake antiguo sin firma (v1): actualiza su app para conectar.",
    );
  }
  if (obj.v === 2) {
    throw new Error(
      "El otro NIDO usa el handshake v2 (sin confirmación anti-replay): actualiza su app para conectar.",
    );
  }
  if (obj.v !== HELLO_VERSION) throw new Error("HELLO de versión desconocida.");
  const pk = typeof obj.pk === "string" ? obj.pk : "";
  const eph = typeof obj.eph === "string" ? obj.eph : "";
  const nonce = typeof obj.nonce === "string" ? obj.nonce : "";
  const sig = typeof obj.sig === "string" ? obj.sig : "";
  const ts = obj.ts;
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) throw new Error("HELLO sin pk válida.");
  if (!/^[0-9a-fA-F]{64}$/.test(eph)) throw new Error("HELLO sin efímera válida.");
  if (!/^[0-9a-fA-F]{32}$/.test(nonce)) throw new Error("HELLO sin nonce válido.");
  if (typeof ts !== "number" || !Number.isInteger(ts) || ts < 1 || ts >= 2 ** 40) {
    throw new Error("HELLO sin timestamp válido.");
  }
  if (!/^[0-9a-fA-F]{128}$/.test(sig)) throw new Error("HELLO sin firma válida.");
  return {
    pk: pk.toLowerCase(),
    eph: eph.toLowerCase(),
    nonce: nonce.toLowerCase(),
    ts,
    sig: sig.toLowerCase(),
  };
}

/** Construye el cuerpo de un HELLO propio (v3, firmado). */
export function buildHello(
  myPkHex: string,
  myEphPkHex: string,
  nonceHex: string,
  tsSeconds: number,
  sigHex: string,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      t: HELLO_TYPE_V3,
      v: HELLO_VERSION,
      pk: myPkHex,
      eph: myEphPkHex,
      nonce: nonceHex,
      ts: tsSeconds,
      sig: sigHex,
    }),
  );
}

export function extractMac(alias: string): string | null {
  return alias.match(MAC_RE)?.[0]?.toUpperCase() ?? null;
}

export interface NidoBluetoothTransportOpts {
  /**
   * Firma de identidad Ed25519 (HELLO y CONFIRM).
   * Inyectable en tests; por defecto usa la clave del Keystore.
   */
  signHello?: (message: Uint8Array) => Promise<Uint8Array>;
  /**
   * Backend de la cache anti-replay de nonces (R4). Por defecto el
   * persistente (SQLCipher); los tests inyectan uno en memoria.
   */
  nonceCache?: HelloNonceCache;
}

export class NidoBluetoothTransport implements P2PTransport {
  readonly name = "nido-bluetooth";
  readonly available: boolean;

  private bindings: NidoP2PBindings | null;
  private events: P2PTransportEvents | null = null;
  private unsubs: Array<() => void> = [];
  // FIX 2026-10-08 (nav-drop): los listeners nativos se separan en dos
  // grupos. Los de ENLACE (onFrame/onConnected/onDisconnected/onError)
  // deben SOBREVIVIR a stopDiscovery(): si se desuscriben al salir de la
  // pantalla, el socket queda vivo pero sordo — los frames entrantes se
  // pierden y la comunicación se corta aunque las rutas estén intactas.
  // Solo los de DESCUBRIMIENTO (onDeviceFound/onDiscoveryFinished) se
  // limpian al detener el discovery.
  private linkUnsubs: Array<() => void> = [];
  private discoveryUnsubs: Array<() => void> = [];
  private myPkHex = "";
  private macToPk = new Map<string, string>();
  private pkToMac = new Map<string, string>();
  private pending = new Map<string, PendingHello>(); // MAC -> HELLO en curso
  /**
   * FIX 2026-10-09: pks revocados. Un contacto revocado no puede reconectar
   * aunque aparezca en discovery. Se limpia solo con re-pair explícito.
   */
  private readonly revokedPks = new Set<string>();
  // FIX 2026-10-09 (BlueLib): ReconnectManager con estado. El retry antes se
  // disparaba por onPeerLost (presencia), no por la transición a DISCONNECTED.
  // Si el peer queda "visible pero muerto", nunca se reintentaba. Ahora el
  // retry es dirigido por estado: onNativeDisconnected programa reconexión
  // con backoff para contactos emparejados.
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<string, number>();
  /** MACs con desconexión manual: no auto-reconectar. */
  private manualDisconnectMacs = new Set<string>();
  /**
   * FIX 2026-10-09 (B3/R1/H1): pkHex con desconexión manual durante un handshake
   * en curso, con timestamp. Si el handshake falla (timeout), el flag quedaría
   * stale y bloquearía una reconexión manual posterior (H1). Por eso se guarda
   * con timestamp y establishRoute ignora flags viejos (>30s).
   */
  private manualDisconnectPks = new Map<string, number>();
  /** R8: timestamps de inicios de handshake entrante por MAC (ventana deslizante). */
  private readonly inboundHandshakeAt = new Map<string, number[]>();
  // H3-2026-10-06: flag para detener los reinicios de discovery.
  private stopped = false;
  /**
   * B/F4: el apagado nativo es terminal y de un solo uso por instancia.
   * Una vez invocado, no se vuelve a tocar el bridge: si el primer intento
   * falló, la recuperación es una instancia fresca (post-wipe siempre se
   * crea una), no reintentar sobre la instancia muerta.
   */
  private nativeShutdownDone = false;
  /** Anti-spam de HELLO repetidos: pk -> timestamp del último handshake OK. */
  private lastHandshakeAt = new Map<string, number>();
  /**
   * R4: cache anti-replay persistente de (pk, nonce). El claim es UN INSERT
   * atómico: conflicto UNIQUE = replay -> reject. Sustituye al mapa en
   * memoria de B/F1 (que moría con el proceso y permitía el PoC
   * post-restart).
   */
  private nonceCache: HelloNonceCache;
  /**
   * Pares de nonces de las sesiones confirmadas, por MAC: necesarios para
   * el tie-break determinista de simultaneous dial (§4.5 del packet).
   * Solo vive en memoria: las sesiones no sobreviven a stopDiscovery().
   */
  private confirmedPair = new Map<string, { pkLower: string; nonceLocalHex: string; noncePeerHex: string }>();
  private signHello: (message: Uint8Array) => Promise<Uint8Array>;
  private linked = false;
  // F3-2026-10-06: memo de la promesa de enlace. Dos startDiscovery()
  // concurrentes pasaban el guard `if (this.linked)` antes de los awaits
  // y registraban listeners duplicados (el segundo sobrescribía unsubs,
  // fugando el primero). Ahora comparten la misma promesa en vuelo.
  private linkPromise: Promise<void> | null = null;

  /**
   * @param bindings Si se omite, se cargan de forma perezosa; pasa `null`
   * explícito para forzar no-disponible, o un doble para tests.
   * @param opts.signHello Firma de identidad (inyectable en tests).
   * @param opts.nonceCache Backend anti-replay (inyectable en tests).
   */
  constructor(bindings?: NidoP2PBindings | null, opts?: NidoBluetoothTransportOpts) {
    this.bindings = bindings === undefined ? loadNidoP2PBindings() : bindings;
    this.available = this.bindings !== null;
    this.signHello =
      opts?.signHello ??
      (async (message: Uint8Array) => {
        const kp = await getSigningKeypair();
        return signDetached(message, kp.secretKey);
      });
    this.nonceCache = opts?.nonceCache ?? defaultHelloNonceCache;
  }

  private bt(): NidoP2PBindings {
    if (!this.bindings) {
      throw new Error(
        "Transporte P2P nativo no disponible: compila el módulo nido-p2p " +
          "(Bluetooth RFCOMM) con un dispositivo Android real. Los mensajes quedan en la cola cifrada.",
      );
    }
    return this.bindings;
  }

  private async ensureMyPk(): Promise<string> {
    if (this.myPkHex) return this.myPkHex;
    const identity = await getIdentity();
    if (!identity) throw new Error("Primero crea tu identidad NIDO.");
    this.myPkHex = toHex(identity.publicKey).toLowerCase();
    return this.myPkHex;
  }

  /**
   * F-2: invalida la cache de identidad propia tras un recovery de pérdida
   * de claves de identidad. Las sesiones establecidas bajo la identidad
   * vieja están criptográficamente muertas; el próximo handshake deriva
   * todo de la identidad nueva. Las rutas por MAC son de peers y no se
   * tocan (nuestra identidad no las invalida).
   */
  resetMyIdentityCache(): void {
    this.myPkHex = "";
    this.confirmedPair.clear();
    this.lastHandshakeAt.clear();
  }

  /** Conecta listeners nativos + servidor (sin discovery). Idempotente. */
  private async ensureLinked(): Promise<void> {
    if (this.linked) return;
    // F3-2026-10-06: si ya hay un enlace en curso, esperar esa promesa en
    // vez de registrar listeners duplicados.
    if (this.linkPromise) {
      await this.linkPromise;
      return;
    }
    this.linkPromise = this.doLink();
    try {
      await this.linkPromise;
    } finally {
      this.linkPromise = null;
    }
  }

  private async doLink(): Promise<void> {
    const b = this.bt();
    await this.ensureMyPk();
    if (!b.isBluetoothEnabled()) throw new Error("El Bluetooth está apagado.");
    // T-permiso-2026-10-06: el diálogo del sistema pausa la Activity; la
    // bandera evita que el gate de App.tsx re-bloquee por esa pausa
    // transitoria.
    const granted = await withPermissionRequest(() => b.requestPermissions());
    if (!granted) throw new Error("NIDO necesita permisos de Bluetooth para hablar con otro NIDO.");
    // R4 §8.2: poda oportunista de la cache anti-replay al enlazar. Las
    // filas viejas corresponden a HELLOs que el chequeo de frescura
    // rechaza de todos modos (best-effort: nunca bloquea el enlace).
    this.nonceCache.prune(Math.floor(Date.now() / 1000) - NONCE_CACHE_WINDOW_S).catch(() => {});
    // FIX 2026-10-08 (nav-drop): listeners de ENLACE (sobreviven a
    // stopDiscovery) separados de los de DESCUBRIMIENTO.
    this.linkUnsubs = [
      b.addListener("onConnected", (e) => {
        void this.beginHello(e.address).catch((err: unknown) =>
          this.events?.onError?.(
            `No se pudo iniciar el handshake: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }),
      b.addListener("onFrame", (e) => {
        void this.onNativeFrame(e.address, e.base64).catch((err: unknown) =>
          this.events?.onError?.(
            `Frame de ${e.address}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }),
      b.addListener("onDisconnected", (e) => this.onNativeDisconnected(e.address)),
      b.addListener("onError", (e) => this.events?.onError?.(e.message)),
    ];
    this.registerDiscoveryListeners();
    await b.startServer();
    // DIAG-2026-10-07: verificar que el servidor quedó realmente escuchando.
    // La notificación del foreground service NO lo garantiza (el servicio
    // puede estar en primer plano sin hilo en accept()). Si el servidor no
    // está vivo, fallar con un error visible en vez de un "listo" mentiroso.
    const status = this.readServerStatus();
    if (status && !status.alive) {
      throw new Error(
        "El servidor Bluetooth no quedó escuchando (accept loop inactivo). Reabre la pantalla de enlace.",
      );
    }
    this.linked = true;
  }

  /**
   * DIAG-2026-10-07: estado del servidor RFCOMM nativo, o null si el módulo
   * no expone el diagnóstico (build vieja).
   */
  readServerStatus(): { alive: boolean; acceptedCount: number; lastAcceptAt: number } | null {
    try {
      const b = this.bt();
      return b.getServerStatus ? b.getServerStatus() : null;
    } catch {
      return null;
    }
  }

  async startDiscovery(events: P2PTransportEvents): Promise<void> {
    this.events = events;
    this.stopped = false;
    this.discoveryRestartCount = 0;
    await this.ensureLinked();
    // FIX 2026-10-08: re-registrar listeners de discovery si se limpiaron.
    // Cuando linked=true (navegación), ensureLinked() retorna temprano y no
    // re-ejecuta doLink(), pero los discoveryUnsubs se vaciaron en
    // stopDiscovery(). Sin esto, onDeviceFound nunca se registra de nuevo
    // y el discovery no encuentra peers.
    if (this.discoveryUnsubs.length === 0) {
      this.registerDiscoveryListeners();
    }
    await this.bt().startDiscovery();
  }

  /** Registra solo los listeners de descubrimiento (re-utilizable). */
  private registerDiscoveryListeners(): void {
    const b = this.bt();
    this.discoveryUnsubs = [
      b.addListener("onDeviceFound", (d) => {
        this.events?.onPeerFound?.({
          pkHex: "",
          alias: d.name ? `${d.name} (${d.address})` : d.address,
          transport: "bluetooth",
        });
      }),
      b.addListener("onDiscoveryFinished", () => {
        this.scheduleDiscoveryRestart();
      }),
    ];
  }

  /**
   * Solicita que el dispositivo sea visible (discoverable) para otros
   * dispositivos Bluetooth. Muestra el diálogo del sistema.
   */
  async requestDiscoverable(): Promise<void> {
    const b = this.bindings;
    if (b?.requestDiscoverable) {
      await b.requestDiscoverable().catch(() => {});
    }
  }

  /**
   * H3-2026-10-06: reinicia el discovery tras cada ciclo (~12s) con backoff
   * exponencial (máx 30s) para no drenar la batería. Se detiene si el
   * usuario llamó a stopDiscovery() explícitamente.
   */
  private discoveryRestartCount = 0;
  private discoveryRestartTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleDiscoveryRestart(): void {
    if (this.stopped) return;
    this.discoveryRestartCount++;
    const delayMs = Math.min(2000 * Math.pow(1.5, this.discoveryRestartCount - 1), 30000);
    if (this.discoveryRestartTimer) clearTimeout(this.discoveryRestartTimer);
    this.discoveryRestartTimer = setTimeout(() => {
      this.discoveryRestartTimer = null;
      if (this.stopped) return;
      this.bt().startDiscovery().catch(() => {
        // Si falla, reintentar en el próximo ciclo.
      });
    }, delayMs);
  }

  async stopDiscovery(): Promise<void> {
    // H3: detener los reinicios programados.
    this.stopped = true;
    if (this.discoveryRestartTimer) {
      clearTimeout(this.discoveryRestartTimer);
      this.discoveryRestartTimer = null;
    }
    const b = this.bindings;
    // FIX 2026-10-08 (nav-drop): solo se desuscriben los listeners de
    // DESCUBRIMIENTO. Los de ENLACE (onFrame, onConnected, onDisconnected,
    // onError) se quedan activos para que la sesión viva siga recibiendo
    // datos aunque la UI salga de la pantalla de enlace.
    for (const unsub of this.discoveryUnsubs) {
      try {
        unsub();
      } catch {
        /* noop */
      }
    }
    this.discoveryUnsubs = [];
    // FIX 2026-10-08 (nav-drop): NO se pone linked=false. El enlace
    // (listeners + servidor) sigue vivo; solo se detuvo el discovery.
    // Si lo pusiéramos en false, el próximo startDiscovery() re-ejecutaría
    // doLink() y registraría listeners DUPLICADOS (los viejos sobrevivieron).
    // linked=false solo ocurre en shutdownNative() (destrucción terminal).
    for (const [, p] of this.pending) {
      // FIX 2026-10-09 (B4): borrar el secreto efímero (R7). Si beginHello
      // está suspendido en un await, su failHello no lo encontrará en el map.
      p.myEphSecret.fill(0);
      this.rejectPending(p, new Error("Discovery detenido."));
    }
    this.pending.clear();
    // FIX 2026-10-08: NO borrar macToPk/pkToMac/confirmedPair aquí.
    // Son estado de SESIÓN (rutas peer↔MAC de conexiones vivas), no de
    // discovery. Borrarlas al salir de la pantalla NIDO cortaba la
    // comunicación aunque el socket RFCOMM siguiera vivo: sendFrame()
    // lanzaba "Peer no conectado por Bluetooth" (pkToMac vacío) y los
    // frames entrantes se ignoraban (macToPk.get(mac) → undefined).
    // Las rutas solo se desmontan en forgetRoute() (desconexión real del
    // socket) o se reemplazan en establishRoute() (re-handshake con
    // tie-break). La anti-replay vive en la cache persistente de nonces
    // (base cifrada), no en estos mapas; y R4 establece que un HELLO
    // solo nunca los muta, así que conservarlos es seguro.
    if (b) {
      await b.stopDiscovery().catch(() => {});
      // P2P-ALWAYS-ON 2026-10-07: NO detener el servidor aquí. El servidor
      // Bluetooth y su foreground service se mantienen corriendo todo el
      // tiempo que la app esté viva (como Briar), no solo mientras la
      // pantalla P2P está abierta. Esto permite recibir conexiones y
      // mensajes aunque el usuario esté en otra pantalla. El servidor solo
      // se detiene en shutdownNative() (destrucción terminal del messenger)
      // o cuando el proceso muere.
    }
  }

  /**
   * B/F4 — terminación nativa terminal.
   *
   * Invoca `bindings.shutdown()`: el módulo Kotlin detiene discovery y
   * servidor y CIERRA todos los sockets RFCOMM activos. Sin esto, destruir
   * el messenger solo borraba el estado JS (rutas/sesiones) y detenía el
   * discovery, pero los sockets nativos sobrevivían.
   *
   * Solo la llama la destrucción terminal (`NidoMessenger.destroy()`),
   * NUNCA `stopLink()` (apagado temporal de UI): la cache anti-replay
   * persistente (R4) vive en la base cifrada y sobrevive a `stopDiscovery()`
   * a propósito; el apagado temporal no debe tocar el lado nativo.
   *
   * Comportamiento definido:
   * - éxito: sockets cerrados, servidor detenido; resolver sin valor.
   * - segunda llamada (misma instancia): no-op, no toca el bridge.
   * - sin sockets activos / sin bindings: no-op exitoso.
   * - el nativo lanza: la promesa rechaza; el llamante (destroy) lo trata
   *   best-effort — la invalidación en memoria ya es efectiva y el estado
   *   TS queda destruido igual. La recuperación es una instancia fresca.
   */
  async shutdownNative(): Promise<void> {
    if (this.nativeShutdownDone) return;
    this.nativeShutdownDone = true;
    // FIX 2026-10-08 (nav-drop): en la destrucción terminal sí se limpian
    // los listeners de ENLACE (aquí no hay sesión que preservar).
    for (const unsub of this.linkUnsubs) {
      try {
        unsub();
      } catch {
        /* noop */
      }
    }
    this.linkUnsubs = [];
    for (const unsub of this.discoveryUnsubs) {
      try {
        unsub();
      } catch {
        /* noop */
      }
    }
    this.discoveryUnsubs = [];
    this.linked = false;
    // FIX 2026-10-09: limpiar reconnects pendientes en shutdown terminal.
    for (const [, t] of this.reconnectTimers) clearTimeout(t);
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    this.manualDisconnectMacs.clear();
    this.manualDisconnectPks.clear();
    const b = this.bindings;
    if (!b) return;
    await b.shutdown();
  }

  /**
   * Conecta por alias ("Nombre (AA:BB:CC:DD:EE:FF)") o MAC directa y hace el
   * handshake. Resuelve con la identidad verificada del peer.
   */
  async connect(alias: string): Promise<P2PPeerInfo> {
    const mac = extractMac(alias);
    if (!mac) throw new Error(`No encontré una dirección Bluetooth en «${alias}».`);
    const b = this.bt();
    await this.ensureLinked();
    const done = this.macToPk.get(mac);
    if (done) {
      const contact = await findContactByPk(done);
      return { pkHex: done, alias: contact?.name ?? mac, transport: "bluetooth" };
    }
    const existing = this.pending.get(mac);
    if (existing) {
      // FIX 2026-10-09 (B2): multicast. Antes se SOBREESCRIBÍA resolve/reject
      // y la primera promise quedaba colgada. Ahora cada llamador se agrega
      // al set y todos reciben el resultado.
      return new Promise<P2PPeerInfo>((resolve, reject) => {
        existing.waiters.add({ resolve, reject });
      });
    }
    return new Promise<P2PPeerInfo>((resolve, reject) => {
      const timer = this.armHelloTimeout(mac);
      const waiters = new Set<{
        resolve: (info: P2PPeerInfo) => void;
        reject: (err: Error) => void;
      }>();
      waiters.add({ resolve, reject });
      // Se registra ANTES de conectar: si onConnected llega primero,
      // beginHello reutiliza este pendiente en vez de crear otro.
      this.pending.set(mac, {
        stage: "waiting-socket",
        myEphSecret: new Uint8Array(0),
        myNonce: new Uint8Array(0), // se rellena en beginHello al enviar el HELLO
        myNonceHex: "", // se rellena en beginHello al enviar el HELLO
        waiters,
        timer,
      });
      // RETRY-2026-10-07: reintento con backoff exponencial. El error
      // "read failed, socket might closed" es ambiental (peer no escuchando,
      // canal RFCOMM ocupado por sesión caída, carrera SDP); un solo intento
      // no basta. Cada intento usa un socket fresco (el nativo cierra el
      // anterior); nunca se reusa un socket fallido (androidaps: 579 fallos
      // medidos por reusar sockets).
      void this.connectWithBackoff(b, mac, 0);
    });
  }

  /**
   * Intenta conectar con backoff exponencial (máx 3 intentos).
   * Cada intento crea un socket fresco en el lado nativo.
   */
  private async connectWithBackoff(
    b: NidoP2PBindings,
    mac: string,
    attempt: number,
  ): Promise<void> {
    const MAX_ATTEMPTS = 3;
    try {
      // FIX 2026-10-09 (BlueLib): detener el discovery antes de conectar.
      // El discovery activo contiende por la radio Bluetooth y causa fallos
      // de conexión intermitentes. Se reanuda solo vía scheduleDiscoveryRestart.
      if (attempt === 0) {
        try {
          await b.stopDiscovery();
        } catch {
          /* best-effort */
        }
      }
      await b.connect(mac);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (attempt + 1 >= MAX_ATTEMPTS) {
        this.failHello(mac, err);
        return;
      }
      // Backoff: 1s, 2s, 4s... (el watchdog nativo ya falló a los 7s)
      const delayMs = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delayMs));
      // Si el handshake ya se resolvió/canceló, no reintentar.
      if (!this.pending.has(mac)) return;
      await this.connectWithBackoff(b, mac, attempt + 1);
    }
  }

  async sendFrame(peerPkHex: string, frame: Uint8Array): Promise<void> {
    const mac = this.pkToMac.get(peerPkHex.toLowerCase());
    if (!mac) throw new Error("Peer no conectado por Bluetooth.");
    await this.bt().sendFrame(mac, encodeBase64(frame));
  }

  /**
   * BUG-6-2026-10-07: MACs de dispositivos emparejados a nivel OS.
   * Best-effort: si el binding falla, devuelve [] (el barrido sigue
   * funcionando solo con nearby). Normaliza a mayúsculas para deduplicar.
   */
  async getBondedMacs(): Promise<string[]> {
    try {
      const devices = await this.bt().getBondedDevices();
      const seen = new Set<string>();
      const out: string[] = [];
      for (const d of devices ?? []) {
        const mac = (d?.address ?? "").toUpperCase();
        if (/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) && !seen.has(mac)) {
          seen.add(mac);
          out.push(mac);
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async disconnect(peerPkHex: string): Promise<void> {
    const pkLower = peerPkHex.toLowerCase();
    const mac = this.pkToMac.get(pkLower);
    // FIX 2026-10-09 (B3/R1): solo marcar pkHex si NO hay MAC (handshake en
    // curso). Si hay MAC, el flag por MAC es suficiente. Marcar siempre
    // rompía reconexiones manuales (R1): el flag stale mataba el siguiente
    // handshake en establishRoute.
    if (!mac) {
      this.manualDisconnectPks.set(pkLower, Date.now());
    } else {
      this.manualDisconnectMacs.add(mac);
      this.cancelReconnect(mac);
      this.reconnectAttempts.delete(mac);
    }
    this.forgetRoute(peerPkHex);
    if (mac) await this.bt().disconnect(mac).catch(() => {});
  }

  /**
   * FIX 2026-10-09: revoca un contacto. Desconecta si está conectado,
   * bloquea reconexiones futuras y limpia timers. El desbloqueo requiere
   * re-pair explícito (unrevokePeer).
   */
  async revokePeer(peerPkHex: string): Promise<void> {
    const pkLower = peerPkHex.toLowerCase();
    this.revokedPks.add(pkLower);
    await this.disconnect(peerPkHex);
  }

  /**
   * FIX 2026-10-09: levanta la revocación (solo vía re-pair explícito).
   */
  unrevokePeer(peerPkHex: string): void {
    this.revokedPks.delete(peerPkHex.toLowerCase());
  }

  /**
   * FIX 2026-10-09: verifica si un pk está revocado.
   */
  isRevoked(peerPkHex: string): boolean {
    return this.revokedPks.has(peerPkHex.toLowerCase());
  }

  /**
   * UNIT B (R5): desmonta la ruta hacia una identidad SUPERSEDED del peer.
   * Implementado sobre el `disconnect` existente (forgetRoute + cierre del
   * socket RFCOMM); idempotente y best-effort (nunca lanza: el messenger
   * lo invoca post-commit en try/catch).
   */
  async teardownRouteForPeer(peerPkHex: string): Promise<void> {
    try {
      await this.disconnect(peerPkHex);
    } catch {
      /* post-commit: la muerte SQL ya es autoritativa; se registra en el llamador */
    }
  }

  // ------------------------------------------------------------ handshake

  /**
   * R8: cuota de handshakes entrantes por MAC (ventana deslizante).
   * Devuelve true si el MAC agotó su cuota → el llamador debe ignorar el
   * intento sin generar cripto ni estado. Los timestamps viejos se podan y
   * los MACs sin actividad reciente se eliminan: el mapa no crece sin cota.
   */
  private inboundHandshakeRateLimited(mac: string): boolean {
    const now = Date.now();
    const windowStart = now - INBOUND_HANDSHAKE_WINDOW_MS;
    let stamps = this.inboundHandshakeAt.get(mac);
    if (stamps) {
      while (stamps.length > 0 && stamps[0]! <= windowStart) stamps.shift();
      if (stamps.length === 0) {
        this.inboundHandshakeAt.delete(mac);
        stamps = undefined;
      }
    }
    if (stamps && stamps.length >= INBOUND_HANDSHAKE_MAX_PER_WINDOW) {
      return true;
    }
    const arr = stamps ?? [];
    arr.push(now);
    this.inboundHandshakeAt.set(mac, arr);
    return false;
  }

  private async beginHello(address: string): Promise<void> {
    const mac = address.toUpperCase();
    const existing = this.pending.get(mac);
    // Idempotente: si ya hay un handshake en curso (más allá del registro
    // de connect()) o la ruta ya existe, no se repite. Un pendiente
    // "waiting-socket" (connect() se adelantó al evento) sí se reutiliza.
    // Un "hello-starting" (beginHello en vuelo) también retorna: el frame
    // que lo disparó espera a helloReady en onNativeFrame.
    if (existing && existing.stage !== "waiting-socket") return;
    if (!existing && this.macToPk.has(mac)) return;
    if (!existing) {
      // R8: limitar handshakes entrantes por MAC ANTES de la cripto cara
      // (generar efímero + firmar). Solo el path entrante nuevo se limita;
      // nuestros reintentos salientes (waiting-socket) no se ven afectados.
      // Fail-closed: el peer legítimo reintenta con backoff y entra en la
      // siguiente ventana.
      if (this.inboundHandshakeRateLimited(mac)) return;
    }
    // R7 FIX: reservar el slot del pendiente de forma SÍNCRONA antes del
    // primer await. Sin esto, dos onNativeFrame concurrentes veían `!pend`
    // y ambos generaban un efímero: uno quedaba huérfano (secreto sin
    // borrar, timer huérfano) y se enviaban dos HELLOs.
    const eph = generateEphemeral();
    let resolveReady!: () => void;
    const helloReady = new Promise<void>((res) => {
      resolveReady = res;
    });
    const pend: PendingHello = existing ?? {
      stage: "hello-starting",
      myEphSecret: eph.secretKey,
      myNonce: new Uint8Array(0),
      myNonceHex: "",
      timer: this.armHelloTimeout(mac),
      helloReady,
      waiters: new Set(), // entrante: sin llamadores connect()
    };
    if (existing) {
      // waiting-socket reutilizado: nace el secreto y se rearma el timeout.
      clearTimeout(existing.timer);
      existing.myEphSecret = eph.secretKey;
      existing.timer = this.armHelloTimeout(mac);
      existing.helloReady = helloReady;
    } else {
      this.pending.set(mac, pend);
    }
    try {
      const b = this.bt();
      const nonce = randomNonce(HANDSHAKE_NONCE_BYTES);
      const nonceHex = toHex(nonce);
      const ephPkHex = toHex(eph.publicKey);
      const myPkHex = await this.ensureMyPk();
      const ts = Math.floor(Date.now() / 1000);
      const sig = await this.signHello(
        buildHelloSignMessageV3(myPkHex, ephPkHex, nonceHex, ts)
      );
      const hello = buildHello(myPkHex, ephPkHex, nonceHex, ts, toHex(sig));
      pend.stage = "hello-sent";
      pend.myNonce = nonce;
      pend.myNonceHex = nonceHex;
      pend.helloReady = undefined; // listo: nadie necesita esperar más
      await b.sendFrame(mac, encodeBase64(hello));
    } catch (e) {
      this.failHello(mac, e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      resolveReady();
    }
  }

  private armHelloTimeout(mac: string): ReturnType<typeof setTimeout> {
    return setTimeout(
      () =>
        this.failHello(
          mac,
          new Error("Handshake agotado (15 s): el otro lado no respondió como NIDO."),
        ),
      HELLO_TIMEOUT_MS,
    );
  }

  private armConfirmTimeout(mac: string): ReturnType<typeof setTimeout> {
    return setTimeout(
      () =>
        this.failHello(
          mac,
          new Error(
            "Handshake agotado esperando CONFIRM (10 s): el peer no demostró presencia viva en esta conexión.",
          ),
        ),
      CONFIRM_WAIT_MS,
    );
  }

  private failHello(mac: string, err: Error): void {
    const pend = this.pending.get(mac);
    if (!pend) return;
    clearTimeout(pend.timer);
    this.pending.delete(mac);
    // R7: borrar el secreto efímero en TODAS las salidas del handshake
    // (timeout, firma inválida, desconexión, fallo de envío), no solo en
    // la ruta de éxito donde deriveSessionKeyV2 lo borra al derivar.
    pend.myEphSecret.fill(0);
    this.rejectPending(pend, err);
    this.events?.onError?.(`Handshake con ${mac}: ${err.message}`);
    try {
      this.bt().disconnect(mac).catch(() => {});
    } catch {
      // Sin enlace nativo (beginHello puede fallar antes de bt()): nada
      // que desconectar.
    }
  }

  private async onNativeFrame(address: string, b64: string): Promise<void> {
    const mac = address.toUpperCase();
    let body: Uint8Array;
    try {
      body = decodeBase64(b64);
    } catch {
      return; // basura: se ignora
    }
    let pend = this.pending.get(mac);
    // R7: si beginHello está en vuelo (slot reservado sincrónicamente),
    // esperar a que complete en vez de ignorar el frame o iniciar un
    // segundo handshake huérfano. El frame no se puede procesar hasta que
    // nuestro efímero/nonce existan, pero perder el HELLO del peer sería
    // un deadlock (él esperaría nuestro CONFIRM eternamente).
    if (pend && pend.stage === "hello-starting" && pend.helloReady) {
      try {
        await pend.helloReady;
      } catch {
        // beginHello falló; failHello ya limpió el slot.
      }
      pend = this.pending.get(mac);
    }
    // RACE-FIX 2026-10-06: si el HELLO del peer llega ANTES de que
    // onConnected dispare beginHello (el evento nativo puede tardar),
    // el frame se ignoraba silenciosamente y el handshake moría por
    // timeout en ambos lados. Si no hay pend, iniciar el handshake
    // ahora (beginHello es idempotente) y reprocesar el frame.
    if (!pend) {
      try {
        await this.beginHello(mac);
      } catch {
        return; // beginHello falló (ej. sin identidad); se ignora el frame
      }
      pend = this.pending.get(mac);
    }
    if (pend) {
      // El handshake se parsea por fase (§4.5 del packet): hello-sent
      // espera HELLO; confirm-sent espera CONFIRM; cualquier otra cosa
      // se rechaza fail-closed.
      if (pend.stage === "hello-sent") {
        await this.handleHello(mac, pend, body);
        return;
      }
      if (pend.stage === "confirm-sent") {
        await this.handleConfirm(mac, pend, body);
        return;
      }
      // waiting-socket: aún no salió nuestro HELLO; el frame se ignora
      // (el timeout de beginHello lo limpiará si nunca conecta).
      return;
    }
    const pk = this.macToPk.get(mac);
    if (pk) this.events?.onFrame?.(pk, body);
    // Frame de conexión sin handshake: se ignora (el timeout lo limpiará).
  }

  /**
   * Fase 1 del handshake (R4): valida el HELLO v3 del peer según §3.3 del
   * packet (parse, versión, formas, frescura del ts, contacto, no-self,
   * firma, INSERT atómico anti-replay, cooldown) y, si todo pasa, envía
   * nuestro CONFIRM v1 y pasa a la fase "confirm-sent".
   *
   * CRÍTICO: esta función NO muta pkToMac/macToPk. La ruta solo se
   * establece en handleConfirm tras verificar el CONFIRM del peer.
   */
  private async handleHello(mac: string, pend: PendingHello, body: Uint8Array): Promise<void> {
    try {
      const hello = parseHello(body);
      const myPkHex = await this.ensureMyPk();
      if (hello.pk === myPkHex) throw new Error("Es mi propio dispositivo.");
      // Frescura del timestamp (§3.3 paso 3): defensa secundaria que hace
      // la evicción de la cache segura por construcción.
      const nowSec = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSec - hello.ts) > HELLO_TS_SKEW_S) {
        throw new Error(
          "Reloj del peer fuera del margen permitido (±10 min): revisa la hora de ambos dispositivos.",
        );
      }
      const contact = await findContactByPk(hello.pk);
      if (!contact) {
        throw new Error(
          "Dispositivo no emparejado: haz el intercambio de QR primero y reintenta.",
        );
      }
      if (!contact.sigPkHex) {
        throw new Error(
          `Contacto sin clave de firma (QR antiguo): pídele a ${contact.name} que te pase su QR de nuevo y re-escanea.`,
        );
      }
      // Autenticación del handshake: la firma liga el efímero y el ts a la
      // identidad verificada por QR. Un MITM no puede sustituir `eph` ni
      // "refrescar" `ts` sin la clave de firma del peer.
      const msg = buildHelloSignMessageV3(hello.pk, hello.eph, hello.nonce, hello.ts);
      const ok = verifyDetached(msg, fromHex(hello.sig), fromHex(contact.sigPkHex));
      if (!ok) {
        throw new Error(
          "Firma del handshake inválida: posible ataque de intermediario. Conexión rechazada.",
        );
      }
      // R4 §3.3 paso 7: decisión anti-replay ATÓMICA. Un solo INSERT:
      // conflicto UNIQUE = replay -> reject, fail-closed, antes de enviar
      // CONFIRM o mutar cualquier estado. Quemar el nonce al aceptar es
      // seguro: un reintento legítimo siempre usa un nonce fresco.
      const claimed = await this.nonceCache.claim(hello.pk, hello.nonce, nowSec);
      if (!claimed) {
        throw new Error(
          "HELLO repetido (nonce ya usado): posible re-inyección de un handshake capturado. Conexión rechazada.",
        );
      }
      // Anti-spam: si ya hay ruta viva y el handshake es muy reciente,
      // un HELLO nuevo no sustituye la sesión en uso.
      const pkLower = hello.pk.toLowerCase();
      const last = this.lastHandshakeAt.get(pkLower) ?? 0;
      if (this.pkToMac.has(pkLower) && Date.now() - last < HANDSHAKE_COOLDOWN_MS) {
        throw new Error("Handshake duplicado: ya hay una sesión activa con este contacto.");
      }
      // HELLO válido: enviamos nuestro CONFIRM (cn = nuestro nonce,
      // pn = el nonce del peer visto en ESTA conexión) y esperamos el suyo.
      // La RUTA SIGUE SIN TOCARSE (invariante central R4).
      const confirmSig = await this.signHello(
        buildConfirmSignMessage(myPkHex, pend.myNonceHex, hello.nonce),
      );
      const confirm = buildConfirmV1(myPkHex, pend.myNonceHex, hello.nonce, toHex(confirmSig));
      clearTimeout(pend.timer);
      pend.stage = "confirm-sent";
      pend.peerPk = pkLower;
      pend.peerEphPkHex = hello.eph;
      pend.peerNonceHex = hello.nonce;
      pend.peerSigPkHex = contact.sigPkHex;
      pend.timer = this.armConfirmTimeout(mac);
      try {
        await this.bt().sendFrame(mac, encodeBase64(confirm));
      } catch (e) {
        this.failHello(mac, e instanceof Error ? e : new Error(String(e)));
        throw e;
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.events?.onError?.(`Handshake con ${mac}: ${err.message}`);
      // failHello ya desconecta el socket; no hay ruta que limpiar porque
      // handleHello nunca muta pkToMac/macToPk.
      this.failHello(mac, err);
    }
  }

  /**
   * Fase 2 del handshake (R4): valida el CONFIRM v1 del peer según §4.4 del
   * packet y, SOLO si todo verifica, establece la ruta y deriva la sesión.
   *
   * Este es el ÚNICO punto del transporte donde pkToMac/macToPk se mutan
   * para un peer (además de su olvido en disconnect). Un HELLO solo —
   * por genuino que sea — jamás llega aquí.
   */
  private async handleConfirm(mac: string, pend: PendingHello, body: Uint8Array): Promise<void> {
    clearTimeout(pend.timer);
    this.pending.delete(mac);
    try {
      const confirm = parseConfirm(body);
      // §4.4 regla 2: el CONFIRM debe venir de la identidad cuyo HELLO
      // abrió este pending (mata la reflexión: mi propio CONFIRM reflejado
      // nombra MI pk, que nunca coincide con peerPk).
      if (confirm.pk !== pend.peerPk) {
        throw new Error(
          "CONFIRM de identidad inesperada: no coincide con el HELLO de esta conexión. Conexión rechazada.",
        );
      }
      // §4.4 reglas 3-4: el peer cita su propio nonce y MI nonce fresco,
      // demostrando presencia viva en ESTA conexión.
      if (confirm.cn !== pend.peerNonceHex) {
        throw new Error(
          "CONFIRM con nonce propio inesperado: no coincide con el HELLO del peer en esta conexión.",
        );
      }
      if (confirm.pn !== pend.myNonceHex) {
        throw new Error(
          "CONFIRM con nonce ajeno inesperado: el peer no vio mi HELLO de esta conexión.",
        );
      }
      // §4.4 regla 5: firma Ed25519 sobre (pk, cn, pn) con la clave del contacto.
      const msg = buildConfirmSignMessage(confirm.pk, confirm.cn, confirm.pn);
      const ok = verifyDetached(msg, fromHex(confirm.sig), fromHex(pend.peerSigPkHex!));
      if (!ok) {
        throw new Error(
          "Firma del CONFIRM inválida: posible ataque de intermediario. Conexión rechazada.",
        );
      }
      // CONFIRM válido: se establece la ruta (con tie-break si ya existe
      // otra sesión confirmada con el mismo peer) y se deriva la sesión.
      await this.establishRoute(mac, pend);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.events?.onError?.(`Handshake con ${mac}: ${err.message}`);
      // R7: el pending ya se eliminó del mapa arriba; borrar el secreto
      // efímero aquí (failHello no lo vería).
      pend.myEphSecret.fill(0);
      this.rejectPending(pend, err);
      await this.bt().disconnect(mac).catch(() => {});
    }
  }

  /**
   * Establece la ruta tras un CONFIRM válido (R4 §4.4 "route establishment
   * rule" + tie-break §4.5).
   *
   * Si ya existe una sesión confirmada con el mismo peer en otra MAC, ambas
   * partes calculan independientemente la clave canónica
   * K = min(nl,np)||max(nl,np) por sesión y conservan la de menor K: el
   * ganador es el mismo en ambos lados sin importar el orden local.
   */
  private async establishRoute(mac: string, pend: PendingHello): Promise<void> {
    const pkLower = pend.peerPk!;
    // FIX 2026-10-09: si el peer está revocado, NO establecer la ruta.
    if (this.revokedPks.has(pkLower)) {
      this.rejectPending(pend, new Error("Contacto revocado."));
      await this.bt().disconnect(mac).catch(() => {});
      return;
    }
    // FIX 2026-10-09 (B3/H1): si el usuario pidió desconectar durante el
    // handshake, NO establecer la ruta. Ignorar flags viejos (>30s) para no
    // bloquear reconexiones manuales tras un timeout (H1).
    const manualAt = this.manualDisconnectPks.get(pkLower);
    if (manualAt !== undefined) {
      this.manualDisconnectPks.delete(pkLower);
      if (Date.now() - manualAt < 30_000) {
        this.rejectPending(pend, new Error("Desconectado por el usuario durante el handshake."));
        await this.bt().disconnect(mac).catch(() => {});
        return;
      }
      // Flag stale: continuar con el handshake normal.
    }
    const myK = tieBreakKey(pend.myNonceHex, pend.peerNonceHex!);
    const existingMac = this.pkToMac.get(pkLower);
    if (existingMac && existingMac !== mac) {
      const existing = this.confirmedPair.get(existingMac);
      if (existing) {
        const existingK = tieBreakKey(existing.nonceLocalHex, existing.noncePeerHex);
        if (myK > existingK) {
          // Este socket pierde el tie-break: se cierra sin tocar la ruta.
          // (El connect() pendiente de este socket se rechaza; la sesión
          // ganadora sigue viva en existingMac.)
          this.rejectPending(
            pend,
            new Error("Handshake simultáneo: la otra conexión con este contacto ganó el desempate."),
          );
          await this.bt().disconnect(mac).catch(() => {});
          return;
        }
        // Ganamos: la sesión anterior se cierra con gracia.
        this.forgetRoute(pkLower);
        await this.bt().disconnect(existingMac).catch(() => {});
      }
    }
    this.macToPk.set(mac, pkLower);
    this.pkToMac.set(pkLower, mac);
    this.lastHandshakeAt.set(pkLower, Date.now());
    this.confirmedPair.set(mac, {
      pkLower,
      nonceLocalHex: pend.myNonceHex,
      noncePeerHex: pend.peerNonceHex!,
    });
    // FIX 2026-10-09 (B5): resetear el contador de reintentos al conectar.
    // Si no, el próximo disconnect arranca con backoff inflado.
    this.reconnectAttempts.delete(mac);
    this.cancelReconnect(mac);
    const contact = await findContactByPk(pkLower);
    // BUG-6 Plan B: guardar la MAC conocida para el barrido futuro.
    // Si getBondedDevices() falla, el barrido prueba estas MACs primero.
    try {
      const { saveKnownMac } = await import("./store");
      await saveKnownMac(pkLower, mac);
    } catch { /* best-effort */ }
    const info: P2PPeerInfo = { pkHex: pkLower, alias: contact?.name ?? mac, transport: "bluetooth" };
    // La sesión la deriva el messenger (ligada a ambos nonces).
    this.events?.onHandshakeComplete?.(
      pkLower,
      pend.myEphSecret,
      fromHex(pend.peerEphPkHex!),
      pend.myNonce,
      fromHex(pend.peerNonceHex!),
    );
    this.events?.onPeerFound?.(info);
    this.resolvePending(pend, info);
  }

  /** FIX 2026-10-09 (B2): resuelve TODOS los waiters de un pendiente. */
  private resolvePending(pend: PendingHello, info: P2PPeerInfo): void {
    clearTimeout(pend.timer);
    for (const w of pend.waiters) {
      try { w.resolve(info); } catch { /* noop */ }
    }
    pend.waiters.clear();
  }

  /** FIX 2026-10-09 (B2): rechaza TODOS los waiters de un pendiente. */
  private rejectPending(pend: PendingHello, err: Error): void {
    clearTimeout(pend.timer);
    for (const w of pend.waiters) {
      try { w.reject(err); } catch { /* noop */ }
    }
    pend.waiters.clear();
  }

  private onNativeDisconnected(address: string): void {
    const mac = address.toUpperCase();
    const pend = this.pending.get(mac);
    if (pend) {
      clearTimeout(pend.timer);
      this.pending.delete(mac);
      // R7: borrar el secreto efímero también al desconectar a mitad del
      // handshake.
      pend.myEphSecret.fill(0);
      this.rejectPending(pend, new Error("Conexión cerrada durante el handshake."));
    }
    const pk = this.macToPk.get(mac);
    if (pk) {
      this.forgetRoute(pk);
      this.events?.onPeerLost?.(pk);
      // FIX 2026-10-09 (BlueLib): retry dirigido por ESTADO, no por presencia.
      // Antes solo se limpiaba; si el peer quedaba "visible pero muerto",
      // nunca se reintentaba. Ahora se programa reconexión con backoff para
      // contactos emparejados (salvo desconexión manual explícita).
      this.scheduleReconnect(mac, pk);
    } else {
      // FIX 2026-10-09 (B6): NO emitir onPeerLost con una MAC cruda. El
      // contrato dice pkHex (64 hex chars). Sin ruta, no hay peer que perder.
    }
  }

  /**
   * FIX 2026-10-09 (BlueLib): programa reconexión automática con backoff
   * exponencial tras una desconexión no solicitada. Solo para peers que
   * tenían ruta establecida (contactos emparejados con handshake completo).
   * Máximo 5 intentos; después se rinde hasta reconexión manual.
   */
  private scheduleReconnect(mac: string, pkHex: string): void {
    if (this.manualDisconnectMacs.has(mac)) {
      this.manualDisconnectMacs.delete(mac);
      return;
    }
    if (this.stopped) return;
    const attempts = this.reconnectAttempts.get(mac) ?? 0;
    if (attempts >= 5) {
      this.reconnectAttempts.delete(mac);
      return;
    }
    this.cancelReconnect(mac);
    const delayMs = Math.min(1000 * 2 ** attempts, 30000);
    this.reconnectAttempts.set(mac, attempts + 1);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(mac);
      // Solo reconectar si no hay ruta viva ni handshake en curso.
      if (this.macToPk.has(mac) || this.pending.has(mac)) {
        this.reconnectAttempts.delete(mac);
        return;
      }
      // FIX 2026-10-09 (B7): no gastar intentos si el Bluetooth está apagado.
      try {
        if (!this.bt().isBluetoothEnabled()) {
          return;
        }
      } catch {
        return;
      }
      void this.connect(mac).catch(() => {
        // El backoff de connect() maneja sus reintentos; si falla del todo,
        // el próximo onNativeDisconnected (si hubo conexión parcial) o el
        // usuario reintentará manualmente.
      });
    }, delayMs);
    this.reconnectTimers.set(mac, timer);
  }

  /** Cancela un reconnect programado (p. ej. al conectar manualmente). */
  private cancelReconnect(mac: string): void {
    const t = this.reconnectTimers.get(mac);
    if (t) {
      clearTimeout(t);
      this.reconnectTimers.delete(mac);
    }
  }

  private forgetRoute(peerPkHex: string): void {
    const key = peerPkHex.toLowerCase();
    const mac = this.pkToMac.get(key);
    if (mac) {
      this.macToPk.delete(mac);
      this.confirmedPair.delete(mac);
    }
    this.pkToMac.delete(key);
  }
}
