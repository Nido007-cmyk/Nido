import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch } from "react-native";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { NidoIcon } from "./components/icons/NidoIcon";
import { setHidePromptIdeas } from "../models/settings";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { typography } from "./theme/typography";
import { spacing, radii } from "./theme/spacing";

export interface PromptIdea {
  category: string;
  icon: string;
  prompt: string;
}

// Prompt items are NIDO-original content in i18n (promptIdeasCarousel.items),
// EN/ES/PT. The BOAR-inherited benchmark prompts were removed 2026-09-28.

interface Props {
  onUsePrompt: (prompt: string) => void;
  onDismiss: () => void;
}

export function PromptIdeasCarousel({ onUsePrompt, onDismiss }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const PROMPT_IDEAS = t("promptIdeasCarousel.items", { returnObjects: true }) as PromptIdea[];
  const [index, setIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const idea = PROMPT_IDEAS[index];
  const isLast = index === PROMPT_IDEAS.length - 1;
  const isFirst = index === 0;

  const dismiss = async () => {
    impact(ImpactFeedbackStyle.Light);
    if (dontShowAgain) await setHidePromptIdeas(true);
    onDismiss();
  };

  const next = () => {
    impact(ImpactFeedbackStyle.Light);
    setIndex((i) => Math.min(PROMPT_IDEAS.length - 1, i + 1));
  };

  const back = () => {
    impact(ImpactFeedbackStyle.Light);
    setIndex((i) => Math.max(0, i - 1));
  };

  const use = () => {
    impact(ImpactFeedbackStyle.Medium);
    onUsePrompt(idea.prompt);
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <NidoIcon name="ideas" size={20} />
            <Text style={styles.headerTitle}>{t("promptIdeasCarousel.title")}</Text>
          </View>
          <Pressable
            onPress={dismiss}
            hitSlop={8}
            style={styles.closeBtn}
            accessibilityLabel={t("common.close")}
          >
            <NidoIcon name="close" size={14} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.categoryIcon}>{idea.icon}</Text>
          <View style={styles.categoryPill}>
            <Text style={styles.category}>{idea.category.toUpperCase()}</Text>
          </View>
          <Text style={styles.prompt}>{idea.prompt}</Text>
        </ScrollView>

        <View style={styles.stepDots}>
          {PROMPT_IDEAS.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>

        <View style={styles.navRow}>
          <Pressable
            style={[styles.navBtn, isFirst && styles.navBtnDisabled]}
            disabled={isFirst}
            onPress={back}
          >
            <Text style={styles.navBtnText}>‹ {t("promptIdeasCarousel.prev")}</Text>
          </Pressable>
          <Pressable style={styles.useBtn} onPress={use}>
            <Text style={styles.useBtnText}>{t("promptIdeasCarousel.usePrompt")}</Text>
          </Pressable>
          <Pressable
            style={[styles.navBtn, isLast && styles.navBtnDisabled]}
            disabled={isLast}
            onPress={next}
          >
            <Text style={styles.navBtnText}>{t("promptIdeasCarousel.next")} ›</Text>
          </Pressable>
        </View>

        <View style={styles.dismissRow}>
          <Pressable
            style={styles.checkboxRow}
            onPress={() => setDontShowAgain((v) => !v)}
            hitSlop={8}
          >
            <Switch
              value={dontShowAgain}
              onValueChange={setDontShowAgain}
              trackColor={{ false: "#1E293B", true: colors.emerald[600] }}
              thumbColor={dontShowAgain ? colors.emerald[400] : colors.text.dim}
            />
            <Text style={styles.dismissLabel}>{t("promptIdeasCarousel.dontShowAgain")}</Text>
          </Pressable>
          <Pressable onPress={dismiss} hitSlop={8}>
            <Text style={styles.dismissBtn}>{t("common.dismiss")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const getStyles = (colors: Colors) => StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: colors.bg.cardElevated,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.md,
    maxHeight: "75%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    paddingBottom: spacing.xs,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerIcon: {
    fontSize: 14,
  },
  headerTitle: {
    ...typography.mono.xs,
    color: colors.text.heading,
    fontWeight: "800",
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color: colors.text.dim,
    fontSize: 16,
  },
  body: {
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: 8,
  },
  categoryIcon: {
    fontSize: 32,
  },
  categoryPill: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
    borderWidth: 1,
    borderRadius: radii.xs,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  category: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
    fontSize: 9,
  },
  prompt: {
    ...typography.ui.bodyLg,
    color: colors.text.primary,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 4,
  },
  stepDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  dotActive: {
    backgroundColor: colors.emerald[400],
    width: 14,
  },
  navRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  navBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: radii.sm,
  },
  navBtnDisabled: {
    opacity: 0.25,
  },
  navBtnText: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "700",
  },
  useBtn: {
    flex: 1,
    backgroundColor: colors.emerald[600],
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  useBtnText: {
    ...typography.ui.titleSm,
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "800",
  },
  dismissRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dismissLabel: {
    ...typography.ui.caption,
    color: colors.text.dim,
  },
  dismissBtn: {
    ...typography.mono.xs,
    color: colors.crimson[400],
    fontWeight: "600",
  },
});
