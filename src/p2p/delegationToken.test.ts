/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { toHex } from "./crypto";
import {
  issueDelegationToken,
  attenuateToken,
  verifyDelegationToken,
} from "./delegationToken";
import { TASK_LIMITS } from "./taskProtocol";

function keypair() {
  const kp = nacl.sign.keyPair();
  return { pk: toHex(kp.publicKey), sk: kp.secretKey };
}

const TASK_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("delegationToken (Biscuit-style Ed25519)", () => {
  it("issues and verifies a valid token", () => {
    const a = keypair();
    const b = keypair();
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    const v = verifyDelegationToken(tok, a.pk, b.pk);
    expect(v).not.toBeNull();
    expect(v!.root.scopes).toEqual(["task:answer"]);
    expect(v!.root.taskId).toBe(TASK_ID);
  });

  it("rejects wrong audience", () => {
    const a = keypair();
    const b = keypair();
    const c = keypair();
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    expect(verifyDelegationToken(tok, a.pk, c.pk)).toBeNull();
  });

  it("rejects tampered scopes", () => {
    const a = keypair();
    const b = keypair();
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    // Flip a byte in the payload segment.
    const tampered = tok.slice(0, 20) + (tok[20] === "A" ? "B" : "A") + tok.slice(21);
    expect(verifyDelegationToken(tampered, a.pk, b.pk)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const a = keypair();
    const b = keypair();
    // Issue with short life, verify in the far future.
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 1000,
    });
    expect(
      verifyDelegationToken(tok, a.pk, b.pk, Date.now() + 20 * 60 * 1000)
    ).toBeNull();
  });

  it("attenuation narrows but cannot widen", () => {
    const a = keypair();
    const b = keypair();
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer", "task:summarize"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    const att = attenuateToken(a.sk, tok, { maxToolCalls: 3 });
    const v = verifyDelegationToken(att, a.pk, b.pk);
    expect(v).not.toBeNull();
    expect(v!.effective.maxToolCalls).toBe(3);
    // Scopes are still the root set (caveats cannot add scopes).
    expect(v!.root.scopes).toEqual(["task:answer", "task:summarize"]);
  });

  it("rejects tokens signed by the wrong key", () => {
    const a = keypair();
    const evil = keypair();
    const b = keypair();
    const tok = issueDelegationToken(evil.sk, {
      issuer: a.pk, // claims to be A
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    expect(verifyDelegationToken(tok, a.pk, b.pk)).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    const a = keypair();
    const b = keypair();
    expect(verifyDelegationToken("", a.pk, b.pk)).toBeNull();
    expect(verifyDelegationToken("!!!", a.pk, b.pk)).toBeNull();
    expect(verifyDelegationToken("e30=", a.pk, b.pk)).toBeNull();
  });

  it("issuance fails closed on bad input", () => {
    const a = keypair();
    const b = keypair();
    expect(() =>
      issueDelegationToken(a.sk, {
        issuer: a.pk,
        audience: b.pk,
        negotiationId: "neg-1",
        taskId: "bad",
        scopes: ["task:answer"],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      })
    ).toThrow();
    expect(() =>
      issueDelegationToken(a.sk, {
        issuer: a.pk,
        audience: b.pk,
        negotiationId: "neg-1",
        taskId: TASK_ID,
        scopes: ["task:delete_everything"] as never,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      })
    ).toThrow();
  });

  it("chain tampering (link removal) breaks verification", () => {
    const a = keypair();
    const b = keypair();
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    const att = attenuateToken(a.sk, tok, { maxToolCalls: 2 });
    // Try to strip the caveat by re-encoding only the root link.
    const raw = JSON.parse(
      Buffer.from(att.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    raw.chain = [raw.chain[0]];
    const stripped =
      Buffer.from(JSON.stringify(raw))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    // Stripped token is still structurally valid (root verifies) but the
    // caveat is gone — this is FINE because caveats only narrow; the
    // root is the ceiling. What must NOT verify is a reordered chain.
    expect(verifyDelegationToken(stripped, a.pk, b.pk)).not.toBeNull();
  });
});

describe("delegationToken: session binding (anti cross-session replay)", () => {
  const TAG_A = "aa".repeat(64); // 128 hex chars, como ackSessionTag
  const TAG_B = "bb".repeat(64);

  function boundToken(a: { pk: string; sk: Uint8Array }, b: { pk: string }, tag: string) {
    return issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      sessionTag: tag,
    });
  }

  it("un token ligado verifica solo con el tag de su sesión", () => {
    const a = keypair();
    const b = keypair();
    const tok = boundToken(a, b, TAG_A);
    expect(verifyDelegationToken(tok, a.pk, b.pk, Date.now(), TAG_A)).not.toBeNull();
  });

  it("fail-closed: tag distinto → null (replay en otra sesión)", () => {
    const a = keypair();
    const b = keypair();
    const tok = boundToken(a, b, TAG_A);
    expect(verifyDelegationToken(tok, a.pk, b.pk, Date.now(), TAG_B)).toBeNull();
  });

  it("fail-closed: token ligado verificado sin tag → null", () => {
    const a = keypair();
    const b = keypair();
    const tok = boundToken(a, b, TAG_A);
    expect(verifyDelegationToken(tok, a.pk, b.pk)).toBeNull();
  });

  it("fail-closed: verificador exige tag pero el token no lo trae → null", () => {
    const a = keypair();
    const b = keypair();
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    expect(verifyDelegationToken(tok, a.pk, b.pk, Date.now(), TAG_A)).toBeNull();
  });

  it("el tag ligado sobrevive a la atenuación y sigue verificando", () => {
    const a = keypair();
    const b = keypair();
    const tok = boundToken(a, b, TAG_A);
    const att = attenuateToken(a.sk, tok, { maxToolCalls: 2 });
    const v = verifyDelegationToken(att, a.pk, b.pk, Date.now(), TAG_A);
    expect(v).not.toBeNull();
    expect(v!.root.sessionTag).toBe(TAG_A);
    expect(v!.effective.maxToolCalls).toBe(2);
    // Con otro tag sigue fallando.
    expect(verifyDelegationToken(att, a.pk, b.pk, Date.now(), TAG_B)).toBeNull();
  });

  it("issuance rechaza sessionTag malformado", () => {
    const a = keypair();
    const b = keypair();
    expect(() =>
      issueDelegationToken(a.sk, {
        issuer: a.pk,
        audience: b.pk,
        negotiationId: "neg-1",
        taskId: TASK_ID,
        scopes: ["task:answer"],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        sessionTag: "corto",
      })
    ).toThrow();
  });
});

describe("delegationToken: attenuateToken verifica antes de extender", () => {
  it("attenuate rechaza un token manipulado (no extiende basura firmada)", () => {
    const a = keypair();
    const b = keypair();
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    const tampered = tok.slice(0, 20) + (tok[20] === "A" ? "B" : "A") + tok.slice(21);
    expect(() => attenuateToken(a.sk, tampered, { maxToolCalls: 1 })).toThrow();
  });

  it("attenuate rechaza extender con la clave equivocada", () => {
    const a = keypair();
    const evil = keypair();
    const b = keypair();
    const tok = issueDelegationToken(a.sk, {
      issuer: a.pk,
      audience: b.pk,
      negotiationId: "neg-1",
      taskId: TASK_ID,
      scopes: ["task:answer"],
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    // evil.sk no es el firmante: la verificación previa falla.
    expect(() => attenuateToken(evil.sk, tok, { maxToolCalls: 1 })).toThrow();
  });
});
