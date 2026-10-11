/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { parseLaunchAction, takeLaunchAction } from "./launchActions";

describe("parseLaunchAction", () => {
  it("acepta solo las acciones conocidas", () => {
    expect(parseLaunchAction({ action: "new_chat" })).toEqual({ action: "new_chat" });
    expect(parseLaunchAction({ action: "p2p" })).toEqual({ action: "p2p" });
    expect(parseLaunchAction({ action: "delete_all" })).toBeNull();
    expect(parseLaunchAction({ action: "send_sms", text: "x" })).toBeNull();
    expect(parseLaunchAction(null)).toBeNull();
    expect(parseLaunchAction("new_chat")).toBeNull();
  });

  it("texto compartido: se limpia, se recorta y nunca vacío", () => {
    expect(parseLaunchAction({ action: "share", text: "  hola\u0007 mundo \n" })).toEqual({
      action: "share",
      text: "hola mundo",
    });
    expect(parseLaunchAction({ action: "share", text: "   " })).toBeNull();
    expect(parseLaunchAction({ action: "share" })).toBeNull();
    const long = "a".repeat(10_000);
    expect((parseLaunchAction({ action: "share", text: long }) as { text: string }).text).toHaveLength(4000);
  });

  it("sin módulo nativo (tests, builds viejas) no lanza", () => {
    expect(takeLaunchAction()).toBeNull();
  });
});
