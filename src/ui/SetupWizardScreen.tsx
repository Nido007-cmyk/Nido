/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * SetupWizardScreen — first-run onboarding, Tier 2 visual direction.
 *
 * Frozen baseline: Tier 1.1 + Tier 2 (2026-09-27). Daylight is the primary
 * reference, Night Garden the designed dark theme. Plain language, sentence
 * case, 4pt spacing grid, neutral mascot slot (no mascot art until
 * BASE_MASTER V2 is approved).
 *
 * Functional behavior (downloads, retry/restart escape hatches, foreground
 * resume, indexing, haptics) is unchanged — this lane is visual only.
 * T-005: restartAllDownloads() restarts from zero; it is never called
 * "resume".
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  AppState,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { impact, notification, ImpactFeedbackStyle, NotificationFeedbackType } from "../services/haptics";
import { useTranslation } from "react-i18next";
import { NidoMascot } from "./components/calm/NidoMascot";
import { NidoIcon } from "./components/icons/NidoIcon";
import * as FileSystem from "expo-file-system/legacy";
import { getDeviceTotalRamBytes } from "ram-monitor";
import { activateKeepAwake, deactivateKeepAwake } from "expo-keep-awake";
import { withStage } from "../utils/stageError";
import {
  TIERS,
  SetupTier,
  MODEL_CATALOG,
  CORPUS_CATALOG,
  CatalogModel,
  totalManifestBytes,
} from "../models/manifest";
import { defaultLlmForRam, setupLlmChoices, preselectLlmId, contextSpecForModel } from "../models/defaultModel";
import { estimateContextBytes, toGb } from "../inference/ramBudget";
import { setActiveModelId } from "../models/settings";
import { ModelManager } from "../models/ModelManager";
import {
  startDownload,
  restartDownload,
  getDownloadState,
  subscribeDownloads,
} from "../services/downloadManager";
import { onSeedProgress, seedKnowledgeBaseIfEmpty, SeedProgress } from "../rag/seedCorpus";
import { KeyLossError } from "../privacy/keyManager";
import { embeddingEngine } from "../rag/embed";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import { LanguageSelector } from "./components/LanguageSelector";
import { calmSpacing, calmRadii, calmShadows } from "./theme/calm";

const modelManager = new ModelManager();

interface Props {
  onReady: () => void;
  onSkip?: () => void;
  /**
   * N4: si el indexado falla con KeyLossError (bases cifradas presentes, DEK
   * ausente), no se muestra el "Reintentar" genérico: se delega a la
   * pantalla honesta de recuperación. Opcional para no romper otros usos.
   */
  onKeyLossError?: (e: KeyLossError) => void;
}

type WizardStep = 1 | 2 | 3 | 4;

interface HardwareScan {
  totalRamBytes: number;
  freeStorageBytes: number;
  scanned: boolean;
}

/** 4 GB total RAM: below this the recommended model may be slow. Heuristic
 *  for the friendly verdict only — not a capability gate. */
const RAM_COMFORT_BYTES = 4 * 1024 * 1024 * 1024;
/** Below 3 GB free the storage verdict turns cautious. */
const STORAGE_COMFORT_BYTES = 3 * 1024 * 1024 * 1024;

function formatGB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0.0 GB";
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatEta(seconds: number | undefined, estimatingLabel: string): string {
  if (seconds == null || seconds <= 0 || !isFinite(seconds)) return estimatingLabel;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}

/** Seconds left at the pace since the screen started watching, or undefined while too early to tell. */
function seedEtaSeconds(p: SeedProgress, start: { at: number; done: number } | null): number | undefined {
  if (!start) return undefined;
  const elapsed = (Date.now() - start.at) / 1000;
  const indexed = p.done - start.done;
  if (elapsed < 3 || indexed < 5) return undefined;
  return ((p.total - p.done) * elapsed) / indexed;
}


/**
 * Tier 2 segmented progress (mockup frame 01): four segments with plain-word
 * labels. The active segment fills with its step progress (download/indexing
 * fraction); completed segments are full, upcoming ones are the line color.
 */
