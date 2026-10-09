/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * nido-p2p — bindings TypeScript del módulo nativo (Kotlin).
 *
 * API mínima y explícita: el módulo solo mueve bytes con framing
 * [u32 BE longitud][payload]. El handshake, el cifrado y el protocolo
 * de mensajes viven en la app (`src/p2p/`).
 *
 * Este archivo SOLO se carga en un build real con el módulo compilado;
 * `src/p2p/nativeTransport.ts` lo importa de forma perezosa y tolera
 * su ausencia (los mensajes quedan en la cola cifrada).
 */
import { requireNativeModule, EventEmitter } from "expo-modules-core";

export interface NidoP2PDeviceInfo {
  address: string; // MAC Bluetooth, p. ej. "A1:B2:C3:D4:E5:F6"
  name: string | null;
}

export interface NidoP2PEvents {
  onDeviceFound: (device: NidoP2PDeviceInfo) => void;
  onDiscoveryFinished: () => void;
  onConnected: (info: NidoP2PDeviceInfo & { incoming: boolean }) => void;
  onFrame: (event: { address: string; base64: string }) => void;
  onDisconnected: (event: { address: string }) => void;
  onError: (event: { message: string }) => void;
}

interface NidoP2PNativeModule {
  getServiceUuid(): string;
  isBluetoothEnabled(): boolean;
  requestPermissions(): Promise<boolean>;
  getBondedDevices(): Promise<NidoP2PDeviceInfo[]>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  startServer(): Promise<void>;
  stopServer(): Promise<void>;
  connect(address: string): Promise<NidoP2PDeviceInfo>;
  sendFrame(address: string, base64: string): Promise<void>;
  disconnect(address: string): Promise<void>;
  shutdown(): Promise<void>;
  /**
   * DIAG-2026-10-07: estado del servidor RFCOMM (acept loop vivo/muerto,
   * conexiones aceptadas). Síncrona en el lado nativo.
   */
  getServerStatus(): {
    alive: boolean;
    acceptedCount: number;
    lastAcceptAt: number;
  };
}

const native = requireNativeModule<NidoP2PNativeModule>("NidoP2P");
// Emisor sin tipar a propósito: este archivo es un puente fino y nunca se
// carga en tests; los tipos públicos están en NidoP2PEvents.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const emitter = new EventEmitter(native as any);

export const NIDO_SERVICE_UUID: string = native.getServiceUuid();

export function isBluetoothEnabled(): boolean {
  try {
    return native.isBluetoothEnabled();
  } catch {
    return false;
  }
}

export function requestPermissions(): Promise<boolean> {
  return native.requestPermissions();
}

export function getBondedDevices(): Promise<NidoP2PDeviceInfo[]> {
  return native.getBondedDevices();
}

export function startDiscovery(): Promise<void> {
  return native.startDiscovery();
}

export function stopDiscovery(): Promise<void> {
  return native.stopDiscovery();
}

export function startServer(): Promise<void> {
  return native.startServer();
}

export function stopServer(): Promise<void> {
  return native.stopServer();
}

export function connect(address: string): Promise<NidoP2PDeviceInfo> {
  return native.connect(address);
}

export function sendFrame(address: string, base64: string): Promise<void> {
  return native.sendFrame(address, base64);
}

export function disconnect(address: string): Promise<void> {
  return native.disconnect(address);
}

export function shutdown(): Promise<void> {
  return native.shutdown();
}

/**
 * DIAG-2026-10-07: estado del servidor RFCOMM nativo (accept loop vivo/muerto,
 * conexiones aceptadas, última aceptación). El nativo la expone como función
 * síncrona; si algo falla del lado nativo, Kotlin devuelve {alive:false,...}.
 */
export function getServerStatus(): {
  alive: boolean;
  acceptedCount: number;
  lastAcceptAt: number;
} {
  return native.getServerStatus();
}

/** Suscribe un listener a un evento nativo; devuelve la función para desuscribir. */
export function addListener<K extends keyof NidoP2PEvents>(
  event: K,
  listener: NidoP2PEvents[K],
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = (emitter as any).addListener(event, listener);
  return () => sub.remove();
}
