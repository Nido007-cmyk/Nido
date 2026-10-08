/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * keyLossRecovery.test.ts — NIDO: N4-RECOVERY-UI.
 *
 * INVARIANT: a KeyLossError always surfaces as the explicit honest recovery
 * screen — never as a generic crash, silent fallback, or fake first-run.
 *
 * The RN screen component cannot render in this suite (vitest, no RN
 * renderer — same constraint as the N3 lane), so these tests target the
 * testable contract underneath it:
 *   KeyLossError (typed, from keyManager) → routeStartupError (App.tsx
 *   routing) → buildKeyLossViewModel (screen model) →
 *   advanceRecoveryPhase (double-confirmation machine) →
 *   executeKeyLossRecovery → recoverFromKeyLoss({ confirmed: true }).
 *
 * Written before/with the fix; the pre-fix state (no keyRecovery copy,
 * no screen, no routing) fails the wiring assertions by construction.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  advanceRecoveryPhase,
  buildKeyLossViewModel,
  executeKeyLossRecovery,
  KEY_LOST_CODE,
  KEY_RECOVERY_COPY_KEYS,
  routeStartupError,
} from "./keyLossRecovery";
import {
  createMemorySecureBackend,
  KeyLossError,
  SecureStoreReadError,
  setTestSecureBackend,
} from "../privacy/keyManager";
// Importing secureDatabase registers the key-loss probe in keyManager —
// the real production registration path (memoryStore / rag/db import
// secureDatabase before resolving the DEK).
import {
  recoverFromKeyLoss,
  setSecureDbTestDriver,
  type SecureDbDriver,
  type SecureDbHandle,
} from "../security/secureDatabase";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import pt from "../i18n/locales/pt.json";

/** Minimal fake driver: only exists/rename/dbDir matter for recovery. */
class MiniDriver implements SecureDbDriver {
  paths = new Set<string>();
  calls: Array<{ from: string; to: string }> = [];
  failRename = false;

  dbDir(): string {
    return "/fake/";
  }
  async openDb(): Promise<SecureDbHandle> {
    throw new Error("not needed");
  }
  async exists(p: string): Promise<boolean> {
    return this.paths.has(p);
  }
  async remove(p: string): Promise<void> {
    this.paths.delete(p);
  }
  async rename(from: string, to: string): Promise<void> {
    if (this.failRename) throw new Error("fs: rename failed");
    if (!this.paths.has(from)) throw new Error(`no existe: ${from}`);
    this.paths.delete(from);
    this.paths.add(to);
    this.calls.push({ from, to });
  }
  async writeFile(p: string): Promise<void> {
    this.paths.add(p);
  }
}

const DB_MAIN = "/fake/nido_memory.db";

beforeEach(() => {
  setTestSecureBackend(createMemorySecureBackend()); // empty store: no key
  setSecureDbTestDriver(null);
});

describe("routeStartupError — the single App.tsx routing decision", () => {
  it("KeyLossError routes to the explicit recovery screen", () => {
    expect(routeStartupError(new KeyLossError(["nido_memory.db"], "lost"))).toBe(
      "key-loss",
    );
  });

  it("any other error keeps the previous behavior", () => {
    expect(routeStartupError(new Error("boom"))).toBe("proceed");
    expect(routeStartupError(new SecureStoreReadError("nido_db_key", "unreadable"))).toBe("proceed");
    expect(routeStartupError(null)).toBe("proceed");
    expect(routeStartupError(undefined)).toBe("proceed");
    expect(routeStartupError("NIDO_KEY_LOST")).toBe("proceed"); // not the class
  });
});

describe("buildKeyLossViewModel — contract → screen model", () => {
  it("copies the typed contract values, never re-derives them", () => {
    const dbs = ["nido_memory.db", "nido_knowledge.db"];
    const vm = buildKeyLossViewModel(new KeyLossError(dbs, "lost"));
    expect(vm.code).toBe(KEY_LOST_CODE);
    expect(vm.code).toBe("NIDO_KEY_LOST");
    expect(vm.databases).toEqual(dbs);
    // Defensive copy: mutating the model must not touch the error.
    vm.databases.push("evil.db");
    expect(dbs).toEqual(["nido_memory.db", "nido_knowledge.db"]);
  });

  it("binds every required i18n key under the keyRecovery namespace", () => {
    const vm = buildKeyLossViewModel(new KeyLossError(["nido_memory.db"], "lost"));
    expect(Object.keys(vm.copy).sort()).toEqual([...KEY_RECOVERY_COPY_KEYS].sort());
    for (const k of KEY_RECOVERY_COPY_KEYS) {
      expect(vm.copy[k]).toBe(`keyRecovery.${k}`);
    }
  });
});

