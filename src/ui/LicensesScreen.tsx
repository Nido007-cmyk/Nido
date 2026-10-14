/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * LicensesScreen.tsx — 0.1.40: Acerca de → Licencias.
 *
 * Lo que las licencias piden que viaje con la app: la de NIDO (MIT, con el
 * aviso de BOAR), la de cada modelo y paquete que se puede descargar, la
 * atribución del texto de Wikipedia que va DENTRO del APK y los avisos de
 * los paquetes de código abierto compilados en ella
 * (src/legal/thirdPartyNotices.json, generado al compilar).
 *
 * Sin red: los enlaces se muestran como texto seleccionable.
 */
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { calmSpacing } from "./theme/calm";
import { makeSurfaces } from "./theme/surfaces";
import { MODEL_CATALOG } from "../models/manifest";
import { assetLicenseRows, packageLicenseLabel, THIRD_PARTY, type ThirdPartyPackage } from "../legal/licenses";

export function LicensesScreen({ onClose }: { onClose: () => void }) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => assetLicenseRows(MODEL_CATALOG), []);

  const header = (
    <View style={styles.sections}>
      <Text style={styles.paragraph}>{t("licenses.intro")}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("licenses.appTitle")}</Text>
        <Text style={styles.paragraph}>{t("licenses.appBody")}</Text>
        {THIRD_PARTY.appLicense ? (
          <Text style={styles.licenseText} selectable>
            {THIRD_PARTY.appLicense}
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("licenses.modelsTitle")}</Text>
        <Text style={styles.paragraph}>{t("licenses.modelsBody")}</Text>
        {rows.map((r) => (
          <View key={r.id} style={styles.assetRow} testID={`license-asset-${r.id}`}>
            <Text style={styles.assetLabel}>{r.label}</Text>
            <Text style={styles.meta} selectable>
              {r.info ? r.info.name : r.license}
            </Text>
            {r.info ? (
              <Text style={styles.link} selectable>
                {t("licenses.licenseLink")}: {r.info.url}
              </Text>
            ) : null}
            {r.info?.noteKey ? <Text style={styles.note}>{t(r.info.noteKey)}</Text> : null}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("licenses.knowledgeTitle")}</Text>
        <Text style={styles.paragraph} selectable>
          {t("licenses.knowledgeBody")}
        </Text>
        <Text style={styles.paragraph}>{t("licenses.embeddingNote")}</Text>
      </View>

      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{t("licenses.thirdPartyTitle")}</Text>
        <Text style={styles.paragraph}>{t("licenses.thirdPartyBody", { count: THIRD_PARTY.count })}</Text>
        {THIRD_PARTY.partial ? <Text style={styles.note}>{t("licenses.thirdPartyPartial")}</Text> : null}
      </View>
    </View>
  );

  const renderPackage = ({ item }: { item: ThirdPartyPackage }) => {
    const key = `${item.name}@${item.version}`;
    const isOpen = open === key;
    return (
      <Pressable
        style={styles.pkgRow}
        onPress={() => {
          impact(ImpactFeedbackStyle.Light);
          setOpen(isOpen ? null : key);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={`${item.name} ${item.version}, ${packageLicenseLabel(item)}`}
      >
        <Text style={styles.pkgName}>
          {item.name} <Text style={styles.meta}>{item.version}</Text>
        </Text>
        <Text style={styles.meta}>{packageLicenseLabel(item)}</Text>
        {isOpen ? (
          item.files.length ? (
            item.files.map((f) => (
              <View key={f.file} style={styles.textBox}>
                <Text style={styles.meta}>{f.file}</Text>
                <Text style={styles.licenseText} selectable>
                  {THIRD_PARTY.texts[f.text]}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.note}>{t("licenses.noText")}</Text>
          )
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("licenses.title")}</Text>
        <Pressable
          onPress={() => {
            impact(ImpactFeedbackStyle.Light);
            onClose();
          }}
          hitSlop={8}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.done")}
        >
          <Text style={styles.closeBtnText}>{t("common.done")}</Text>
        </Pressable>
      </View>
      <FlatList
        data={THIRD_PARTY.packages}
        keyExtractor={(p) => `${p.name}@${p.version}`}
        renderItem={renderPackage}
        ListHeaderComponent={header}
        contentContainerStyle={styles.body}
        initialNumToRender={20}
        windowSize={7}
      />
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    container: ui.page,
    header: ui.topBar,
    title: ui.topBarTitle,
    closeBtn: ui.topBarAction,
    closeBtnText: ui.topBarActionText,
    body: { paddingHorizontal: calmSpacing.comfortable, paddingTop: calmSpacing.cozy, paddingBottom: calmSpacing.generous },
    sections: { gap: 12, marginBottom: calmSpacing.cozy },
    card: ui.card,
    cardHead: { gap: calmSpacing.tight },
    cardTitle: ui.sectionLabel,
    paragraph: ui.body,
    assetRow: { gap: 2, paddingVertical: calmSpacing.tight },
    assetLabel: { ...typography.ui.body, color: colors.text.heading, fontWeight: "700" },
    meta: { ...typography.mono.xs, color: colors.text.dim },
    link: { ...typography.mono.xs, color: colors.text.accentEmerald },
    note: { ...typography.ui.caption, color: colors.text.secondary },
    pkgRow: {
      paddingVertical: calmSpacing.cozy,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border.subtle,
      gap: 2,
    },
    pkgName: { ...typography.ui.body, color: colors.text.primary },
    textBox: { ...ui.inset, marginTop: calmSpacing.tight },
    licenseText: { ...typography.mono.xs, color: colors.text.primary },
  });
};
