> **Idioma:** [English](../TRANSPORT_ARCHITECTURE.md) · Español

# NIDO Transport Architecture — Especificación (borrador v0.1)

**Estado:** diseño, NO implementar todavía.

**Principio:** el protocolo nunca depende de Bluetooth — ni de ningún
medio. `TRANSPORT ≠ TRUST`: que un paquete llegue por Bluetooth no lo hace
confiable; que llegue por relay no lo hace menos criptográficamente válido.
Los transportes mueven ciphertext; la autenticación y el cifrado viven en
las capas superiores (handshake + sesión + envelope firmado).

---

## 1. Interfaz Transport

```typescript
interface Transport {
  /** "bluetooth-rfcomm" | "lan-tcp" | "wifi-direct" | "internet-p2p" | "relay" | … */
  readonly id: string;
  /** Propiedades declaradas (ver §2). */
  readonly properties: TransportProperties;
  /** Descubrimiento de pares (según el medio). */
  discover(cb: (peer: DiscoveredPeer) => void): Promise<void>;
  /** Conecta con un par descubierto o por dirección. */
  connect(addr: TransportAddress): Promise<Connection>;
  /** Cierra todo. */
  close(): Promise<void>;
}

interface Connection {
  /** Envía bytes opacos (ya cifrados por la capa de sesión). */
  send(bytes: Uint8Array): Promise<void>;
  /** Recibe bytes opacos. */
  onReceive(cb: (bytes: Uint8Array) => void): void;
  close(): Promise<void>;
}

interface TransportProperties {
  reliability: "reliable-stream" | "unreliable-datagram";
  ordering: "ordered" | "unordered";
  mtu_bytes: number;          // el framing del protocolo lo respeta
  latency_class: "low" | "medium" | "high";
  requires_discovery: boolean;
  works_offline: boolean;     // sin Internet
}
```

Reglas:

- El transporte entrega **bytes opacos**. No parsea, no valida, no decide.
- Una `TASK_REQUEST` es **idéntica** viaje por el medio que viaje.
- El protocolo exige de la capa de sesión (no del transporte):
  confidencialidad + autenticidad + anti-replay por frame.
- Si el transporte es datagrama no fiable, la capa de sesión/protocolo
  añade retransmisión; el formato del envelope no cambia.

---

## 2. Transportes

| Transporte | Estado | Propiedades |
|---|---|---|
| Bluetooth RFCOMM | implementado (Kotlin) | stream fiable, MTU ~256 KiB por frame, offline |
| LAN (TCP + mDNS) | futuro | stream fiable, offline (red local) |
| Wi-Fi Direct | futuro | stream fiable, offline |
| Internet P2P directo | futuro | p. ej. QUIC con direccionamiento por identidad; online |
| Relay cifrado | futuro | store-and-forward opcional; solo ve ciphertext |
| Futuros (hardware dedicado…) | reservado | la interfaz no cambia |

**Orden de intento** (futuro transporte remoto): directo primero
(Bluetooth/LAN/Wi-Fi Direct/Internet P2P); relay solo si no hay vía
directa. El relay es un *hint de enrutado*, no parte de la identidad.

---

## 3. Seguridad end-to-end y el relay

- Todo lo que sale del dispositivo hacia otro NIDO está cifrado por la
  **sesión** (AEAD, claves efímeras del handshake autenticado) y firmado a
  nivel de envelope (ver `AGENT_PROTOCOL.md`).
- El relay futuro **solo ve ciphertext**: nunca posee claves privadas de
  identidad, plaintext de sesiones, memoria del agente, permisos de tools
  ni claves de descifrado.
- **El relay puede desaparecer o cambiarse sin**: cambiar la identidad
  NIDO, cambiar capabilities, perder memoria ni re-emparejar contactos.
  La dirección del relay es configuración de enrutado, revocable por el
  usuario.
- Un relay malicioso como máximo puede: descartar, retrasar o duplicar
  (lo cubren idempotencia y duplicados, `AGENT_PROTOCOL.md` §9). No puede
  leer, forjar (firma) ni elevar privilegios.

---

## 4. Dónde vive cada responsabilidad

- **Transporte:** mover bytes, descubrir pares, reportar disponibilidad.
- **Sesión (handshake):** autenticar dispositivos, establecer claves,
  cifrar frames, anti-replay.
- **Protocolo agente:** envelopes, tareas, idempotencia, expiración,
  reintentos, cola offline.
- **Policy Engine:** autorización.

La **cola offline** vive en la capa de protocolo/agente (outbox
persistente cifrado), no en el transporte: una tarea sobrevive a
desconexiones, cambios de transporte e incluso reinicios. El transporte
solo informa `available/unavailable`.

---

## 5. Discovery de pares sin filtrar privacidad

- Bluetooth: discovery clásico con nombre genérico (no "NIDO de Arsrs").
- LAN: mDNS con identificador efímero rotativo, no la identidad estable.
- El primer contacto real (identidad↔identidad) ocurre por **QR**
  (ver `AGENT_PROTOCOL.md` §2) o por introducción de un contacto mutuo —
  nunca por broadcast de la clave de identidad.
- Un observador del medio aprende como máximo: "hay un dispositivo
  hablando un protocolo", no quién es ni con quién habla (el direccionamiento
  a relays usa hashes de identidad, no claves en claro).

---

## 6. Preguntas abiertas

1. ¿El relay debe ser store-and-forward (buzón) o solo reenvío en
   caliente? (Buzón ayuda a §9 del protocolo; aumenta la superficie del
   relay aunque siga siendo ciphertext-only.)
2. Direccionamiento Internet P2P sin servidor central: ¿DHT, introducción
   por contactos, o ambos? (Sin decidir: no implementar infraestructura
   compleja todavía.)
3. ¿Cómo rota el identificador efímero de discovery para evitar tracking
   por radio? (Intervalo, entropía, sincronización con el usuario.)
4. Límites de tamaño por transporte y fragmentación a nivel de sesión:
   ¿MTU común mínimo garantizado?