describe("advanceRecoveryPhase — double-confirmation machine", () => {
  it("explaining → begin → confirming (first explicit gesture)", () => {
    expect(advanceRecoveryPhase("explaining", "begin")).toBe("confirming");
  });

  it("execution is unreachable without BOTH gestures", () => {
    // A stray "confirm" from the explaining phase cannot jump to execution.
    expect(advanceRecoveryPhase("explaining", "confirm")).toBe("explaining");
    expect(advanceRecoveryPhase("explaining", "succeeded")).toBe("explaining");
    expect(advanceRecoveryPhase("explaining", "errored")).toBe("explaining");
    // From confirming, only "confirm" (second gesture) executes.
    expect(advanceRecoveryPhase("confirming", "begin")).toBe("confirming");
    expect(advanceRecoveryPhase("confirming", "succeeded")).toBe("confirming");
    expect(advanceRecoveryPhase("confirming", "errored")).toBe("confirming");
  });

  it("confirming → confirm → executing; cancel returns to explaining", () => {
    expect(advanceRecoveryPhase("confirming", "confirm")).toBe("executing");
    expect(advanceRecoveryPhase("confirming", "cancel")).toBe("explaining");
  });

  it("executing → succeeded → done (terminal); errored → failed", () => {
    expect(advanceRecoveryPhase("executing", "succeeded")).toBe("done");
    expect(advanceRecoveryPhase("executing", "errored")).toBe("failed");
    expect(advanceRecoveryPhase("done", "begin")).toBe("done");
    expect(advanceRecoveryPhase("done", "retry")).toBe("done");
  });

  it("failed → retry returns to confirming, never straight to executing", () => {
    expect(advanceRecoveryPhase("failed", "retry")).toBe("confirming");
    expect(advanceRecoveryPhase("failed", "confirm")).toBe("failed");
    expect(advanceRecoveryPhase("failed", "begin")).toBe("failed");
  });
});

describe("executeKeyLossRecovery — the only confirmed:true call site", () => {
  it("invokes recover exactly once with confirmed: true", async () => {
    const recover = vi.fn(async () => ({ archived: [] as string[] }));
    await executeKeyLossRecovery({ recover });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith({ confirmed: true });
  });

  it("propagates a recovery failure (screen shows failed, nothing hidden)", async () => {
    const recover = vi.fn(async () => {
      throw new Error("fs: rename failed");
    });
    await expect(executeKeyLossRecovery({ recover })).rejects.toThrow(
      "fs: rename failed",
    );
  });
});

describe("integration — KeyLossError → screen → explicit confirm → real recoverFromKeyLoss", () => {
  it("full chain: typed error → routing → view model → double confirm → archived (never destroyed)", async () => {
    const driver = new MiniDriver();
    driver.paths.add(DB_MAIN);
    driver.paths.add(`${DB_MAIN}-wal`);
    setSecureDbTestDriver(driver);

    // 1. Produce a REAL KeyLossError through the production contract
    //    (empty SecureStore + managed DB present → N4 behavior).
    const { getDatabaseKeyHex } = await import("../privacy/keyManager");
    let caught: unknown = null;
    try {
      await getDatabaseKeyHex();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KeyLossError);
    const keyLoss = caught as KeyLossError;
    expect(keyLoss.code).toBe("NIDO_KEY_LOST");

    // 2. App.tsx routing decision.
    expect(routeStartupError(keyLoss)).toBe("key-loss");

    // 3. Screen model binds the contract's database list.
    const vm = buildKeyLossViewModel(keyLoss);
    expect(vm.databases).toContain("nido_memory.db");

    // 4. Double confirmation: execution unreachable before both gestures.
    let phase = advanceRecoveryPhase("explaining", "confirm");
    expect(phase).not.toBe("executing");
    phase = advanceRecoveryPhase("explaining", "begin");
    phase = advanceRecoveryPhase(phase, "confirm");
    expect(phase).toBe("executing");

    // 5. The REAL recoverFromKeyLoss runs with confirmed: true —
    //    archives (renames), never deletes.
    const calls: Array<{ confirmed: boolean }> = [];
    const wrapped = async (opts: { confirmed: boolean }) => {
      calls.push({ confirmed: opts.confirmed });
      return recoverFromKeyLoss(opts);
    };
    await executeKeyLossRecovery({ recover: wrapped });
    expect(calls).toEqual([{ confirmed: true }]);
    expect(driver.calls.length).toBeGreaterThan(0);
    // Original paths are gone, archived copies exist: nothing destroyed.
    expect(driver.paths.has(DB_MAIN)).toBe(false);
    const archived = [...driver.paths].filter((p) => p.includes(".keyloss-"));
    expect(archived.length).toBe(driver.calls.length);
  });
});

