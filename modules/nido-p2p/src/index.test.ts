/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DIAG-2026-10-07 (fix): regresión del puente JS del módulo nativo nido-p2p.
 *
 * El commit de diagnóstico agregó Function("getServerStatus") en Kotlin y la
 * tarjeta de UI que lo consume vía require("nido-p2p"), pero olvidó exportar
 * getServerStatus en modules/nido-p2p/src/index.ts. En dispositivo, la tarjeta
 * mostraba "Server status unavailable" aunque el nativo sí sabía responder,
 * porque b.getServerStatus era undefined y readServerStatus() devolvía null.
 *
 * Este test impide que vuelva a pasar: verifica que toda la superficie que
 * src/p2p/nativeTransport.ts consume del puente esté realmente exportada.
 */

const nativeFns = vi.hoisted(() => ({
  getServiceUuid: vi.fn(() => "test-uuid"),
  isBluetoothEnabled: vi.fn(() => true),
  requestPermissions: vi.fn(async () => true),
  getBondedDevices: vi.fn(async () => []),
  startDiscovery: vi.fn(async () => undefined),
  stopDiscovery: vi.fn(async () => undefined),
  startServer: vi.fn(async () => undefined),
  stopServer: vi.fn(async () => undefined),
  connect: vi.fn(async () => ({ address: "00:00:00:00:00:00", name: null })),
  sendFrame: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
  getServerStatus: vi.fn(() => ({
    alive: true,
    acceptedCount: 3,
    lastAcceptAt: 1234567890,
  })),
}));

vi.mock("expo-modules-core", () => ({
  requireNativeModule: vi.fn(() => nativeFns),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  EventEmitter: vi.fn(function (this: any) {
    return { addListener: vi.fn(() => ({ remove: vi.fn() })) };
  }),
}));

// El import va después del mock: index.ts llama requireNativeModule a nivel
// de módulo (igual que en un build real).
import * as bindings from "./index";

describe("puente nido-p2p: superficie exportada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exporta getServerStatus (diagnóstico del accept loop)", () => {
    expect(typeof bindings.getServerStatus).toBe("function");
  });

  it("getServerStatus delega al módulo nativo y devuelve su forma", () => {
    const status = bindings.getServerStatus();
    expect(nativeFns.getServerStatus).toHaveBeenCalledTimes(1);
    expect(status).toEqual({
      alive: true,
      acceptedCount: 3,
      lastAcceptAt: 1234567890,
    });
  });

  it("expone todo lo que nativeTransport consume vía require(\"nido-p2p\")", () => {
    const expected = [
      "NIDO_SERVICE_UUID",
      "isBluetoothEnabled",
      "requestPermissions",
      "getBondedDevices",
      "startDiscovery",
      "stopDiscovery",
      "startServer",
      "stopServer",
      "connect",
      "sendFrame",
      "disconnect",
      "shutdown",
      "getServerStatus",
      "addListener",
    ];
    for (const name of expected) {
      expect(
        (bindings as Record<string, unknown>)[name],
        `export faltante en modules/nido-p2p/src/index.ts: ${name}`,
      ).toBeDefined();
    }
  });
});
