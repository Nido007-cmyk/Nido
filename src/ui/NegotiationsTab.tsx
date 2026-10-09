/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * NegotiationsTab — UI para negociaciones NIDO↔NIDO en producción.
 *
 * Se suscribe a negotiationService y renderiza NegotiationCard para
 * propuestas entrantes. Es el wiring real que faltaba: antes
 * NegotiationCard tenía cero callers.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal } from "react-native";
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

interface P2PContact {
  pkHex: string;
  name: string;
}

export function NegotiationsTab() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<NegotiationSession[]>(() =>
    negotiationService.listSessions()
  );
  const [processingId, setProcessingId] = useState<string | null>(null);
  // NEGOTIATION-INIT 2026-10-07: UI para proponer.
  const [showPropose, setShowPropose] = useState(false);
  const [contacts, setContacts] = useState<P2PContact[]>([]);
  const [selectedPk, setSelectedPk] = useState<string>("");
  const [description, setDescription] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setSessions(negotiationService.listSessions());
  }, []);

  // M-U1 FIX 2026-10-07: mapa pkHex -> nombre para mostrar nombres en vez de hex.
  const [contactNames, setContactNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const unsubscribe = negotiationService.subscribe((event: NegotiationEvent) => {
      // Cualquier evento refresca la lista
      refresh();
    });
    // Cargar nombres de contactos para resolución pkHex -> nombre.
    (async () => {
      try {
        const { listContacts } = await import("../p2p/store");
        const list = await listContacts();
        const map = new Map<string, string>();
        for (const c of list) {
          map.set(c.pkHex.toLowerCase(), c.name);
          // También indexar por signing key por si acaso.
          if ((c as any).sigPkHex) map.set((c as any).sigPkHex.toLowerCase(), c.name);
        }
        setContactNames(map);
      } catch { /* best-effort */ }
    })();
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
        // Modelo fail-closed: el estado visible solo cambia si el transporte
        // acepta el ACCEPT firmado. Si falla, la sesión guarda pendingSend y
        // la UI muestra "No enviado / Reintentar" (evento send_failed).
        await negotiationService.acceptSession(session.negotiationId);
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
        await negotiationService.declineSession(session.negotiationId);
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
        await negotiationService.counterSession(session.negotiationId, modifiedScopes);
      } finally {
        setProcessingId(null);
        refresh();
      }
    },
    [refresh]
  );

  const handleRetry = useCallback(
    async (session: NegotiationSession) => {
      setProcessingId(session.negotiationId);
      try {
        // Reintenta con los mismos bytes firmados (mismo nonce): el peer
        // descarta duplicados por su protección anti-replay.
        await negotiationService.retrySend(session.negotiationId);
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
  // TESTFIX-2026-10-08: las aceptadas cuentan como contenido — si no,
  // el early return de "vacío" ocultaba la sección de colaboraciones
  // activas justo cuando solo quedaban aceptadas (caso físico real).
  const acceptedSessions = sessions.filter((s) => s.state === "ACCEPTED");

  const openPropose = useCallback(async () => {
    setProposeError(null);
    setDescription("");
    setSelectedPk("");
    try {
      const { listContacts } = await import("../p2p/store");
      const list = await listContacts();
      setContacts(list.map((c: any) => ({ pkHex: c.pkHex, name: c.name })));
    } catch {
      setContacts([]);
    }
    setShowPropose(true);
  }, []);

  const handlePropose = useCallback(async () => {
    if (!selectedPk || !description.trim()) {
      setProposeError(t("negotiations.selectContactAndDescribe"));
      return;
    }
    setProposeBusy(true);
    setProposeError(null);
    try {
      const result = await negotiationService.proposeTo(selectedPk, description.trim());
      if (!result.sent) {
        // M-U3 FIX: mensaje claro si el peer está offline, no "send_failed" críptico.
        const msg = result.reason === "send_failed" || result.reason === "peer_offline"
          ? t("negotiations.peerOffline")
          : `${t("negotiations.sendFailed")} ${result.reason ?? ""}`.trim();
        setProposeError(msg);
        return;
      }
      setShowPropose(false);
      refresh();
    } finally {
      setProposeBusy(false);
    }
  }, [selectedPk, description, refresh]);

  if (activeSessions.length === 0 && acceptedSessions.length === 0 && !showPropose) {
    return (
      <View style={styles.container}>
        <EmptyState
          title={t("negotiations.emptyTitle")}
          description={t("negotiations.emptyDescription")}
          mascotRole="connection"
        />
        <TouchableOpacity style={styles.proposeButton} onPress={openPropose}>
          <Text style={styles.proposeButtonText}>{t("negotiations.proposeButton")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.list}>
      {activeSessions.map((session) =>
        // OUTGOING-2026-10-08: nuestras propias propuestas se muestran como
        // "enviada, esperando respuesta" — nunca como entrante con
        // Accept/Decline (bug: se veía igual en ambas tablets).
        negotiationService.isOutgoing(session) ? (
          <View key={session.negotiationId} style={styles.outgoingCard}>
            <Text style={styles.outgoingTitle}>
              {t("negotiations.outgoingTitle", {
                peer:
                  contactNames.get(session.peerPkHex.toLowerCase()) ??
                  session.peerPkHex.slice(0, 8),
              })}
            </Text>
            <Text style={styles.outgoingDesc} numberOfLines={3}>
              {session.proposal.taskDescription}
            </Text>
            <Text style={styles.outgoingStatus}>
              {session.sending
                ? t("negotiations.outgoingSending")
                : t("negotiations.outgoingWaiting")}
            </Text>
          </View>
        ) : (
          <NegotiationCard
            key={session.negotiationId}
            proposal={session.proposal}
            peerName={contactNames.get(session.peerPkHex.toLowerCase()) ?? session.peerPkHex.slice(0, 8)}
            peerPkShort={session.peerPkHex.slice(0, 16)}
            onAccept={() => handleAccept(session)}
            onDecline={() => handleDecline(session)}
            onCounter={(scopes) => handleCounter(session, scopes)}
            onRetry={() => handleRetry(session)}
            pendingSend={
              session.pendingSend
                ? { action: session.pendingSend.action, attempts: session.pendingSend.attempts }
                : null
            }
            processing={processingId === session.negotiationId}
          />
        )
      )}
      {/* TESTFIX-2026-10-08: colaboraciones activas. Evidencia física:
          al aceptar, la sesión "desaparecía" de ambas tablets — solo había
          un volcado crudo del estado ("ACCEPTED: ..."). Ahora las sesiones
          aceptadas tienen sección propia con peer, descripción y fecha. */}
      {acceptedSessions.length > 0 && (
        <View style={styles.activeSection}>
          <Text style={styles.activeTitle}>{t("negotiations.activeTitle")}</Text>
          {acceptedSessions.map((session) => {
              const peerName =
                contactNames.get(session.peerPkHex.toLowerCase()) ??
                session.peerPkHex.slice(0, 8);
              const locale = i18n.resolvedLanguage ?? i18n.language ?? "es";
              const dateStr = new Date(session.updatedAt).toLocaleDateString(locale, {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              });
              return (
                <View key={session.negotiationId} style={styles.activeCard}>
                  <Text style={styles.activePeer}>✓ {peerName}</Text>
                  <Text style={styles.activeDesc} numberOfLines={3}>
                    {session.proposal.taskDescription}
                  </Text>
                  <Text style={styles.activeDate}>
                    {t("negotiations.acceptedOn", { date: dateStr })}
                  </Text>
                </View>
              );
            })}
        </View>
      )}
      {/* Sesiones en estado terminal (declinadas/expiradas, para visibilidad) */}
      {sessions
        .filter((s) => s.state === "DECLINED" || s.state === "EXPIRED")
        .slice(0, 5)
        .map((session) => (
          <View key={session.negotiationId} style={styles.terminalCard}>
            <Text style={styles.terminalText}>
              {session.state}: {session.proposal.taskDescription.slice(0, 50)}
            </Text>
          </View>
        ))}
      <TouchableOpacity style={styles.proposeButton} onPress={openPropose}>
        <Text style={styles.proposeButtonText}>{t("negotiations.proposeButton")}</Text>
      </TouchableOpacity>

      <Modal visible={showPropose} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t("negotiations.proposeButton").replace("+ ", "")}</Text>
            <Text style={styles.modalLabel}>Contacto:</Text>
            {contacts.map((c) => (
              <TouchableOpacity
                key={c.pkHex}
                style={[
                  styles.contactOption,
                  selectedPk === c.pkHex && styles.contactSelected,
                ]}
                onPress={() => setSelectedPk(c.pkHex)}
              >
                <Text style={styles.contactName}>{c.name}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.modalLabel}>Propuesta:</Text>
            <TextInput
              style={styles.modalInput}
              value={description}
              onChangeText={setDescription}
              placeholder="¿Qué quieres proponer?"
              multiline
            />
            {proposeError && <Text style={styles.modalError}>{proposeError}</Text>}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setShowPropose(false)}
              >
                <Text>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSend}
                onPress={handlePropose}
                disabled={proposeBusy}
              >
                <Text style={styles.proposeButtonText}>
                  {proposeBusy ? "Enviando..." : "Enviar"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    outgoingCard: {
      backgroundColor: colors.bg.cardElevated,
      borderRadius: 8,
      padding: calmSpacing.cozy,
      borderLeftWidth: 3,
      borderLeftColor: "#4A6B4F",
    },
    outgoingTitle: {
      color: colors.text.primary,
      fontWeight: "600",
      fontSize: 14,
      marginBottom: 4,
    },
    outgoingDesc: {
      color: colors.text.secondary,
      fontSize: 13,
      marginBottom: 6,
    },
    outgoingStatus: {
      color: colors.text.muted,
      fontSize: 12,
      fontStyle: "italic",
    },
    // TESTFIX-2026-10-08: estilos de colaboraciones activas.
    activeSection: {
      gap: 8,
    },
    activeTitle: {
      color: colors.text.primary,
      fontWeight: "700",
      fontSize: 14,
    },
    activeCard: {
      backgroundColor: colors.bg.cardElevated,
      borderRadius: 8,
      padding: calmSpacing.cozy,
      borderLeftWidth: 3,
      borderLeftColor: "#4A6B4F",
    },
    activePeer: {
      color: colors.text.primary,
      fontWeight: "600",
      fontSize: 14,
      marginBottom: 4,
    },
    activeDesc: {
      color: colors.text.secondary,
      fontSize: 13,
      marginBottom: 6,
    },
    activeDate: {
      color: colors.text.muted,
      fontSize: 12,
    },
    proposeButton: {
      backgroundColor: "#4A6B4F",
      borderRadius: 8,
      padding: calmSpacing.cozy,
      alignItems: "center",
      marginTop: calmSpacing.comfortable,
    },
    proposeButtonText: {
      color: "#fff",
      fontWeight: "600",
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      padding: 20,
    },
    modalContent: {
      backgroundColor: colors.bg.surface,
      borderRadius: 12,
      padding: calmSpacing.comfortable,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      marginBottom: 12,
      color: colors.text.primary,
    },
    modalLabel: {
      fontSize: 14,
      fontWeight: "600",
      marginTop: 8,
      marginBottom: 4,
      color: colors.text.primary,
    },
    contactOption: {
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border?.default ?? "#ccc",
      marginBottom: 6,
    },
    contactSelected: {
      borderColor: "#4A6B4F",
      borderWidth: 2,
    },
    contactName: {
      color: colors.text.primary,
    },
    modalInput: {
      borderWidth: 1,
      borderColor: colors.border?.default ?? "#ccc",
      borderRadius: 8,
      padding: 10,
      minHeight: 80,
      color: colors.text.primary,
      textAlignVertical: "top",
    },
    modalError: {
      color: "red",
      marginTop: 8,
    },
    modalButtons: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 12,
      marginTop: 16,
    },
    modalCancel: {
      padding: 10,
    },
    modalSend: {
      backgroundColor: "#4A6B4F",
      borderRadius: 8,
      padding: 10,
      paddingHorizontal: 20,
    },
  });
