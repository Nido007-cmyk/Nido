/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * TaskApprovalCard — human gate for delegated task execution.
 *
 * Rendered when a TASK_REQUEST arrives from a paired NIDO. Shows:
 * - Who is asking (peer contact name)
 * - The task description VERBATIM, visually marked as untrusted
 * - The scope list in plain language, rendered from the VERIFIED
 *   TOKEN scopes — never from the peer's free text (threat model 4.6)
 * - Expiry
 *
 * Buttons: Allow once / Deny. No "always allow" in v1.
 * Screen sleep during approval never auto-approves (timeout = deny).
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme";
import type { Colors } from "../../theme/colors";
import type { TaskScope } from "../../../p2p/taskProtocol";

export interface TaskApprovalRequest {
  taskId: string;
  peerName: string;
  peerPkShort: string;
  description: string;
  /** Verified token scopes (NOT peer free text). */
  scopes: TaskScope[];
  expiresAt: number;
  /**
   * R4: documento adjunto (task:summarize) que el modelo procesará.
   * El aprobador debe verlo: huella, tamaño y extracto. Sin esto se
   * aprobaría a ciegas el payload real.
   */
  document?: {
    sha512Hex: string;
    sizeBytes: number;
    preview: string;
  };
}

interface Props {
  request: TaskApprovalRequest;
  onAllow: () => void;
  onDeny: () => void;
}

export function TaskApprovalCard({ request, onAllow, onDeny }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();

  return (
    <View style={styles.card} testID="task-approval-card">
      <Text style={styles.title}>
        {t("tasks.approvalTitle", "Task request")}
      </Text>
      <Text style={styles.peer}>
        {t("tasks.fromPeer", "From {{name}} ({{pk}})", {
          name: request.peerName,
          pk: request.peerPkShort,
        })}
      </Text>

      <Text style={styles.untrustedLabel}>
        {t("tasks.untrustedLabel", "Their message (untrusted):")}
      </Text>
      <View style={styles.quoteBox}>
        <Text style={styles.quote}>{request.description}</Text>
      </View>

      <Text style={styles.scopesLabel}>
        {t("tasks.scopesLabel", "It will be allowed to:")}
      </Text>
      {request.scopes.map((s) => (
        <Text key={s} style={styles.scope}>
          {"• "}
          {t(`tasks.scope.${s}`, s)}
        </Text>
      ))}

      {request.document && (
        <>
          <Text style={styles.untrustedLabel}>
            {t("tasks.documentLabel", "Attached document (untrusted):")}
          </Text>
          <View style={styles.quoteBox}>
            <Text style={styles.quote}>{request.document.preview}</Text>
          </View>
          <Text style={styles.docMeta}>
            {t("tasks.documentMeta", "{{bytes}} bytes · SHA-512 {{hash}}", {
              bytes: request.document.sizeBytes,
              hash: `${request.document.sha512Hex.slice(0, 16)}…`,
            })}
          </Text>
        </>
      )}

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.deny]}
          onPress={onDeny}
          testID="task-approval-deny"
        >
          <Text style={styles.denyText}>{t("common.deny", "Deny")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.allow]}
          onPress={onAllow}
          testID="task-approval-allow"
        >
          <Text style={styles.allowText}>
            {t("tasks.allowOnce", "Allow once")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function getStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.bg.card,
      borderRadius: 16,
      padding: 20,
      margin: 16,
      borderWidth: 2,
      borderColor: colors.text.accentAmber,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text.primary,
      marginBottom: 4,
    },
    peer: {
      fontSize: 14,
      color: colors.text.dim,
      marginBottom: 12,
    },
    untrustedLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.text.accentAmber,
      marginBottom: 4,
    },
    quoteBox: {
      borderLeftWidth: 3,
      borderLeftColor: colors.text.accentAmber,
      paddingLeft: 12,
      marginBottom: 12,
    },
    quote: {
      fontSize: 15,
      color: colors.text.primary,
      fontStyle: "italic",
    },
    scopesLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text.primary,
      marginBottom: 4,
    },
    scope: {
      fontSize: 14,
      color: colors.text.primary,
      marginBottom: 2,
    },
    docMeta: {
      fontSize: 12,
      color: colors.text.dim,
      fontFamily: "monospace",
      marginBottom: 12,
    },
    buttons: {
      flexDirection: "row",
      marginTop: 16,
      gap: 12,
    },
    button: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: "center",
    },
    deny: {
      backgroundColor: colors.bg.subtle,
      borderWidth: 1,
      borderColor: colors.text.dim,
    },
    allow: {
      backgroundColor: colors.emerald.bgSubtle,
    },
    denyText: {
      color: colors.text.primary,
      fontWeight: "600",
    },
    allowText: {
      color: colors.text.primary,
      fontWeight: "700",
    },
  });
}
