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
  const { t } = useTranslation();
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
      setProposeError("Selecciona un contacto y escribe la propuesta.");
      return;
    }
    setProposeBusy(true);
    setProposeError(null);
    try {
      const result = await negotiationService.proposeTo(selectedPk, description.trim());
      if (!result.sent) {
        setProposeError(`No se pudo enviar: ${result.reason ?? "error"}`);
        return;
      }
      setShowPropose(false);
      refresh();
    } finally {
      setProposeBusy(false);
    }
  }, [selectedPk, description, refresh]);

  if (activeSessions.length === 0 && !showPropose) {
    return (
      <View style={styles.container}>
        <EmptyState
          title={t("negotiations.emptyTitle")}
          description={t("negotiations.emptyDescription")}
          mascotRole="connection"
        />
        <TouchableOpacity style={styles.proposeButton} onPress={openPropose}>
          <Text style={styles.proposeButtonText}>+ Proponer colaboración</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.list}>
      {activeSessions.map((session) => (
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
      <TouchableOpacity style={styles.proposeButton} onPress={openPropose}>
        <Text style={styles.proposeButtonText}>+ Proponer colaboración</Text>
      </TouchableOpacity>

      <Modal visible={showPropose} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Proponer colaboración</Text>
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
