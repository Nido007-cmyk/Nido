import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  Switch,
} from "react-native";
import { impact, notification, ImpactFeedbackStyle, NotificationFeedbackType, setHapticsEnabledCache } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { NidoMascot } from "./components/calm/NidoMascot";
import { MODEL_CATALOG, CatalogModel, AssetKind, CORPUS_CATALOG, REQUIRED_MODELS } from "../models/manifest";
import { llamaEngine } from "../inference/LlamaEngine";
import { ModelManager } from "../models/ModelManager";
import { getActiveModelId, setActiveModelId, getHapticsEnabled, setHapticsEnabled } from "../models/settings";
import { seedKnowledgeBaseIfEmpty } from "../rag/seedCorpus";
import { DbLifecycleEndedError } from "../security/secureDatabase";
import type { KeyLossError } from "../privacy/keyManager";
import { closePack } from "../rag/packs";
import {
  startDownload,
  getDownloadState,
  isDownloading,
  subscribeDownloads,
} from "../services/downloadManager";
import { resetAllAppData } from "../services/appReset";
import { CatalogItemCard, CatalogRowState } from "./CatalogItemCard";
import { CorpusSettingsTab } from "./CorpusSettingsTab";
import { PersonalitySettings } from "./PersonalitySettings";
import { UsageStatsContent } from "./UsageStatsContent";
import { VoiceSettings } from "./VoiceSettings";
import { MemorySettings } from "./MemorySettings";
import { AccordionSection } from "./AccordionSection";
import { NidoIcon } from "./components/icons/NidoIcon";
import { SetupWizardScreen } from "./SetupWizardScreen";
import { ThemeSelector } from "./components/ThemeSelector";
import { LanguageSelector } from "./components/LanguageSelector";
import { Toast } from "./Toast";
import { useTheme, colors, typography } from "./theme";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";

const modelManager = new ModelManager();
const LLM_EMBEDDING_KINDS: AssetKind[] = ["llm", "embedding"];

type Props =
  | { mode: "required"; onReady: () => void; onKeyLossError?: (e: KeyLossError) => void }
  | { mode: "optional"; onClose: () => void; onRelaunchWizard?: () => void };

/**
 * ModelSetupScreen handles two operational modes:
 * - "required": First-run onboarding flow using SetupWizardScreen (Hardware Diagnostics ➔ Model Tier ➔ Local Indexing).
 * - "optional": Field Settings dashboard (Tone, Model Catalog, Offline Knowledge Base, Telemetry, and Danger Zone).
 */
