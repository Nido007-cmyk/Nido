/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  collectSecurityDiagnostics,
  diagnosticsToSafeText,
} from "./security";

const okDb = {
  getAllAsync: async () => [{ cipher_version: "4.6.1 community" }],
};
const noCipherDb = {
  getAllAsync: async () => [{ cipher_version: "" }],
};
const throwingDb = {
  getAllAsync: async () => {
    throw new Error("boom");
  },
};

function memStore() {
  const m = new Map<string, string>();
  return {
    setItemAsync: async (k: string, v: string) => {
      m.set(k, v);
    },
    getItemAsync: async (k: string) => m.get(k) ?? null,
    deleteItemAsync: async (k: string) => {
      m.delete(k);
    },
    _size: () => m.size,
  };
}

const okAuth = {
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  supportedAuthenticationTypesAsync: async () => [1, 2],
};
const noBioAuth = {
  hasHardwareAsync: async () => false,
  isEnrolledAsync: async () => false,
  supportedAuthenticationTypesAsync: async () => [],
};

describe("security diagnostics", () => {
  it("reporta SQLCipher verificado con cipher_version", async () => {
    const d = await collectSecurityDiagnostics({ db: okDb });
    expect(d.sqlcipher.state).toBe("verified");
    expect(d.sqlcipher.cipherVersion).toBe("4.6.1 community");
  });

  it("cipher_version vacío => failed (fail-closed, no asumir)", async () => {
    const d = await collectSecurityDiagnostics({ db: noCipherDb });
    expect(d.sqlcipher.state).toBe("failed");
    expect(d.sqlcipher.cipherVersion).toBeNull();
  });

  it("error de PRAGMA => failed", async () => {
    const d = await collectSecurityDiagnostics({ db: throwingDb });
    expect(d.sqlcipher.state).toBe("failed");
  });

  it("sin db => not-verifiable, nunca 'verified' por defecto", async () => {
    const d = await collectSecurityDiagnostics({});
    expect(d.sqlcipher.state).toBe("not-verifiable");
  });

  it("keystore round-trip con canary efímero que se borra", async () => {
    const store = memStore();
    const d = await collectSecurityDiagnostics({
      secureStore: store,
      randomHex: () => "aa".repeat(16),
    });
    expect(d.keystore.state).toBe("verified");
    expect(d.keystore.roundTripOk).toBe(true);
    expect(store._size()).toBe(0); // canary borrado
  });

  it("keystore que no coincide => failed", async () => {
    const bad = {
      setItemAsync: async () => {},
      getItemAsync: async () => "otro-valor",
      deleteItemAsync: async () => {},
    };
    const d = await collectSecurityDiagnostics({ secureStore: bad });
    expect(d.keystore.state).toBe("failed");
    expect(d.keystore.roundTripOk).toBe(false);
  });

  it("biometría: reporta hardware/enrolled/tipos", async () => {
    const d = await collectSecurityDiagnostics({ localAuth: okAuth });
    expect(d.biometric.state).toBe("verified");
    expect(d.biometric.hasHardware).toBe(true);
    expect(d.biometric.enrolled).toBe(true);
    expect(d.biometric.types).toEqual(["fingerprint", "facial"]);
  });

  it("sin biometría => hasHardware false, sin tipos", async () => {
    const d = await collectSecurityDiagnostics({ localAuth: noBioAuth });
    expect(d.biometric.hasHardware).toBe(false);
    expect(d.biometric.types).toEqual([]);
  });

  it("hardware-backed y StrongBox: honestamente not-verifiable desde JS", async () => {
    const d = await collectSecurityDiagnostics({ db: okDb });
    expect(d.hardwareBacked.state).toBe("not-verifiable");
    expect(d.strongBox.state).toBe("not-verifiable");
    expect(d.hardwareBacked.note).toMatch(/NO asumir/);
  });

  it("el texto seguro no filtra el canary ni secretos", async () => {
    const store = memStore();
    const secretCanary = "cafef00d".repeat(4);
    const d = await collectSecurityDiagnostics({
      db: okDb,
      secureStore: store,
      randomHex: () => secretCanary,
    });
    const text = diagnosticsToSafeText(d);
    expect(text).not.toContain(secretCanary);
    expect(text).toContain("sqlcipher: verified");
    expect(text).toContain("keystore: verified");
  });

  it("generatedAt es ISO válido", async () => {
    const d = await collectSecurityDiagnostics({});
    expect(Number.isNaN(Date.parse(d.generatedAt))).toBe(false);
  });
});
