/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from "react-native";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import appConfig from "../../app.json";
import { BackupScreen } from "./BackupScreen";
import { LicensesScreen } from "./LicensesScreen";
import QRCode from "qrcode";
import { SUPPORT_ADDRESSES, copySupportAddress, type SupportAddress } from "./aboutSupport";

/**
 * QR dibujado con Views, como en NidoScreen (qrcode es JS puro, sin
 * dependencias nativas nuevas). El contenido del QR es la dirección
 * misma, carácter a carácter, leída de la fuente única de aboutSupport.
 */
function QrViews({ text, size = 120 }: { text: string; size?: number }) {
  const modules = useMemo(() => {
    try {
      const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
      const n = qr.modules.size as number;
      const data = qr.modules.data as Uint8Array | number[];
      return { n, data };
    } catch {
      return null;
    }
  }, [text]);
  if (!modules) return null;
  const cell = size / modules.n;
  const rows: React.ReactNode[] = [];
  for (let r = 0; r < modules.n; r++) {
    const cells: React.ReactNode[] = [];
    for (let c = 0; c < modules.n; c++) {
      const dark = modules.data[r * modules.n + c] === 1;
      cells.push(
        <View key={c} style={{ width: cell, height: cell, backgroundColor: dark ? "#111" : "#fff" }} />,
      );
    }
    rows.push(
      <View key={r} style={{ flexDirection: "row" }}>
        {cells}
      </View>,
    );
  }
  return (
    <View style={{ backgroundColor: "#fff", padding: 10, borderRadius: 8 }}>
      <View style={{ width: size, height: size }}>{rows}</View>
    </View>
  );
}

