/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * transport.ts — NIDO P2P: abstracción de transporte (Fase E).
 *
 * El protocolo (protocol.ts) no sabe por dónde viajan los frames.
 * Esta interfaz la implementará el módulo nativo `nido-p2p`
 * (Bluetooth RFCOMM; Wi-Fi Direct como segundo transporte).
 *
 * Sin el módulo nativo compilado, los mensajes quedan en la cola de
 * salida cifrada: nada se pierde y nada se finge enviar.
 */

export interface P2PPeerInfo {
  /** pk hex de identidad del peer (se conoce tras el handshake). */
  pkHex: string;
  /** Nombre Bluetooth / alias visible. */
  alias: string;
  transport: "bluetooth" | "wifi-direct";
}

export interface P2PTransportEvents {
  /**
   * Peer descubierto. En Bluetooth clásico el pkHex aún no se conoce antes
   * del handshake: llega como "" y el alias incluye la MAC.
   */
  onPeerFound?: (peer: P2PPeerInfo) => void;
  onPeerLost?: (pkHex: string) => void;
  /** Un frame completo recibido (ya reensamblado por el nativo). */
  onFrame?: (peerPkHex: string, frame: Uint8Array) => void;
  /**
   * Handshake completado a nivel transporte: el peer presentó un HELLO v2
   * con firma válida y es un contacto emparejado por QR. El messenger
   * deriva la sesión cifrada con `completeHandshake`, ligada a ambos
   * nonces (anti-replay de HELLO).
   */
  onHandshakeComplete?: (
    peerPkHex: string,
    myEphemeralSecret: Uint8Array,
    theirEphemeralPk: Uint8Array,
    myNonce: Uint8Array,
    theirNonce: Uint8Array,
  ) => void;
  onError?: (message: string) => void;
}

export interface P2PTransport {
  readonly name: string;
  /** ¿Hay un módulo nativo real detrás? */
  readonly available: boolean;
  startDiscovery(events: P2PTransportEvents): Promise<void>;
  stopDiscovery(): Promise<void>;
  /**
   * FIX 2026-10-09: peers con ruta establecida (handshake completo).
   * La UI lo usa para restaurar el estado "en línea" al volver a la
   * pantalla NIDO tras navegar: sin esto, el `online` (useState) se pierde
   * al desmontar y la UI muestra "desconectado" aunque el socket siga vivo,
   * provocando intentos de reconexión manual que chocan con la conexión existente.
   * Opcional: transportes sin este concepto devuelven [].
   */
  connectedPeers?(): string[];
  /**
   * Terminación nativa terminal (B/F4). Opcional: solo los transportes con
   * un módulo nativo real la implementan. La invoca únicamente la
   * destrucción terminal (`NidoMessenger.destroy()`), nunca `stopLink()`.
   * Debe ser idempotente y nunca dejar el transporte en un estado peor.
   */
  shutdownNative?(): Promise<void>;
  /**
   * F-2: invalida la cache de identidad propia tras un recovery de pérdida
   * de claves. Opcional: solo los transportes que cachean la identidad
   * (NidoBluetoothTransport) la implementan.
   */
  resetMyIdentityCache?(): void;
  /**
   * DIAG-2026-10-07: estado del servidor RFCOMM nativo (opcional: solo los
   * transportes con módulo nativo real lo implementan). Null si el módulo
   * no expone el diagnóstico.
   */
  readServerStatus?(): { alive: boolean; acceptedCount: number; lastAcceptAt: number } | null;
  /**
   * BUG-6-2026-10-07: MACs de dispositivos emparejados a nivel OS (opcional:
   * solo transportes con módulo nativo real). [] si no disponible.
   */
  getBondedMacs?(): Promise<string[]>;
  /** Conecta con un peer descubierto (por su alias/MAC) y hace el handshake. */
  connect(alias: string): Promise<P2PPeerInfo>;
  /** Envía un frame ya cifrado al peer conectado. */
  sendFrame(peerPkHex: string, frame: Uint8Array): Promise<void>;
  disconnect(peerPkHex: string): Promise<void>;
  /**
   * UNIT B (F-4, R5): desmonta la ruta hacia una identidad SUPERSEDED del
   * peer. OBLIGATORIO para todo transporte con capacidad de producción
   * (forzado por compilación: esta firma es requerida en la interfaz).
   * El messenger lo invoca post-commit del re-pair, en try/catch: un fallo
   * aquí se registra pero jamás revierte el commit (la muerte SQL ya es
   * autoritativa). Idempotente: doble teardown es no-op.
   */
  teardownRouteForPeer(peerPkHex: string): Promise<void>;
}

