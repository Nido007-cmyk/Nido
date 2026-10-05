/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * PackShareCard — Calm Agent UI for P2P pack sharing.
 *
 * Shows:
 * - Pack name and size
 * - Peer identity (sender or receiver)
 * - Transfer direction and progress
 * - State-appropriate actions (Accept/Decline/Cancel/Retry)
 *
 * Follows the Calm Agent design language: no technical jargon,
 * clear states, gentle actions.
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme";
import type { Colors } from "../../theme/colors";
import { typography } from "../../theme/typography";
import { spacing, radii } from "../../theme/spacing";
import { NidoIcon } from "../icons/NidoIcon";
import type { PackTransferInfo } from "../../../p2p/packShareService";

interface Props {
  transfer: PackTransferInfo;
  peerName: string;
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  processing?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PackShareCard({
  transfer,
  peerName,
  onAccept,
  onDecline,
  onCancel,
  onRetry,
  processing = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const typo = typography;

  const isSender = transfer.direction === "send";
  const progressPct = Math.round(transfer.progress * 100);

  const stateLabel = useMemo(() => {
    switch (transfer.state) {
      case "offered":
        return isSender ? t("packshare.sentOffer") : t("packshare.receivedOffer");
      case "sending":
        return t("packshare.sending");
      case "receiving":
        return t("packshare.receiving");
      case "complete":
        return t("packshare.complete");
      case "declined":
        return t("packshare.declined");
      case "cancelled":
        return t("packshare.cancelled");
      case "failed":
        return t("packshare.failed");
      default:
        return transfer.state;
    }
  }, [transfer.state, isSender, t]);

  const showProgress = transfer.state === "sending" || transfer.state === "receiving";
  const showAcceptDecline = transfer.state === "offered" && !isSender && onAccept && onDecline;
  const showCancel = (transfer.state === "offered" && isSender) ||
    transfer.state === "sending" || transfer.state === "receiving";
  const showRetry = transfer.state === "failed" && onRetry;

  const dotColor = useMemo(() => {
    switch (transfer.state) {
      case "offered": return colors.text.accentAmber;
      case "sending":
      case "receiving": return colors.text.accentEmerald;
      case "complete": return colors.text.accentEmerald;
      case "failed": return colors.crimson[500];
      default: return colors.text.dim;
    }
  }, [transfer.state, colors]);

  return (
    <View style={styles.card} testID={`packshare-card-${transfer.sessionId}`}>
      <View style={styles.header}>
        <NidoIcon name={isSender ? "external" : "download"} size={20} color={colors.text.secondary} />
        <View style={styles.headerText}>
          <Text style={[typo.ui.body, styles.packName]} numberOfLines={1}>
            {transfer.packName}
          </Text>
          <Text style={[typo.ui.caption, styles.peerLine]} numberOfLines={1}>
            {isSender
              ? t("packshare.toPeer", { peer: peerName })
              : t("packshare.fromPeer", { peer: peerName })}
          </Text>
        </View>
        <Text style={[typo.ui.caption, styles.size]}>{formatBytes(transfer.sizeBytes)}</Text>
      </View>

      <View style={styles.stateRow}>
        <View style={[styles.stateDot, { backgroundColor: dotColor }]} />
        <Text style={[typo.ui.caption, styles.stateLabel]}>{stateLabel}</Text>
        {showProgress && <Text style={[typo.ui.caption, styles.progressText]}>{progressPct}%</Text>}
      </View>

      {showProgress && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
      )}

      {transfer.state === "failed" && transfer.error && (
        <Text style={[typo.ui.caption, styles.errorText]}>{transfer.error}</Text>
      )}

      {(showAcceptDecline || showCancel || showRetry) && (
        <View style={styles.actions}>
          {showAcceptDecline && (
            <>
              <TouchableOpacity
                style={[styles.button, styles.acceptButton]}
                onPress={onAccept}
                disabled={processing}
                testID={`packshare-accept-${transfer.sessionId}`}
              >
                <Text style={[typo.ui.body, styles.acceptText]}>{t("packshare.accept")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.declineButton]}
                onPress={onDecline}
                disabled={processing}
                testID={`packshare-decline-${transfer.sessionId}`}
              >
                <Text style={[typo.ui.body, styles.declineText]}>{t("packshare.decline")}</Text>
              </TouchableOpacity>
            </>
          )}
          {showCancel && onCancel && (
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              disabled={processing}
              testID={`packshare-cancel-${transfer.sessionId}`}
            >
              <Text style={[typo.ui.body, styles.cancelText]}>{t("packshare.cancel")}</Text>
            </TouchableOpacity>
          )}
          {showRetry && (
            <TouchableOpacity
              style={[styles.button, styles.retryButton]}
              onPress={onRetry}
              disabled={processing}
              testID={`packshare-retry-${transfer.sessionId}`}
            >
              <Text style={[typo.ui.body, styles.retryText]}>{t("packshare.retry")}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function getStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.bg.card,
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.sm,
    },
    headerText: {
      flex: 1,
      marginLeft: spacing.sm,
      marginRight: spacing.sm,
    },
    packName: {
      color: colors.text.primary,
      fontWeight: "600",
    },
    peerLine: {
      color: colors.text.secondary,
      marginTop: 2,
    },
    size: {
      color: colors.text.secondary,
    },
    stateRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.xs,
    },
    stateDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: spacing.xs,
    },
    stateLabel: {
      color: colors.text.secondary,
      flex: 1,
    },
    progressText: {
      color: colors.text.primary,
      fontWeight: "600",
    },
    progressBar: {
      height: 6,
      backgroundColor: colors.bg.subtle,
      borderRadius: 3,
      overflow: "hidden",
      marginVertical: spacing.xs,
    },
    progressFill: {
      height: "100%",
      backgroundColor: colors.text.accentEmerald,
      borderRadius: 3,
    },
    errorText: {
      color: colors.crimson[500],
      marginTop: spacing.xs,
    },
    actions: {
      flexDirection: "row",
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
    button: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      alignItems: "center",
    },
    acceptButton: {
      backgroundColor: colors.text.accentEmerald,
    },
    acceptText: {
      color: colors.text.inverse,
      fontWeight: "600",
    },
    declineButton: {
      backgroundColor: colors.bg.card,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    declineText: {
      color: colors.text.primary,
    },
    cancelButton: {
      backgroundColor: colors.bg.card,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    cancelText: {
      color: colors.text.secondary,
    },
    retryButton: {
      backgroundColor: colors.text.accentEmerald,
    },
    retryText: {
      color: colors.text.inverse,
      fontWeight: "600",
    },
  });
}
