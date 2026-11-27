/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.118: todo botón responde al toque (onda + atenuado) salvo que pinte
// su propio estado pulsado o esté desactivado.
import { describe, it, expect } from "@jest/globals";
import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Pressable, pressedStyle, rippleFor, PRESSED_OPACITY, RIPPLE_COLOR } from "./Pressable";

const flat = (s: unknown): Record<string, unknown> =>
  Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean).map(flat)) : ((s as Record<string, unknown>) ?? {});

describe("Pressable con respuesta al toque", () => {
  it("se atenúa mientras se pulsa y vuelve al soltar", () => {
    const base = { padding: 4 };
    expect(flat(pressedStyle(base, { pressed: true, hovered: false } as any, false)).opacity).toBe(PRESSED_OPACITY);
    expect(flat(pressedStyle(base, { pressed: false, hovered: false } as any, false)).opacity).toBeUndefined();
  });

  it("un botón desactivado no se atenúa", () => {
    expect(flat(pressedStyle({}, { pressed: true, hovered: false } as any, true)).opacity).toBeUndefined();
  });

  it("respeta el estado pulsado propio (style como función)", () => {
    const own = ({ pressed }: { pressed: boolean }) => ({ backgroundColor: pressed ? "red" : "blue" });
    expect(flat(pressedStyle(own as any, { pressed: true, hovered: false } as any, false))).toEqual({ backgroundColor: "red" });
  });

  it("lleva onda de Android por defecto, y la propia si se pasa", () => {
    expect(rippleFor(undefined, false)).toEqual({ color: RIPPLE_COLOR, foreground: true });
    expect(rippleFor({ color: "#f00" }, false)).toEqual({ color: "#f00" });
    expect(rippleFor(undefined, true)).toBeUndefined();
  });

  it("sigue siendo un botón que se pulsa", async () => {
    const { fireEvent } = require("@testing-library/react-native");
    let n = 0;
    await render(<Pressable accessibilityRole="button" onPress={() => n++}><Text>Pulsa</Text></Pressable>);
    await fireEvent.press(screen.getByText("Pulsa"));
    expect(n).toBe(1);
  });
});