describe("i18n — keyRecovery copy parity EN/ES/PT + honesty", () => {
  const locales = { en, es, pt } as const;

  it("keyRecovery exists in all three locales with every required key, non-empty", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const kr = (locale as Record<string, unknown>)["keyRecovery"] as Record<
        string,
        unknown
      >;
      expect(kr, `${name} missing keyRecovery`).toBeDefined();
      for (const k of KEY_RECOVERY_COPY_KEYS) {
        expect(typeof kr[k], `${name}.keyRecovery.${k}`).toBe("string");
        expect((kr[k] as string).trim().length, `${name}.keyRecovery.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("ES/PT are real translations, not English copy-paste", () => {
    const enKr = (en as unknown as Record<string, Record<string, string>>)["keyRecovery"];
    const esKr = (es as unknown as Record<string, Record<string, string>>)["keyRecovery"];
    const ptKr = (pt as unknown as Record<string, Record<string, string>>)["keyRecovery"];
    for (const k of KEY_RECOVERY_COPY_KEYS) {
      if (k === "cancel") continue; // cognate allowed
      expect(esKr[k], `es.${k}`).not.toBe(enKr[k]);
      expect(ptKr[k], `pt.${k}`).not.toBe(enKr[k]);
    }
  });

  it("honesty: the copy never implies the key can be recovered", () => {
    const enKr = (en as unknown as Record<string, Record<string, string>>)["keyRecovery"];
    const esKr = (es as unknown as Record<string, Record<string, string>>)["keyRecovery"];
    const ptKr = (pt as unknown as Record<string, Record<string, string>>)["keyRecovery"];
    // The "cannot recover the key" line must carry an explicit negation.
    expect(enKr["cannotRecoverKey"].toLowerCase()).toMatch(/cannot|can't|never/);
    expect(esKr["cannotRecoverKey"].toLowerCase()).toMatch(/no puede|nunca|jam/);
    expect(ptKr["cannotRecoverKey"].toLowerCase()).toMatch(/n\u00e3o pode|nunca|jamais/);
    // No locale may promise key recovery anywhere in the screen copy.
    const all = [enKr, esKr, ptKr].flatMap((kr) => Object.values(kr).join(" "));
    for (const text of all) {
      expect(text.toLowerCase()).not.toMatch(
        /nido (will|can) recover (the|your) key|recuperar[aá] (la|a) chave|will restore your key/,
      );
    }
  });
});

describe("wiring — cross-component assertions (R3-style source checks)", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");

  it("App.tsx routes KeyLossError to the recovery screen at startup", () => {
    const src = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf-8");
    expect(src).toContain("routeStartupError");
    expect(src).toContain('"key-loss"');
    expect(src).toContain("KeyLossRecoveryScreen");
    expect(src).toContain("getDatabaseKeyHex");
    expect(src).toContain("enterKeyLossIfNeeded");
  });

  it("KeyLossRecoveryScreen wires the real recovery behind the double confirm — no silent path", () => {
    const src = fs.readFileSync(
      path.join(repoRoot, "src", "ui", "KeyLossRecoveryScreen.tsx"),
      "utf-8",
    );
    expect(src).toContain("recoverFromKeyLoss");
    expect(src).toContain("executeKeyLossRecovery");
    expect(src).toContain("confirmed: true");
    expect(src).not.toContain("confirmed: false");
    // The recovery call is gated by the confirmation machine phases.
    expect(src).toContain("advanceRecoveryPhase");
  });
});
