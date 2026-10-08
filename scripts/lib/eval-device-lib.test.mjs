/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  buildRequest,
  commands,
  devClientUrl,
  formatProgress,
  isDebuggable,
  isPackageListed,
  parseAdbDevices,
  parseArgs,
  resultDir,
  selectDevice,
} from "./eval-device-lib.mjs";

describe("parseArgs", () => {
  it("defaults to everything installed, with reload on", () => {
    expect(parseArgs([])).toMatchObject({ models: undefined, adaptive: false, queries: undefined, pkg: "team.nido.app", reload: true, dryRun: false, timeoutMin: 240 });
  });

  it("parses selections and flags", () => {
    const o = parseArgs(["--models", "qwen2.5-1.5b, phi-3.5", "--adaptive", "--queries", "greeting-1,reasoning", "--serial", "ABC", "--no-reload", "--dry-run", "--timeout-min", "30"]);
    expect(o).toMatchObject({ models: ["qwen2.5-1.5b", "phi-3.5"], adaptive: true, queries: ["greeting-1", "reasoning"], serial: "ABC", reload: false, dryRun: true, timeoutMin: 30 });
  });

  it("rejects unknown options, missing values and bad values", () => {
    expect(() => parseArgs(["--model", "x"])).toThrow(/unknown option/);
    expect(() => parseArgs(["--models"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--models", "--adaptive"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--timeout-min", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["--package", "x; rm -rf /"])).toThrow(/package/);
  });
});

describe("device selection", () => {
  const out = [
    "List of devices attached",
    "SSYLAQFILNBEKBEQ\tdevice",
    "emulator-5554\tunauthorized",
    "R58M\toffline",
    "",
  ].join("\n");

  it("parses adb devices output", () => {
    expect(parseAdbDevices(out)).toEqual([
      { serial: "SSYLAQFILNBEKBEQ", state: "device" },
      { serial: "emulator-5554", state: "unauthorized" },
      { serial: "R58M", state: "offline" },
    ]);
  });

  it("uses the single authorized device", () => {
    expect(selectDevice(parseAdbDevices(out))).toEqual({ serial: "SSYLAQFILNBEKBEQ" });
  });

  it("explains unauthorized, offline, missing and ambiguous devices", () => {
    expect(selectDevice([{ serial: "A", state: "unauthorized" }]).error).toMatch(/Allow USB debugging/);
    expect(selectDevice([{ serial: "A", state: "offline" }]).error).toMatch(/offline/);
    expect(selectDevice([]).error).toMatch(/no Android device/);
    expect(selectDevice([{ serial: "A", state: "device" }, { serial: "B", state: "device" }]).error).toMatch(/--serial/);
    expect(selectDevice([{ serial: "A", state: "device" }, { serial: "B", state: "device" }], "B")).toEqual({ serial: "B" });
    expect(selectDevice([{ serial: "A", state: "device" }], "Z").error).toMatch(/not connected/);
  });
});

describe("commands", () => {
  const cmd = commands({ serial: "S1", pkg: "team.nido.app", slug: "nido-app", requestId: "req-1" });

  it("targets the chosen device", () => {
    expect(cmd.reverse).toEqual(["adb", "-s", "S1", "reverse", "tcp:8081", "tcp:8081"]);
    expect(cmd.readStatus).toEqual(["adb", "-s", "S1", "exec-out", "run-as team.nido.app cat files/eval/requests/req-1.status.json"]);
  });

  it("writes the request as base64 into private storage, with a private umask", () => {
    const request = { requestId: "req-1", models: ["phi-3.5"], queries: ["greeting-1"] };
    const remote = cmd.writeRequest(request)[4];
    expect(remote).toMatch(/^run-as team\.nido\.app sh -c 'umask 077 && mkdir -p files\/eval\/requests && echo [A-Za-z0-9+/=]+ \| base64 -d > files\/eval\/requests\/pending\.json'$/);
    const b64 = /echo ([A-Za-z0-9+/=]+) \|/.exec(remote)[1];
    expect(JSON.parse(Buffer.from(b64, "base64").toString())).toEqual(request);
  });

  it("reloads the dev client from Metro through the adb tunnel", () => {
    expect(devClientUrl("nido-app")).toBe("exp+nido-app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081");
    expect(cmd.reload[4]).toContain(`-d '${devClientUrl("nido-app")}'`);
  });

  it("only reads result files inside files/eval", () => {
    expect(cmd.readResult("files/eval/eval-2026-09-23T10-00-00-000Z.jsonl")[4]).toBe(
      "run-as team.nido.app cat files/eval/eval-2026-09-23T10-00-00-000Z.jsonl"
    );
    expect(() => cmd.readResult("files/eval/../../databases/x.jsonl")).toThrow();
    expect(() => cmd.readResult("files/settings.json")).toThrow();
  });
});

describe("helpers", () => {
  it("detects debuggable, installed packages", () => {
    expect(isDebuggable("    pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_BACKUP ]")).toBe(true);
    expect(isDebuggable("    pkgFlags=[ HAS_CODE ALLOW_BACKUP ]")).toBe(false);
    expect(isPackageListed("package:team.nido.app\n", "team.nido.app")).toBe(true);
    expect(isPackageListed("package:team.nido.app.other\n", "team.nido.app")).toBe(false);
  });

  it("builds minimal requests", () => {
    expect(buildRequest(parseArgs([]), "r")).toEqual({ requestId: "r" });
    expect(buildRequest(parseArgs(["--adaptive"]), "r")).toEqual({ requestId: "r", adaptive: true });
  });

  it("dates result folders and formats progress", () => {
    expect(resultDir("eval-results", new Date(2026, 8, 3))).toBe("eval-results/2026-09-03");
    expect(formatProgress(null)).toMatch(/waiting/);
    expect(formatProgress({ state: "running", completed: 3, total: 17, current: "model:phi / explanation-1" })).toBe("3/17 — model:phi / explanation-1");
    expect(formatProgress({ state: "failed", error: "boom" })).toBe("failed: boom");
  });
});
