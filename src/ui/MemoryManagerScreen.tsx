import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { NidoIcon } from "./components/icons/NidoIcon";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";
import { EmptyState } from "./components/calm/EmptyState";
import {
  getFacts,
  deleteFact,
  getPeople,
  deletePerson,
  listNotes,
  deleteNote,
  listReminders,
  deleteReminder,
  completeReminder,
  type AgentNote,
  type AgentReminder,
} from "../agent/memory/memoryStore";
import type { Fact, Person } from "../agent/memory/types";
import { impact, ImpactFeedbackStyle } from "../services/haptics";

type Tab = "facts" | "notes" | "people" | "reminders";

/**
 * MemoryManagerScreen: permite al usuario ver y gestionar lo que NIDO
 * recuerda — facts, notas, personas y recordatorios. El backend ya existía
 * (memoryStore.ts) pero no tenía surface; esta pantalla cierra el gap
 * CORE ONLY → WIRED.
 */
export function MemoryManagerScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("facts");
  const [loading, setLoading] = useState(true);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [reminders, setReminders] = useState<AgentReminder[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, n, p, r] = await Promise.all([
        getFacts(100),
        listNotes(50),
        getPeople(),
        listReminders(50),
      ]);
      setFacts(f);
      setNotes(n);
      setPeople(p);
      setReminders(r);
    } catch (e) {
      // Error honesto: no crash silencioso
      console.warn("[MemoryManager] load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = useCallback(
    (title: string, message: string, onConfirm: () => Promise<void>) => {
      Alert.alert(title, message, [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            await onConfirm();
            await load();
          },
        },
      ]);
    },
    [load, t]
  );

  const handleClose = () => {
    impact(ImpactFeedbackStyle.Light);
    onClose();
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "facts", label: t("memoryManager.tabs.facts"), icon: "memory" },
    { key: "notes", label: t("memoryManager.tabs.notes"), icon: "note" },
    { key: "people", label: t("memoryManager.tabs.people"), icon: "person" },
    { key: "reminders", label: t("memoryManager.tabs.reminders"), icon: "reminder" },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoIcon name="memory" size={20} />
          <Text style={styles.title}>{t("memoryManager.title")}</Text>
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

      <View style={styles.tabBar}>
        {tabs.map((tb) => (
          <Pressable
            key={tb.key}
            onPress={() => setTab(tb.key)}
            style={[styles.tab, tab === tb.key && styles.tabActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === tb.key }}
            accessibilityLabel={tb.label}
          >
            <Text style={[styles.tabText, tab === tb.key && styles.tabTextActive]}>
              {tb.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.emerald[400]} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {tab === "facts" &&
            (facts.length === 0 ? (
              <EmptyState
                title={t("memoryManager.facts.emptyTitle")}
                description={t("memoryManager.facts.emptyDescription")}
              />
            ) : (
              facts.map((f) => (
                <View key={f.id} style={styles.card}>
                  <Text style={styles.cardText}>{f.content}</Text>
                  <Pressable
                    onPress={() =>
                      confirmDelete(
                        t("memoryManager.deleteTitle"),
                        t("memoryManager.deleteMessage"),
                        () => deleteFact(f.id)
                      )
                    }
                    hitSlop={8}
                    style={styles.deleteBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.delete")}
                  >
                    <NidoIcon name="delete" size={16} />
                  </Pressable>
                </View>
              ))
            ))}

          {tab === "notes" &&
            (notes.length === 0 ? (
              <EmptyState
                title={t("memoryManager.notes.emptyTitle")}
                description={t("memoryManager.notes.emptyDescription")}
              />
            ) : (
              notes.map((n) => (
                <View key={n.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{n.title}</Text>
                  {n.body ? <Text style={styles.cardText}>{n.body}</Text> : null}
                  <Pressable
                    onPress={() =>
                      confirmDelete(
                        t("memoryManager.deleteTitle"),
                        t("memoryManager.deleteMessage"),
                        () => deleteNote(n.id)
                      )
                    }
                    hitSlop={8}
                    style={styles.deleteBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.delete")}
                  >
                    <NidoIcon name="delete" size={16} />
                  </Pressable>
                </View>
              ))
            ))}

          {tab === "people" &&
            (people.length === 0 ? (
              <EmptyState
                title={t("memoryManager.people.emptyTitle")}
                description={t("memoryManager.people.emptyDescription")}
              />
            ) : (
              people.map((p) => (
                <View key={p.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{p.name}</Text>
                  {p.notes ? <Text style={styles.cardText}>{p.notes}</Text> : null}
                  <Pressable
                    onPress={() =>
                      confirmDelete(
                        t("memoryManager.deleteTitle"),
                        t("memoryManager.deleteMessage"),
                        () => deletePerson(p.id)
                      )
                    }
                    hitSlop={8}
                    style={styles.deleteBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.delete")}
                  >
                    <NidoIcon name="delete" size={16} />
                  </Pressable>
                </View>
              ))
            ))}

          {tab === "reminders" &&
            (reminders.length === 0 ? (
              <EmptyState
                title={t("memoryManager.reminders.emptyTitle")}
                description={t("memoryManager.reminders.emptyDescription")}
              />
            ) : (
              reminders.map((r) => (
                <View key={r.id} style={[styles.card, r.done === 1 && styles.cardDone]}>
                  <Text style={[styles.cardText, r.done === 1 && styles.cardTextDone]}>
                    {r.text}
                  </Text>
                  {r.due_at ? (
                    <Text style={styles.cardMeta}>{r.due_at}</Text>
                  ) : null}
                  <View style={styles.cardActions}>
                    {r.done !== 1 && (
                      <Pressable
                        onPress={async () => {
                          await completeReminder(r.id);
                          await load();
                        }}
                        hitSlop={8}
                        style={styles.actionBtn}
                        accessibilityRole="button"
                        accessibilityLabel={t("memoryManager.markDone")}
                      >
                        <NidoIcon name="check" size={16} />
                      </Pressable>
                    )}
                    <Pressable
                      onPress={() =>
                        confirmDelete(
                          t("memoryManager.deleteTitle"),
                          t("memoryManager.deleteMessage"),
                          () => deleteReminder(r.id)
                        )
                      }
                      hitSlop={8}
                      style={styles.deleteBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.delete")}
                    >
                      <NidoIcon name="delete" size={16} />
                    </Pressable>
                  </View>
                </View>
              ))
            ))}
        </ScrollView>
      )}
    </View>
  );
}

const getStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.surface },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: calmSpacing.comfortable,
      paddingVertical: calmSpacing.comfortable,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
      backgroundColor: colors.bg.cardElevated,
      ...calmShadows.none,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: calmSpacing.cozy,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text.primary,
    },
    closeBtn: {
      paddingHorizontal: calmSpacing.cozy,
      paddingVertical: 6,
    },
    closeBtnText: {
      color: colors.emerald[500],
      fontWeight: "600",
      fontSize: 16,
    },
    tabBar: {
      flexDirection: "row",
      paddingHorizontal: calmSpacing.comfortable,
      paddingVertical: calmSpacing.cozy,
      gap: calmSpacing.cozy,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    tab: {
      paddingHorizontal: calmSpacing.cozy,
      paddingVertical: 8,
      borderRadius: calmRadii.gentle,
    },
    tabActive: {
      backgroundColor: colors.emerald.bgSubtle,
    },
    tabText: {
      color: colors.text.secondary,
      fontSize: 14,
      fontWeight: "600",
    },
    tabTextActive: {
      color: colors.emerald[600],
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    body: {
      padding: calmSpacing.comfortable,
      gap: calmSpacing.cozy,
    },
    card: {
      backgroundColor: colors.bg.cardElevated,
      borderRadius: calmRadii.gentle,
      padding: calmSpacing.comfortable,
      borderWidth: 1,
      borderColor: colors.border.default,
      ...calmShadows.none,
    },
    cardDone: {
      opacity: 0.6,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text.primary,
      marginBottom: 4,
    },
    cardText: {
      fontSize: 14,
      color: colors.text.primary,
      lineHeight: 20,
    },
    cardTextDone: {
      textDecorationLine: "line-through",
      color: colors.text.muted,
    },
    cardMeta: {
      fontSize: 12,
      color: colors.text.muted,
      marginTop: 4,
    },
    cardActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: calmSpacing.cozy,
      marginTop: calmSpacing.cozy,
    },
    actionBtn: {
      padding: 8,
      borderRadius: calmRadii.subtle,
      backgroundColor: colors.emerald.bgSubtle,
    },
    deleteBtn: {
      padding: 8,
      borderRadius: calmRadii.subtle,
    },
  });
