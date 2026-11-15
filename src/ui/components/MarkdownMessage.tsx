/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Share } from "react-native";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { useTheme } from "../theme";
import { spacing, radii } from "../theme/spacing";
import type { VerbatimSpan } from "../../rag/provenance";

interface Props {
  content: string;
  isStreaming?: boolean;
  /**
   * Programa bounty, tanda 1 (color por fuente): el color de cada
   * fuente por su número de cita — citationColors[0] tiñe «[1]», etc.
   * Sin la lista, los marcadores se pintan como texto normal.
   */
  citationColors?: string[];
  /**
   * T-17 (0.1.99): los tramos del texto que son CITA literal (la
   * guía tal cual, o la frase que el juez sustituyó por la fuente),
   * calculados por provenance.verbatimSpans contra el texto
   * guardado. Un tramo se pinta con comilla de apertura y fondo
   * sutil del color de su fuente. Sin la prop, el render es el de
   * siempre, byte a byte. Un tramo que no se encuentra tal cual en
   * la línea que se pinta no se marca: sin marca, nunca marca falsa.
   */
  verbatimSpans?: VerbatimSpan[];
}

interface Block {
  type: "text" | "code";
  content: string;
  language?: string;
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      type: "code",
      language: match[1]?.trim() || "CODE",
      content: match[2]?.replace(/\n$/, "") || "",
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    blocks.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  return blocks;
}

function CodeBlockView({
  code,
  language,
  colors,
  typography,
}: {
  code: string;
  language?: string;
  colors: any;
  typography: any;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      impact(ImpactFeedbackStyle.Light);
      await Share.share({ message: code });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <View
      style={[
        styles.codeBlock,
        {
          backgroundColor: colors.bg.terminal,
          borderColor: colors.border.default,
        },
      ]}
    >
      <View
        style={[
          styles.codeHeader,
          {
            backgroundColor: colors.bg.cardElevated,
            borderBottomColor: colors.border.default,
          },
        ]}
      >
        <View style={styles.codeHeaderLeft}>
          <View
            style={[
              styles.codeIndicatorDot,
              { backgroundColor: colors.emerald[400] },
            ]}
          />
          <Text
            style={[
              typography.mono.xs,
              { color: colors.text.secondary, fontWeight: "700" },
            ]}
          >
            {(language || "plaintext").toUpperCase()}
          </Text>
        </View>
        <Pressable accessibilityRole="button"
          style={[
            styles.copyBtn,
            { backgroundColor: colors.bg.subtle },
            copied && {
              backgroundColor: colors.emerald.bgSubtle,
              borderColor: colors.emerald.border,
              borderWidth: 1,
            },
          ]}
          onPress={handleCopy}
          hitSlop={8}
        >
          <Text
            style={[
              typography.mono.xs,
              {
                color: copied ? colors.text.accentEmerald : colors.text.muted,
                fontWeight: "700",
              },
            ]}
          >
            {copied ? "✓ SHARED" : "COPY / SHARE"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.codeBody}>
        <Text
          style={[
            typography.mono.sm,
            { color: colors.text.primary, lineHeight: 19 },
          ]}
          selectable
        >
          {code}
        </Text>
      </View>
    </View>
  );
}

