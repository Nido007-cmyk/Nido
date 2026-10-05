import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { ProcessingIndicator } from "../ProcessingIndicator";
import { useTheme } from "../theme";

const PEEK_CHARS = 140;

/** The latest bit of reasoning, for a one-line ticker. */
function latestLine(thinking: string): string {
  const lines = thinking.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return last.length > PEEK_CHARS ? `…${last.slice(-PEEK_CHARS)}` : last;
}

/**
 * Shown while a reasoning model is still thinking, before its answer
 * starts: the same "thinking" indicator as before the first token, with
 * elapsed time and a faded one-line peek at the latest reasoning. Tapping
 * toggles the full reasoning (rendered by the caller).
 */
export function ReasoningPeek({
  thinking,
  expanded,
  onToggle,
}: {
  thinking: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const startedAt = useRef(Date.now());
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const peek = latestLine(thinking);

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={expanded ? t("chatScreen.hideReasoning") : t("chatScreen.showReasoning")}
    >
      <ProcessingIndicator status="thinking" label={t("chatScreen.reasoningElapsed", { seconds })} />
      {!expanded && peek.length > 0 && (
        <Text style={[styles.peek, { color: colors.text.dim }]} numberOfLines={1} ellipsizeMode="head">
          {peek}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  peek: {
    fontSize: 12,
    fontStyle: "italic",
    opacity: 0.7,
    marginTop: 2,
  },
});
