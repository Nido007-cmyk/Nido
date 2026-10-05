/**
 * ApprovalCard — Calm Agent approval surface.
 *
 * When Nido wants to perform a sensitive action, the user must immediately
 * understand: what → why → what data → what effect → how to approve/deny.
 *
 * Spec §5: No hiding behind technical language. The primary action must
 * never fire from an ambiguous tap.
 *
 * AUTO / ASK / DENY have coherent visual representation.
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme";
import type { Colors } from "../../theme/colors";
import { typography } from "../../theme/typography";
import { spacing, radii } from "../../theme/spacing";
import { NidoIcon } from "../icons/NidoIcon";

export interface ApprovalRequest {
  /** Human-readable action title, e.g. "Send a message" */
  actionTitle: string;
  /** Why Nido wants to do this */
  reason: string;
  /** Key-value details: To, Content preview, etc. */
  details: Array<{ label: string; value: string }>;
  /** What data leaves the device */
  dataLeaving: string[];
  /** Risk level affects visual hierarchy */
  riskLevel: "low" | "medium" | "high";
}

interface Props {
  request: ApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
  approving?: boolean;
}

export function ApprovalCard({ request, onApprove, onDeny, approving = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();

  return (
    <View style={styles.container} accessibilityRole="alert">
      {/* Header */}
      <View style={styles.header}>
        <NidoIcon name="warning" size={20} />
        <Text style={styles.title}>
          {t("approvalCard.title", { action: request.actionTitle })}
        </Text>
      </View>

      {/* Reason */}
      <Text style={styles.reason}>{request.reason}</Text>

      {/* Details */}
      <View style={styles.details}>
        {request.details.map((d, i) => (
          <View key={i} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{d.label}</Text>
            <Text style={styles.detailValue} numberOfLines={3}>
              {d.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Data leaving device */}
      {request.dataLeaving.length > 0 && (
        <View style={styles.dataSection}>
          <Text style={styles.dataTitle}>{t("approvalCard.dataLeaving")}</Text>
          <Text style={styles.dataValue}>{request.dataLeaving.join(" + ")}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.denyButton]}
          onPress={onDeny}
          disabled={approving}
          accessibilityRole="button"
          accessibilityLabel={t("approvalCard.deny")}
        >
          <Text style={styles.denyText}>{t("approvalCard.deny")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.button,
            styles.approveButton,
            request.riskLevel === "high" && styles.approveButtonHighRisk,
          ]}
          onPress={onApprove}
          disabled={approving}
          accessibilityRole="button"
          accessibilityLabel={t("approvalCard.approveOnce")}
        >
          <Text style={styles.approveText}>
            {approving ? t("approvalCard.approving") : t("approvalCard.approveOnce")}
          </Text>
        </TouchableOpacity>
      </View>
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
    title: {
      ...typography.ui.body,
      fontWeight: "600",
      color: colors.text.primary,
      flex: 1,
    },
    reason: {
      ...typography.ui.subtext,
      color: colors.text.secondary,
      marginBottom: spacing.md,
    },
    details: {
      gap: spacing.xs,
      marginBottom: spacing.md,
    },
    detailRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    detailLabel: {
      ...typography.ui.caption,
      color: colors.text.dim,
      minWidth: 80,
    },
    detailValue: {
      ...typography.ui.subtext,
      color: colors.text.primary,
      flex: 1,
    },
    dataSection: {
      backgroundColor: colors.bg.subtle,
      borderRadius: radii.md,
      padding: spacing.sm,
      marginBottom: spacing.md,
    },
    dataTitle: {
      ...typography.ui.caption,
      color: colors.text.dim,
      marginBottom: 2,
    },
    dataValue: {
      ...typography.ui.subtext,
      color: colors.text.secondary,
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
    denyButton: {
      backgroundColor: colors.bg.subtle,
    },
    denyText: {
      ...typography.ui.body,
      color: colors.text.secondary,
      fontWeight: "500",
    },
    approveButton: {
      backgroundColor: colors.emerald[400],
    },
    approveButtonHighRisk: {
      backgroundColor: "#C0392B",
    },
    approveText: {
      ...typography.ui.body,
      color: "#FFFFFF",
      fontWeight: "600",
    },
  });