export function MarkdownMessage({ content, isStreaming, citationColors, verbatimSpans }: Props) {
  const { colors, typography } = useTheme();
  const blocks = parseBlocks(content);

  const renderInlineParts = (text: string, keyPrefix: string) => {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[\d+\])/g);
    return parts.map((part, index) => {
      const key = `${keyPrefix}${index}`;
      // Marcador de cita con el color de su fuente (el número manda:
      // quien no distinga el color sigue pudiendo seguir el [n] hasta
      // la píldora del mismo número en las notas de fuentes).
      const cite = /^\[(\d+)\]$/.exec(part);
      if (cite && citationColors) {
        const color = citationColors[Number(cite[1]) - 1];
        if (color) {
          return (
            <Text
              key={key}
              style={[typography.ui.bodyLg, { color, fontWeight: "800" }]}
              selectable
            >
              {part}
            </Text>
          );
        }
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        const codeSnippet = part.slice(1, -1);
        return (
          <Text
            key={key}
            style={[
              typography.mono.sm,
              styles.inlineCode,
              {
                backgroundColor: colors.bg.subtle,
                color: colors.text.accentCyan,
                borderColor: colors.cyan.border,
              },
            ]}
            selectable
          >
            {codeSnippet}
          </Text>
        );
      }
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        const boldText = part.slice(2, -2);
        return (
          <Text
            key={key}
            style={[
              typography.ui.bodyLg,
              { fontWeight: "800", color: colors.text.heading },
            ]}
            selectable
          >
            {boldText}
          </Text>
        );
      }
      return (
        <Text
          key={key}
          style={[typography.ui.bodyLg, { color: colors.text.primary }]}
          selectable
        >
          {part}
        </Text>
      );
    });
  };

  /**
   * T-17: trocea la línea en tramos normales y tramos de cita. La
   * búsqueda es secuencial y exacta dentro de la línea: un tramo de
   * cita que no aparece tal cual en esta línea no se marca aquí.
   * Sin prop (o sin ningún tramo en la línea), el resultado es el
   * render en línea de siempre.
   */
  const renderInline = (text: string) => {
    if (!verbatimSpans || verbatimSpans.length === 0) return renderInlineParts(text, "");
    const segments: { text: string; span?: VerbatimSpan }[] = [];
    let rest = text;
    for (const span of verbatimSpans) {
      const at = rest.indexOf(span.text);
      if (at < 0) continue;
      if (at > 0) segments.push({ text: rest.slice(0, at) });
      segments.push({ text: span.text, span });
      rest = rest.slice(at + span.text.length);
    }
    if (rest.length > 0) segments.push({ text: rest });
    if (!segments.some((s) => s.span)) return renderInlineParts(text, "");
    const out: React.ReactNode[] = [];
    segments.forEach((seg, i) => {
      if (!seg.span) {
        out.push(...renderInlineParts(seg.text, `s${i}-`));
        return;
      }
      const citeColor =
        seg.span.n != null && citationColors ? citationColors[seg.span.n - 1] : undefined;
      const backgroundColor =
        citeColor && /^#[0-9A-Fa-f]{6}$/.test(citeColor) ? `${citeColor}26` : colors.bg.subtle;
      out.push(
        <Text key={`v${i}`} style={{ backgroundColor }}>
          <Text style={[typography.ui.bodyLg, { color: colors.text.primary }]}>«</Text>
          {renderInlineParts(seg.text, `v${i}-`)}
        </Text>,
      );
    });
    return out;
  };

  return (
    <View style={styles.container}>
      {blocks.map((block, idx) => {
        if (block.type === "code") {
          return (
            <CodeBlockView
              key={idx}
              code={block.content}
              language={block.language}
              colors={colors}
              typography={typography}
            />
          );
        }

        const lines = block.content.split("\n");
        return (
          <View key={idx} style={styles.paragraphContainer}>
            {lines.map((line, lineIdx) => {
              const trimmed = line.trim();
              if (trimmed.startsWith("### ")) {
                return (
                  <Text
                    key={lineIdx}
                    style={[
                      typography.ui.titleSm,
                      { color: colors.text.accentCyan, marginTop: 4, marginBottom: 2 },
                    ]}
                  >
                    {trimmed.slice(4)}
                  </Text>
                );
              }
              if (trimmed.startsWith("## ")) {
                return (
                  <Text
                    key={lineIdx}
                    style={[
                      typography.ui.title,
                      { color: colors.text.heading, marginTop: 6, marginBottom: 2 },
                    ]}
                  >
                    {trimmed.slice(3)}
                  </Text>
                );
              }
              if (trimmed.startsWith("# ")) {
                return (
                  <Text
                    key={lineIdx}
                    style={[
                      typography.ui.titleLg,
                      { color: colors.text.heading, marginTop: 8, marginBottom: 4 },
                    ]}
                  >
                    {trimmed.slice(2)}
                  </Text>
                );
              }
              if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                return (
                  <View key={lineIdx} style={styles.bulletRow}>
                    <Text
                      style={[
                        typography.ui.body,
                        { color: colors.text.accentEmerald, fontWeight: "800" },
                      ]}
                    >
                      •
                    </Text>
                    <Text style={styles.bulletText}>{renderInline(trimmed.slice(2))}</Text>
                  </View>
                );
              }

              return (
                <Text key={lineIdx} style={[typography.ui.bodyLg, { color: colors.text.primary }]}>
                  {renderInline(line)}
                </Text>
              );
            })}
          </View>
        );
      })}

      {isStreaming && (
        <View style={styles.cursorRow}>
          <View
            style={[
              styles.streamingCursor,
              { backgroundColor: colors.emerald[400] },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  paragraphContainer: {
    gap: 4,
  },
  inlineCode: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.xs,
    borderWidth: 1,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingLeft: spacing.xs,
    gap: 6,
    marginVertical: 1,
  },
  bulletText: {
    flex: 1,
  },
  codeBlock: {
    borderRadius: radii.md,
    overflow: "hidden",
    marginVertical: spacing.xs,
    borderWidth: 1,
  },
  codeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  codeHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  codeIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  copyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.xs,
  },
  codeBody: {
    padding: spacing.sm,
  },
  cursorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  streamingCursor: {
    width: 8,
    height: 18,
    borderRadius: 2,
    opacity: 0.85,
  },
});
