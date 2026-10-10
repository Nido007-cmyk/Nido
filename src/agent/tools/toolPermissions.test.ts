/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchToolCall } from "./dispatcher";
import { setDisabledTools, setToolDisabled, isToolDisabled, getDisabledTools } from "./toolPermissions";
import { actionLog } from "../actionLog";

afterEach(() => {
  setDisabledTools([]);
  actionLog.clear();
});

describe("tool permissions", () => {
  it("a disabled tool never reaches its handler", async () => {
    const handler = vi.fn(async () => "ok");
    setToolDisabled("device_time", true);
    const out = await dispatchToolCall({ name: "device_time", arguments: {} }, { device_time: handler });
    expect(handler).not.toHaveBeenCalled();
    expect(out).toContain("desactivada");
    expect(actionLog.list()[0]).toMatchObject({ tool: "device_time", outcome: "disabled" });
  });

  it("re-enabling restores the tool and logs the execution", async () => {
    const handler = vi.fn(async () => "12:00");
    setToolDisabled("device_time", true);
    setToolDisabled("device_time", false);
    expect(isToolDisabled("device_time")).toBe(false);
    const out = await dispatchToolCall({ name: "device_time", arguments: {} }, { device_time: handler });
    expect(out).toBe("12:00");
    expect(actionLog.list()[0]).toMatchObject({ tool: "device_time", outcome: "executed", confirmed: false });
  });

  it("the log never stores arguments or results", async () => {
    await dispatchToolCall(
      { name: "save_note", arguments: { title: "secreto-titulo", body: "secreto-cuerpo" } },
      { save_note: async () => "secreto-resultado" },
    );
    expect(JSON.stringify(actionLog.list())).not.toContain("secreto");
  });

  it("an unconfirmed sensitive action is logged as cancelled", async () => {
    const handler = vi.fn(async () => "sent");
    await dispatchToolCall(
      { name: "nido_send_message", arguments: { to: "ana", text: "hola" } },
      { nido_send_message: handler },
    );
    expect(handler).not.toHaveBeenCalled();
    expect(actionLog.list()[0].outcome).toBe("cancelled");
  });

  it("setDisabledTools ignores junk and sorts", () => {
    setDisabledTools(["b", "", "a"]);
    expect(getDisabledTools()).toEqual(["a", "b"]);
  });
});
