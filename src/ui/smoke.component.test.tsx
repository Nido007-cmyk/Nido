// @ts-nocheck
// Smoke test: verifies Jest + @testing-library/react-native infrastructure.
// v14 API: render is async, queries available on result.
import React from "react";
import { Text, View, Pressable } from "react-native";
import { render, fireEvent, screen } from "@testing-library/react-native";

describe("Jest RN infrastructure smoke test", () => {
  it("renders a basic React Native component", async () => {
    await render(
      <View>
        <Text>Hello NIDO</Text>
      </View>
    );
    expect(screen.getByText("Hello NIDO")).toBeTruthy();
  });

  it("handles basic interaction", async () => {
    let pressed = false;
    await render(
      <Pressable
        onPress={() => { pressed = true; }}
        accessibilityLabel="test-button"
        accessibilityRole="button"
      >
        <Text>Tap me</Text>
      </Pressable>
    );
    fireEvent.press(screen.getByText("Tap me"));
    expect(pressed).toBe(true);
  });

  it("resolves accessibility labels", async () => {
    await render(
      <View accessibilityLabel="test-container">
        <Text>Content</Text>
      </View>
    );
    expect(screen.getByLabelText("test-container")).toBeTruthy();
  });
});
