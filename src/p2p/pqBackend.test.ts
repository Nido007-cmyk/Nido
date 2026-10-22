/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.51 — elección de la implementación de ML-KEM-768.
 *
 * En el teléfono se usa mlkem-native si da exactamente los mismos bytes que
 * la versión JS; si no (o si no está), la JS. Aquí se prueba esa elección con
 * módulos nativos simulados. La equivalencia real entre mlkem-native y la JS
 * la comprueba CI compilando el C de verdad (.github/workflows/pqc.yml).
 */
import { afterEach, describe, expect, it } from "vitest";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import {
  kemBackend,
  kemDecapsulate,
  kemEncapsulate,
  kemImplMatchesReference,
  kemKeygen,
  nativeKemImpl,
  setKemImplForTests,
} from "./pq";
import { fromHex, toHex } from "./crypto";

/** "Nativo" simulado que en realidad llama a la JS (debe pasar el control). */
const honestNative = {
  keypair: (c: string) => {
    const kp = ml_kem768.keygen(fromHex(c));
    return toHex(kp.publicKey) + toHex(kp.secretKey);
  },
  encaps: (pk: string, m: string) => {
    try {
      const r = ml_kem768.encapsulate(fromHex(pk), fromHex(m));
      return toHex(r.cipherText) + toHex(r.sharedSecret);
    } catch {
      return null;
    }
  },
  decaps: (ct: string, sk: string) => toHex(ml_kem768.decapsulate(fromHex(ct), fromHex(sk))),
};

afterEach(() => setKemImplForTests(null));

describe("0.1.51: ML-KEM nativo con control contra la JS", () => {
  it("en Node (sin módulo nativo) se usa la JS", () => {
    setKemImplForTests(null);
    expect(kemBackend()).toBe("noble");
  });

  it("un nativo que da los mismos bytes pasa el control", () => {
    expect(kemImplMatchesReference(nativeKemImpl(honestNative))).toBe(true);
  });

  it("un nativo que se equivoca en un solo byte NO pasa (se seguiría con la JS)", () => {
    const flipSs = {
      ...honestNative,
      encaps: (pk: string, m: string) => {
        const h = honestNative.encaps(pk, m)!;
        return h.slice(0, -2) + (h.slice(-2) === "00" ? "01" : "00");
      },
    };
    expect(kemImplMatchesReference(nativeKemImpl(flipSs))).toBe(false);
  });

  it("un nativo que no aplica el rechazo implícito igual que FIPS 203 NO pasa", () => {
    // Recuerda los cifrados que él mismo produjo; ante uno alterado devuelve
    // ceros (rechazo "explícito"), en vez del secreto que manda FIPS 203.
    const made = new Set<string>();
    const explicitReject = {
      ...honestNative,
      encaps: (pk: string, m: string) => {
        const r = honestNative.encaps(pk, m);
        if (r) made.add(r.slice(0, 1088 * 2));
        return r;
      },
      decaps: (ct: string, sk: string) => (made.has(ct) ? honestNative.decaps(ct, sk) : "00".repeat(32)),
    };
    expect(kemImplMatchesReference(nativeKemImpl(explicitReject))).toBe(false);
  });

  it("un nativo que devuelve basura o null NO pasa y no lanza", () => {
    expect(kemImplMatchesReference(nativeKemImpl({ ...honestNative, keypair: () => "zz" }))).toBe(false);
    expect(kemImplMatchesReference(nativeKemImpl({ ...honestNative, decaps: () => null }))).toBe(false);
  });

  it("con el nativo elegido, las funciones públicas interoperan con la JS", () => {
    setKemImplForTests(nativeKemImpl(honestNative), "mlkem-native");
    expect(kemBackend()).toBe("mlkem-native");
    const kp = kemKeygen();
    // Encapsula la JS (el otro teléfono), desencapsula el "nativo".
    const e = ml_kem768.encapsulate(kp.publicKey);
    expect(toHex(kemDecapsulate(e.cipherText, kp.secretKey))).toBe(toHex(e.sharedSecret));
    // Y al revés.
    const jsKp = ml_kem768.keygen();
    const mine = kemEncapsulate(jsKp.publicKey);
    expect(toHex(ml_kem768.decapsulate(mine.cipherText, jsKp.secretKey))).toBe(toHex(mine.sharedSecret));
  });
});
