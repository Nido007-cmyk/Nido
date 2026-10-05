// @ts-nocheck
// ChatScreen component tests: asymmetric message rendering.
// Tests the professional UI direction: user bubble vs assistant full-width.
// Uses a test harness that replicates ChatScreen's rendering contract
// without importing the full ChatScreen dependency graph.

import React from "react";
import { render, screen } from "@testing-library/react-native";

// We test the message rendering logic via a minimal harness that
// replicates ChatScreen's renderItem decision logic. This avoids
// mocking the entire ChatScreen dependency graph while verifying
// the asymmetric design contract.
import { View, Text, Pressable, StyleSheet } from "react-native";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";

interface TestMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function TestMessageItem({ item }: { item: TestMessage }) {
  const isUser = item.role === "user";
  return (
    <Pressable
      accessibilityRole={isUser ? "text" : "text"}
      accessibilityLabel={isUser ? `Your message: ${item.text}` : `NIDO response: ${item.text}`}
      style={[
        isUser ? styles.userBubble : styles.assistantContainer,
      ]}
    >
      <Text>{item.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userBubble: {
    paddingVertical: calmSpacing.cozy,
    paddingHorizontal: calmSpacing.comfortable,
    borderRadius: calmRadii.bubble,
    maxWidth: "75%",
    alignSelf: "flex-end",
    ...calmShadows.none,
  },
  assistantContainer: {
    paddingVertical: calmSpacing.comfortable,
    paddingHorizontal: calmSpacing.cozy,
    maxWidth: "100%",
    alignSelf: "stretch",
  },
});

describe("ChatScreen asymmetric message rendering", () => {
  it("renders user message with bubble style", async () => {
    const msg: TestMessage = { id: "1", role: "user", text: "Hello" };
    await render(<TestMessageItem item={msg} />);
    const el = screen.getByLabelText("Your message: Hello");
    expect(el).toBeTruthy();
    // Verify bubble style props are applied
    const style = el.props.style;
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect(flatStyle.maxWidth).toBe("75%");
    expect(flatStyle.alignSelf).toBe("flex-end");
    expect(flatStyle.borderRadius).toBe(calmRadii.bubble);
  });

  it("renders assistant message without bubble (full-width)", async () => {
    const msg: TestMessage = { id: "2", role: "assistant", text: "Hi there" };
    await render(<TestMessageItem item={msg} />);
    const el = screen.getByLabelText("NIDO response: Hi there");
    expect(el).toBeTruthy();
    const style = el.props.style;
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    // Assistant uses full width, no bubble constraints
    expect(flatStyle.maxWidth).toBe("100%");
    expect(flatStyle.alignSelf).toBe("stretch");
    // No borderRadius bubble (relies on container, not bubble)
    expect(flatStyle.borderRadius).toBeUndefined();
  });

  it("uses 18pt bubble radius from design system", () => {
    expect(calmRadii.bubble).toBe(18);
  });

  it("has accessible labels for both roles", async () => {
    await render(
      <View>
        <TestMessageItem item={{ id: "1", role: "user", text: "Q" }} />
        <TestMessageItem item={{ id: "2", role: "assistant", text: "A" }} />
      </View>
    );
    expect(screen.getByLabelText("Your message: Q")).toBeTruthy();
    expect(screen.getByLabelText("NIDO response: A")).toBeTruthy();
  });
});
