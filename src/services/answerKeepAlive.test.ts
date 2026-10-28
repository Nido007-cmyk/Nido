/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("download-wake-lock", () => ({
  startAnsweringKeepAlive: (title: string) => {
    calls.push(`start:${title}`);
    return true;
  },
  stopAnsweringKeepAlive: () => {
    calls.push("stop");
  },
}));
vi.mock("../i18n", () => ({ default: { t: (k: string) => k } }));

import { _activeAnswerKeepAlives, holdAnswerKeepAlive } from "./answerKeepAlive";

describe("answerKeepAlive (0.1.55)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("un servicio para varias respuestas a la vez; se para con la última", () => {
    const a = holdAnswerKeepAlive();
    const b = holdAnswerKeepAlive();
    expect(calls).toEqual(["start:answering.title"]);
    a();
    expect(calls).toEqual(["start:answering.title"]);
    b();
    expect(calls).toEqual(["start:answering.title", "stop"]);
    expect(_activeAnswerKeepAlives()).toBe(0);
  });

  it("terminar dos veces no descuadra la cuenta", () => {
    const a = holdAnswerKeepAlive();
    a();
    a();
    expect(_activeAnswerKeepAlives()).toBe(0);
    const b = holdAnswerKeepAlive();
    expect(_activeAnswerKeepAlives()).toBe(1);
    b();
    expect(calls).toEqual(["start:answering.title", "stop", "start:answering.title", "stop"]);
  });
});