export function ModelSetupScreen(props: Props) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const requiredMode = props.mode === "required";
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [activeIds, setActiveIds] = useState<Partial<Record<AssetKind, string>>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [dangerModalVisible, setDangerModalVisible] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [, forceRender] = useState(0);
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);

  useEffect(() => subscribeDownloads(() => forceRender((n) => n + 1)), []);

  const refreshStatus = useCallback(async () => {
    const statuses = await modelManager.statusAll();
    setPresence(Object.fromEntries(statuses.map((s) => [s.asset.id, s.present])));

    const next: Partial<Record<AssetKind, string>> = {};
    for (const kind of LLM_EMBEDDING_KINDS) {
      const active = await getActiveModelId(kind);
      next[kind] = active ?? MODEL_CATALOG.find((m) => m.kind === kind && m.required)?.id;
    }
    setActiveIds(next);

    return statuses;
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    getHapticsEnabled().then(setHapticsEnabledState);
  }, []);

  const toggleHaptics = useCallback(async (value: boolean) => {
    setHapticsEnabledState(value);
    // Cache update happens immediately, not just after the persisted
    // write resolves — a haptic tap could otherwise fire once more (or
    // not fire) between flipping the switch and setHapticsEnabled()
    // finishing, since src/services/haptics.ts reads from an in-memory
    // cache, not settings.ts, on every tap.
    setHapticsEnabledCache(value);
    await setHapticsEnabled(value);
  }, []);

  const getRow = useCallback(
    (item: CatalogModel): CatalogRowState => {
      const dl = getDownloadState(item.id);
      return {
        present: presence[item.id] ?? false,
        downloading: isDownloading(item.id),
        progress: dl?.progress ?? 0,
        error: dl?.error ?? null,
        bytesWritten: dl?.bytesWritten,
        bytesExpected: dl?.bytesExpected,
        speedBytesPerSec: dl?.speedBytesPerSec,
        etaSeconds: dl?.etaSeconds,
      };
    },
    [presence]
  );

  const download = useCallback(
    async (model: CatalogModel) => {
      impact(ImpactFeedbackStyle.Medium);
      await startDownload(model);
      await refreshStatus();

      if (model.kind === "corpus" && !requiredMode && !getDownloadState(model.id)?.error) {
        let seedAborted = false;
        try {
          await seedKnowledgeBaseIfEmpty();
        } catch (e) {
          // Clear All Data a mitad del seed: el trabajo obsoleto se aborta
          // a propósito con DbLifecycleEndedError; el wipe ya deja la app en
          // estado limpio, así que no hay nada que reportar aquí — y no se
          // afirma una indexación que no ocurrió.
          if (e instanceof DbLifecycleEndedError) seedAborted = true;
          else throw e;
        }
        if (!seedAborted) setToast(t("modelSetupScreen.toasts.indexed", { name: model.label }));
      }
    },
    [requiredMode, refreshStatus, t]
  );

  const remove = useCallback(
    async (model: CatalogModel) => {
      if (model.format === "sqlite-pack") await closePack(model.id);
      await modelManager.deleteModel(model);
      await refreshStatus();
      setToast(t("modelSetupScreen.toasts.removed", { name: model.label }));
    },
    [refreshStatus, t]
  );

  // Id of the LLM being loaded after "Use"; blocks other Use/delete/Done until it's ready.
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const useModel = useCallback(
    async (model: CatalogModel) => {
      if (activatingId) return;
      impact(ImpactFeedbackStyle.Light);
      if (model.kind !== "llm") {
        await setActiveModelId(model.kind, model.id);
        await refreshStatus();
        setToast(t("modelSetupScreen.toasts.activeSet", { kind: model.kind, name: model.label }));
        return;
      }
      // Load it here, so the chat is ready on return and a failure shows
      // next to the model that caused it.
      const previousId =
        (await getActiveModelId("llm")) ?? REQUIRED_MODELS.find((m) => m.kind === "llm")!.id;
      setActivatingId(model.id);
      await setActiveModelId("llm", model.id);
      try {
        await llamaEngine.load(model.filename);
        setToast(t("modelSetupScreen.toasts.activeSet", { kind: model.kind, name: model.label }));
      } catch (e: any) {
        // Keep the previous model active; the chat reloads it on return.
        await setActiveModelId("llm", previousId);
        setToast(t("modelSetupScreen.toasts.loadFailed", { name: model.label, error: e?.message ?? String(e) }));
      } finally {
        setActivatingId(null);
        await refreshStatus();
      }
    },
    [activatingId, refreshStatus, t]
  );

  const onRelaunchWizard = !requiredMode
    ? (props as { onRelaunchWizard?: () => void }).onRelaunchWizard
    : undefined;

  const handleExecuteReset = async () => {
    notification(NotificationFeedbackType.Warning);
    setResetting(true);
    try {
      await resetAllAppData();
      setDangerModalVisible(false);
      onRelaunchWizard?.();
    } catch (e: any) {
      setResetting(false);
      setToast(t("modelSetupScreen.toasts.resetFailed", { error: e?.message ?? e }));
    }
  };

  // If required on first run, display the 3-step Setup Wizard!
  if (requiredMode) {
    const p = props as { onReady: () => void; onKeyLossError?: (e: KeyLossError) => void };
    return <SetupWizardScreen onReady={p.onReady} onKeyLossError={p.onKeyLossError} />;
  }

  // Optional mode: Settings Screen
  return (
    <View style={styles.container}>
      {/* Settings Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <NidoMascot role="brand" size={36} />
          <View>
            <Text style={styles.title}>{t("modelSetupScreen.header.title")}</Text>
            <Text style={styles.subtitle}>{t("modelSetupScreen.header.subtitle")}</Text>
          </View>
        </View>
        <Pressable
          style={[styles.closeBtn, activatingId !== null && { opacity: 0.4 }]}
          onPress={(props as { onClose: () => void }).onClose}
          disabled={activatingId !== null}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("common.done")}
        >
          <Text style={styles.closeBtnText}>{t("common.done")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.accordionScroll}>
        <AccordionSection icon="chat" title={t("modelSetupScreen.sections.tone")}>
          <PersonalitySettings />
        </AccordionSection>

        <AccordionSection icon="models" title={t("modelSetupScreen.sections.models")}>
          <Text style={styles.sectionHeading}>{t("modelSetupScreen.installedModels")}</Text>
          <FlatList
            data={[
              ...MODEL_CATALOG.filter((m) => m.kind === "llm"),
            ]}
            keyExtractor={(m) => m.id}
            scrollEnabled={false}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <CatalogItemCard
                item={item}
                row={getRow(item)}
                isActive={activeIds[item.kind] === item.id}
                onDownload={download}
                onUse={useModel}
                onRemove={remove}
                activating={activatingId === item.id}
                busy={activatingId !== null}
              />
            )}
          />

        </AccordionSection>

        <AccordionSection icon="knowledge" title={t("modelSetupScreen.sections.knowledgeBase")}>
          <CorpusSettingsTab
            corpusItems={CORPUS_CATALOG}
            getRow={getRow}
            download={download}
            remove={remove}
          />
        </AccordionSection>

        <AccordionSection icon="memory" title={t("modelSetupScreen.sections.memory")}>
          <MemorySettings />
        </AccordionSection>

        <AccordionSection icon="activity" title={t("modelSetupScreen.sections.telemetry")}>
          <UsageStatsContent />
        </AccordionSection>

        <AccordionSection icon="appearance" title={t("modelSetupScreen.sections.displayTheme")}>
          <View style={styles.themeSectionWrapper}>
            <ThemeSelector />
          </View>
          <View style={styles.hapticRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hapticRowLabel}>{t("interfaceSettings.hapticFeedbackLabel")}</Text>
              <Text style={styles.hapticRowValue}>{t("interfaceSettings.hapticFeedbackValue")}</Text>
            </View>
            <Switch
              value={hapticsEnabled}
              onValueChange={toggleHaptics}
              trackColor={{ false: "#333", true: "#3a7a4a" }}
            />
          </View>
        </AccordionSection>

        <AccordionSection icon="language" title={t("modelSetupScreen.sections.language")}>
          <View style={styles.themeSectionWrapper}>
            <LanguageSelector />
          </View>
        </AccordionSection>

        <AccordionSection icon="mic" title={t("modelSetupScreen.sections.voice")}>
          <VoiceSettings />
        </AccordionSection>

        {/* RECOVERY & DANGER ZONE SECTION */}
        <AccordionSection icon="warning" title={t("modelSetupScreen.sections.recovery")}>
          <View style={styles.recoveryContainer}>
            {/* Setup Wizard Shortcut */}
            <View style={styles.recoveryCard}>
              <View style={styles.recoveryHeader}>
                <NidoIcon name="wizard" size={18} />
                <Text style={styles.recoveryTitle}>{t("modelSetupScreen.recovery.wizardTitle")}</Text>
              </View>
              <Text style={styles.recoveryDesc}>{t("modelSetupScreen.recovery.wizardDesc")}</Text>
              <Pressable
                style={styles.wizardBtn}
                onPress={() => onRelaunchWizard?.()}
                disabled={!onRelaunchWizard}
                accessibilityRole="button"
                accessibilityLabel={t("modelSetupScreen.recovery.wizardButton")}
                accessibilityState={{ disabled: !onRelaunchWizard }}
              >
                <Text style={styles.wizardBtnText}>{t("modelSetupScreen.recovery.wizardButton")}</Text>
              </Pressable>
            </View>

            {/* Danger Zone Card */}
            <View style={styles.dangerZoneCard}>
              <View style={styles.dangerHeader}>
                <View style={styles.dangerBadge}>
                  <Text style={styles.dangerBadgeText}>{t("modelSetupScreen.recovery.dangerBadge")}</Text>
                </View>
              </View>
              <Text style={styles.dangerDesc}>{t("modelSetupScreen.recovery.dangerDesc")}</Text>
              <Pressable
                style={styles.dangerActionBtn}
                onPress={() => {
                  impact(ImpactFeedbackStyle.Heavy);
                  setDangerModalVisible(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={t("modelSetupScreen.recovery.dangerButton")}
                accessibilityHint={t("modelSetupScreen.recovery.dangerDesc")}
              >
                <Text style={styles.dangerActionBtnText}>{t("modelSetupScreen.recovery.dangerButton")}</Text>
              </Pressable>
            </View>
          </View>
        </AccordionSection>
      </ScrollView>

      {/* High-Impact Danger Confirmation Modal */}
      <Modal
        visible={dangerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDangerModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconCircle}>
              <NidoIcon name="warning" size={22} />
            </View>
            <Text style={styles.modalTitle}>{t("modelSetupScreen.dangerModal.title")}</Text>
            <Text style={styles.modalSubtitle}>{t("modelSetupScreen.dangerModal.subtitle")}</Text>

            {/* Itemized consequences list */}
            <View style={styles.consequencesBox}>
              <Text style={styles.consequencesHeader}>{t("modelSetupScreen.dangerModal.consequencesHeader")}</Text>
              <View style={styles.consequenceItem}>
                <Text style={styles.consequenceBullet}>•</Text>
                <Text style={styles.consequenceText}>{t("modelSetupScreen.dangerModal.consequenceModels")}</Text>
              </View>
              <View style={styles.consequenceItem}>
                <Text style={styles.consequenceBullet}>•</Text>
                <Text style={styles.consequenceText}>{t("modelSetupScreen.dangerModal.consequenceEmbeddings")}</Text>
              </View>
              <View style={styles.consequenceItem}>
                <Text style={styles.consequenceBullet}>•</Text>
                <Text style={styles.consequenceText}>{t("modelSetupScreen.dangerModal.consequenceHistory")}</Text>
              </View>
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setDangerModalVisible(false)}
                disabled={resetting}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
                accessibilityState={{ disabled: resetting }}
              >
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirmBtn, resetting && styles.modalConfirmBtnDisabled]}
                onPress={handleExecuteReset}
                disabled={resetting}
                accessibilityRole="button"
                accessibilityLabel={t("modelSetupScreen.dangerModal.confirm")}
                accessibilityHint={t("modelSetupScreen.dangerModal.consequenceHistory")}
                accessibilityState={{ disabled: resetting, busy: resetting }}
              >
                {resetting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>{t("modelSetupScreen.dangerModal.confirmButton")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {toast && <Toast message={toast} onHide={() => setToast(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.comfortable,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.bg.cardElevated,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mascotIcon: {
    fontSize: 22,
  },
  title: {
    ...typography.ui.titleSm,
    color: colors.text.heading,
    letterSpacing: 0.5,
  },
  subtitle: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.dim,
  },
  closeBtn: {
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    borderRadius: calmRadii.subtle,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  closeBtnText: {
    ...typography.mono.xs,
    color: colors.text.accentCyan,
    fontWeight: "800",
  },
  accordionScroll: {
    paddingBottom: calmSpacing.generous,
  },
  sectionHeading: {
    ...typography.mono.xs,
    color: colors.text.dim,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginHorizontal: calmSpacing.comfortable,
    marginTop: calmSpacing.comfortable,
    marginBottom: calmSpacing.tight,
  },
  list: {
    paddingHorizontal: calmSpacing.comfortable,
    gap: calmSpacing.cozy,
  },
  themeSectionWrapper: {
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.tight,
  },
  hapticRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: calmSpacing.cozy,
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.cozy,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  hapticRowLabel: {
    ...typography.ui.subtext,
    color: colors.text.heading,
    fontWeight: "700",
  },
  hapticRowValue: {
    ...typography.mono.xs,
    fontSize: 10,
    color: colors.text.dim,
    marginTop: 2,
  },
  recoveryContainer: {
    padding: calmSpacing.comfortable,
    gap: calmSpacing.comfortable,
  },
  recoveryCard: {
    ...calmShadows.none,
    backgroundColor: colors.bg.cardElevated,
    borderRadius: calmRadii.gentle,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: calmSpacing.comfortable,
    gap: calmSpacing.cozy,
  },
  recoveryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recoveryIcon: {
    fontSize: 14,
  },
  recoveryTitle: {
    ...typography.mono.xs,
    color: colors.text.heading,
    fontWeight: "800",
  },
  recoveryDesc: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  wizardBtn: {
    backgroundColor: colors.cyan.bgSubtle,
    borderColor: colors.cyan.border,
    borderWidth: 1,
    borderRadius: calmRadii.soft,
    paddingVertical: calmSpacing.cozy,
    alignItems: "center",
  },
  wizardBtnText: {
    ...typography.ui.titleSm,
    fontSize: 12,
    color: colors.text.accentCyan,
  },
  dangerZoneCard: {
    ...calmShadows.none,
    backgroundColor: "rgba(239, 68, 68, 0.06)",
    borderRadius: calmRadii.gentle,
    borderWidth: 1,
    borderColor: colors.crimson.border,
    padding: calmSpacing.comfortable,
    gap: calmSpacing.cozy,
  },
  dangerHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  dangerBadge: {
    backgroundColor: colors.crimson.bgSubtle,
    borderColor: colors.crimson[500],
    borderWidth: 1,
    borderRadius: calmRadii.subtle,
    paddingHorizontal: calmSpacing.cozy,
    paddingVertical: calmSpacing.tight,
  },
  dangerBadgeText: {
    ...typography.mono.xs,
    fontSize: 8,
    color: colors.crimson[400],
    fontWeight: "800",
  },
  dangerDesc: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  dangerActionBtn: {
    backgroundColor: colors.crimson[600],
    borderRadius: calmRadii.soft,
    paddingVertical: calmSpacing.comfortable,
    alignItems: "center",
  },
  dangerActionBtnText: {
    ...typography.ui.titleSm,
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: calmSpacing.airy,
  },
  modalCard: {
    ...calmShadows.none,
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.bg.cardElevated,
    borderRadius: calmRadii.gentle,
    borderWidth: 1,
    borderColor: colors.crimson.border,
    padding: calmSpacing.airy,
    alignItems: "center",
    gap: calmSpacing.cozy,
  },
  modalIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.crimson.bgSubtle,
    borderWidth: 1,
    borderColor: colors.crimson[500],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  modalIconText: {
    fontSize: 22,
  },
  modalTitle: {
    ...typography.ui.title,
    color: colors.crimson[400],
    letterSpacing: 0.5,
  },
  modalSubtitle: {
    ...typography.ui.caption,
    color: colors.text.muted,
    textAlign: "center",
  },
  consequencesBox: {
    ...calmShadows.none,
    width: "100%",
    backgroundColor: colors.bg.terminal,
    borderRadius: calmRadii.soft,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: calmSpacing.cozy,
    gap: 6,
    marginVertical: 4,
  },
  consequencesHeader: {
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.text.dim,
    fontWeight: "700",
  },
  consequenceItem: {
    flexDirection: "row",
    gap: 6,
  },
  consequenceBullet: {
    color: colors.crimson[400],
    fontWeight: "700",
  },
  consequenceText: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    flex: 1,
    lineHeight: 16,
  },
  modalActions: {
    flexDirection: "row",
    gap: calmSpacing.cozy,
    width: "100%",
    marginTop: calmSpacing.tight,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: calmRadii.soft,
    paddingVertical: calmSpacing.comfortable,
    alignItems: "center",
  },
  modalCancelText: {
    ...typography.ui.titleSm,
    color: colors.text.heading,
  },
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: colors.crimson[600],
    borderRadius: calmRadii.soft,
    paddingVertical: calmSpacing.comfortable,
    alignItems: "center",
  },
  modalConfirmBtnDisabled: {
    opacity: 0.5,
  },
  modalConfirmText: {
    ...typography.ui.titleSm,
    color: "#FFFFFF",
    fontWeight: "800",
  },
});
