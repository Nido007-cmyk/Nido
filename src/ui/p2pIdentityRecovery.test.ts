/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * p2pIdentityRecovery.test.ts — NIDO: F-2.
 *
 * INVARIANT: un P2PIdentityKeyLossError siempre aflora como la pantalla de
 * recovery honesto y explícito — nunca como un error genérico del enlace,
 * un fallback silencioso, o un first-run falso que regenere la identidad.
 *
 * La pantalla RN no puede renderizarse en esta suite (vitest, sin renderer
 * RN — misma restricción que N3/N4), así que estos tests cubren el contrato
 * testable debajo: P2PIdentityKeyLossError (tipado, de store) →
 * routeIdentityBootstrapError (routing de NidoScreen) →
 * buildP2PIdentityRecoveryViewModel (modelo de pantalla) →
 * doble confirmación explícita → recoverP2PIdentityAfterKeyLoss(true).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildP2PIdentityRecoveryViewModel,
  P2P_IDENTITY_KEY_LOST_CODE,
  P2P_RECOVERY_COPY_KEYS,
  RECOVERY_CONFIRMATIONS_REQUIRED,
  routeIdentityBootstrapError,
} from "./p2pIdentityRecovery";
import { P2PIdentityKeyLossError } from "../p2p/store";
import { KeyLossError } from "../privacy/keyManager";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import pt from "../i18n/locales/pt.json";

// El módulo de recovery importa el error tipado desde ../p2p/store, que a
// su vez importa memoryStore (real: arrastra react-native). Se mockea como
// en los tests p2p — el contrato aquí es presentación, no persistencia.
const mockMem = vi.hoisted(() => ({
  identity: [],
  contacts: [],
  messages: [],
  ackLog: [],
  lateAck: [],
  nonceCache: [],
  identityArchive: [],
  repairIntents: [],
  bootRepairLog: [],
}));
vi.mock("../agent/memory/memoryStore", async () => {
  const { p2pMemoryStoreModule } = await import("../p2p/p2pMemoryMock");
  return p2pMemoryStoreModule(mockMem);
});

const PK_HEX = "ab".repeat(32);

/** Acceso tipado al namespace nuevo sin arrastrar el tipo del JSON completo. */
function recoveryNs(locale: unknown): Record<string, string> {
  return (locale as { p2pIdentityRecovery: Record<string, string> }).p2pIdentityRecovery;
}

function makeErr(alias = "nido_p2p_sk"): P2PIdentityKeyLossError {
  return new P2PIdentityKeyLossError(alias, PK_HEX, "pérdida de prueba");
}

describe("f2: routing del error de identidad", () => {
  it("P2PIdentityKeyLossError → pantalla de recovery honesto", () => {
    expect(routeIdentityBootstrapError(makeErr())).toBe("p2p-identity-loss");
  });

  it("otros errores siguen su camino anterior", () => {
    expect(routeIdentityBootstrapError(new Error("boom"))).toBe("proceed");
    expect(routeIdentityBootstrapError(new KeyLossError([], "x"))).toBe("proceed");
    expect(routeIdentityBootstrapError(null)).toBe("proceed");
  });

  it("el código del contrato es el del error tipado, no re-derivado", () => {
    expect(P2P_IDENTITY_KEY_LOST_CODE).toBe("NIDO_P2P_IDENTITY_KEY_LOST");
    expect(makeErr().code).toBe(P2P_IDENTITY_KEY_LOST_CODE);
  });
});

describe("f2: view model de la pantalla honesta", () => {
  it("enlaza los valores del contrato y las rutas de copy", () => {
    const vm = buildP2PIdentityRecoveryViewModel(makeErr("nido_p2p_sign_sk"));
    expect(vm.code).toBe(P2P_IDENTITY_KEY_LOST_CODE);
    expect(vm.alias).toBe("nido_p2p_sign_sk");
    expect(vm.pkHex).toBe(PK_HEX);
    for (const k of P2P_RECOVERY_COPY_KEYS) {
      expect(vm.copy[k]).toBe(`p2pIdentityRecovery.${k}`);
    }
  });

  it("se exigen exactamente dos confirmaciones explícitas", () => {
    expect(RECOVERY_CONFIRMATIONS_REQUIRED).toBe(2);
  });
});

describe("f2: copy honesto en EN/ES/PT", () => {
  const locales = { en, es, pt } as const;

  it("todas las claves de copy existen en los tres idiomas", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const ns = recoveryNs(locale);
      expect(ns, `namespace ausente en ${name}`).toBeDefined();
      for (const k of P2P_RECOVERY_COPY_KEYS) {
        expect(typeof ns[k], `${name}: falta ${k}`).toBe("string");
        expect(ns[k].trim().length, `${name}: ${k} vacío`).toBeGreaterThan(0);
      }
    }
  });

  it("el copy dice claro: peers no reconocen + re-pair requerido", () => {
    const body = recoveryNs(en);
    expect(body.consequence).toMatch(/no longer recognize/i);
    expect(body.consequence).toMatch(/re-pair/i);
    expect(body.confirmBody).toMatch(/cannot be undone/i);
    // Nada de "creating a new identity automatically": es un acto del usuario.
    expect(body.recoverButton).toMatch(/create/i);
  });

  it("el copy nunca promete recuperar la identidad perdida", () => {
    for (const locale of Object.values(locales)) {
      const all = Object.values(recoveryNs(locale)).join(" ");
      expect(all).not.toMatch(/recover your (old |previous )?identity/i);
      expect(all).not.toMatch(/recuperar tu identidad/i);
      expect(all).not.toMatch(/recuperar sua identidade/i);
    }
  });
});
