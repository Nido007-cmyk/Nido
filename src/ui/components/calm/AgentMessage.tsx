/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * AgentMessage — Calm Agent message bubble
 *
 * Redesigned for NIDO's "Calm Agent" UI (2026-10-05).
 * Not a generic chat bubble — feels like a thoughtful response
 * from someone who knows you.
 *
 * Differences from standard chat UI:
 * - Generous padding, airy feel (not dense)
 * - Subtle background, not stark white/gray
 * - Typography optimized for reading (16px/24px)
 * - Optional memory indicator ("I remember...")
 * - Optional agency receipt (model, timing — collapsible)
 */

import React, { useState, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { calmSpacing, calmRadii, calmType } from "../../theme/calm";
import { MemoryChip } from "./MemoryChip";
import { AgencyReceipt } from "./AgencyReceipt";

export interface AgentMessageProps {
  /** The message text (plain) or custom rendered content */
  text?: string;
  /** Custom rendered content (e.g., MarkdownMessage). Overrides text. */
  children?: ReactNode;
  /** Optional: what NIDO remembered to personalize this */
  memoryContext?: string;
  /** Optional: telemetry for the agency receipt */
  receipt?: {
    model: string;
    tokensPerSecond?: number;
    latencyMs?: number;
    toolsUsed?: string[];
  };
  /** Optional: sources cited in this answer (DR-2) */
  citations?: Array<{
    index: number;
    title: string;
    source?: string;
  }>;
  /** Timestamp */
  timestamp?: number;
}

export function AgentMessage({
  text,
  children,
  memoryContext,
  receipt,
  citations,
  timestamp,
}: AgentMessageProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [showReceipt, setShowReceipt] = useState(false);

  const styles = StyleSheet.create({
    container: {
      marginVertical: calmSpacing.cozy,
      marginHorizontal: calmSpacing.comfortable,
    },
    bubble: {
      backgroundColor: colors.bg.card,
      borderRadius: calmRadii.gentle,
      padding: calmSpacing.comfortable,
      // Subtle, not stark
      borderWidth: 1,
      borderColor: colors.border.subtle,
    },
    text: {
      ...calmType.body,
      color: colors.text.primary,
    },
    citations: {
      marginTop: calmSpacing.cozy,
      paddingTop: calmSpacing.cozy,
      borderTopWidth: 1,
      borderTopColor: colors.border.subtle,
    },
    citationRow: {
      flexDirection: "row",
      marginVertical: 2,
    },
    citationIndex: {
      ...calmType.caption,
      color: colors.text.secondary,
      fontWeight: "600",
      marginRight: calmSpacing.tight,
      minWidth: 24,
    },
    citationText: {
      flex: 1,
    },
    citationTitle: {
      ...calmType.callout,
      color: colors.text.primary,
    },
    citationSource: {
      ...calmType.caption,
      color: colors.text.muted,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: calmSpacing.cozy,
      gap: calmSpacing.tight,
    },
    timestamp: {
      ...calmType.caption,
      color: colors.text.muted,
    },
    receiptToggle: {
      ...calmType.caption,
      color: colors.text.secondary,
      textDecorationLine: "underline",
    },
  });

  return (
    <View style={styles.container}>
      {memoryContext && <MemoryChip text={memoryContext} />}
      <View style={styles.bubble}>
        {children ?? <Text style={styles.text}>{text}</Text>}
        {citations && citations.length > 0 && (
          <View style={styles.citations}>
            {citations.map((cite) => (
              <View key={cite.index} style={styles.citationRow}>
                <Text style={styles.citationIndex}>[{cite.index}]</Text>
                <View style={styles.citationText}>
                  <Text style={styles.citationTitle} numberOfLines={1}>
                    {cite.title}
                  </Text>
                  {cite.source && (
                    <Text style={styles.citationSource} numberOfLines={1}>
                      {cite.source}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
        {(receipt || timestamp) && (
          <View style={styles.footer}>
            {timestamp && (
              <Text style={styles.timestamp}>
                {new Date(timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            )}
            {receipt && (
              <Pressable accessibilityRole="button" onPress={() => setShowReceipt(!showReceipt)}>
                <Text style={styles.receiptToggle}>
                  {showReceipt ? t("calm.hideDetails") : t("calm.showDetails")}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      {receipt && showReceipt && <AgencyReceipt {...receipt} />}
    </View>
  );
}
