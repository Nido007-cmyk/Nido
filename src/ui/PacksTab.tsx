/**
 * PacksTab — UI para Pack Sharing NIDO↔NIDO en producción.
 *
 * Se suscribe a packShareService y renderiza:
 * - Packs disponibles para compartir (del knowledgePacks)
 * - Transferencias activas (PackShareCard)
 *
 * Es el wiring real que faltaba: antes packSharing tenía cero callers en UI.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { typography } from "./theme/typography";
import { calmSpacing } from "./theme/calm";
import { spacing, radii } from "./theme/spacing";
import { EmptyState } from "./components/calm/EmptyState";
import { PackShareCard } from "./components/calm/PackShareCard";
import { NidoIcon } from "./components/icons/NidoIcon";
import {
  packShareService,
  type PackTransferInfo,
  type PackShareEvent,
} from "../p2p/packShareService";
import { knowledgePacks } from "../rag/packs";
import type { CatalogModel } from "../models/manifest";

interface PeerOption {
  pkHex: string;
  name: string;
}

interface Props {
  /** Peers disponibles (de NidoScreen). */
  peers: PeerOption[];
  /** Nombre de un peer por su pkHex. */
  getPeerName: (pkHex: string) => string;
}

export function PacksTab({ peers, getPeerName }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const typo = typography;
  const [transfers, setTransfers] = useState<PackTransferInfo[]>(() =>
    packShareService.listTransfers()
  );
  const [packs, setPacks] = useState<CatalogModel[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setTransfers(packShareService.listTransfers());
  }, []);

  const loadPacks = useCallback(async () => {
    try {
      const list = await knowledgePacks();
      setPacks(list);
    } catch {
      setPacks([]);
    }
  }, []);

  useEffect(() => {
    loadPacks();
    const unsubscribe = packShareService.subscribe((event: PackShareEvent) => {
      refresh();
    });
    const interval = setInterval(() => {
      packShareService.pruneTerminal();
      refresh();
    }, 60000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh, loadPacks]);

  const handleSharePack = useCallback(
    async (packId: string) => {
      if (peers.length === 0) {
        Alert.alert(t("packshare.noPeersTitle"), t("packshare.noPeersMessage"));
        return;
      }
      // Si hay un solo peer, se envía directo. Con múltiples peers,
      // una versión futura debería mostrar un selector.
      const peer = peers[0];
      setProcessingId(packId);
      try {
        const sessionId = await packShareService.offerPack(packId, peer.pkHex);
        if (!sessionId) {
          Alert.alert(t("packshare.offerFailedTitle"), t("packshare.offerFailedMessage"));
        }
      } finally {
        setProcessingId(null);
        refresh();
      }
    },
    [peers, t, refresh]
  );

  const handleAccept = useCallback(
    async (transfer: PackTransferInfo) => {
      setProcessingId(transfer.sessionId);
      try {
        await packShareService.acceptOffer(transfer.sessionId);
      } finally {
        setProcessingId(null);
        refresh();
      }
    },
    [refresh]
  );

  const handleDecline = useCallback(
    async (transfer: PackTransferInfo) => {
      setProcessingId(transfer.sessionId);
      try {
        await packShareService.declineOffer(transfer.sessionId);
      } finally {
        setProcessingId(null);
        refresh();
      }
    },
    [refresh]
  );

  const handleCancel = useCallback(
    async (transfer: PackTransferInfo) => {
      setProcessingId(transfer.sessionId);
      try {
        if (transfer.direction === "send") {
          await packShareService.cancelSend(transfer.sessionId);
        } else {
          await packShareService.declineOffer(transfer.sessionId);
        }
      } finally {
        setProcessingId(null);
        refresh();
      }
    },
    [refresh]
  );

  const activeTransfers = transfers.filter(
    (tr) => tr.state !== "complete" && tr.state !== "declined" && tr.state !== "cancelled"
  );
  const pastTransfers = transfers.filter(
    (tr) => tr.state === "complete" || tr.state === "declined" || tr.state === "cancelled"
  );

  return (
    <ScrollView style={styles.container} testID="packs-tab">
      <Text style={[typo.ui.title, styles.sectionTitle]}>{t("packshare.availablePacks")}</Text>
      {packs.length === 0 ? (
        <Text style={[typo.ui.body, styles.emptyText]}>{t("packshare.noPacks")}</Text>
      ) : (
        packs.map((pack) => (
          <View key={pack.id} style={styles.packRow}>
            <View style={styles.packInfo}>
              <Text style={[typo.ui.body, styles.packName]} numberOfLines={1}>
                {pack.label}
              </Text>
              <Text style={[typo.ui.caption, styles.packMeta]} numberOfLines={1}>
                {pack.description || t("packshare.noDescription")}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => handleSharePack(pack.id)}
              disabled={processingId === pack.id}
              testID={`packshare-share-${pack.id}`}
            >
              <NidoIcon name="external" size={16} color={colors.text.inverse} />
              <Text style={[typo.ui.body, styles.shareText]}>{t("packshare.share")}</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {activeTransfers.length > 0 && (
        <>
          <Text style={[typo.ui.title, styles.sectionTitle]}>{t("packshare.activeTransfers")}</Text>
          {activeTransfers.map((transfer) => (
            <PackShareCard
              key={transfer.sessionId}
              transfer={transfer}
              peerName={getPeerName(transfer.peerPkHex)}
              onAccept={() => handleAccept(transfer)}
              onDecline={() => handleDecline(transfer)}
              onCancel={() => handleCancel(transfer)}
              processing={processingId === transfer.sessionId}
            />
          ))}
        </>
      )}

      {pastTransfers.length > 0 && (
        <>
          <Text style={[typo.ui.title, styles.sectionTitle]}>{t("packshare.history")}</Text>
          {pastTransfers.map((transfer) => (
            <PackShareCard
              key={transfer.sessionId}
              transfer={transfer}
              peerName={getPeerName(transfer.peerPkHex)}
            />
          ))}
        </>
      )}

      {transfers.length === 0 && packs.length === 0 && (
        <EmptyState
          title={t("packshare.emptyTitle")}
          description={t("packshare.emptyMessage")}
        />
      )}
    </ScrollView>
  );
}

function getStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: calmSpacing.comfortable,
    },
    sectionTitle: {
      color: colors.text.primary,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    emptyText: {
      color: colors.text.secondary,
      fontStyle: "italic",
      marginBottom: spacing.md,
    },
    packRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.bg.card,
      borderRadius: radii.md,
      padding: spacing.sm,
      marginBottom: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    packInfo: {
      flex: 1,
      marginRight: spacing.sm,
    },
    packName: {
      color: colors.text.primary,
      fontWeight: "600",
    },
    packMeta: {
      color: colors.text.secondary,
      marginTop: 2,
    },
    shareButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.text.accentEmerald,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      gap: spacing.xs,
    },
    shareText: {
      color: colors.text.inverse,
      fontWeight: "600",
    },
  });
}
