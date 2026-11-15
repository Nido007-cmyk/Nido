/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// T-17 (0.1.99) · m-95: la primera red de tests de NidoScreen
// IMPORTANDO la pantalla real (2.300 líneas, la pantalla P2P
// completa: hasta hoy ningún test la importaba; lo más cercano,
// nidoScreenGuard.test.ts, prueba el protocolo y la estructura sin
// montarla). El arnés sigue el patrón de SourceFootnotes: tema e
// i18n mockeados, el mensajero compartido sustituido por uno inerte
// con la forma que la pantalla lee al montar, el store P2P
// controlado por el test, y las pestañas pesadas como stubs.
//
// La red cubre montaje y navegación básica: barra de pestañas con
// «chats» activa, estado vacío sin contactos, el botón de cierre y
// la lista con un contacto. Los flujos P2P (emparejar, enviar,
// negociar) viven en los tests de src/p2p/ y no se duplican aquí.
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222", card: "#111", black: "#000", modalOverlay: "rgba(0,0,0,0.5)", terminal: "#333" },
      text: { heading: "#fff", primary: "#eee", secondary: "#ccc", dim: "#999", muted: "#888", accentCyan: "#0ff", accentEmerald: "#0f0", inverse: "#000" },
      border: { default: "#444", subtle: "#555" },
      emerald: { 400: "#3ECF6F", 500: "#2F9E44", 600: "#227A35", bgSubtle: "rgba(47,158,68,0.10)", border: "#2F9E44" },
      amber: { 500: "#D97706", 600: "#B07C2A", bgSubtle: "rgba(217,119,6,0.10)", border: "#B07C2A" },
      crimson: { 400: "#C05A44", 500: "#B3442F", bgSubtle: "rgba(179,68,47,0.10)", border: "#B3442F" },
      cyan: { 400: "#22D3EE", 500: "#06B6D4", border: "#0aa" },
    },
    typography: {
      ui: {
        body: { fontSize: 16, lineHeight: 22 },
        bodyLg: { fontSize: 17, lineHeight: 24 },
        caption: { fontSize: 13, lineHeight: 18 },
        subtext: { fontSize: 14, lineHeight: 19 },
        titleSm: { fontSize: 15, lineHeight: 20 },
        title: { fontSize: 20, lineHeight: 26 },
        titleLg: { fontSize: 24, lineHeight: 30 },
      },
      mono: { xs: { fontSize: 11, lineHeight: 14 }, sm: { fontSize: 12, lineHeight: 16 }, base: { fontSize: 13, lineHeight: 18 } },
    },
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "es" } }),
}));

