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
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
import appConfig from "../../app.json";
import { NetworkAuditCard } from "./NetworkAuditCard";
import { SkillsCard } from "./SkillsCard";
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

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.surface },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.bg.cardElevated,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: calmSpacing.cozy,
  },
  headerIcon: {
    fontSize: 18,
  },
  title: {
    ...typography.ui.titleSm,
    color: colors.text.heading,
  },
  closeBtn: {
    paddingHorizontal: calmSpacing.cozy,
    paddingVertical: calmSpacing.tight,
    borderRadius: calmRadii.subtle,
    backgroundColor: colors.bg.subtle,
  },
  closeBtnText: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "800",
  },
  body: {
    padding: calmSpacing.comfortable,
    gap: calmSpacing.comfortable,
    paddingBottom: calmSpacing.generous,
  },
  heroBox: {
    alignItems: "center",
    paddingVertical: calmSpacing.comfortable,
    gap: calmSpacing.tight,
  },
  mascotImg: {
    width: 64,
    height: 64,
    borderRadius: calmRadii.soft,
    marginBottom: calmSpacing.tight,
  },
  heroTitle: {
    ...typography.ui.headline,
    color: colors.text.heading,
  },
  heroSubtitle: {
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  versionBadge: {
    backgroundColor: colors.bg.subtle,
    paddingHorizontal: calmSpacing.cozy,
    paddingVertical: 2,
    borderRadius: calmRadii.subtle,
    marginTop: calmSpacing.tight,
  },
  versionText: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.dim,
  },
  card: {
    backgroundColor: colors.bg.cardElevated,
    borderRadius: calmRadii.gentle,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: calmSpacing.comfortable,
    gap: calmSpacing.cozy,
    ...calmShadows.none,
  },
  cardTitle: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  paragraph: {
    ...typography.ui.body,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  repoBox: {
    backgroundColor: colors.bg.terminal,
    borderRadius: calmRadii.subtle,
    padding: calmSpacing.cozy,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  actionBtn: {
    minHeight: 48,
    borderRadius: calmRadii.subtle,
    borderWidth: 1,
    borderColor: colors.border.emerald,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: calmSpacing.comfortable,
  },
  actionBtnText: {
    ...typography.ui.body,
    color: colors.text.accentEmerald,
    fontWeight: "700",
  },
  repoText: {
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
  },
});
