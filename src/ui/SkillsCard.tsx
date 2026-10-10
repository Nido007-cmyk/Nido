/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * SkillsCard — lista de solo lectura de las habilidades del agente (U6).
 *
 * El agente ya usaba las skills de src/agent/skills, pero ninguna pantalla
 * las mostraba: el usuario no podía saber qué sabe hacer NIDO paso a paso.
 * Se muestran las integradas y, si la base está disponible, las aprendidas.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
import { listSkills, listAllSkills } from "../agent/skills/registry";

export function SkillsCard() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [skills, setSkills] = useState<{ name: string; description: string }[]>(() => listSkills());

  useEffect(() => {
    let alive = true;
    listAllSkills()
      .then((all) => {
        if (alive) setSkills(all);
      })
      .catch(() => {
        // Sin base de datos se quedan las integradas, que ya están en pantalla.
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("skillsCard.title")}</Text>
      <Text style={styles.paragraph}>{t("skillsCard.body")}</Text>
      {skills.map((s) => (
        <View key={s.name} style={styles.row}>
          <Text style={styles.rowName}>{s.name}</Text>
          <Text style={styles.rowDesc}>{s.description}</Text>
        </View>
      ))}
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) =>
  StyleSheet.create({
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
    row: {
      backgroundColor: colors.bg.terminal,
      borderRadius: calmRadii.subtle,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      padding: calmSpacing.cozy,
      gap: 2,
    },
    rowName: {
      ...typography.mono.xs,
      color: colors.text.primary,
      fontWeight: "700",
    },
    rowDesc: {
      ...typography.ui.caption,
      color: colors.text.secondary,
    },
  });