export function AboutScreen({ onClose }: { onClose: () => void }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  const { t } = useTranslation();
  // U1: la pantalla de respaldo existía pero ningún menú llevaba a ella.
  const [showBackup, setShowBackup] = useState(false);
  // 0.1.40: licencias de la app, de los modelos y de terceros.
  const [showLicenses, setShowLicenses] = useState(false);
  const handleClose = () => {
    impact(ImpactFeedbackStyle.Light);
    onClose();
  };

  // 2026-10-30: confirmación breve tras copiar una dirección de la
  // tarjeta de desarrollo; solo se muestra si el portapapeles aceptó.
  const [copiedId, setCopiedId] = useState<SupportAddress["id"] | null>(null);
  const handleCopyAddress = async (entry: SupportAddress) => {
    impact(ImpactFeedbackStyle.Light);
    try {
      await copySupportAddress(entry.address);
      setCopiedId(entry.id);
    } catch {
      // Sin confirmación si el portapapeles falló: no se anuncia lo que no pasó.
    }
  };

  if (showBackup) {
    return <BackupScreen onClose={() => setShowBackup(false)} />;
  }
  if (showLicenses) {
    return <LicensesScreen onClose={() => setShowLicenses(false)} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{t("aboutScreen.title")}</Text>
        </View>
        <Pressable
          onPress={handleClose}
          hitSlop={8}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.done")}
        >
          <Text style={styles.closeBtnText}>{t("common.done")}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.heroBox}>
          <Image
            source={require("../../assets/icon-nido.png")}
            style={styles.mascotImg}
            resizeMode="contain"
          />
          <Text style={styles.heroTitle}>NIDO</Text>
          <Text style={styles.heroSubtitle}>{t("aboutScreen.heroSubtitle")}</Text>
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>
              {t("aboutScreen.versionBadge", {
                version: appConfig.expo.version,
                build: __DEV__ ? t("aboutScreen.buildDevelopment") : t("aboutScreen.buildRelease"),
              })}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.airGappedTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.airGappedBody")}</Text>
        </View>

        {/* 0.1.55: el registro de red, la comprobación de seguridad, el diagnóstico
            de cierres, las habilidades, las tareas programadas y los permisos del
            agente se movieron a Ajustes (Seguridad, Asistente y Diagnóstico). */}
        {/* U1: acceso a respaldo, clave de cifrado y rotación de clave. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.backupTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.backupBody")}</Text>
          <Pressable
            style={styles.actionBtn}
            onPress={() => {
              impact(ImpactFeedbackStyle.Light);
              setShowBackup(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("aboutScreen.backupOpen")}
          >
            <Text style={styles.actionBtnText}>{t("aboutScreen.backupOpen")}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.limitsTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.limitsBody")}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.privacyTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.privacyBody")}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.hardwareTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.hardwareBody")}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.benchmarkTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.benchmarkBody")}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.repoTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.repoBody")}</Text>
          <View style={styles.repoBox}>
            <Text style={styles.repoText}>{t("aboutScreen.repoUrl")}</Text>
          </View>
        </View>

        {/* 2026-10-30: información del proyecto, no una petición — las
            direcciones para quienes han preguntado cómo contribuir al
            desarrollo. Sin avisos, sin recompensas, sin desbloqueos: la
            app solo las muestra y las copia; no procesa pagos ni hace
            llamadas de red por esta tarjeta. Las direcciones viven una
            sola vez en aboutSupport.ts y todo (texto, QR, copiar) lee
            de ahí. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.developmentTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.developmentBody")}</Text>
          {SUPPORT_ADDRESSES.map((entry) => {
            const networkName = entry.id === "solana" ? "Solana" : "Base";
            return (
              <View key={entry.id} style={styles.supportBlock}>
                <Text style={styles.supportLabel}>
                  {t(entry.id === "solana" ? "aboutScreen.developmentSolanaLabel" : "aboutScreen.developmentBaseLabel")}
                </Text>
                <Pressable
                  testID={`about-support-address-${entry.id}`}
                  style={styles.repoBox}
                  onPress={() => void handleCopyAddress(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("aboutScreen.developmentCopy")} · ${networkName}`}
                >
                  <Text style={styles.repoText}>{entry.address}</Text>
                </Pressable>
                <View style={styles.supportQr}>
                  <QrViews text={entry.address} />
                </View>
                <Pressable
                  testID={`about-support-copy-${entry.id}`}
                  style={styles.actionBtn}
                  onPress={() => void handleCopyAddress(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("aboutScreen.developmentCopy")} · ${networkName}`}
                >
                  <Text style={styles.actionBtnText}>{t("aboutScreen.developmentCopy")}</Text>
                </Pressable>
                {copiedId === entry.id && (
                  <Text style={styles.supportCopied}>{t("aboutScreen.developmentCopied")}</Text>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("aboutScreen.licensesTitle")}</Text>
          <Text style={styles.paragraph}>{t("aboutScreen.licensesBody")}</Text>
          <Pressable
            style={styles.actionBtn}
            onPress={() => {
              impact(ImpactFeedbackStyle.Light);
              setShowLicenses(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("aboutScreen.licensesOpen")}
          >
            <Text style={styles.actionBtnText}>{t("aboutScreen.licensesOpen")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    container: ui.page,
    header: ui.topBar,
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: calmSpacing.cozy,
      flexShrink: 1,
    },
    title: ui.topBarTitle,
    closeBtn: ui.topBarAction,
    closeBtnText: ui.topBarActionText,
    body: {
      paddingHorizontal: calmSpacing.comfortable,
      paddingTop: calmSpacing.cozy,
      gap: 12,
      paddingBottom: calmSpacing.generous,
    },
    heroBox: {
      alignItems: "center",
      paddingVertical: calmSpacing.comfortable,
      gap: calmSpacing.tight,
    },
    mascotImg: {
      width: 72,
      height: 72,
      borderRadius: calmRadii.round,
      marginBottom: calmSpacing.tight,
    },
    heroTitle: {
      ...typography.ui.headline,
      color: colors.text.heading,
    },
    heroSubtitle: {
      ...typography.ui.body,
      color: colors.text.secondary,
    },
    versionBadge: {
      backgroundColor: colors.emerald.bgSubtle,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: calmRadii.pill,
      marginTop: calmSpacing.cozy,
    },
    versionText: {
      ...typography.ui.micro,
      color: colors.emerald[600],
      fontWeight: "700",
    },
    card: ui.card,
    cardTitle: ui.sectionLabel,
    paragraph: ui.body,
    repoBox: ui.inset,
    actionBtn: ui.primaryButton,
    actionBtnText: ui.primaryButtonText,
    repoText: {
      ...typography.mono.xs,
      color: colors.text.accentEmerald,
    },
    supportBlock: {
      marginTop: calmSpacing.comfortable,
      gap: calmSpacing.tight,
    },
    supportLabel: {
      ...typography.ui.caption,
      color: colors.text.secondary,
      fontWeight: "700",
    },
    supportQr: {
      alignItems: "center",
      paddingVertical: calmSpacing.tight,
    },
    supportCopied: {
      ...typography.ui.micro,
      color: colors.emerald[600],
      fontWeight: "700",
    },
  });
};
