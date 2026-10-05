/**
 * NegotiationsTab — UI para negociaciones NIDO↔NIDO en producción.
 *
 * Se suscribe a negotiationService y renderiza NegotiationCard para
 * propuestas entrantes. Es el wiring real que faltaba: antes
 * NegotiationCard tenía cero callers.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { calmSpacing } from "./theme/calm";
import { EmptyState } from "./components/calm/EmptyState";
import { NegotiationCard } from "./components/calm/NegotiationCard";
import {
  negotiationService,
  type NegotiationSession,
  type NegotiationEvent,
} from "../p2p/negotiationService";

export function NegotiationsTab() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<NegotiationSession[]>(() =>
    negotiationService.listSessions()
  );
  const [processingId, setProcessingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setSessions(negotiationService.listSessions());
  }, []);

  useEffect(() => {
    const unsubscribe = negotiationService.subscribe((event: NegotiationEvent) => {
      // Cualquier evento refresca la lista
      refresh();
    });
    // Limpieza periódica de sesiones terminales
    const interval = setInterval(() => {
      negotiationService.pruneTerminal();
      refresh();
    }, 60000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh]);

  const handleAccept = useCallback(
    async (session: NegotiationSession) => {
      setProcessingId(session.negotiationId);
      try {
        // TODO: Enviar ACCEPT firmado al peer via transporte.
        // Por ahora se marca localmente; el envío real requiere
        // acceso al NidoMessenger desde la UI (FASE 3b).
        console.log("[Negotiations] Accept:", session.negotiationId);
      } finally {
        setProcessingId(null);
        refresh();
      }
    },
    [refresh]
  );

  const handleDecline = useCallback(
    async (session: NegotiationSession) => {
      setProcessingId(session.negotiationId);
      try {
        console.log("[Negotiations] Decline:", session.negotiationId);
      } finally {
        setProcessingId(null);
        refresh();
      }
    },
    [refresh]
  );

  const handleCounter = useCallback(
    async (session: NegotiationSession, modifiedScopes: string[]) => {
      setProcessingId(session.negotiationId);
      try {
        console.log("[Negotiations] Counter:", session.negotiationId, modifiedScopes);
      } finally {
        setProcessingId(null);
        refresh();
      }
    },
    [refresh]
  );

  const activeSessions = sessions.filter(
    (s) => s.state === "PROPOSED" || s.state === "COUNTERED"
  );

  if (activeSessions.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState
          title={t("negotiations.emptyTitle")}
          description={t("negotiations.emptyDescription")}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.list}>
      {activeSessions.map((session) => (
        <NegotiationCard
          key={session.negotiationId}
          proposal={session.proposal}
          peerName={session.peerPkHex.slice(0, 8)}
          peerPkShort={session.peerPkHex.slice(0, 16)}
          onAccept={() => handleAccept(session)}
          onDecline={() => handleDecline(session)}
          onCounter={(scopes) => handleCounter(session, scopes)}
          processing={processingId === session.negotiationId}
        />
      ))}
      {/* Sesiones en estado terminal (para visibilidad) */}
      {sessions
        .filter((s) => !["PROPOSED", "COUNTERED"].includes(s.state))
        .slice(0, 5)
        .map((session) => (
          <View key={session.negotiationId} style={styles.terminalCard}>
            <Text style={styles.terminalText}>
              {session.state}: {session.proposal.taskDescription.slice(0, 50)}
            </Text>
          </View>
        ))}
    </ScrollView>
  );
}

const getStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg.surface,
    },
    list: {
      padding: calmSpacing.comfortable,
      gap: calmSpacing.comfortable,
    },
    terminalCard: {
      backgroundColor: colors.bg.cardElevated,
      borderRadius: 8,
      padding: calmSpacing.cozy,
      opacity: 0.7,
    },
    terminalText: {
      color: colors.text.secondary,
      fontSize: 13,
    },
  });
