/**
 * NegotiationCard — Calm Agent UI for P2P task negotiation.
 *
 * Shows:
 * - Who requests collaboration (peer identity)
 * - Requested task
 * - Requested capabilities/scopes
 * - Expiration
 * - Allow / Counter / Decline actions
 *
 * Used when a PROPOSE arrives from a peer NIDO.
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme";
import type { Colors } from "../../theme/colors";
import { typography } from "../../theme/typography";
import { spacing, radii } from "../../theme/spacing";
import { NidoIcon } from "../icons/NidoIcon";
import type { TaskProposal } from "../../../p2p/negotiation";

interface Props {
  proposal: TaskProposal;
  peerName: string;
  peerPkShort: string;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: (modifiedScopes: string[]) => void;
  processing?: boolean;
}

export function NegotiationCard({
  proposal,
  peerName,
  peerPkShort,
  onAccept,
  onDecline,
  onCounter,
  processing = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const [counterMode, setCounterMode] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(proposal.requestedScopes);

  const expiresIn = Math.max(0, proposal.expiresAt - Date.now());
  const expiresMinutes = Math.ceil(expiresIn / 60000);

  // Human-readable scope labels (avoids i18n namespace separator issue with ':')
  const scopeLabels = t("negotiationCard.scopeLabels", { returnObjects: true }) as Record<string, string>;
  const scopeLabel = (scope: string): string =>
    (scopeLabels && scopeLabels[scope]) || scope;

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  return (
    <View style={styles.container} accessibilityRole="alert">
      {/* Header: who */}
      <View style={styles.header}>
        <NidoIcon name="pairing" size={20} />
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {t("negotiationCard.title", { name: peerName })}
          </Text>
          <Text style={styles.verifiedLabel}>
            {t("negotiationCard.verifiedPeer")}
          </Text>
        </View>
      </View>

      {/* Task description */}
      <Text style={styles.taskDescription}>{proposal.taskDescription}</Text>

      {/* Requested capabilities - human-readable labels */}
      <Text style={styles.sectionTitle}>{t("negotiationCard.requestedAccess")}</Text>
      <View style={styles.scopes}>
        {proposal.requestedScopes.map((scope) => {
          const label = scopeLabel(scope);
          return (
            <TouchableOpacity
              key={scope}
              style={[
                styles.scopeChip,
                counterMode && selectedScopes.includes(scope) && styles.scopeChipSelected,
                counterMode && !selectedScopes.includes(scope) && styles.scopeChipDeselected,
              ]}
              onPress={() => counterMode && toggleScope(scope)}
              disabled={!counterMode || processing}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selectedScopes.includes(scope) }}
              accessibilityLabel={label}
            >
              <Text style={styles.scopeText}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {counterMode && (
        <Text style={styles.counterHint}>{t("negotiationCard.counterHint")}</Text>
      )}

      {/* Expiration */}
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>{t("negotiationCard.expiresIn")}</Text>
        <Text style={styles.metaValue}>
          {t("negotiationCard.minutes", { count: expiresMinutes })}
        </Text>
      </View>

      {/* Actions */}
      {!counterMode ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.declineButton]}
            onPress={onDecline}
            disabled={processing}
            accessibilityRole="button"
          >
            <Text style={styles.declineText}>{t("negotiationCard.decline")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.counterButton]}
            onPress={() => setCounterMode(true)}
            disabled={processing}
            accessibilityRole="button"
          >
            <Text style={styles.counterText}>{t("negotiationCard.counter")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.acceptButton]}
            onPress={onAccept}
            disabled={processing}
            accessibilityRole="button"
          >
            <Text style={styles.acceptText}>{t("negotiationCard.accept")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.declineButton]}
            onPress={() => {
              setCounterMode(false);
              setSelectedScopes(proposal.requestedScopes);
            }}
            disabled={processing}
            accessibilityRole="button"
          >
            <Text style={styles.declineText}>{t("negotiationCard.cancel")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.acceptButton]}
            onPress={() => onCounter(selectedScopes)}
            disabled={processing || selectedScopes.length === 0}
            accessibilityRole="button"
          >
            <Text style={styles.acceptText}>{t("negotiationCard.sendCounter")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const getStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      backgroundColor: colors.bg.card,
      borderRadius: radii.lg,
      padding: spacing.lg,
      marginVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.text.accentAmber,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    headerText: {
      flex: 1,
    },
    title: {
      ...typography.ui.body,
      fontWeight: "600",
      color: colors.text.primary,
    },
    peerKey: {
      ...typography.ui.caption,
      color: colors.text.dim,
      fontFamily: "monospace",
    },
    verifiedLabel: {
      ...typography.ui.caption,
      color: colors.text.accentEmerald,
      fontWeight: "600",
    },
    taskDescription: {
      ...typography.ui.subtext,
      color: colors.text.secondary,
      marginBottom: spacing.md,
    },
    sectionTitle: {
      ...typography.ui.caption,
      color: colors.text.dim,
      marginBottom: spacing.xs,
    },
    scopes: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    scopeChip: {
      backgroundColor: colors.bg.subtle,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    scopeChipSelected: {
      backgroundColor: colors.emerald.bgSubtle,
      borderWidth: 1,
      borderColor: colors.emerald.border,
    },
    scopeChipDeselected: {
      opacity: 0.5,
    },
    scopeText: {
      ...typography.ui.caption,
      color: colors.text.secondary,
    },
    counterHint: {
      ...typography.ui.caption,
      color: colors.text.dim,
      fontStyle: "italic",
      marginBottom: spacing.sm,
    },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: spacing.md,
    },
    metaLabel: {
      ...typography.ui.caption,
      color: colors.text.dim,
    },
    metaValue: {
      ...typography.ui.caption,
      color: colors.text.secondary,
      fontWeight: "500",
    },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    button: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      alignItems: "center",
    },
    declineButton: {
      backgroundColor: colors.bg.subtle,
    },
    declineText: {
      ...typography.ui.body,
      color: colors.text.secondary,
      fontWeight: "500",
    },
    counterButton: {
      backgroundColor: colors.bg.subtle,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    counterText: {
      ...typography.ui.body,
      color: colors.text.primary,
      fontWeight: "500",
    },
    acceptButton: {
      backgroundColor: colors.emerald[400],
    },
    acceptText: {
      ...typography.ui.body,
      color: "#FFFFFF",
      fontWeight: "600",
    },
  });