function SegProgress({
  current,
  labels,
  progress,
}: {
  current: number;
  labels: string[];
  progress?: number;
}) {
  const { colors, typography: tp } = useTheme();
  return (
    <View style={segStyles.row} accessibilityRole="progressbar">
      {labels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const fill = done ? 1 : active ? progress ?? 0 : 0;
        return (
          <View key={label} style={segStyles.seg}>
            <View style={[segStyles.track, { backgroundColor: colors.border.default }]}>
              {fill > 0 && (
                <View
                  style={[
                    segStyles.fill,
                    {
                      width: `${Math.max(fill * 100, 6)}%`,
                      backgroundColor: colors.text.accentEmerald,
                    },
                  ]}
                />
              )}
            </View>
            <Text
              style={[
                segStyles.label,
                tp.ui.caption,
                {
                  color: active
                    ? colors.text.primary
                    : done
                    ? colors.text.secondary
                    : colors.text.muted,
                  fontWeight: active ? "700" : "500",
                },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const segStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: calmSpacing.cozy,
    paddingHorizontal: calmSpacing.airy,
    paddingTop: calmSpacing.comfortable,
    paddingBottom: calmSpacing.cozy,
  },
  seg: { flex: 1, gap: 6 },
  track: {
    height: 4,
    borderRadius: calmRadii.pill,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: calmRadii.pill,
  },
  label: {
    textAlign: "center",
  },
});

/** Tier 2 progress bar: 8dp track in the line color, accent fill. */
function Bar({ value, tone }: { value: number; tone?: "accent" | "ok" | "warn" }) {
  const { colors } = useTheme();
  const fillColor =
    tone === "ok"
      ? colors.emerald[500]
      : tone === "warn"
      ? colors.amber[500]
      : colors.text.accentEmerald;
  return (
    <View style={[barStyles.track, { backgroundColor: colors.border.default }]}>
      <View
        style={[
          barStyles.fill,
          { width: `${Math.max(Math.min(value, 1) * 100, 4)}%`, backgroundColor: fillColor },
        ]}
      />
    </View>
  );
}

const barStyles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: calmRadii.pill,
    overflow: "hidden",
  },
  fill: {
    height: 8,
    borderRadius: calmRadii.pill,
  },
});

/** Small tinted icon badge; glyphs are drawn with plain Views (no emoji). */
function IconBadge({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[badgeStyles.badge, { backgroundColor: colors.emerald.bgSubtle }]}>
      {children}
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    width: 40,
    height: 40,
    borderRadius: calmRadii.gentle,
    alignItems: "center",
    justifyContent: "center",
  },
});

function BarsGlyph() {
  const { colors } = useTheme();
  const c = colors.text.accentEmerald;
  return (
    <View style={{ gap: 3.5, alignItems: "center" }}>
      {[14, 14, 9].map((w, i) => (
        <View key={i} style={{ width: w, height: 2.5, borderRadius: 2, backgroundColor: c }} />
      ))}
    </View>
  );
}

function LayersGlyph() {
  const { colors } = useTheme();
  const c = colors.text.accentEmerald;
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 18,
          height: 12,
          borderRadius: 3,
          borderWidth: 2.5,
          borderColor: c,
          transform: [{ translateY: 3 }],
        }}
      />
      <View style={{ width: 18, height: 2.5, borderRadius: 2, backgroundColor: c }} />
    </View>
  );
}

function LockGlyph() {
  const { colors } = useTheme();
  const c = colors.text.accentEmerald;
  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          width: 12,
          height: 10,
          borderWidth: 2.5,
          borderBottomWidth: 0,
          borderColor: c,
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          marginBottom: -2,
        }}
      />
      <View style={{ width: 18, height: 13, borderRadius: 3, backgroundColor: c }} />
    </View>
  );
}

function GlobeGlyph() {
  const { colors } = useTheme();
  const c = colors.text.accentEmerald;
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: 10,
          borderWidth: 2.5,
          borderColor: c,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 14, height: 2.5, borderRadius: 2, backgroundColor: c }} />
      </View>
    </View>
  );
}

/** Verdict check / warning mark used in the device cards. */
function VerdictMark({ ok }: { ok: boolean }) {
  const { colors, typography: tp } = useTheme();
  return (
    <View
      style={[
        verdictStyles.mark,
        { backgroundColor: ok ? colors.emerald[500] : colors.amber[500] },
      ]}
    >
      <NidoIcon name={ok ? "check" : "warning"} size={12} color="#FFFFFF" />
    </View>
  );
}

const verdictStyles = StyleSheet.create({
  mark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontWeight: "700",
    lineHeight: 14,
  },
});

