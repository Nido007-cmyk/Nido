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
import { NetworkAuditCard } from "./NetworkAuditCard";
import { SkillsCard } from "./SkillsCard";
import { AgentPermissionsCard } from "./AgentPermissionsCard";
import { SecurityStatusCard } from "./SecurityStatusCard";
import { BackupScreen } from "./BackupScreen";

export function AboutScreen({ onClose }: { onClose: () => void }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  const { t } = useTranslation();
  // U1: la pantalla de respaldo existía pero ningún menú llevaba a ella.
  const [showBackup, setShowBackup] = useState(false);
  const handleClose = () => {
    impact(ImpactFeedbackStyle.Light);
    onClose();
  };

  if (showBackup) {
    return <BackupScreen onClose={() => setShowBackup(false)} />;
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

        {/* U3: el registro de red, visible para el usuario. */}
        <NetworkAuditCard />

        {/* U7: estado de seguridad comprobado en este teléfono. */}
        <SecurityStatusCard />

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

        {/* U6: qué sabe hacer el agente. */}
        <SkillsCard />

        {/* Historial de acciones y permisos por herramienta. */}
        <AgentPermissionsCard />

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
  });
};