jest.mock("../services/haptics", () => ({
  impact: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

// El mensajero inerte: la forma exacta que la pantalla lee al
// montar (identidad, código, enlace, revocaciones, sondeo del
// servidor) y nada con efectos.
const mockMessenger = {
  ensureIdentity: jest.fn(async () => ({ fingerprint: "AB CD EF", pkHex: "c0ffee" })),
  myPairingCode: jest.fn(async () => "NIDO-CODIGO-DE-PRUEBA"),
  connectedPeers: jest.fn(() => []),
  startLink: jest.fn(async () => {}),
  stopLink: jest.fn(async () => {}),
  serverStatus: jest.fn(() => ({ alive: true, acceptedCount: 0, lastAcceptAt: 0 })),
  isRevoked: jest.fn(async () => false),
  getRevocationStoreStatus: jest.fn(async () => ({ healthy: true })),
  contacts: jest.fn(async () => []),
  connectPeer: jest.fn(async () => {}),
  disconnectPeer: jest.fn(async () => {}),
  handshakeInProgress: jest.fn(() => false),
  shouldDialPeer: jest.fn(() => false),
  getSessionTag: jest.fn(() => null),
  sendDelegationMessage: jest.fn(async () => {}),
  sendChat: jest.fn(async () => ({ queued: false })),
  sessionUsesV5: jest.fn(() => false),
  sessionV5Warning: jest.fn(async () => false),
};
jest.mock("../services/nidoMessenger", () => ({
  getSharedNidoMessenger: () => mockMessenger,
}));

let mockContacts: any[] = [];
jest.mock("../p2p/store", () => ({
  listContacts: async () => mockContacts,
  findContactRowAny: async () => null,
  getConversation: async () => [],
  deleteMessage: async () => {},
  getSigningKeypair: async () => ({ publicKey: new Uint8Array(32) }),
  getKnownMacs: async () => [],
  listV4CapablePks: async () => new Set(),
  DISAPPEAR_OPTIONS_SEC: [0, 60, 3600, 86400],
  P2PIdentityKeyLossError: class P2PIdentityKeyLossError extends Error {},
}));

jest.mock("../p2p/messenger", () => ({ DEDUP_RETENTION_DAYS: 90 }));

jest.mock("../p2p/reconnectManager", () => ({
  reconnectManager: { notifyPeerFound: jest.fn(), notifyPeerLost: jest.fn(), cancel: jest.fn(), cancelAll: jest.fn(), schedule: jest.fn(), setConnector: jest.fn() },
}));

jest.mock("../p2p/relay/relayService", () => ({ relayFlags: async () => ({}) }));

jest.mock("../p2p/nativeTransport", () => ({
  extractLanAddress: () => null,
  extractMac: () => null,
}));

jest.mock("../p2p/batteryHint", () => ({
  shouldShowBatteryHint: async () => false,
  dismissBatteryHint: async () => {},
  openBatterySettings: () => false,
}));

jest.mock("../p2p/pairingCeremony", () => ({ runPairingCeremony: jest.fn(async () => ({})) }));

jest.mock("../p2p/negotiationService", () => ({
  negotiationService: { setLocalIdentity: jest.fn(), setLocalSigningPk: jest.fn() },
}));

jest.mock("../p2p/startupReconnect", () => ({ reconnectKnownContactsOnce: jest.fn(async () => {}) }));

jest.mock("../p2p/crypto", () => ({ toHex: () => "" }));

jest.mock("../p2p/p2pErrorText", () => ({ describeP2PError: () => ({ key: "nido.errorGeneric" }) }));

jest.mock("../agent/delegation/delegationService", () => ({
  delegationService: { setSendFunction: jest.fn(), setSessionTagLookup: jest.fn() },
}));

jest.mock("../config/featureFlags", () => ({ loadFeatureFlags: jest.fn(async () => ({})) }));

jest.mock("../utils/secretClipboard", () => ({ copyPrivate: jest.fn(async () => true) }));

jest.mock("nido-secure-dialog", () => ({ showSecureAlert: jest.fn(async () => false) }));

jest.mock("./useSecureScreen", () => ({ useSecureScreen: () => {} }));

jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("./components/calm/NidoMascot", () => ({ NidoMascot: () => null }));
jest.mock("./NegotiationsTab", () => ({ NegotiationsTab: () => null }));
jest.mock("./PacksTab", () => ({ PacksTab: () => null }));
jest.mock("./RemoteTasksCard", () => ({ RemoteTasksCard: () => null }));
jest.mock("./RelayCard", () => ({ RelayCard: () => null }));

const { NidoScreen } = require("./NidoScreen");

describe("NidoScreen · red de montaje (m-95)", () => {
  beforeEach(() => {
    mockContacts = [];
    jest.clearAllMocks();
  });

  it("monta y pinta la barra de pestañas con «chats» activa", async () => {
    await render(<NidoScreen onClose={() => {}} />);
    const chats = await screen.findByLabelText("nido.tabChats");
    expect(chats.props.accessibilityState?.selected).toBe(true);
    for (const key of ["nido.tabContacts", "nido.tabLink", "nido.tabNegotiations", "nido.tabPacks"]) {
      expect(screen.getByLabelText(key).props.accessibilityState?.selected).toBe(false);
    }
    // El enlace arrancó y la identidad se pidió una vez.
    expect(mockMessenger.ensureIdentity).toHaveBeenCalled();
    expect(mockMessenger.startLink).toHaveBeenCalled();
  });

  it("sin contactos, la pestaña de chats enseña su estado vacío", async () => {
    await render(<NidoScreen onClose={() => {}} />);
    expect(await screen.findByText("nido.noContactsTitle")).toBeTruthy();
    expect(screen.getByText("nido.noContactsBody")).toBeTruthy();
  });

  it("el botón de cierre invoca onClose", async () => {
    const onClose = jest.fn();
    await render(<NidoScreen onClose={onClose} />);
    await fireEvent.press(screen.getByLabelText("common.done"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("con un contacto en el store, la lista lo pinta", async () => {
    mockContacts = [{ pkHex: "aabbcc", name: "Ana", verified: true }];
    await render(<NidoScreen onClose={() => {}} />);
    expect(await screen.findByText("Ana")).toBeTruthy();
    expect(screen.queryByText("nido.noContactsTitle")).toBeNull();
    // La fila es pulsable y lleva el nombre como etiqueta.
    expect(screen.getByLabelText("Ana")).toBeTruthy();
  });
});