export function SetupWizardScreen({ onReady, onSkip, onKeyLossError }: Props) {
  const { colors, typography: tp, themeId } = useTheme();
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedTier, setSelectedTier] = useState<SetupTier>("standard");
  // Model picker (2026-10-05): the user chooses which LLM to download in
  // step 2, preselected for their device's RAM. Persisted to settings on
  // download start so ChatScreen's resolveActiveModel honors the choice.
  const [selectedLlmId, setSelectedLlmId] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [hardware, setHardware] = useState<HardwareScan>({
    totalRamBytes: 0,
    freeStorageBytes: 0,
    scanned: false,
  });
  const [indexingPhase, setIndexingPhase] = useState<"waiting" | "building" | "ready" | "error">("waiting");
  const [indexingError, setIndexingError] = useState<string | null>(null);
  const [seedProgress, setSeedProgress] = useState<SeedProgress | null>(null);
  // Where the count was when this screen started watching, for a time-left estimate.
  const seedStart = useRef<{ at: number; done: number } | null>(null);

  const styles = makeStyles(colors);

  useEffect(
    () =>
      onSeedProgress((p) => {
        seedStart.current ??= { at: Date.now(), done: p.done };
        setSeedProgress(p);
      }),
    []
  );
  const [, forceRender] = useState(0);

  // Subscribe to live download progress
  useEffect(() => subscribeDownloads(() => forceRender((n) => n + 1)), []);

  // Hardware scan (total RAM + free disk; no free-RAM API exists on the
  // native module, so the Memory card honestly reports the total).
  useEffect(() => {
    (async () => {
      let ram = 0;
      let freeStorage = 0;
      try {
        ram = getDeviceTotalRamBytes();
      } catch {
        ram = 0;
      }
      try {
        freeStorage = await FileSystem.getFreeDiskStorageAsync();
      } catch {
        freeStorage = 0;
      }
      setHardware({
        totalRamBytes: ram,
        freeStorageBytes: freeStorage,
        scanned: true,
      });
      // Preselect the model picker for this device's RAM (owner decision
      // 2026-10-05); the user can still pick the other one in step 2.
      setSelectedLlmId((prev) => prev ?? preselectLlmId(ram));
    })();
  }, []);

  const refreshPresence = useCallback(async () => {
    const statuses = await modelManager.statusAll();
    const presMap = Object.fromEntries(statuses.map((s) => [s.asset.id, s.present]));
    setPresence(presMap);
    return presMap;
  }, []);

  useEffect(() => {
    refreshPresence();
  }, [refreshPresence]);

  const activeTierConfig = TIERS.find((t) => t.id === selectedTier) ?? TIERS[0];
  const tierCorpusPackIds = activeTierConfig.corpusPackIds ?? [];
  // RAM-aware setup set: the required non-LLM assets plus the LLM the user
  // picked in step 2 (preselected for this device's RAM), instead of blindly
  // the catalog's `required` LLM. Falls back to the RAM default before the
  // hardware scan completes.
  const setupLlm: CatalogModel =
    MODEL_CATALOG.find((m) => m.id === selectedLlmId) ?? defaultLlmForRam(hardware.totalRamBytes);
  const setupLlmAssets: CatalogModel[] = [
    ...MODEL_CATALOG.filter((m) => m.required && m.kind !== "llm"),
    setupLlm,
  ];
  const tierAssets: CatalogModel[] = [
    ...setupLlmAssets,
    ...CORPUS_CATALOG.filter((c) => tierCorpusPackIds.includes(c.id)),
  ];

  const allAssetsPresent = tierAssets.every((m) => presence[m.id]);

  const handleStartDownloads = useCallback(async () => {
    impact(ImpactFeedbackStyle.Medium);
    // Persist the user's model pick so ChatScreen's resolveActiveModel (and
    // the Settings picker) honor it instead of silently re-defaulting.
    try {
      await setActiveModelId("llm", setupLlm.id);
    } catch {
      // Non-fatal: the download set below is already built from setupLlm.
    }
    setStep(3);
    const presMap = await refreshPresence();

    for (const asset of tierAssets) {
      if (!presMap[asset.id]) {
        // presence is only ever set from an explicit statusAll() scan, not
        // derived from download progress — without re-checking here, a
        // finished 100%-downloaded file never flips to present, and
        // indexing never starts.
        startDownload(asset).finally(() => refreshPresence());
      }
    }
  }, [refreshPresence, tierAssets]);

  // Downloads done: move on to indexing.
  useEffect(() => {
    if (step === 3 && allAssetsPresent) setStep(4);
  }, [step, allAssetsPresent]);

  // Step 4: seed the knowledge base on the phone. Indexing embeds every
  // article, so the embedding model has to be loaded first; only the chat
  // screen loaded it before.
  const runIndexing = useCallback(async () => {
    try {
      setIndexingPhase("building");
      setIndexingError(null);
      const emb = MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required)!;
      await embeddingEngine.load(emb.filename);
      await withStage("seed-knowledge-base", () => seedKnowledgeBaseIfEmpty());
      setIndexingPhase("ready");
      notification(NotificationFeedbackType.Success);
    } catch (e: unknown) {
      // N4: KeyLossError no es un error reintentable — significa "bases
      // cifradas presentes, DEK ausente". Va a la pantalla honesta de
      // recuperación (archivar y empezar de cero con confirmación explícita)
      // en vez de a un "Reintentar" muerto. Sin handler, se conserva la
      // tarjeta de error genérica (comportamiento previo).
      if (e instanceof KeyLossError && onKeyLossError) {
        onKeyLossError(e);
        return;
      }
      setIndexingError(e instanceof Error ? e.message : String(e));
      setIndexingPhase("error");
    }
  }, [onKeyLossError]);

  useEffect(() => {
    if (step === 4) {
      runIndexing();
    }
  }, [step, runIndexing]);

  // Compute aggregate download metrics across tier assets
  let totalBytesExpected = 0;
  let totalBytesWritten = 0;
  let maxEta = 0;
  let isAnyDownloading = false;
  let completedCount = 0;
  let currentAssetLabel: string | null = null;
  let currentAssetBytes = 0;
  // Before this, a stalled/failed download just silently reverted to
  // "PENDING" with no way to know why or to retry — the mandatory first-run
  // wizard had no escape hatch at all (see docs/ADAPTIVE_ROUTING.md's
  // timeout/backgrounding findings; downloads had the exact same gap
  // generation timeouts did). failedAssets makes the error visible and
  // retriable instead.
  const failedAssets: { asset: CatalogModel; error: string }[] = [];
  // Meta #3: assets waiting for an automatic retry (transient failure,
  // backoff countdown running). Shown distinctly from final failures so
  // the user sees the app is working on it, not stuck.
  const retryingAssets: { asset: CatalogModel; dl: NonNullable<ReturnType<typeof getDownloadState>> }[] = [];

  for (const asset of tierAssets) {
    const dl = getDownloadState(asset.id);
    totalBytesExpected += asset.sizeBytes;
    if (presence[asset.id]) {
      totalBytesWritten += asset.sizeBytes;
      completedCount++;
    } else if (dl) {
      totalBytesWritten += dl.bytesWritten ?? 0;
      if (dl.autoRetrying) {
        retryingAssets.push({ asset, dl });
      } else if (dl.downloading) {
        isAnyDownloading = true;
        // Assets download concurrently, but on a typical connection only
        // one actually makes visible progress at a time — surfacing which
        // one, plus a "2/3" count, is what stops a finished asset handing
        // off to the next one from reading as the whole thing restarting.
        // Label the asset actually moving bytes, not merely the first one
        // flagged downloading: during the T-005 tablet session the bar
        // showed ~1 GB while labeled with the 36 MB embedding model.
        if ((dl.bytesWritten ?? 0) > currentAssetBytes) {
          currentAssetBytes = dl.bytesWritten ?? 0;
          currentAssetLabel = asset.label;
        }
        if (dl.etaSeconds && dl.etaSeconds > maxEta) maxEta = dl.etaSeconds;
      } else if (dl.error) {
        failedAssets.push({ asset, error: dl.error });
      }
    }
  }

  const retryFailedDownloads = useCallback(() => {
    impact(ImpactFeedbackStyle.Medium);
    for (const { asset } of failedAssets) {
      startDownload(asset).finally(() => refreshPresence());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedAssets, refreshPresence]);

  // Manual, unconditional escape hatch — distinct from retryFailedDownloads,
  // which only acts on assets that surfaced an explicit error. A download
  // can also go stuck with NO error at all (module-level download-tracking
  // state surviving a dev Fast Refresh mid-transfer while the actual native
  // task it pointed at is gone, or a real device silently dropping a
  // network task without a callback ever firing) — that state can't be
  // reliably auto-detected from here, so instead of guessing, this button
  // is just always available whenever setup isn't finished, and force-clears
  // + restarts every not-yet-present asset regardless of what the UI
  // currently believes its state is.
  const restartAllDownloads = useCallback(() => {
    impact(ImpactFeedbackStyle.Medium);
    for (const asset of tierAssets) {
      if (!presence[asset.id]) {
        restartDownload(asset).finally(() => refreshPresence());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierAssets, presence, refreshPresence]);

  // Auto-resume when the user returns to the app after backgrounding it —
  // expo-file-system pauses (not fails) a download while backgrounded, and
  // ModelManager.downloadCatalogModel's inactivity timeout also pauses
  // rather than cancels, so a "failed" download at this point is really
  // just parked, waiting for the same resumable to be resumed. Without
  // this, the only way to keep the mandatory setup screen moving forward
  // after swapping apps was to notice the error card and tap Retry
  // manually.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && failedAssets.length > 0) {
        retryFailedDownloads();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedAssets, retryFailedDownloads]);

  const aggregateProgress =
    totalBytesExpected > 0 ? Math.min(totalBytesWritten / totalBytesExpected, 1) : 0;

  const segLabels = [
    t("setupWizard.steps.device"),
    t("setupWizard.steps.model"),
    t("setupWizard.steps.download"),
    t("setupWizard.steps.ready"),
  ];
  const segIndex = step - 1;
  const segProgress =
    step === 3 ? aggregateProgress : step === 4 && seedProgress && seedProgress.total > 0
      ? Math.min(seedProgress.done / seedProgress.total, 1)
      : undefined;

  const ramOk = hardware.totalRamBytes >= RAM_COMFORT_BYTES;
  const storageOk = hardware.freeStorageBytes >= STORAGE_COMFORT_BYTES;

  const renderStep1 = () => (
    <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
      <NidoMascot role="welcome" size={120} />
      <Text style={[styles.h1, tp.ui.headline, styles.center]}>{t("setupWizard.step1.title")}</Text>
      <Text style={[styles.lead, tp.ui.bodyLg, styles.center]}>{t("setupWizard.step1.subtitle")}</Text>

      {/* Memory */}
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <IconBadge><BarsGlyph /></IconBadge>
          <View style={styles.cardTextCol}>
            <Text style={[styles.cardHead, tp.ui.title]}>{t("setupWizard.step1.memoryTitle")}</Text>
            {hardware.scanned ? (
              <Text style={[styles.cardSub, tp.ui.subtext, styles.tabular]}>
                {t("setupWizard.step1.totalOf", { total: formatGB(hardware.totalRamBytes) })}
              </Text>
            ) : (
              <ActivityIndicator size="small" color={colors.text.accentEmerald} style={styles.inlineSpinner} />
            )}
          </View>
        </View>
        {hardware.scanned && (
          <>
            <Bar value={hardware.totalRamBytes > 0 ? 1 : 0} tone={ramOk ? "ok" : "warn"} />
            <View style={styles.verdictRow}>
              <VerdictMark ok={ramOk} />
              <Text style={[styles.verdictText, tp.ui.body]}>
                {t(ramOk ? "setupWizard.step1.memoryOk" : "setupWizard.step1.memoryLow")}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Storage */}
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <IconBadge><LayersGlyph /></IconBadge>
          <View style={styles.cardTextCol}>
            <Text style={[styles.cardHead, tp.ui.title]}>{t("setupWizard.step1.storageTitle")}</Text>
            {hardware.scanned ? (
              <Text style={[styles.cardSub, tp.ui.subtext, styles.tabular]}>
                {t("setupWizard.step1.freeOf", { free: formatGB(hardware.freeStorageBytes) })}
              </Text>
            ) : (
              <ActivityIndicator size="small" color={colors.text.accentEmerald} style={styles.inlineSpinner} />
            )}
          </View>
        </View>
        {hardware.scanned && (
          <>
            <Bar value={1} tone={storageOk ? "ok" : "warn"} />
            <View style={styles.verdictRow}>
              <VerdictMark ok={storageOk} />
              <Text style={[styles.verdictText, tp.ui.body]}>
                {t(storageOk ? "setupWizard.step1.storageOk" : "setupWizard.step1.storageLow")}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Private by design — frozen Tier 2 copy, do not reword. */}
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <IconBadge><LockGlyph /></IconBadge>
          <View style={styles.cardTextCol}>
            <Text style={[styles.cardHead, tp.ui.title]}>{t("setupWizard.step1.privateTitle")}</Text>
            <Text style={[styles.cardSub, tp.ui.body]}>{t("setupWizard.step1.privateText")}</Text>
          </View>
        </View>
      </View>

      {/* Language */}
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <IconBadge><GlobeGlyph /></IconBadge>
          <Text style={[styles.cardHead, tp.ui.title]}>{t("setupWizard.step1.language")}</Text>
        </View>
        <LanguageSelector compact />
      </View>

      <View style={styles.footer}>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => {
            impact(ImpactFeedbackStyle.Light);
            setStep(2);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("setupWizard.step1.continue")}
        >
          <Text style={[styles.primaryBtnText, tp.ui.title]}>{t("setupWizard.step1.continue")}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  // NIDO UX (2026-10-05, physical device gate): the tier card shows ONLY the
  // tier's EXTRA download (corpus packs). Including the model size here made
  // every tier read "About 0.4 GB to download", looking like a second,
  // separate 0.4 GB download on top of the model card above it.
  const tierDownloadBytes = (corpusPackIds: string[]) =>
    totalManifestBytes(CORPUS_CATALOG.filter((c) => corpusPackIds.includes(c.id)));

  // Model picker (2026-10-05): light vs preferred LLM, preselected for this
  // device's RAM. Honest per-model info: download size + estimated RAM.
  const renderModelPicker = () => {
    const recommendedId = hardware.scanned ? preselectLlmId(hardware.totalRamBytes) : null;
    return (
      <View style={styles.modelSection}>
        <Text style={[styles.sectionTitle, tp.ui.title]}>{t("setupWizard.step2.modelTitle")}</Text>
        <Text style={[styles.sectionSub, tp.ui.body]}>{t("setupWizard.step2.modelSubtitle")}</Text>
        {setupLlmChoices().map((m) => {
          const isSelected = setupLlm.id === m.id;
          const isRecommended = recommendedId !== null && recommendedId === m.id;
          const ramNeeded = toGb(estimateContextBytes(contextSpecForModel(m)).totalBytes);
          return (
            <Pressable
              key={m.id}
              style={[styles.card, isSelected && styles.tierCardActive]}
              onPress={() => {
                impact(ImpactFeedbackStyle.Light);
                setSelectedLlmId(m.id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
            >
              <View style={styles.tierHeader}>
                <View style={styles.tierTitleRow}>
                  <Text style={[styles.tierName, tp.ui.title]}>{m.label}</Text>
                  {isRecommended && (
                    <View style={styles.recommendedPill}>
                      <Text style={[styles.recommendedText, tp.ui.caption]}>
                        {t("setupWizard.step2.modelRecommendedForDevice")}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={[styles.radio, isSelected && styles.radioActive]}>
                  {isSelected && <View style={styles.radioDot} />}
                </View>
              </View>
              <Text style={[styles.tierDesc, tp.ui.body]}>{m.description}</Text>
              <Text style={[styles.tierSize, tp.ui.subtext, styles.tabular]}>
                {t("setupWizard.step2.downloadSize", { size: formatGB(m.sizeBytes) })}
                {" · "}
                {t("setupWizard.step2.modelRam", { ram: ramNeeded })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderStep2 = () => (
    <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.h1, tp.ui.headline]}>{t("setupWizard.step2.title")}</Text>
      <Text style={[styles.lead, tp.ui.bodyLg]}>{t("setupWizard.step2.subtitle")}</Text>

      {renderModelPicker()}

      {TIERS.map((tier) => {
        const isSelected = selectedTier === tier.id;
        return (
          <Pressable
            key={tier.id}
            style={[styles.card, isSelected && styles.tierCardActive]}
            onPress={() => {
              impact(ImpactFeedbackStyle.Light);
              setSelectedTier(tier.id);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <View style={styles.tierHeader}>
              <View style={styles.tierTitleRow}>
                <Text style={[styles.tierName, tp.ui.title]}>{tier.label}</Text>
                {tier.id === "standard" && (
                  <View style={styles.recommendedPill}>
                    <Text style={[styles.recommendedText, tp.ui.caption]}>
                      {t("setupWizard.step2.recommended")}
                    </Text>
                  </View>
                )}
              </View>
              <View style={[styles.radio, isSelected && styles.radioActive]}>
                {isSelected && <View style={styles.radioDot} />}
              </View>
            </View>
            <Text style={[styles.tierDesc, tp.ui.body]}>{tier.description}</Text>
            {tierDownloadBytes(tier.corpusPackIds ?? []) > 0 && (
              <Text style={[styles.tierSize, tp.ui.subtext, styles.tabular]}>
                {t("setupWizard.step2.downloadSize", {
                  size: formatGB(tierDownloadBytes(tier.corpusPackIds ?? [])),
                })}
              </Text>
            )}
          </Pressable>
        );
      })}

      <View style={styles.footerRow}>
        <Pressable
          style={styles.quietBtn}
          onPress={() => setStep(1)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("setupWizard.step2.back")}
        >
          <Text style={[styles.quietBtnText, tp.ui.title]}>{t("setupWizard.step2.back")}</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, styles.footerRowPrimary]}
          onPress={handleStartDownloads}
          accessibilityRole="button"
          accessibilityLabel={t("setupWizard.step2.startDownload")}
        >
          <Text style={[styles.primaryBtnText, tp.ui.title]}>{t("setupWizard.step2.startDownload")}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  const renderStep3 = () => (
    <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.h1, tp.ui.headline]}>{t("setupWizard.step3.title")}</Text>
      <Text style={[styles.lead, tp.ui.bodyLg]}>{t("setupWizard.step3.subtitle")}</Text>

      {!allAssetsPresent && (
        <View style={styles.card}>
          <Bar value={aggregateProgress} tone="accent" />
          <View style={styles.progressGap} />
          <Text style={[styles.statusLine, tp.ui.title, styles.tabular]}>
            {t("setupWizard.step3.downloading", {
              done: formatGB(totalBytesWritten),
              total: formatGB(totalBytesExpected),
            })}
          </Text>
          <Text style={[styles.statusSub, tp.ui.body, styles.tabular]}>
            {isAnyDownloading
              ? `${t("setupWizard.step3.timeLeft", {
                  time: formatEta(maxEta, t("setupWizard.estimating")),
                })} · ${t("setupWizard.step3.assetCounter", {
                  current: Math.min(completedCount + 1, tierAssets.length),
                  total: tierAssets.length,
                })}`
              : t("setupWizard.step3.assetCounter", {
                  current: completedCount,
                  total: tierAssets.length,
                })}
          </Text>
        </View>
      )}

      {retryingAssets.length > 0 && (
        <View style={styles.noteCard}>
          {retryingAssets.map(({ asset, dl }) => (
            <Text key={asset.id} style={[styles.noteText, tp.ui.body]}>
              {t("setupWizard.step3.autoRetrying", {
                seconds: dl.nextRetryInSeconds ?? 0,
                attempt: dl.retryAttempt ?? 1,
                max: dl.maxAutoRetries ?? 3,
              })}
            </Text>
          ))}
        </View>
      )}

      {failedAssets.length > 0 && (
        <View style={styles.errorCard}>
          <Text style={[styles.errorTitle, tp.ui.title]}>{t("setupWizard.step3.errorTitle")}</Text>
          <Text style={[styles.errorText, tp.ui.body]}>{t("setupWizard.step3.errorText")}</Text>
          {/* GAP-4 fix: mostrar qué asset falló y por qué (el dato ya existía, no se renderizaba) */}
          {failedAssets.map(({ asset, error }) => (
            <View key={asset.id} style={styles.failedAssetRow}>
              <Text style={[styles.failedAssetLabel, tp.ui.body]}>{asset.label}</Text>
              <Text style={[styles.failedAssetError, tp.ui.caption]} numberOfLines={2}>
                {error}
              </Text>
            </View>
          ))}
          <Pressable style={styles.primaryBtn} onPress={retryFailedDownloads} accessibilityRole="button" accessibilityLabel={t("setupWizard.step3.tryAgain")}>
            <Text style={[styles.primaryBtnText, tp.ui.title]}>{t("setupWizard.step3.tryAgain")}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.noteCard}>
        <Text style={[styles.noteText, tp.ui.body]}>{t("setupWizard.step3.keepOpen")}</Text>
      </View>

      {!allAssetsPresent && (
        <Pressable style={styles.quietBtn} onPress={restartAllDownloads} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("setupWizard.step3.restartStuck")}>
          <Text style={[styles.quietBtnText, tp.ui.body, styles.dangerText]}>
            {t("setupWizard.step3.restartStuck")}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );

  const renderStep4 = () => {
    if (indexingPhase === "ready") {
      // Tier 2 frame 11 — the ready celebration. Frozen copy, do not reword.
      return (
        <ScrollView contentContainerStyle={[styles.stepContent, styles.readyContent]} showsVerticalScrollIndicator={false}>
          <NidoMascot role="success" size={140} />
          <Text style={[styles.h1, tp.ui.headline, styles.center]}>{t("setupWizard.step4.readyTitle")}</Text>
          <Text style={[styles.lead, tp.ui.bodyLg, styles.center]}>{t("setupWizard.step4.readyText")}</Text>
          <View style={styles.footer}>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => {
                notification(NotificationFeedbackType.Success);
                onReady();
              }}
              accessibilityRole="button"
              accessibilityLabel={t("setupWizard.step4.startChatting")}
            >
              <Text style={[styles.primaryBtnText, tp.ui.title]}>{t("setupWizard.step4.startChatting")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      );
    }
    return (
      <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.h1, tp.ui.headline]}>{t("setupWizard.step4.settingUp")}</Text>
        {indexingPhase === "error" ? (
          <View style={styles.errorCard}>
            <Text style={[styles.errorTitle, tp.ui.title]}>{t("setupWizard.step3.errorTitle")}</Text>
            <Text style={[styles.errorText, tp.ui.body]}>
              {t("setupWizard.step4.setupError", { error: indexingError ?? "" })}
            </Text>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => {
                impact(ImpactFeedbackStyle.Medium);
                runIndexing();
              }}
              accessibilityRole="button"
              accessibilityLabel={t("setupWizard.step3.tryAgain")}
            >
              <Text style={[styles.primaryBtnText, tp.ui.title]}>{t("setupWizard.step3.tryAgain")}</Text>
            </Pressable>
            <Pressable
              style={styles.quietBtn}
              onPress={() => {
                notification(NotificationFeedbackType.Success);
                onReady();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("setupWizard.step4.continueAnyway")}
            >
              <Text style={[styles.quietBtnText, tp.ui.body]}>
                {t("setupWizard.step4.continueAnyway")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.indexingRow}>
              <ActivityIndicator size="small" color={colors.text.accentEmerald} />
              <Text style={[styles.statusLine, tp.ui.title, styles.tabular]}>
                {seedProgress && seedProgress.total > 0
                  ? t("setupWizard.step4.counter", {
                      done: seedProgress.done.toLocaleString(),
                      total: seedProgress.total.toLocaleString(),
                    })
                  : t("setupWizard.calculating")}
              </Text>
            </View>
            <View style={styles.progressGap} />
            <Bar
              value={
                seedProgress && seedProgress.total > 0
                  ? seedProgress.done / seedProgress.total
                  : 0
              }
              tone="accent"
            />
            {seedProgress && seedProgress.total > 0 && (
              <Text style={[styles.statusSub, tp.ui.body, styles.tabular]}>
                {t("setupWizard.step3.timeLeft", {
                  time: formatEta(seedEtaSeconds(seedProgress, seedStart.current), t("setupWizard.estimating")),
                })}
              </Text>
            )}
          </View>
        )}
        <View style={styles.noteCard}>
          <Text style={[styles.noteText, tp.ui.body]}>{t("setupWizard.step3.keepOpen")}</Text>
        </View>
      </ScrollView>
    );
  };

  // DOWNLOAD-KEEP-AWAKE 2026-10-07: mantener la pantalla encendida mientras
  // hay descargas activas. Sin esto, Android Doze corta la red al apagarse
  // la pantalla y la descarga se congela hasta reabrir la app. expo-keep-awake
  // evita que Doze se active (requiere pantalla encendida).
  useEffect(() => {
    if (isAnyDownloading) {
      activateKeepAwake("nido-model-download");
    } else {
      deactivateKeepAwake("nido-model-download");
    }
    // Limpiar al desmontar.
    return () => {
      deactivateKeepAwake("nido-model-download");
    };
  }, [isAnyDownloading]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg.black }]} edges={["top", "bottom"]}>
      <StatusBar
        barStyle={themeId === "daylight" ? "dark-content" : "light-content"}
        backgroundColor={colors.bg.black}
      />
      <SegProgress current={segIndex} labels={segLabels} progress={segProgress} />
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
    </SafeAreaView>
  );
}

/** Tier 2: 20px gutters, 8/12/16/full radii, sentence case, ≥44pt targets. */
function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    stepContent: {
      paddingHorizontal: calmSpacing.airy,
      paddingTop: calmSpacing.comfortable,
      paddingBottom: calmSpacing.generous,
      gap: calmSpacing.comfortable,
    },
    readyContent: {
      flexGrow: 1,
      justifyContent: "center",
    },
    h1: {
      color: colors.text.primary,
      marginTop: calmSpacing.cozy,
    },
    lead: {
      color: colors.text.secondary,
      marginTop: -calmSpacing.cozy,
      marginBottom: calmSpacing.tight,
    },
    modelSection: {
      gap: calmSpacing.comfortable,
      marginTop: calmSpacing.tight,
    },
    sectionTitle: {
      color: colors.text.primary,
    },
    sectionSub: {
      color: colors.text.secondary,
      marginTop: -calmSpacing.cozy,
    },
    center: {
      textAlign: "center",
    },
    tabular: {
      fontVariant: ["tabular-nums"],
    },
    card: {
      ...calmShadows.none,
      backgroundColor: colors.bg.card,
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: calmRadii.gentle,
      padding: calmSpacing.comfortable,
      gap: calmSpacing.comfortable,
    },
    cardRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: calmSpacing.comfortable,
    },
    cardTextCol: {
      flex: 1,
      gap: calmSpacing.tight,
    },
    cardHead: {
      color: colors.text.primary,
    },
    cardSub: {
      color: colors.text.secondary,
    },
    inlineSpinner: {
      alignSelf: "flex-start",
      marginTop: calmSpacing.tight,
    },
    verdictRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: calmSpacing.cozy,
    },
    verdictText: {
      color: colors.text.secondary,
      flex: 1,
    },
    tierCardActive: {
      borderWidth: 2,
      borderColor: colors.text.accentEmerald,
      backgroundColor: colors.emerald.bgSubtle,
    },
    tierHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: calmSpacing.comfortable,
    },
    tierTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: calmSpacing.cozy,
      flex: 1,
      flexWrap: "wrap",
    },
    tierName: {
      color: colors.text.primary,
      flexShrink: 1,
    },
    recommendedPill: {
      backgroundColor: colors.emerald.bgSubtle,
      borderRadius: calmRadii.pill,
      paddingHorizontal: calmSpacing.cozy,
      paddingVertical: calmSpacing.tight,
    },
    recommendedText: {
      color: colors.text.accentEmerald,
      fontWeight: "700",
    },
    radio: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 2,
      borderColor: colors.border.elevated,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    radioActive: {
      borderColor: colors.text.accentEmerald,
    },
    radioDot: {
      width: 13,
      height: 13,
      borderRadius: 7,
      backgroundColor: colors.text.accentEmerald,
    },
    tierDesc: {
      color: colors.text.secondary,
    },
    tierSize: {
      color: colors.text.muted,
    },
    progressGap: {
      height: calmSpacing.tight,
    },
    indexingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: calmSpacing.cozy,
    },
    statusLine: {
      color: colors.text.primary,
    },
    statusSub: {
      color: colors.text.secondary,
      marginTop: calmSpacing.tight,
    },
    noteCard: {
      ...calmShadows.none,
      backgroundColor: colors.bg.cardElevated,
      borderRadius: calmRadii.gentle,
      padding: calmSpacing.comfortable,
    },
    noteText: {
      color: colors.text.secondary,
    },
    errorCard: {
      ...calmShadows.none,
      backgroundColor: colors.crimson.bgSubtle,
      borderWidth: 1,
      borderColor: colors.crimson.border,
      borderRadius: calmRadii.gentle,
      padding: calmSpacing.comfortable,
      gap: calmSpacing.comfortable,
    },
    errorTitle: {
      color: colors.crimson[600],
    },
    errorText: {
      color: colors.text.secondary,
    },
    failedAssetRow: {
      backgroundColor: colors.bg.surface,
      borderRadius: calmRadii.subtle,
      padding: calmSpacing.cozy,
      gap: 2,
    },
    failedAssetLabel: {
      color: colors.text.primary,
      fontWeight: "600",
    },
    failedAssetError: {
      color: colors.text.muted,
    },
    footer: {
      marginTop: calmSpacing.cozy,
      gap: calmSpacing.cozy,
    },
    footerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: calmSpacing.cozy,
      marginTop: calmSpacing.cozy,
    },
    footerRowPrimary: {
      flex: 1,
    },
    primaryBtn: {
      minHeight: 56,
      borderRadius: calmRadii.pill,
      backgroundColor: colors.text.accentEmerald,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: calmSpacing.spacious,
    },
    primaryBtnText: {
      color: colors.text.inverse,
    },
    quietBtn: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: calmSpacing.comfortable,
    },
    quietBtnText: {
      color: colors.text.accentEmerald,
    },
    dangerText: {
      color: colors.crimson[500],
    },
  });
}
