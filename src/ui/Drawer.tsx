/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Dimensions, ScrollView, Image } from "react-native";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { ChatSession } from "../services/chatHistory";
import { DrawerFooterStats } from "./DrawerFooterStats";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { NidoIcon, type IconName } from "./components/icons/NidoIcon";
import { spacing, radii } from "./theme/spacing";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(310, SCREEN_WIDTH * 0.82);

export interface DrawerItem {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: DrawerItem[];
  sessions?: ChatSession[];
  activeSessionId?: string | null;
  onNewChat?: () => void;
  onSelectSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
}

function formatTimestamp(ms: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diffMin = (Date.now() - ms) / 60000;
  if (diffMin < 1) return t("time.justNow");
  if (diffMin < 60) return t("time.minutesAgo", { count: Math.floor(diffMin) });
  const diffHr = diffMin / 60;
  if (diffHr < 24) return t("time.hoursAgo", { count: Math.floor(diffHr) });
  return t("time.daysAgo", { count: Math.floor(diffHr / 24) });
}

export function Drawer({
  open,
  onClose,
  items,
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: Props) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);

  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: open ? 0 : -DRAWER_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: open ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, translateX, backdropOpacity]);

  const handleAction = (callback: () => void) => {
    impact(ImpactFeedbackStyle.Light);
    callback();
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        onTouchEnd={onClose}
      />
      <Animated.View style={[styles.panel, { transform: [{ translateX }] }]}>
        <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
          {/* Brand Row */}
          <View style={styles.brandRow}>
            <Image source={require("../../assets/icon-nido.png")} style={styles.brandMascot} />
            <View style={styles.brandText}>
              <Text style={styles.title}>NIDO</Text>
              <Text style={styles.subtitle}>{t("drawer.subtitle")}</Text>
            </View>
          </View>

          {/* New Chat Button */}
          {onNewChat && (
            <Pressable
              style={styles.newChatBtn}
              onPress={() => {
                handleAction(() => {
                  onClose();
                  onNewChat();
                });
              }}
            >
              <NidoIcon name="new-chat" size={18} color={colors.text.accentEmerald} />
              <Text style={styles.newChatLabel}>{t("drawer.newChat")}</Text>
            </Pressable>
          )}

          {/* Recent Sessions */}
          {sessions && sessions.length > 0 && (
            <>
              <Text style={styles.sectionHeading}>{t("drawer.recentSessions")}</Text>
              <ScrollView style={styles.sessionList}>
                {sessions.map((s) => {
                  const active = s.id === activeSessionId;
                  return (
                    <Pressable
                      key={s.id}
                      style={[styles.sessionRow, active && styles.sessionRowActive]}
                      onPress={() => {
                        handleAction(() => {
                          onClose();
                          onSelectSession?.(s.id);
                        });
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sessionTitle} numberOfLines={1}>
                          {s.title}
                        </Text>
                        <Text style={styles.sessionTime}>{formatTimestamp(s.updatedAt, t)}</Text>
                      </View>
                      <Pressable
                        hitSlop={8}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleAction(() => onDeleteSession?.(s.id));
                        }}
                      >
                        <NidoIcon name="delete" size={14} />
                      </Pressable>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.divider} />
            </>
          )}

          {/* Navigation Items */}
          <View style={styles.itemList}>
            {items.map((item) => (
              <Pressable
                key={item.key}
                style={styles.item}
                onPress={() => {
                  handleAction(() => {
                    onClose();
                    item.onPress();
                  });
                }}
              >
                <NidoIcon name={item.icon} size={20} />
                <Text style={styles.itemLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <DrawerFooterStats />
      </Animated.View>
    </View>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.bg.cardElevated,
    paddingTop: 56,
    paddingHorizontal: 16,
    borderRightWidth: 1,
    borderRightColor: colors.border.default,
  },
  scrollArea: { flex: 1 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  brandText: { flex: 1, flexShrink: 1 },
  brandMascot: { width: 36, height: 36, borderRadius: radii.md },
  title: {
    ...typography.ui.title,
    color: colors.text.heading,
  },
  subtitle: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.accentEmerald,
    marginTop: 1,
  },
  newChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: colors.emerald.bgSubtle,
    borderWidth: 1,
    borderColor: colors.emerald.border,
    marginBottom: 12,
  },
  newChatIcon: { color: colors.text.accentEmerald, fontSize: 16, fontWeight: "800" },
  newChatLabel: {
    ...typography.ui.titleSm,
    color: colors.text.accentEmerald,
    fontSize: 13,
  },
  sectionHeading: {
    ...typography.mono.xs,
    color: colors.text.dim,
    fontWeight: "700",
    marginBottom: 6,
    marginTop: 4,
  },
  sessionList: { maxHeight: 220 },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
  },
  sessionRowActive: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
    borderWidth: 1,
  },
  sessionTitle: {
    ...typography.ui.caption,
    color: colors.text.primary,
    fontWeight: "500",
  },
  sessionTime: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.dim,
    marginTop: 2,
  },
  sessionTrash: { fontSize: 13, opacity: 0.7 },
  divider: { height: 1, backgroundColor: colors.border.subtle, marginVertical: 12 },
  itemList: { gap: 4 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radii.md,
  },
  itemIcon: { fontSize: 18 },
  itemLabel: {
    ...typography.ui.titleSm,
    color: colors.text.heading,
  },
});
