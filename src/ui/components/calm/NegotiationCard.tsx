/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
import type { Typography } from "../../theme/typography";
import { spacing, radii } from "../../theme/spacing";
import { NidoIcon } from "../icons/NidoIcon";
import { NidoMascot } from "./NidoMascot";
import type { TaskProposal } from "../../../p2p/negotiation";

/** Respuesta pendiente de entrega (del servicio): estado honesto, no éxito. */
export interface PendingSendInfo {
  action: "ACCEPT" | "DECLINE" | "COUNTER";
  attempts: number;
}

interface Props {
  proposal: TaskProposal;
  peerName: string;
  peerPkShort: string;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: (modifiedScopes: string[]) => void;
  /** Reintento de una respuesta que no llegó al peer (mismos bytes firmados). */
  onRetry?: () => void;
  /** Si existe, la tarjeta muestra "No enviado / Reintentar" en vez de éxito. */
  pendingSend?: PendingSendInfo | null;
  processing?: boolean;
}

export function NegotiationCard({
  proposal,
  peerName,
  peerPkShort,
  onAccept,
  onDecline,
  onCounter,
  onRetry,
  pendingSend = null,
  processing = false,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t, i18n } = useTranslation();
  const [counterMode, setCounterMode] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(proposal.requestedScopes);

  const expiresIn = Math.max(0, proposal.expiresAt - Date.now());
  const expiresMinutes = Math.ceil(expiresIn / 60000);

  // Human-readable scope labels. NOTE: these are intentionally NOT read via
  // i18n returnObjects — i18next's default nsSeparator (":") corrupts the
  // lookup for keys containing ":" (its returnObjects path re-translates each
  // nested key, so "read:notes" is parsed as namespace "…read" + key "notes").
  // The fixed technical scope set is mapped here directly, bilingual.
  const SCOPE_LABELS: Record<string, { es: string; en: string }> = {
    "read:notes": { es: "Leer notas", en: "Read notes" },
    "read:knowledge": { es: "Leer base de conocimiento", en: "Read knowledge base" },
    "read:contacts": { es: "Leer contactos", en: "Read contacts" },
    "read:reminders": { es: "Leer recordatorios", en: "Read reminders" },
    "write:notes": { es: "Escribir notas", en: "Write notes" },
    "write:reminder": { es: "Crear recordatorios", en: "Create reminders" },
    "write:reminders": { es: "Crear recordatorios", en: "Create reminders" },
  };
  const scopeLabel = (scope: string): string => {
    const entry = SCOPE_LABELS[scope];
    if (entry) {
      return i18n.language?.startsWith("es") ? entry.es : entry.en;
    }
    return scope;
  };

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

      {/* Actions — o estado honesto "No enviado / Reintentar" si el envío falló.
          El estado visible nunca afirma éxito sin entrega confirmada. */}
      {pendingSend ? (
        <View
          style={styles.retryRow}
          accessibilityRole="alert"
          accessibilityLabel={t("negotiationCard.notSentTitle")}
        >
          <NidoMascot role="recovery" size={44} />
          <View style={styles.retryTextCol}>
            <Text style={styles.retryTitle}>{t("negotiationCard.notSentTitle")}</Text>
            <Text style={styles.retryDesc}>{t("negotiationCard.notSentDesc")}</Text>
          </View>
          <TouchableOpacity
            style={[styles.button, styles.retryButton]}
            onPress={onRetry}
            disabled={processing || !onRetry}
            accessibilityRole="button"
            accessibilityLabel={t("negotiationCard.retry")}
          >
            <Text style={styles.retryButtonText}>{t("negotiationCard.retry")}</Text>
          </TouchableOpacity>
        </View>
      ) : !counterMode ? (
        <View style={styles.actions}>
          <TouchableOpacity accessibilityLabel={t("negotiationCard.decline")}
            style={[styles.button, styles.declineButton]}
            onPress={onDecline}
            disabled={processing}
            accessibilityRole="button"
          >
            <Text style={styles.declineText}>{t("negotiationCard.decline")}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel={t("negotiationCard.counter")}
            style={[styles.button, styles.counterButton]}
            onPress={() => setCounterMode(true)}
            disabled={processing}
            accessibilityRole="button"
          >
            <Text style={styles.counterText}>{t("negotiationCard.counter")}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel={t("negotiationCard.accept")}
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
          <TouchableOpacity accessibilityLabel={t("negotiationCard.cancel")}
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
          <TouchableOpacity accessibilityLabel={t("negotiationCard.sendCounter")}
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

const getStyles = (colors: Colors, typography: Typography) =>
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
      minHeight: 44,
      justifyContent: "center",
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
      minHeight: 44,
      justifyContent: "center",
    },
    counterText: {
      ...typography.ui.body,
      color: colors.text.primary,
      fontWeight: "500",
    },
    acceptButton: {
      backgroundColor: colors.emerald[400],
      minHeight: 44,
      justifyContent: "center",
    },
    acceptText: {
      ...typography.ui.body,
      color: colors.text.inverse,
      fontWeight: "600",
    },
    retryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.bg.subtle,
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: radii.md,
      padding: spacing.sm,
    },
    retryTextCol: {
      flex: 1,
    },
    retryTitle: {
      ...typography.ui.body,
      color: colors.text.primary,
      fontWeight: "600",
    },
    retryDesc: {
      ...typography.ui.subtext,
      color: colors.text.secondary,
    },
    retryButton: {
      backgroundColor: colors.emerald[400],
      // OJO: no usar `flex: 0` aquí — react-native-web lo compila a
      // `flex: 0 1 0%` y el botón colapsa al padding recortando el texto.
      // Explícito = content-size en nativo y en web.
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: "auto",
      paddingHorizontal: spacing.md,
      minHeight: 44,
      justifyContent: "center",
    },
    retryButtonText: {
      ...typography.ui.body,
      color: colors.text.inverse,
      fontWeight: "600",
    },
  });