/**
 * Transporte en memoria: para tests y para la UI sin radio.
 * Dos instancias conectadas entre sí simulan el cable.
 */
export class LoopbackTransport implements P2PTransport {
  readonly name = "loopback";
  readonly available = true;
  private events: P2PTransportEvents | null = null;
  private partner: LoopbackTransport | null = null;
  private peerInfo: P2PPeerInfo | null = null;

  /** Enlaza dos extremos como si hubiera un socket entre ellos. */
  linkTo(other: LoopbackTransport, myInfo: P2PPeerInfo, theirInfo: P2PPeerInfo): void {
    this.partner = other;
    this.peerInfo = theirInfo;
    other.partner = this;
    other.peerInfo = myInfo;
  }

  async startDiscovery(events: P2PTransportEvents): Promise<void> {
    this.events = events;
  }

  async stopDiscovery(): Promise<void> {
    this.events = null;
  }

  async connect(_alias: string): Promise<P2PPeerInfo> {
    if (!this.peerInfo) throw new Error("Sin peer enlazado (loopback).");
    // Anuncia el peer al otro extremo, como haría el discovery real.
    this.partner?.events?.onPeerFound?.(this.peerInfo);
    return this.peerInfo;
  }

  async sendFrame(_peerPkHex: string, frame: Uint8Array): Promise<void> {
    const partner = this.partner;
    const info = this.peerInfo;
    if (!partner || !info) throw new Error("Sin conexión loopback.");
    // Entrega asíncrona, como un socket real.
    setTimeout(() => {
      partner.events?.onFrame?.(info.pkHex, frame);
    }, 0);
  }

  async disconnect(_peerPkHex: string): Promise<void> {
    const info = this.peerInfo;
    if (info) this.partner?.events?.onPeerLost?.(info.pkHex);
    this.partner = null;
    this.peerInfo = null;
  }

  /**
   * UNIT B: no-op DOCUMENTADO. Este es el único "vacío" aceptable para
   * teardownRouteForPeer: el loopback no tiene rutas reales que desmontar
   * (es solo tests/UI sin radio). Los transportes de producción DEBEN
   * desmontar de verdad.
   */
  async teardownRouteForPeer(_peerPkHex: string): Promise<void> {
    // Sin rutas reales: nada que desmontar. Idempotente por construcción.
  }

  /** F-2: loopback no cachea identidad propia; no-op. */
  resetMyIdentityCache(): void {}
}

/**
 * Marcador del futuro módulo nativo (`modules/nido-p2p`, Kotlin).
 * Falla de forma explícita: nunca finge que envió algo.
 */
export class NativeP2PTransport implements P2PTransport {
  readonly name = "native";
  readonly available = false;

  private fail(): Promise<never> {
    return Promise.reject(
      new Error(
        "Transporte P2P nativo no disponible: compila el módulo nido-p2p " +
          "(Bluetooth RFCOMM) con un dispositivo Android real. Los mensajes quedan en la cola cifrada.",
      ),
    );
  }

  startDiscovery(_events: P2PTransportEvents): Promise<void> {
    return this.fail();
  }
  stopDiscovery(): Promise<void> {
    return this.fail();
  }
  connect(_alias: string): Promise<P2PPeerInfo> {
    return this.fail();
  }
  sendFrame(_peerPkHex: string, _frame: Uint8Array): Promise<void> {
    return this.fail();
  }
  disconnect(_peerPkHex: string): Promise<void> {
    return this.fail();
  }
  /**
   * UNIT B: no-op honesto — sin módulo nativo compilado no existen rutas
   * que desmontar. (El stub falla explícito en todo lo demás para no
   * fingir capacidad.)
   */
  async teardownRouteForPeer(_peerPkHex: string): Promise<void> {}
}
