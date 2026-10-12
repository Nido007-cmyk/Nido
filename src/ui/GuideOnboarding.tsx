/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * First-run onboarding (0.1.14): three short screens shown once, on a new
 * install, over the chat. "Skip" is visible from the first screen. Example
 * taps type the text into the chat (never sent automatically).
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal } from "react-native";
import { useTranslation } from "react-i18next";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { makeSurfaces } from "./theme/surfaces";
import { NidoMascot } from "./components/calm/NidoMascot";

interface Props {
  /** Closes the onboarding (it won't show again). */
  onDone: () => void;
  onTryExample: (text: string) => void;
  onOpenGuide: () => void;
}

export function GuideOnboarding({ onDone, onTryExample, onOpenGuide }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const examples = t("guide.onboarding.s2Examples", { returnObjects: true, defaultValue: [] }) as unknown;
  const exampleList = Array.isArray(examples) ? (examples as string[]) : [];

  const next = () => {
    impact(ImpactFeedbackStyle.Light);
    setStep((s) => Math.min(2, s + 1));
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.topRow}>
            <Text style={styles.dots}>{[0, 1, 2].map((i) => (i === step ? "●" : "○")).join(" ")}</Text>
            {step < 2 && (
              <Pressable onPress={onDone} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("guide.onboarding.skip")}>
                <Text style={styles.skip}>{t("guide.onboarding.skip")}</Text>
              </Pressable>
            )}
          </View>

          {step === 0 && (
            <View style={styles.content}>
              <View style={styles.mascot}>
                <NidoMascot role="brand" size={72} />
              </View>
              <Text style={styles.title}>{t("guide.onboarding.s1Title")}</Text>
              <Text style={styles.body}>{t("guide.onboarding.s1Body")}</Text>
            </View>
          )}

          {step === 1 && (
            <View style={styles.content}>
              <Text style={styles.title}>{t("guide.onboarding.s2Title")}</Text>
              <Text style={styles.body}>{t("guide.onboarding.s2Body")}</Text>
              <View style={styles.examples}>
                {exampleList.map((ex) => (
                  <Pressable
                    key={ex}
                    style={styles.example}
                    onPress={() => {
                      impact(ImpactFeedbackStyle.Medium);
                      onTryExample(ex);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={ex}
                  >
                    <Text style={styles.exampleText}>{ex}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.caption}>{t("guide.onboarding.s2Wait")}</Text>
            </View>
          )}

          {step === 2 && (
            <View style={styles.content}>
              <Text style={styles.title}>{t("guide.onboarding.s3Title")}</Text>
              <Text style={styles.body}>{t("guide.onboarding.s3Body")}</Text>
              <Pressable onPress={onOpenGuide} accessibilityRole="button" accessibilityLabel={t("guide.onboarding.fullGuide")}>
                <Text style={styles.link}>{t("guide.onboarding.fullGuide")}</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            style={styles.primary}
            onPress={step < 2 ? next : onDone}
            accessibilityRole="button"
            accessibilityLabel={step < 2 ? t("guide.onboarding.next") : t("guide.onboarding.start")}
          >
            <Text style={styles.primaryText}>{step < 2 ? t("guide.onboarding.next") : t("guide.onboarding.start")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
    sheet: { ...ui.card, padding: 20, gap: 16, maxWidth: 520, width: "100%", alignSelf: "center" },
    topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    dots: { ...typography.ui.caption, color: colors.text.dim, letterSpacing: 2 },
    skip: { ...typography.ui.caption, color: colors.text.secondary, fontWeight: "600" },
    content: { gap: 10 },
    mascot: { alignItems: "center", marginBottom: 4 },
    title: { ...typography.ui.titleLg, color: colors.text.heading },
    body: ui.body,
    caption: { ...ui.caption, color: colors.text.dim },
    examples: { gap: 8, marginTop: 4 },
    example: { ...ui.secondaryButton, alignItems: "flex-start" },
    exampleText: ui.secondaryButtonText,
    link: { ...typography.ui.body, color: colors.emerald[600], fontWeight: "600", marginTop: 4 },
    primary: ui.primaryButton,
    primaryText: ui.primaryButtonText,
  });
};
