/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Alert,
  TextInput,
} from "react-native";
import { impact, notification, ImpactFeedbackStyle, NotificationFeedbackType, setHapticsEnabledCache } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { NidoMascot } from "./components/calm/NidoMascot";
import { MODEL_CATALOG, CatalogModel, AssetKind, CORPUS_CATALOG } from "../models/manifest";
import { defaultLlmForDevice } from "../models/defaultModel";
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
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { makeSurfaces } from "./theme/surfaces";
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
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t } = useTranslation();
  const requiredMode = props.mode === "required";
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [activeIds, setActiveIds] = useState<Partial<Record<AssetKind, string>>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [dangerModalVisible, setDangerModalVisible] = useState(false);
  // A1: restaurar un respaldo hecho con otra clave (otro teléfono o antes
  // de rotar). El usuario escribe la clave que guardó al crear el respaldo.
  const [restoreKeyVisible, setRestoreKeyVisible] = useState(false);
  const [restoreKeyText, setRestoreKeyText] = useState("");
  const [restoreKeyBusy, setRestoreKeyBusy] = useState(false);

  const handleRestoreWithKey = async () => {
    const { normalizeBackupKey, restoreBackupWithKey } = await import("../security/backup");
    if (!normalizeBackupKey(restoreKeyText)) {
      Alert.alert(t("backup.errorTitle"), t("backup.keyInvalid"));
      return;
    }
    setRestoreKeyBusy(true);
    try {
      const DocumentPicker = await import("expo-document-picker");
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (result.canceled) return;
      const uri = result.assets[0].uri;
      const { requireUnlock } = await import("../security/biometricGate");
      await requireUnlock(t("backup.restoreTitle"));
      await restoreBackupWithKey(uri, restoreKeyText);
      setRestoreKeyVisible(false);
      setRestoreKeyText("");
      Alert.alert(t("backup.restoreDoneTitle"), t("backup.restoreDoneBody"), [{ text: t("backup.ok") }]);
    } catch (e) {
      Alert.alert(t("backup.errorTitle"), e instanceof Error ? e.message : t("backup.restoreFailed"));
    } finally {
      setRestoreKeyBusy(false);
    }
  };
  const [resetting, setResetting] = useState(false);
  const [, forceRender] = useState(0);
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  // TESTFIX-2026-10-08 (Fix 7): toggle de tareas delegadas (default OFF).
  const [delegationEnabled, setDelegationEnabledState] = useState(false);

  useEffect(() => subscribeDownloads(() => forceRender((n) => n + 1)), []);

  const refreshStatus = useCallback(async () => {
    const statuses = await modelManager.statusAll();
    setPresence(Object.fromEntries(statuses.map((s) => [s.asset.id, s.present])));

    const next: Partial<Record<AssetKind, string>> = {};
    for (const kind of LLM_EMBEDDING_KINDS) {
      const active = await getActiveModelId(kind);
      // RAM-aware default for the LLM kind; required entry for the rest.
      next[kind] =
        active ??
        (kind === "llm"
          ? defaultLlmForDevice().id
          : MODEL_CATALOG.find((m) => m.kind === kind && m.required)?.id);
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

  // TESTFIX-2026-10-08 (Fix 7): cargar el flag persistido.
  useEffect(() => {
    import("../config/featureFlags").then(({ isFeatureEnabled }) =>
      setDelegationEnabledState(isFeatureEnabled("delegation.enabled"))
    ).catch(() => {});
  }, []);

  const toggleDelegation = useCallback(async (value: boolean) => {
    setDelegationEnabledState(value);
    try {
      const { setFeatureEnabled } = await import("../config/featureFlags");
      await setFeatureEnabled("delegation.enabled", value);
    } catch {
      // Si no se pudo persistir, revertir el switch.
      setDelegationEnabledState(!value);
    }
  }, []);

  const toggleHaptics = useCallback(async (value: boolean) => {
    const prev = !value;
    setHapticsEnabledState(value);
    // Cache update happens immediately, not just after the persisted
    // write resolves — a haptic tap could otherwise fire once more (or
    // not fire) between flipping the switch and setHapticsEnabled()
    // finishing, since src/services/haptics.ts reads from an in-memory
    // cache, not settings.ts, on every tap.
    setHapticsEnabledCache(value);
    try {
      await setHapticsEnabled(value);
    } catch {
      // FIX 2026-10-09 (UI-AUDIT/F4): revertir si no se pudo persistir.
      setHapticsEnabledState(prev);
      setHapticsEnabledCache(prev);
    }
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
        (await getActiveModelId("llm")) ?? defaultLlmForDevice().id;
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

        {/* TESTFIX-2026-10-08 (Fix 7): tareas delegadas, default OFF. */}
        <AccordionSection icon="activity" title={t("settings.delegationTitle")}>
          <View style={styles.hapticRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hapticRowLabel}>{t("settings.delegationTitle")}</Text>
              <Text style={styles.hapticRowValue}>{t("settings.delegationDesc")}</Text>
            </View>
            <Switch
              value={delegationEnabled}
              onValueChange={toggleDelegation}
              trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
              thumbColor={colors.bg.card}
            />
          </View>
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
              trackColor={{ false: colors.border.elevated, true: colors.emerald[400] }}
              thumbColor={colors.bg.card}
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

            {/* BACKUP 2026-10-07: respaldo y restauración de la base cifrada. */}
            <View style={styles.recoveryCard}>
              <View style={styles.recoveryHeader}>
                <NidoIcon name="security" size={18} />
                <Text style={styles.recoveryTitle}>Backup</Text>
              </View>
              <Text style={styles.recoveryDesc}>
                {t("backup.sectionDesc")}
              </Text>
              <Pressable accessibilityLabel={t("backup.createButton")}
                style={styles.wizardBtn}
                onPress={async () => {
                  try {
                    // TESTFIX-2026-10-08 (Fix 6): lógica extraída a
                    // backupShare.ts; la alerta ahora ofrece Compartir para
                    // sacar el archivo de la carpeta privada del app.
                    const { createBackupFile } = await import("./backupShare");
                    const { path, key } = await createBackupFile();
                    // Mostrar la clave para que el usuario la copie.
                    Alert.alert(
                      t("backup.dekTitle"),
                      `${t("backup.dekSavedIn")} ${path}\n\n${t("backup.dekCopyPrompt")}\n${key}`,
                      [
                        {
                          text: t("backup.shareButton"),
                          onPress: async () => {
                            try {
                              const { shareBackupFile } = await import("./backupShare");
                              await shareBackupFile(path);
                            } catch {
                              Alert.alert(t("backup.errorTitle"), t("backup.shareFailed"));
                            }
                          },
                        },
                        { text: t("backup.ok") },
                      ]
                    );
                  } catch (e) {
                    Alert.alert(t("backup.errorTitle"), e instanceof Error ? e.message : t("backup.createFailed"));
                  }
                }}
                accessibilityRole="button"
              >
                <Text style={styles.wizardBtnText}>{t("backup.createButton")}</Text>
              </Pressable>
              <Pressable accessibilityLabel={t("backup.shareButton")}
                style={[styles.wizardBtn, { marginTop: 8 }]}
                onPress={async () => {
                  try {
                    const { findLatestBackup, shareBackupFile } = await import("./backupShare");
                    const latest = await findLatestBackup();
                    if (!latest) {
                      Alert.alert(t("backup.noBackupsTitle"), t("backup.noBackupsBody"));
                      return;
                    }
                    await shareBackupFile(latest);
                  } catch (e) {
                    Alert.alert(t("backup.errorTitle"), e instanceof Error && e.message === "sharing-unavailable"
                      ? t("backup.sharingUnavailable")
                      : t("backup.shareFailed"));
                  }
                }}
                accessibilityRole="button"
              >
                <Text style={styles.wizardBtnText}>{t("backup.shareButton")}</Text>
              </Pressable>
              <Pressable accessibilityLabel={t("backup.restoreButton")}
                style={[styles.wizardBtn, { marginTop: 8 }]}
                onPress={async () => {
                  try {
                    const DocumentPicker = await import("expo-document-picker");
                    const result = await DocumentPicker.getDocumentAsync({
                      type: "*/*",
                      copyToCacheDirectory: true,
                    });
                    if (result.canceled) return;
                    const uri = result.assets[0].uri;
                    const { validateBackup, restoreBackup } = await import("../security/backup");
                    const v = await validateBackup(uri);
                    if (!v.valid) {
                      Alert.alert(t("backup.invalidTitle"), v.reason ?? t("backup.invalidBody"));
                      return;
                    }
                    Alert.alert(
                      t("backup.restoreTitle"),
                      t("backup.restoreConfirm"),
                      [
                        { text: t("backup.cancel"), style: "cancel" },
                        {
                          text: t("backup.restoreConfirmButton"),
                          style: "destructive",
                          onPress: async () => {
                            try {
                              // FIX 2026-10-09 (RESTORE-BIOMETRIC): restauración es
                              // destructiva (reemplaza todos los datos) → requiere
                              // autenticación biométrica.
                              const { requireUnlock } = await import("../security/biometricGate");
                              await requireUnlock(t("backup.restoreTitle"));
                              await restoreBackup(uri);
                              Alert.alert(
                                t("backup.restoreDoneTitle"),
                                t("backup.restoreDoneBody"),
                                [{ text: t("backup.ok") }]
                              );
                            } catch (e) {
                              Alert.alert(t("backup.errorTitle"), e instanceof Error ? e.message : t("backup.restoreFailed"));
                            }
                          },
                        },
                      ]
                    );
                  } catch (e) {
                    Alert.alert(t("backup.errorTitle"), e instanceof Error ? e.message : t("backup.pickerFailed"));
                  }
                }}
                accessibilityRole="button"
              >
                <Text style={styles.wizardBtnText}>{t("backup.restoreButton")}</Text>
              </Pressable>
              <Pressable
                style={styles.wizardBtn}
                onPress={() => setRestoreKeyVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={t("backup.restoreWithKeyButton")}
              >
                <Text style={styles.wizardBtnText}>{t("backup.restoreWithKeyButton")}</Text>
              </Pressable>
            </View>
          </View>
        </AccordionSection>
      </ScrollView>

      {/* A1: restaurar con la clave del respaldo */}
      <Modal
        visible={restoreKeyVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRestoreKeyVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t("backup.restoreWithKeyTitle")}</Text>
            <Text style={styles.modalSubtitle}>{t("backup.restoreWithKeyBody")}</Text>
            <TextInput
              style={styles.restoreKeyInput}
              value={restoreKeyText}
              onChangeText={setRestoreKeyText}
              placeholder={t("backup.keyPlaceholder")}
              placeholderTextColor={colors.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              accessibilityLabel={t("backup.keyPlaceholder")}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => {
                  setRestoreKeyVisible(false);
                  setRestoreKeyText("");
                }}
                accessibilityRole="button"
                accessibilityLabel={t("backup.cancel")}
              >
                <Text style={styles.modalCancelText}>{t("backup.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.restoreKeyConfirm, restoreKeyBusy && styles.modalConfirmBtnDisabled]}
                onPress={handleRestoreWithKey}
                disabled={restoreKeyBusy}
                accessibilityRole="button"
                accessibilityLabel={t("backup.chooseFile")}
              >
                <Text style={styles.modalConfirmText}>{t("backup.chooseFile")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
                  <ActivityIndicator color={colors.text.inverse} size="small" />
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

const getStyles = (colors: Colors, typography: Typography) => {
  const ui = makeSurfaces(colors, typography);
  return StyleSheet.create({
  container: ui.page,
  header: ui.topBar,
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mascotIcon: {
    fontSize: 22,
  },
  title: ui.topBarTitle,
  subtitle: { ...typography.ui.caption, color: colors.text.secondary },
  closeBtn: ui.topBarAction,
  closeBtnText: ui.topBarActionText,
  accordionScroll: {
    paddingBottom: calmSpacing.generous,
  },
  sectionHeading: {
    ...ui.sectionLabel,
    marginHorizontal: calmSpacing.comfortable + 4,
    marginTop: calmSpacing.airy,
    marginBottom: calmSpacing.cozy,
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
  hapticRowLabel: { ...typography.ui.body, color: colors.text.primary, fontWeight: "600" },
  hapticRowValue: { ...typography.ui.caption, color: colors.text.secondary, marginTop: 2 },
  recoveryContainer: {
    padding: calmSpacing.comfortable,
    gap: calmSpacing.comfortable,
  },
  recoveryCard: ui.card,
  recoveryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recoveryIcon: {
    fontSize: 14,
  },
  recoveryTitle: { ...typography.ui.body, color: colors.text.heading, fontWeight: "700" },
  recoveryDesc: ui.caption,
  wizardBtn: ui.secondaryButton,
  wizardBtnText: ui.secondaryButtonText,
  dangerZoneCard: { ...ui.card, backgroundColor: colors.crimson.bgSubtle, borderColor: colors.crimson.border },
  dangerHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  dangerBadge: {
    backgroundColor: colors.crimson.bgSubtle,
    borderRadius: calmRadii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dangerBadgeText: { ...typography.ui.micro, color: colors.crimson[600], fontWeight: "700" },
  dangerDesc: ui.caption,
  dangerActionBtn: ui.dangerButton,
  dangerActionBtnText: ui.dangerButtonText,
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.bg.modalOverlay,
    alignItems: "center",
    justifyContent: "center",
    padding: calmSpacing.airy,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.bg.card,
    borderRadius: 20,
    padding: calmSpacing.airy,
    alignItems: "center",
    gap: calmSpacing.cozy,
  },
  modalIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.crimson.bgSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  modalIconText: {
    fontSize: 22,
  },
  modalTitle: { ...typography.ui.title, color: colors.text.heading, fontWeight: "700", textAlign: "center" },
  modalSubtitle: { ...typography.ui.caption, color: colors.text.secondary, textAlign: "center" },
  consequencesBox: { ...ui.inset, width: "100%", gap: 6, marginVertical: 4 },
  consequencesHeader: ui.sectionLabel,
  consequenceItem: {
    flexDirection: "row",
    gap: 6,
  },
  consequenceBullet: { color: colors.crimson[500], fontWeight: "700" },
  consequenceText: { ...typography.ui.caption, color: colors.text.secondary, flex: 1 },
  modalActions: {
    flexDirection: "row",
    gap: calmSpacing.cozy,
    width: "100%",
    marginTop: calmSpacing.tight,
  },
  modalCancelBtn: { ...ui.secondaryButton, flex: 1 },
  modalCancelText: ui.secondaryButtonText,
  modalConfirmBtn: { ...ui.primaryButton, flex: 1, backgroundColor: colors.crimson[500], borderColor: colors.crimson[500] },
  restoreKeyInput: { ...ui.input, width: "100%", minHeight: 88, fontFamily: "monospace", textAlignVertical: "top" },
  restoreKeyConfirm: { ...ui.primaryButton, flex: 1 },
  modalConfirmBtnDisabled: {
    opacity: 0.5,
  },
  modalConfirmText: ui.primaryButtonText,
});
};
