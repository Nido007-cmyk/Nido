/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { answerFromPackFacts, packCountryNames } from "../rag/packs";
import { answerFromGuide } from "../rag/guideAnswerRun";
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  Keyboard,
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Linking,
} from "react-native";
import { VaultOfferBanner } from "./VaultOfferBanner";
import { PanicButton } from "./components/PanicButton";
import { PrivateTextInput as TextInput } from "./components/PrivateTextInput";
import { LinearGradient } from "expo-linear-gradient";
import { impact, notification, ImpactFeedbackStyle, NotificationFeedbackType } from "../services/haptics";
import { NidoIcon } from "./components/icons/NidoIcon";
import { NidoMascot } from "./components/calm/NidoMascot";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { llamaEngine } from "../inference/LlamaEngine";
import { embeddingEngine } from "../rag/embed";
import { retrieve, assemblePrompt, RetrievedChunk, ConversationTurn } from "../rag/retrieve";
import { assembleChatMessages, ANSWER_CONTEXT_CHUNKS } from "../rag/pure";
import { classifyTask, isRetrievalIrrelevant, isCreativeRequest } from "../routing/classify";
import {
  hasHealthEvidence,
  healthSafeProvenance,
  healthSafeText,
  isEmergencyText,
  isHealthQuestion,
} from "../routing/emergencyGate";
import type { TaskType } from "../routing/types";
import { onSeedProgress, seedKnowledgeBaseIfEmpty } from "../rag/seedCorpus";
import { MODEL_CATALOG, CORPUS_CATALOG, REQUIRED_MODELS, CatalogModel } from "../models/manifest";
import { defaultLlmForDevice } from "../models/defaultModel";
import { subscribeDownloads, listDownloadStates } from "../services/downloadManager";
import {
  getActiveModelId,
  getHidePromptIdeas,
  getGuideOnboardingDone,
  setGuideOnboardingDone,
  getPersonalityId,
  setPersonalityId,
  getCustomSystemPrompt,
  getMaxTokens,
  getMemorySettings,
  MemorySettings as MemorySettingsType,
  DEFAULT_MEMORY_SETTINGS,
  getDeepResearchMode,
  setDeepResearchMode,
  getVoiceInputEnabled,
  getReadAloudEnabled,
  getAdaptiveRoutingEnabled,
  takeSettingsRecoveryNotice,
} from "../models/settings";
import { runDeepResearch, ResearchProgress } from "../services/orchestrator";
import { runAdaptiveChat } from "../services/adaptiveChat";
import { speakAloud } from "../voice/tts";
import { showSecureAlert } from "nido-secure-dialog";
// NIDO agent: loop agéntico local con herramientas (Fase A).
import { classifyIntent } from "../agent/loop/intent";
import { isGenericMemoryQuestionShape, memoryFullCoverageHit, memoryGateHit } from "../agent/loop/memoryQuery";
import { beginUserTurn, choiceTurnKind, resetConversationState, type ChoiceStore } from "../agent/loop/toolRouter";
import { applyEdit, type InputSource, type Segment } from "../agent/input/provenance";
import { planSend } from "../agent/input/sendPlan";
import { runAgentLoop, assertPromptBudget, estimatePromptTokens } from "../agent/loop/agentLoop";
import { buildToolHandlers, searchPhoneContacts } from "../agent/tools/handlers";
import { matchSmallTalk, smallTalkSessionTitle } from "../agent/loop/smallTalk";
import { matchSafetyAnswer, unknownCountryText } from "../agent/loop/safetyAnswers";
import { agentFallbackText, toFallbackLang } from "../agent/loop/fallbackText";
import { describePolicyConfirmation } from "../agent/policy/confirmText";
import {
  verifyGroundedAnswer,
  isFactualQuestion,
  noSourcesAnswer,
  type GroundingStatus,
} from "../rag/grounding";
import { snapshot as loadMemorySnapshot } from "../agent/memory/memoryStore";
import type { SentenceProvenance } from "../rag/provenance";
import { guideAnswerProvenance } from "../rag/guideAnswer";
import { getPersonality, PersonalityId, PERSONALITIES } from "../constants/personalities";
import {
  createSession,
  addMessage as persistMessage,
  addAssistantDraft,
  updateAssistantDraft,
  finishAssistantMessage,
  deleteMessage,
  getMessages as getSessionMessages,
  listSessions,
  deleteSession,
  setSessionTitle,
  setSessionSummary,
  pruneSessions,
  setMessageFeedback,
  ChatSession,
} from "../services/chatHistory";
import { summarizeConversation } from "../services/summarize";
import { titleFromQuestion } from "../services/sessionTitle";
import { PromptIdeasCarousel } from "./PromptIdeasCarousel";
import { UserGuideScreen } from "./UserGuideScreen";
import { GuideOnboarding } from "./GuideOnboarding";
import { VoiceInputButton } from "./VoiceInputButton";
import { ProcessingIndicator, ProcessingStatus } from "./ProcessingIndicator";
import { Drawer, DrawerItem } from "./Drawer";
import { AboutScreen } from "./AboutScreen";
import { KnowledgeBaseScreen } from "./KnowledgeBaseScreen";
import { MemoryManagerScreen } from "./MemoryManagerScreen";
import { NidoScreen } from "./NidoScreen";
import { ExecutionTelemetryScreen } from "./ExecutionTelemetryScreen";
import { ModelSetupScreen } from "./ModelSetupScreen";
import { EvaluationScreen } from "./EvaluationScreen";
import { takePendingEvalRequest } from "../eval/deviceEvalRequest";
import type { EvalRequest } from "../eval/deviceEvalRequest.pure";
import { ChatHeader } from "./ChatHeader";
import { SendGuard } from "./sendGuard";
import { Toast } from "./Toast";
import { ModelLoadErrorCard } from "./components/ModelLoadErrorCard";
import { MarkdownMessage } from "./components/MarkdownMessage";
import { splitInlineBullets } from "../services/answerFormat";
import { ReasoningPeek } from "./components/ReasoningPeek";
import { splitThinking, stripThinking } from "../services/thinking";
import { cleanCitations } from "../services/citations";
import { SourceFootnotes } from "./components/SourceFootnotes";
import { EvidenceFirstCard } from "./components/EvidenceFirstCard";
import { sourceAccent } from "./components/sourceColors";
import { buildEvidenceCard, type EvidenceCardData } from "../rag/evidenceCard";
import { findNumberConflicts, type NumberConflict } from "../rag/sourceCheck";
import { SourceReader } from "./components/SourceReader";
import { onLaunchAction, registerShortcuts, takeLaunchAction } from "../services/launchActions";
import { answerKnowledgeQueryWithCategory, toIdentityLocale, knowledgeSessionTitle } from "../rag/selfKnowledge";
import { recordQueryStats, trackPeakRss, startAppMemoryTracking, QueryStats } from "../services/telemetry";
import { recordExecution } from "../services/executionTelemetry";
import { recordRouterSample, type StageDropReason } from "../services/routerStats";
import { looksLikeMissedCommand, recordMissedPhrase } from "../services/missedPhrases";
import { trimRepetitionLoop } from "../inference/repetitionGuard";
import { trimToCompleteSentences } from "../inference/completeSentences";
import { getMemoryInfo } from "ram-monitor";
import { useTheme } from "./theme";
import type { Colors } from "./theme/colors";
import type { Typography } from "./theme/typography";
import { spacing, radii } from "./theme/spacing";
import { calmSpacing, calmRadii, calmType, calmShadows } from "./theme/calm";
import { displayLang, formatInt } from "../utils/safeFormat";
import { BottomTabBar } from "./navigation/BottomTabBar";
import type { MainTab } from "./navigation/tabs";
import { EmergencyScreen } from "./EmergencyScreen";
import { LibraryScreen } from "./LibraryScreen";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: RetrievedChunk[];
  /** Honest no-result flag (2026-09-28): retrieval was attempted and
   * returned zero chunks. In-memory only — not persisted to the session
   * store (a reloaded session shows the text without re-rendering the
   * note). */
  noSourcesFound?: boolean;
  /**
   * RAG-GROUNDING 2026-10-11: resultado de verificar la respuesta contra las
   * fuentes (grounding.ts). La cabecera de fuentes lo muestra para no dar a
   * entender que una respuesta está respaldada cuando no lo está.
   */
  grounding?: GroundingStatus;
  stopped?: boolean;
  timedOut?: boolean;
  /**
   * La respuesta quedó a medias y así consta en el historial: el proceso
   * murió a mitad de la generación (2026-10-30, prueba física del dueño).
   * Al reabrir, la burbuja enseña el texto parcial con su aviso, o solo el
   * aviso si no llegó ningún token. Ver chatHistory.addAssistantDraft.
   */
  interrupted?: boolean;
  feedback?: "up" | "down" | null;
  /** 0.1.55: "Call" buttons under an emergency-number answer (verified facts). */
  calls?: Array<{ value: string; label: string; tel: string }>;
  /** 0.1.59: answer shown verbatim from this NIDO Essentials guide chunk ("Open the full guide"). */
  guideChunkId?: string;
  /** 0.1.61: where each sentence comes from (src/rag/provenance.ts). In memory only for now. */
  provenance?: SentenceProvenance[];
  /**
   * Programa bounty, tanda 1: la tarjeta de evidencia primero
   * (src/rag/evidenceCard.ts) — la fuente principal y su frase que
   * mejor responde, pintada encima de la respuesta. En memoria, como
   * provenance: una sesión reabierta enseña el texto y sus fuentes
   * como siempre, sin la tarjeta.
   */
  evidenceFirst?: EvidenceCardData;
  /**
   * Programa bounty, tanda 8: las contradicciones de cifras contra
   * las fuentes (src/rag/sourceCheck.ts), que SourceFootnotes enseña
   * citando la frase de la fuente. Solo se calculan en la ruta
   * «unverified», donde las cifras llegan sin el juicio de la tanda 1.
   * En memoria, como evidenceFirst.
   */
  numberConflicts?: NumberConflict[];
}

const VERBATIM_MESSAGE_COUNT = 6;

function researchStageLabel(p: ResearchProgress, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (p.stage === "decomposing") return t("chatScreen.research.decomposing");
  if (p.stage === "researching") {
    return t("chatScreen.research.researching", {
      index: (p.subQuestionIndex ?? 0) + 1,
      count: p.subQuestionCount ?? 1,
    });
  }
  return t("chatScreen.research.synthesizing");
}

async function resolveActiveModel(kind: "llm" | "embedding"): Promise<CatalogModel> {
  const activeId = await getActiveModelId(kind);
  // RAM-aware default for the LLM kind (0.5B on low-RAM devices); the
  // required embedding for the embedding kind. Matches what the setup
  // wizard installs (see defaultLlmForDevice).
  const fallback =
    kind === "llm" ? defaultLlmForDevice() : REQUIRED_MODELS.find((m) => m.kind === kind)!;
  if (!activeId) return fallback;
  // NIDO: only curated-catalog models exist — the Hugging Face browser was
  // removed (it leaked search interests over the network).
  const found = MODEL_CATALOG.find((m) => m.id === activeId && m.kind === kind);
  if (!found) console.warn(`[ChatScreen] active ${kind} model "${activeId}" not found, using ${fallback.id}`);
  return found ?? fallback;
}

export function ChatScreen({
  onRelaunchWizard,
}: {
  onRelaunchWizard?: () => void;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  // 0.1.59: «Abrir la guía completa» under a verbatim guide answer.
  const [guideReaderChunkId, setGuideReaderChunkId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [loadStatus, setLoadStatus] = useState(t("chatScreen.initializingCore"));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showPromptIdeas, setShowPromptIdeas] = useState(false);
  // 0.1.14: guía de usuario y onboarding de primera vez.
  const [showGuide, setShowGuide] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  const [showExecutionTelemetry, setShowExecutionTelemetry] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // 0.1.55: barra inferior. Ajustes y NIDO siguen siendo showSettings /
  // showNido (sus efectos dependen de ellos); Emergencia y Biblioteca son
  // pestañas nuevas. La pestaña visible sale de effectiveTab, más abajo.
  const [activeTab, setActiveTab] = useState<MainTab>("chat");
  // Auditoría 0.1.55: «Mis documentos» del menú abre la Biblioteca en Mis documentos.
  const [librarySection, setLibrarySection] = useState<"documents" | "learn" | "packs">("packs");
  // 0.1.46: botón de pánico (opt-in en Ajustes). Se relee al cerrar Ajustes.
  // Cargar los interruptores aquí, al arrancar, también deja listos los del
  // P2P (saludo privado, v5) antes de la primera reconexión.
  const [panicEnabled, setPanicEnabled] = useState(false);
  // Auditoría completa 2026-10-31 (F3-10): si settings.json estaba
  // dañado y los ajustes volvieron a los valores de fábrica en
  // silencio, el marcador durable se consume aquí, una sola vez,
  // y el usuario se entera (una herramienta apagada pudo volver
  // encendida sin que nadie lo dijera).
  useEffect(() => {
    let alive = true;
    takeSettingsRecoveryNotice()
      .then((at) => {
        if (alive && at !== null) {
          // Por el diálogo seguro, como todo aviso de esta pantalla:
          // la guarda R3 la mantiene sin el Alert de React Native.
          void showSecureAlert({
            title: t("settings.recoveredTitle"),
            message: t("settings.recoveredNotice"),
            cancelLabel: t("common.close"),
            confirmLabel: t("common.done"),
          }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (showSettings) return;
    let alive = true;
    import("../config/featureFlags")
      .then(async ({ isFeatureEnabled, loadFeatureFlags }) => {
        await loadFeatureFlags().catch(() => {});
        if (alive) setPanicEnabled(isFeatureEnabled("security.panicButton"));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showSettings]);

  // 0.1.46: los mensajes temporales vencidos se borran al arrancar y cada
  // vez que NIDO vuelve a primer plano, aunque no se abra ese chat.
  useEffect(() => {
    const purge = () => {
      import("../p2p/store")
        .then(({ deleteExpiredMessages }) => deleteExpiredMessages())
        .catch(() => {});
    };
    purge();
    // 0.1.47: tras una restauración, la copia previa se borra en cuanto la
    // base restaurada abre bien.
    import("../security/backup")
      .then(({ cleanupAfterSuccessfulRestore }) => cleanupAfterSuccessfulRestore())
      .catch(() => {});
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") purge();
    });
    return () => sub.remove();
  }, []);
  const [showNido, setShowNido] = useState(false);
  const [voiceInputEnabled, setVoiceInputEnabledState] = useState(true);
  const showSettingsRef = useRef(false);
  showSettingsRef.current = showSettings;
  // 0.1.55: selectTab and the Android back action are rebuilt every render;
  // callbacks and the BackHandler read the current ones through these refs.
  const selectTabRef = useRef<((tab: MainTab) => void) | null>(null);
  const backActionRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => backActionRef.current());
    return () => sub.remove();
  }, []);
  const [deviceEvalRequest, setDeviceEvalRequest] = useState<EvalRequest | null>(null);
  const [personalityId, setPersonalityIdState] = useState<PersonalityId>("succinct");
  const [processing, setProcessing] = useState<{ messageId: string; status: ProcessingStatus; label?: string } | null>(null);
  const [deepResearchActive, setDeepResearchActive] = useState(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [liveTokPerSec, setLiveTokPerSec] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeModel, setActiveModel] = useState<CatalogModel | null>(null);
  // send() reads the loaded model for telemetry without re-creating itself on every model change.
  const activeModelRef = useRef<CatalogModel | null>(null);
  activeModelRef.current = activeModel;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  // Assistant messages whose model reasoning (<think>…</think>) is expanded.
  const [shownReasoning, setShownReasoning] = useState<Set<string>>(new Set());
  const toggleReasoning = useCallback((id: string) => {
    setShownReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [toast, setToast] = useState<string | null>(null);

  const listRef = useRef<FlatList<Message>>(null);
  // Keep the newest text in view while the reply streams, unless the user
  // scrolled up to read something; scrolling back near the bottom resumes it.
  const followBottom = useRef(true);
  const scrollToBottom = useCallback((animated = false) => {
    // Deferred a frame: on Android the content size reported to
    // onContentSizeChange can still be the previous one, leaving the end of
    // the reply cut off at the bottom of the list.
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);
  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    followBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 120;
  }, []);
  const inputRef = useRef<TextInput>(null);
  // Labels for whatever's downloadable — the built-in catalog (sync,
  // available immediately).
  const assetLabelsRef = useRef<Record<string, string>>(
    Object.fromEntries([...MODEL_CATALOG, ...CORPUS_CATALOG].map((m) => [m.id, m.label]))
  );
  // Which asset ids we've personally observed mid-download, so a
  // downloadManager notification firing for an unrelated reason (or one
  // that was already finished/failed before this screen mounted) doesn't
  // produce a false "download complete" toast.
  const seenDownloadingRef = useRef<Set<string>>(new Set());
  const memorySettingsRef = useRef<MemorySettingsType>(DEFAULT_MEMORY_SETTINGS);
  const deepResearchModeRef = useRef(false);
  // 0.1.25: elección pendiente («¿cuál nota?») entre turnos del chat.
  const choiceStoreRef = useRef<ChoiceStore>({ current: null });
  // 0.1.37: idioma del turno anterior (al cambiar, se olvida todo seguimiento).
  const lastTurnLangRef = useRef<string | null>(null);
  // 0.1.38: de dónde vino cada tramo de la caja (escrito, dictado, pegado,
  // compartido, ejemplo) y la orden preparada como chip. El chip va ligado
  // al texto, al idioma y al modo: si cambia cualquiera, cae en silencio y
  // el siguiente envío vuelve a analizar el texto actual.
  const segmentsRef = useRef<Segment[]>([]);
  const inputValueRef = useRef("");
  const [staged, setStaged] = useState<null | {
    text: string;
    lang: string;
    deep: boolean;
    label: string;
    runText: string;
    draft: string;
  }>(null);
  // 0.1.43: espejo sincrónico del chip. Registra la caída del chip (si lo
  // hay) con su motivo — solo la etiqueta, nunca texto — y anula el espejo
  // al registrar: una caída = un registro, aunque varios sitios la
  // intenten en el mismo tick.
  const stagedRef = useRef<typeof staged>(null);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  const recordChipDrop = useCallback((reason: StageDropReason) => {
    if (!stagedRef.current) return;
    stagedRef.current = null;
    recordRouterSample(0, "stageDropped", { route: reason, modelTools: [], retry: null });
  }, []);
  const updateInput = useCallback((next: string, source?: InputSource) => {
    segmentsRef.current = applyEdit(segmentsRef.current, inputValueRef.current, next, source);
    inputValueRef.current = next;
    setInput(next);
    // 0.1.43: si el texto deja de ser el del chip, el chip cae.
    if (stagedRef.current && stagedRef.current.text !== next) recordChipDrop("text_edited");
    setStaged((cur) => (cur && cur.text !== next ? null : cur));
  }, [recordChipDrop]);
  const sessionSummaryRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const backgroundTaskRef = useRef<Promise<void> | null>(null);
  const sendTaskRef = useRef<Promise<void> | null>(null);
  // N3 (2026-09-28): synchronous in-flight guard for send(). Consulted at
  // entry before any await; set synchronously so a second tap in the same
  // tick observes the first (batched `setGenerating` cannot do that).
  const sendGuardRef = useRef<SendGuard>(new SendGuard());
  const processingRef = useRef<{ messageId: string; status: ProcessingStatus; label?: string } | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    processingRef.current = processing;
  }, [processing]);

  const activeSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Labels for download toasts: the catalog is the only source of models now
  // (the Hugging Face browser was removed for privacy), and assetLabelsRef
  // is already seeded from MODEL_CATALOG + CORPUS_CATALOG above.

  // downloadManager is a module-level singleton (see its own comment) —
  // a download started from the Models screen keeps running after the user
  // leaves Settings, so this toasts its completion in chat. Only toasts a
  // transition we actually watched happen (downloading -> done, no error),
  // and not one that finished while Settings was open: the user already saw
  // it there, and the toast would only appear later, on returning to chat.
  useEffect(() => {
    return subscribeDownloads(() => {
      for (const { assetId, state: dl } of listDownloadStates()) {
        if (dl.downloading) {
          seenDownloadingRef.current.add(assetId);
        } else if (seenDownloadingRef.current.has(assetId)) {
          seenDownloadingRef.current.delete(assetId);
          if (!dl.error && !showSettingsRef.current) {
            const known = assetLabelsRef.current[assetId];
            if (known) {
              setToast(t("chatScreen.modelDownloadComplete", { label: known }));
            } else {
              // Unknown asset id (shouldn't happen: every downloadable asset
              // is in the catalog); fall back to the raw id.
              setToast(t("chatScreen.modelDownloadComplete", { label: assetId }));
            }
          }
        }
      }
    });
  }, [t]);

  const refreshSessions = useCallback(async () => {
    setSessions(await listSessions());
  }, []);

  useEffect(() => {
    (async () => {
      // 0.1.14: en una instalación nueva (sin conversaciones) se muestra el
      // onboarding de la guía UNA vez, en lugar de las ideas de prompts.
      // Quien ya usaba NIDO no lo ve: se marca como hecho sin mostrarlo.
      let onboarding = false;
      try {
        if (!(await getGuideOnboardingDone())) {
          const existing = await listSessions();
          if (existing.length === 0) onboarding = true;
          else await setGuideOnboardingDone(true);
        }
      } catch {
        /* settings unreadable: no onboarding, as before */
      }
      if (onboarding) setShowOnboarding(true);
      else {
        const hide = await getHidePromptIdeas();
        if (!hide) setShowPromptIdeas(true);
      }
      setPersonalityIdState(await getPersonalityId());
      memorySettingsRef.current = await getMemorySettings();
      const drMode = await getDeepResearchMode();
      deepResearchModeRef.current = drMode;
      setVoiceInputEnabledState(await getVoiceInputEnabled());
      setDeepResearchEnabled(drMode);
      await refreshSessions();
      // T-008: reabrir la última sesión al arrancar en frío, en vez de
      // mostrar siempre un chat vacío. El historial sí persiste en la base;
      // solo faltaba recargarlo al montar.
      try {
        const ss = await listSessions();
        if (ss.length > 0) {
          const latest = ss[0];
          const records = await getSessionMessages(latest.id);
          followBottom.current = true;
          setMessages(records.map((r) => ({ id: r.id, role: r.role, text: r.text, feedback: r.feedback, interrupted: r.interrupted })));
          setActiveSessionId(latest.id);
          sessionSummaryRef.current = latest.summary ?? null;
        }
      } catch {
        /* noop: si falla, arranca en chat vacío como antes */
      }
    })();
  }, [refreshSessions]);

  const copyMessage = useCallback(
    async (id: string, text: string) => {
      await Clipboard.setStringAsync(text);
      impact(ImpactFeedbackStyle.Light);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId((cur) => (cur === id ? null : cur)), 1500);
    },
    []
  );

  // Tapping the currently-active thumb again clears the rating (matches
  // copyMessage's own toggle-back-off pattern) rather than being a
  // one-way, unchangeable vote.
  const rateMessage = useCallback(
    async (id: string, rating: "up" | "down") => {
      const current = messagesRef.current.find((m) => m.id === id)?.feedback ?? null;
      const next = current === rating ? null : rating;
      impact(ImpactFeedbackStyle.Light);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, feedback: next } : m)));
      await setMessageFeedback(id, next);
    },
    []
  );

  // Cycles every tone; Custom only when a custom prompt is written (an empty one acts like the default).
  // Long-press a sent message to put it back in the input and send it again.
  const reuseMessage = useCallback(
    (text: string) => {
      updateInput(text, "typed");
      inputRef.current?.focus();
      impact(ImpactFeedbackStyle.Medium);
      setToast(t("chatScreen.messageReused"));
    },
    [t]
  );

  // 0.1.14: un ejemplo de la guía se escribe en el chat; nunca se envía solo.
  const tryGuideExample = useCallback((text: string) => {
    setShowGuide(false);
    setShowOnboarding(false);
    // 0.1.55 (auditoría): la guía también se abre desde Biblioteca y Ajustes;
    // el ejemplo se escribe en el chat, así que hay que mostrar el chat.
    selectTabRef.current?.("chat");
    setGuideOnboardingDone(true).catch(() => {});
    updateInput(text, "example");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const finishOnboarding = useCallback(() => {
    setShowOnboarding(false);
    setGuideOnboardingDone(true).catch(() => {});
  }, []);

  const cycleTone = useCallback(async () => {
    const customPrompt = (await getCustomSystemPrompt()) ?? "";
    const order = PERSONALITIES.map((p) => p.id).filter((id) => id !== "custom" || customPrompt.trim().length > 0);
    const next = order[(order.indexOf(personalityId) + 1) % order.length];
    setPersonalityIdState(next);
    await setPersonalityId(next);
    impact(ImpactFeedbackStyle.Light);
    setToast(t("chatScreen.toneChanged", { tone: `${getPersonality(next).icon} ${t(`personalities.${next}.label`)}` }));
  }, [personalityId, t]);

  // 0.1.55: Investigación profunda también desde el chat (chip junto al
  // cuadro de texto); sigue guardándose en Ajustes, que lo muestra igual.
  const toggleDeepResearch = useCallback(async () => {
    const next = !deepResearchModeRef.current;
    deepResearchModeRef.current = next;
    setDeepResearchEnabled(next);
    impact(ImpactFeedbackStyle.Light);
    setToast(t(next ? "chatScreen.researchOn" : "chatScreen.researchOff"));
    await setDeepResearchMode(next).catch(() => {});
  }, [t]);

  const initModels = useCallback(async () => {
    try {
      setLoadError(null);
      setReady(false);
      setLoadStatus(t("chatScreen.mountingWeights"));
      const llm = await resolveActiveModel("llm");
      const emb = await resolveActiveModel("embedding");
      setActiveModel(llm);

      await Promise.all([
        llamaEngine.load(llm.filename),
        embeddingEngine.load(emb.filename),
      ]);
      startAppMemoryTracking();

      setLoadStatus(t("chatScreen.indexingKnowledgeBase"));
      const stopProgress = onSeedProgress((p) =>
        setLoadStatus(`${t("chatScreen.indexingKnowledgeBase")} ${formatInt(p.done, displayLang(i18n.language))} / ${formatInt(p.total, displayLang(i18n.language))}`)
      );
      await seedKnowledgeBaseIfEmpty().finally(stopProgress);
      setReady(true);
      // Multilingual search (0.2.0): finish a model switch that was
      // interrupted, and build pack vector indexes. Background, never blocks
      // the chat; both are no-ops when there's nothing to do.
      void import("../rag/reembed").then(({ reembedMissing }) => reembedMissing()).catch(() => {});
      void import("../rag/packs")
        .then(({ prepareVectorIndexes }) => prepareVectorIndexes(embeddingEngine.loadedModelSha256, embeddingEngine.profile))
        .catch(() => {});
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
    }
  }, [t]);

  useEffect(() => {
    initModels();
  }, [initModels]);

  const generatingRef = useRef(false);
  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  // Development builds only: pick up an evaluation request written over adb
  // by scripts/eval-device.mjs (see src/eval/deviceEvalRequest.ts). Waits
  // until models are loaded, and leaves the request pending while a chat
  // reply is still generating.
  useEffect(() => {
    if (typeof __DEV__ === "undefined" || !__DEV__ || !ready || deviceEvalRequest) return;
    let cancelled = false;
    const check = async () => {
      if (cancelled || generatingRef.current) return;
      try {
        const request = await takePendingEvalRequest();
        if (request && !cancelled) setDeviceEvalRequest(request);
      } catch (e: any) {
        console.warn("[EVAL] could not read device request:", e?.message ?? e);
      }
    };
    check();
    const id = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready, deviceEvalRequest]);

  // Tareas programadas: se revisan al quedar listo el modelo, cada minuto y
  // al volver a primer plano. Usan el mismo candado que send(): nunca corren
  // a la vez que una respuesta del chat, y mientras corren el chat se muestra
  // ocupado.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const check = async () => {
      if (cancelled || generatingRef.current) return;
      if (!sendGuardRef.current.tryAcquire()) return;
      try {
        const { getDueTasks } = await import("../agent/scheduled/taskStore");
        if ((await getDueTasks()).length === 0) return;
        if (!llamaEngine.isLoaded) return;
        setGenerating(true);
        const { runScheduledTasksNow } = await import("../agent/scheduled/runScheduled");
        await runScheduledTasksNow({
          engine: llamaEngine,
          nCtx: llamaEngine.getModelInfo()?.nCtx,
          // 0.1.24 (H-9): el mismo mapeo de idioma que la ruta del
          // chat (toFallbackLang admite pt); el ternario anterior
          // colapsaba el portugués a español solo en tareas.
          lang: toFallbackLang(i18n.resolvedLanguage ?? i18n.language),
          strings: {
            doneTitle: (name) => t("scheduledTasks.notifyDone", { name }),
            failedTitle: (name) => t("scheduledTasks.notifyFailed", { name }),
            failedBody: t("scheduledTasks.notifyFailedBody"),
            dueTitle: (name) => t("scheduledTasks.notifyDue", { name }),
            dueBody: t("scheduledTasks.notifyDueBody"),
          },
        });
      } catch {
        // Una pasada fallida se reintenta en la siguiente revisión.
      } finally {
        setGenerating(false);
        sendGuardRef.current.release();
      }
    };
    void check();
    const id = setInterval(() => void check(), 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      cancelled = true;
      clearInterval(id);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const stopRequestedRef = useRef(false);

  // Stop only takes effect between generated tokens, so while the prompt is
  // still being processed it can take a while; show that the tap registered.
  const [stopping, setStopping] = useState(false);
  const stopGeneration = useCallback(async () => {
    stopRequestedRef.current = true;
    setStopping(true);
    setProcessing((prev) => (prev ? { ...prev, label: t("chatScreen.stopping") } : prev));
    impact(ImpactFeedbackStyle.Heavy);
    await llamaEngine.stop();
  }, [t]);

  const cancelBackgroundTask = useCallback(async () => {
    if (!backgroundTaskRef.current) return;
    await llamaEngine.stop();
    await backgroundTaskRef.current.catch(() => {});
    backgroundTaskRef.current = null;
  }, []);

  /**
   * Stops whatever's actively generating (single-pass or Deep Research) and
   * waits for send()'s own promise to fully settle — including its finally
   * block and DB persistence — before returning. Switching sessions or
   * starting a new chat while a generation is in flight used to just swap
   * `messages`/`activeSessionId` out from under it: the old generation kept
   * running against a now-stale assistantId, so its token updates and even
   * its final "insert the finished answer" update silently no-opped (a
   * .map() that can't find a matching id), losing the response from the
   * live UI even though it was still correctly persisted to that session's
   * history (only a fresh DB read — e.g. re-selecting the session — ever
   * surfaced it again). Awaiting the real generation task here, not just
   * the post-generation title/summary background task, closes that gap.
   */
  const stopAndAwaitGeneration = useCallback(async () => {
    if (!sendTaskRef.current) return;
    stopRequestedRef.current = true;
    await llamaEngine.stop();
    await sendTaskRef.current.catch(() => {});
  }, []);

  /**
   * 2026-10-30 (prueba física del dueño, Tab A9+): la política anterior de
   * docs/ADAPTIVE_ROUTING.md §14 («al pasar a segundo plano, cancelar
   * siempre») queda DEROGADA. Su foto enseñó su mensaje sin respuesta, sin
   * texto parcial y sin aviso: el listener cancelaba la generación al
   * salir, y el aviso vivía solo en este estado de React, que se perdió
   * con el proceso. La 0.1.37, sin listener, terminaba la respuesta sola
   * en segundo plano. Política nueva: la generación en curso NO se
   * cancela al salir — sigue bajo el servicio «NIDO está respondiendo»
   * (answerKeepAlive, 0.1.55), que existe para proteger el proceso
   * mientras genera. Este listener ya no detiene nada: solo guarda en la
   * fila borrador del historial lo generado hasta el momento (la marca de
   * interrumpida sigue puesta), para que si Android mata el proceso en
   * segundo plano, al reabrir quede la respuesta a medias con su aviso
   * honesto en vez de un hueco. Si el proceso sobrevive, la generación
   * termina y finishAssistantMessage guarda el texto final sin marca.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "background") return;
      if (!sendTaskRef.current) return;
      const inFlightId = processingRef.current?.messageId;
      if (!inFlightId || !activeSessionIdRef.current) return;
      const partial = messagesRef.current.find((m) => m.id === inFlightId)?.text ?? "";
      void updateAssistantDraft(inFlightId, partial).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  const resetToNewChat = useCallback(async () => {
    await stopAndAwaitGeneration();
    await cancelBackgroundTask();
    setMessages([]);
    setActiveSessionId(null);
    sessionSummaryRef.current = null;
    // 0.1.37 (auditoría): una pregunta pendiente del chat anterior no debe
    // convertir el primer mensaje del nuevo en un recordatorio o un borrado.
    choiceStoreRef.current.current = null;
    resetConversationState();
    recordChipDrop("new_chat");
    setStaged(null);
    impact(ImpactFeedbackStyle.Medium);
  }, [stopAndAwaitGeneration, cancelBackgroundTask, recordChipDrop]);

  // 0.1.10: NIDO desde fuera de la app (Compartir → NIDO, atajos del
  // icono, acceso rápido). La acción espera en el módulo nativo hasta que el
  // chat está visible; el texto compartido solo se pone en el campo de texto
  // (no se envía solo: viene de otra app y no es de confianza).
  const applyLaunchAction = useCallback(async () => {
    const action = takeLaunchAction();
    if (!action) return;
    if (action.action === "p2p") {
      setShowNido(true);
      setActiveTab("nido");
      return;
    }
    // 0.1.55 (auditoría): «Compartir → NIDO» o el atajo de nuevo chat con otra
    // pestaña abierta dejaba el texto escondido en el chat.
    selectTabRef.current?.("chat");
    await resetToNewChat();
    // 0.1.38: lo compartido queda cercado: si se envía, el router no lo mira.
    if (action.action === "share") updateInput(action.text, "shared");
  }, [resetToNewChat]);

  useEffect(() => {
    void applyLaunchAction();
    const off = onLaunchAction(() => void applyLaunchAction());
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void applyLaunchAction();
    });
    return () => {
      off();
      sub.remove();
    };
  }, [applyLaunchAction]);

  useEffect(() => {
    registerShortcuts({ newChat: t("launch.shortcutNewChat"), p2p: t("launch.shortcutP2P") });
  }, [t]);

  const selectSession = useCallback(async (id: string) => {
    await stopAndAwaitGeneration();
    await cancelBackgroundTask();
    const records = await getSessionMessages(id);
    followBottom.current = true;
    setMessages(records.map((r) => ({ id: r.id, role: r.role, text: r.text, feedback: r.feedback, interrupted: r.interrupted })));
    setActiveSessionId(id);
    choiceStoreRef.current.current = null;
    resetConversationState();
    recordChipDrop("session_switch");
    setStaged(null);
    const session = sessions.find((s) => s.id === id);
    sessionSummaryRef.current = session?.summary ?? null;
  }, [stopAndAwaitGeneration, cancelBackgroundTask, sessions, recordChipDrop]);

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSession(id);
      await refreshSessions();
      if (id === activeSessionId) await resetToNewChat();
    },
    [activeSessionId, refreshSessions, resetToNewChat]
  );

  const send = useCallback(async (override?: { text: string; draft: string }) => {
    const query = (override?.text ?? input).trim();
    // FIX 2026-10-09: no enviar antes de que los motores estén listos.
    // El carrusel de sugerencias llena el input programáticamente (evade
    // `editable={ready}`) y el teclado puede disparar onSubmitEditing
    // antes de que llamaEngine/embeddingEngine terminen de cargar,
    // lo que causaba cierre inmediato del app al enviar la sugerencia
    // de recordatorio recién abierto el chat.
    if (!query || generating || !ready) return;
    // N3 (2026-09-28): synchronous in-flight guard. `setGenerating(true)` is
    // batched, so two taps in the same tick both see stale `generating ===
    // false` through the closure. The ref is set synchronously here, before
    // any await, so the second tap observes the first and bails out. Release
    // happens in the outer finally: every exit path (early returns, errors)
    // passes through it, so the button can never be left permanently blocked.
    if (!sendGuardRef.current.tryAcquire()) return;
    try {
    // 0.1.38 (enrutado por tramo): lo pegado o compartido no llega al
    // router; si sobra texto alrededor de una orden, la orden se prepara
    // como chip y solo el toque la ejecuta. El toque llega aquí como
    // `override` (el plan ya se hizo).
    let inertRouting = false;
    if (!override) {
      const plan = planSend(query, segmentsRef.current);
      if (plan.kind === "stage") {
        setStaged({
          text: inputValueRef.current,
          lang: i18n.resolvedLanguage ?? i18n.language,
          deep: deepResearchModeRef.current,
          label: plan.label,
          runText: plan.runText,
          draft: plan.draft,
        });
        return;
      }
      inertRouting = plan.kind === "inert";
    }
    // 0.1.37: los seguimientos («¿qué te recuerdo?», «Haz uno») valen solo
    // para el turno siguiente.
    beginUserTurn();

    await cancelBackgroundTask();

    // Tras el toque de un chip, lo demás vuelve a la caja como borrador.
    segmentsRef.current = [];
    inputValueRef.current = "";
    // 0.1.43: con override el chip se está EJECUTANDO (llegó por su toque),
    // no cayendo: se marca consumido para que updateInput no lo cuente
    // como caída. Sin override no se toca: si había un chip y se envió
    // otra cosa, su caída la registra updateInput (text_edited).
    if (override) stagedRef.current = null;
    updateInput(override?.draft ?? "", "typed");
    setStaged(null);
    setGenerating(true);
    stopRequestedRef.current = false;

    let sessionId = activeSessionId;
    const isNewSession = !sessionId;
    if (!sessionId) {
      const session = await createSession();
      sessionId = session.id;
      setActiveSessionId(sessionId);
    }
    const userMsg: Message = { id: `${Date.now()}-u`, role: "user", text: query };
    const assistantId = `${Date.now()}-a`;
    // Explicit id, matching the in-memory message id used for the FlatList
    // key/React state — so a thumbs-up/down tap on this exact message can
    // reference `item.id` directly as answer_feedback's foreign key later,
    // rather than needing a separate id-mapping step.
    await persistMessage(sessionId, "user", query, userMsg.id);
    // 2026-10-30: la fila de la respuesta nace ya, vacía y marcada como
    // interrumpida. La completa finishAssistantMessage al terminar la
    // generación, o la borra deleteMessage si no hubo respuesta; si el
    // proceso muere antes, la fila queda y al reabrir hay aviso en vez de
    // silencio. Un fallo de esta escritura no bloquea la respuesta:
    // finishAssistantMessage es un upsert y la guarda igual al final.
    await addAssistantDraft(sessionId, assistantId).catch(() => {});

    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "" }]);
    setProcessing({ messageId: assistantId, status: "retrieving" });

    // The loaded model answers unless adaptive routing picks another (its telemetry overrides this).
    const baseModelId = activeModelRef.current?.id;
    let fixedTaskType: TaskType | undefined;
    const peakRss = trackPeakRss(() => {
      try {
        return getMemoryInfo().rssBytes;
      } catch {
        return 0;
      }
    });
    const startTime = performance.now();
    let ttftMs = 0;
    let tokensGenerated = 0;
    let assistantText = "";

    // --- Deterministic self-knowledge (2026-09-28) ---
    // Identity/capability/advantage/roadmap/usage questions are answered
    // from the bundled knowledge base — no agent loop, no retrieval, no
    // model. This is the fix for the live-evidence failures (chat "What's
    // Nido app" -> hallucinated academic app; Deep Research "Nido app" ->
    // Fate/Zero anime + "OFFLINE VERIFIED SOURCES"): the app can never
    // improvise about itself. Placed before the agent path AND both chat
    // branches, so it covers normal chat and Deep Research alike.
    const kbLocale = toIdentityLocale(i18n.resolvedLanguage ?? i18n.language);
    const kbQueryMeta = answerKnowledgeQueryWithCategory(query, kbLocale);
    // SMALLTALK 2026-10-11: charla básica ("bien y tú?", "gracias", "ok")
    // con respuesta determinista: sin RAG, sin letrero de "no sources", sin
    // generar. Antes cannedResponses solo corría dentro del agente y el chat
    // normal nunca lo consultaba. Anclado al mensaje completo: "hola,
    // recuérdame comprar pan" sigue su camino normal.
    const uiLang = toFallbackLang(i18n.resolvedLanguage ?? i18n.language);
    if (lastTurnLangRef.current !== null && lastTurnLangRef.current !== uiLang) {
      choiceStoreRef.current.current = null;
      resetConversationState();
    }
    lastTurnLangRef.current = uiLang;
    // 0.1.55: preguntas de seguridad con respuesta FIJA, sin modelo. Orden:
    // 1) monóxido de carbono (siempre primero: un error puede costar una vida);
    // 2) números de emergencia desde los datos verificados de los packs
    //    (23 países, con fuente y fecha); 3) la tabla fija de safetyAnswers
    //    (8 países, o «¿en qué país estás?») solo si ningún pack respondió.
    // Lo pegado o compartido (inertRouting) no cuenta como pregunta.
    const safetyHit = inertRouting ? null : matchSafetyAnswer(query, uiLang);
    const coHit = safetyHit !== null && safetyHit.kind !== "emergency-number" ? safetyHit : null;
    const smallTalkHit = safetyHit === null && kbQueryMeta === null ? matchSmallTalk(query, uiLang) : null;
    const factsHit =
      coHit === null && kbQueryMeta === null && smallTalkHit === null && !inertRouting
        ? await answerFromPackFacts(query, uiLang)
        : null;
    let numberHit = safetyHit !== null && safetyHit.kind === "emergency-number" && factsHit === null ? safetyHit : null;
    if (numberHit?.countryUnknown) {
      // 0.1.57: list every country with checked numbers (all the packs' countries,
      // not only the built-in table's 8). Still a fixed text: no number guessed.
      const names = await packCountryNames(uiLang).catch(() => [] as string[]);
      if (names.length > 0) numberHit = { ...numberHit, text: unknownCountryText(uiLang, numberHit.countryUnknown.asked, names) };
    }
    const kbAnswer =
      coHit !== null
        ? coHit.text
        : kbQueryMeta !== null
          ? kbQueryMeta.answer
          : smallTalkHit?.text ?? factsHit?.text ?? numberHit?.text ?? null;
    if (kbAnswer !== null) {
      assistantText = kbAnswer;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: kbAnswer, calls: kbQueryMeta === null && !smallTalkHit ? factsHit?.calls : undefined }
            : m
        )
      );
      notification(NotificationFeedbackType.Success);

      const kbDurationMs = performance.now() - startTime;
      recordQueryStats({
        tokensGenerated,
        durationMs: kbDurationMs,
        ttftMs,
        tokPerSec: 0,
        peakRssBytes: peakRss.stop(),
        timestamp: Date.now(),
        totalLatencyMs: kbDurationMs,
        modelId: baseModelId,
        taskType: "chat",
        adaptiveRoutingUsed: false,
        retrievalUsed: false,
        outcome: "success",
      });
      recordExecution({
        modelId: baseModelId,
        taskType: "chat",
        adaptiveRoutingUsed: false,
        retrievalUsed: false,
        totalLatencyMs: kbDurationMs,
        tokensGenerated,
        outcome: "success",
      }).catch(() => {});

      if (kbAnswer.trim().length > 0) {
        await finishAssistantMessage(sessionId, assistantId, kbAnswer);
      } else {
        await deleteMessage(assistantId);
      }

      const kbSettings = memorySettingsRef.current;
      // D/F3 (2026-09-28): the answer above is deterministic and model-free,
      // so its session title must be too. generateSessionTitle would invoke
      // llamaEngine.generate purely for bookkeeping — instead use the
      // deterministic title derived from the already-trusted category.
      // Synchronous and model-free: no background task, no retry path.
      if (isNewSession && kbSettings.autoGenerateTitles) {
        const sid = sessionId;
        const kbTitle = smallTalkHit
          ? smallTalkSessionTitle(smallTalkHit.lang)
          : factsHit
            ? factsHit.title
            : knowledgeSessionTitle(query, kbLocale);
        await setSessionTitle(sid, kbTitle);
        await refreshSessions();
      }
      await pruneSessions(kbSettings.maxSavedSessions);
      setGenerating(false);
      setStopping(false);
      setProcessing(null);
      setLiveTokPerSec(null);
      // Lectura en voz alta (Fase C): solo si el usuario la activó.
      if (kbAnswer.trim().length > 0) {
        getReadAloudEnabled()
          .then((enabled) => {
            if (enabled) speakAloud(kbAnswer);
          })
          .catch(() => {});
      }
      return;
    }

    // --- NIDO agent path: recordar / actuar ---
    // Intenciones que implican herramientas locales (notas, recordatorios,
    // memoria, hora del dispositivo) se resuelven con el loop agéntico en
    // vez del pipeline RAG/adaptativo: 100% local, con memoria inyectada.
    // Si el modelo no usa herramientas, responde directo igual que el chat.
    // 0.1.33: coste real del pre-router en el dispositivo (Diagnóstico).
    const classifyT0 = performance.now();
    // 0.1.38: texto citado (pegado/compartido) sin orden propia: el router
    // no lo mira; es conversación.
    let agentIntent: ReturnType<typeof classifyIntent> = inertRouting ? "conversar" : classifyIntent(query);
    const classifyMs = performance.now() - classifyT0;
    // 0.1.23: sonda con hit de memoria para las preguntas genéricas en
    // primera persona («¿cuál es mi color favorito?», «¿dónde vivo?»,
    // «what car do I have?»). classifyIntent las deja en conversar a
    // propósito — la forma es ambigua con las preguntas sobre
    // documentos de la guía y con la charla — y quien decide es el
    // dato: si lo guardado tiene un hit fuerte (memoryGateHit), el
    // turno entra al loop y la rama genérica de answerMemoryQuery
    // cita el hecho. Sin hit, o si la snapshot falla, el turno sigue
    // exactamente el camino de hoy (fail-open). En Deep Research la
    // sonda se salta: una pregunta en modo investigación es para
    // investigar, no para atajarla con un hecho guardado.
    let probedMemory: Awaited<ReturnType<typeof loadMemorySnapshot>> | null = null;
    if (
      agentIntent === "conversar" &&
      !inertRouting &&
      !deepResearchModeRef.current &&
      (isGenericMemoryQuestionShape(query) || /^\s*¿|\?\s*$/.test(query))
    ) {
      const snap = await loadMemorySnapshot().catch(() => null);
      // 0.1.42: también una pregunta sin primera persona cuyos términos
      // están TODOS en un hecho guardado («¿dónde está la clave del wifi?»).
      if (snap && ((isGenericMemoryQuestionShape(query) && memoryGateHit(query, snap)) || memoryFullCoverageHit(query, snap))) {
        agentIntent = "recordar";
        // La snapshot de la sonda se reutiliza como loadMemory del
        // loop: no se paga dos veces en los turnos que entran.
        probedMemory = snap;
      }
    }
    // 0.1.25: si hay una elección pendiente («¿cuál nota?»), la
    // respuesta del usuario clasifica como conversar y nunca entraría
    // al loop: si la resuelve o es corta, el turno entra para
    // consumirla o repetir la pregunta; si es un mensaje nuevo y
    // largo, la elección caduca en silencio y el turno sigue normal.
    const pendingChoice = choiceStoreRef.current.current;
    if (pendingChoice && agentIntent === "conversar" && !inertRouting) {
      if (choiceTurnKind(query, pendingChoice) !== "none") {
        agentIntent = "actuar";
      } else {
        choiceStoreRef.current.current = null;
      }
    }
    if (agentIntent !== "recordar" && agentIntent !== "actuar") {
      recordRouterSample(classifyMs, "chat");
      // 0.1.41: una orden que NIDO tomó por conversación también es un
      // fallo del router (opcional, con el registro de frases encendido).
      if (!inertRouting && looksLikeMissedCommand(query)) {
        void recordMissedPhrase(query, { route: "chat", modelTools: [], retry: null, fallback: null }).catch(() => {});
      }
    }
    if (agentIntent === "recordar" || agentIntent === "actuar") {
      setProcessing({ messageId: assistantId, status: "thinking" });
      // 0.1.33: ¿respondió el modelo o el código? Solo se cuenta, el
      // motor es el mismo.
      let modelUsed = false;
      try {
        const agentMaxTokens = await getMaxTokens();
        // NIDO: las acciones sensibles (calendario, mensajes NIDO) piden
        // confirmación explícita con un diálogo nativo antes de ejecutarse.
        // R3: diálogo con FLAG_SECURE en la propia ventana del Dialog
        // (el flag de MainActivity no cubre Dialog windows).
        const requestConfirm = (req: { title: string; message: string }) =>
          showSecureAlert({
            title: req.title,
            message: req.message,
            cancelLabel: t("common.cancel"),
            confirmLabel: t("common.confirm"),
          });
        // FASE D7: Wire Policy Engine ASK → UI. Si el Policy Engine decide
        // que una acción requiere confirmación humana, mostrar diálogo real.
        // Sin esto, las acciones ASK se bloqueaban silenciosamente (fail-closed
        // correcto, pero sin surface para el usuario).
        // TOOLS-AUDIT 2026-10-11: el diálogo dice QUÉ se va a hacer (número,
        // texto exacto del SMS, lo que se va a guardar) en el idioma del
        // usuario, no "Tool 'place_call' is irreversible…".
        const onConfirmTool = async (
          decision: { reason: string; risk: string },
          action?: { tool: string; args: Record<string, unknown> }
        ): Promise<boolean> => {
          const dialog = describePolicyConfirmation(
            decision as { reason: string; risk: "low" | "medium" | "high" | "critical" },
            action,
            uiLang
          );
          return showSecureAlert({
            title: dialog.title,
            message: dialog.message,
            cancelLabel: t("common.cancel"),
            confirmLabel: t("common.confirm"),
          });
        };
        const agentResult = await runAgentLoop(query, {
          engine: {
            generate: (args) => {
              modelUsed = true;
              return llamaEngine.generate(args);
            },
          },
          handlers: buildToolHandlers({ requestConfirm }),
          onConfirmTool,
          loadMemory: () =>
            probedMemory !== null
              ? Promise.resolve(probedMemory)
              : loadMemorySnapshot().catch(() => null),
          maxSteps: 3,
          nPredict: agentMaxTokens,
          // FIX 2026-10-09: idioma vigente para el system prompt.
          // TOOLS-AUDIT 2026-10-11: también pt (respuestas deterministas).
          lang: uiLang,
          // TOOLS-AUDIT 2026-10-11: contactos/llamadas/SMS por la vía
          // determinista (no depende de que el 0.5B escriba el JSON).
          contactSearch: searchPhoneContacts,
          // 0.1.25: elección pendiente («¿cuál nota?») compartida entre turnos.
          choiceStore: choiceStoreRef.current,
          // 0.1.8: "lee la nota X" se resuelve por título, no por id.
          listNoteTitles: async () => {
            const { listNotes } = await import("../agent/memory/memoryStore");
            return (await listNotes(50)).map((n) => ({ id: n.id, title: n.title }));
          },
          // 0.1.20 (P3-10): buscar dentro de las notas necesita el cuerpo.
          listNotesFull: async () => {
            const { listNotes } = await import("../agent/memory/memoryStore");
            return (await listNotes(50)).map((n) => ({ id: n.id, title: n.title, body: n.body }));
          },
          // 0.1.14: "qué recordatorios tengo".
          listReminders: async () => {
            const { listReminders } = await import("../agent/memory/memoryStore");
            return (await listReminders(50)).map((r) => ({ id: r.id, text: r.text, dueAt: r.due_at, repeat: r.repeat ?? null }));
          },
          // Presupuesto de prompt contra el n_ctx real del modelo cargado
          // (T-contexto-2026-10-06).
          nCtx: llamaEngine.getModelInfo()?.nCtx,
        });
        assistantText = agentResult.response;
        // 0.1.39: el loop dice por dónde salió el turno (routing). Antes
        // se adivinaba comparando el texto con dos respaldos y se escapaba
        // el tercero («memoryFailed»), que contaba como respuesta del modelo.
        const routing = agentResult.routing;
        const routedOutcome =
          routing?.fallback ||
          (["notUnderstood", "actionFailed", "memoryFailed"] as const).some(
            (k) => agentResult.response.trim() === agentFallbackText(k, uiLang),
          )
            ? "notUnderstood"
            : modelUsed || routing?.route === "model"
              ? "model"
              : "router";
        recordRouterSample(classifyMs, routedOutcome, routing);
        if (routing && routedOutcome !== "router") {
          // Opcional y apagado por defecto: guardar la frase que el router
          // no reconoció, para revisarla uno mismo (Diagnóstico).
          void recordMissedPhrase(query, routing).catch(() => {});
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: assistantText } : m))
        );
        notification(NotificationFeedbackType.Success);

        const agentDurationMs = performance.now() - startTime;
        recordQueryStats({
          tokensGenerated,
          durationMs: agentDurationMs,
          ttftMs,
          tokPerSec: 0,
          peakRssBytes: peakRss.stop(),
          timestamp: Date.now(),
          totalLatencyMs: agentDurationMs,
          modelId: baseModelId,
          taskType: "chat",
          adaptiveRoutingUsed: false,
          retrievalUsed: false,
          outcome: "success",
        });
        recordExecution({
          modelId: baseModelId,
          taskType: "chat",
          adaptiveRoutingUsed: false,
          retrievalUsed: false,
          totalLatencyMs: agentDurationMs,
          tokensGenerated,
          outcome: "success",
        }).catch(() => {});

        if (assistantText.trim().length > 0) {
          await finishAssistantMessage(sessionId, assistantId, assistantText);
        } else {
          await deleteMessage(assistantId);
        }

        const agentSettings = memorySettingsRef.current;
        if (isNewSession && agentSettings.autoGenerateTitles) {
          // 0.1.61: título sin modelo (sessionTitle.ts): no gasta batería ni
          // borra de la caché el prefijo que reutiliza la siguiente pregunta.
          const title = titleFromQuestion(query);
          if (title) {
            await setSessionTitle(sessionId, title).catch(() => {});
            await refreshSessions();
          }
        }
        await pruneSessions(agentSettings.maxSavedSessions);
      } catch (e: any) {
        peakRss.stop();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: `Error: ${e?.message ?? e}` } : m
          )
        );
        // El error se enseña en pantalla pero no se persiste (como hasta
        // ahora): la fila borrador de esta respuesta desaparece.
        void deleteMessage(assistantId).catch(() => {});
        recordExecution({
          adaptiveRoutingUsed: false,
          modelId: baseModelId,
          taskType: "chat",
          totalLatencyMs: performance.now() - startTime,
          tokensGenerated,
          outcome: "failure",
          errorMessage: e?.message ?? String(e),
        }).catch(() => {});
      } finally {
        // La rama agéntica retorna antes del finally general: limpia su
        // propio estado para no dejar el botón de enviar bloqueado.
        setGenerating(false);
        setStopping(false);
        setProcessing(null);
        setLiveTokPerSec(null);
      }
      // Lectura en voz alta (Fase C): solo si el usuario la activó.
      if (assistantText.trim().length > 0) {
        getReadAloudEnabled()
          .then((enabled) => {
            if (enabled) speakAloud(assistantText);
          })
          .catch(() => {});
      }
      return;
    }

    try {
      const [maxTokens, activePersonalityId, customPrompt] = await Promise.all([
        getMaxTokens(),
        getPersonalityId(),
        getCustomSystemPrompt(),
      ]);
      const personality = getPersonality(activePersonalityId);
      const systemPrompt = activePersonalityId === "custom" ? customPrompt : personality.systemPrompt;
      const styleReminder = activePersonalityId === "custom" ? undefined : personality.styleReminder;

      const priorMessages = messagesRef.current.filter((m) => m.text.length > 0);
      const verbatimTurns: ConversationTurn[] = priorMessages
        .slice(-VERBATIM_MESSAGE_COUNT)
        .map((m) => ({ role: m.role, text: m.role === "assistant" ? stripThinking(m.text) : m.text }));
      const history = { summary: sessionSummaryRef.current, turns: verbatimTurns };

      let firstToken = true;
      let firstTokenTime = 0;
      const onToken = (piece: string) => {
        tokensGenerated += 1;
        assistantText += piece;
        // FIX 2026-10-09 (5.1): buffer tokens, flush a React cada ~100ms.
        // Antes cada token hacía setMessages → re-render de toda la lista.
        tokenBuffer += piece;
        const now = performance.now();
        if (firstToken) {
          firstToken = false;
          firstTokenTime = now;
          ttftMs = firstTokenTime - startTime;
          setProcessing({ messageId: assistantId, status: "generating" });
          // Primer token sí va inmediato (TTFT).
          flushTokenBuffer();
        } else {
          const elapsedSinceFirst = (now - firstTokenTime) / 1000;
          if (elapsedSinceFirst > 0) setLiveTokPerSec(tokensGenerated / elapsedSinceFirst);
          if (now - lastFlushTime >= 100) {
            flushTokenBuffer();
          }
        }
      };
      // Buffer de tokens para 5.1.
      let tokenBuffer = "";
      let lastFlushTime = 0;
      const flushTokenBuffer = () => {
        if (!tokenBuffer) return;
        const chunk = tokenBuffer;
        tokenBuffer = "";
        lastFlushTime = performance.now();
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + chunk } : m))
        );
      };

      let chunks: RetrievedChunk[] = [];
      // 0.1.59: answered word for word from a NIDO Essentials guide (no model).
      let guideAnswered = false;
      // Honest no-result flag for THIS reply (2026-09-28): true only when
      // retrieval was actually attempted and returned zero chunks — never
      // for greetings/other retrieval-irrelevant tasks where no retrieval
      // was tried. Rendered deterministically under the bubble.
      let noSourcesFound = false;
      // Adaptive-routing-specific telemetry, merged into the regular
      // recordQueryStats() call below — stays null (contributing nothing)
      // for Deep Research and for the plain fixed-active-model path, so
      // existing QueryStats consumers see no shape change for those.
      let adaptiveTelemetry: Partial<QueryStats> | null = null;

      if (deepResearchModeRef.current) {
        // Deep Research Mode is completely separate from adaptive routing
        // and untouched by it — orchestrator.ts's own sequential pipeline,
        // same as before this integration.
        setDeepResearchActive(true);
        const result = await runDeepResearch(
          query,
          systemPrompt,
          history,
          maxTokens,
          (p: ResearchProgress) => {
            setProcessing({ messageId: assistantId, status: "thinking", label: researchStageLabel(p, t) });
          },
          onToken,
          () => stopRequestedRef.current
        );
        chunks = result.citations;
        // Deep Research always runs a retrieval pass per sub-question, so
        // "all passes returned nothing" is the honest signal here.
        noSourcesFound = result.noSourcesFound ?? result.citations.length === 0;
        // FIX 2026-10-09 (H-1): flush del buffer de tokens en Deep Research.
        flushTokenBuffer();
        if (result.timedOut) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, timedOut: true } : m))
          );
        }
      } else {
        // classifyTask/isRetrievalIrrelevant are the same deterministic,
        // tested rule router.ts uses (src/routing/classify.ts) — reused
        // directly by the fixed-model path below regardless of whether
        // adaptive routing is enabled, so a pure greeting like "wake up!"
        // never retrieves unrelated knowledge-base chunks either way.
        // 0.1.59: first aid in the guide's own words. When a NIDO Essentials
        // guide is the clear best match, its text is shown verbatim and no
        // model runs (a small model dropped a «no» in the aspirin rule and
        // mangled the choking steps on a real tablet). Retrieval runs once;
        // the fixed path below reuses it when no guide answers.
        let preRetrieved: RetrievedChunk[] | null = null;
        if (!isRetrievalIrrelevant(classifyTask(query))) {
          setProcessing({ messageId: assistantId, status: "retrieving" });
          const g = await answerFromGuide(query, uiLang);
          preRetrieved = g.retrieved;
          if (g.answer) {
            guideAnswered = true;
            assistantText = g.answer.text;
            const guideText = g.answer.text;
            const guideChunkId = g.answer.chunks[0]?.chunkId;
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: guideText, guideChunkId } : m)));
            chunks = g.answer.chunks;
          }
        }
        const runFixedModelChat = async (): Promise<{ chunks: RetrievedChunk[]; noSourcesFound: boolean }> => {
          let c: RetrievedChunk[];
          fixedTaskType = classifyTask(query);
          // Honest no-result (2026-09-28): retrievalAttempted is true only
          // when retrieve() actually ran — never for retrieval-irrelevant
          // task types (greetings, calculations, ...), where no retrieval
          // was tried at all.
          let retrievalAttempted = false;
          if (isRetrievalIrrelevant(fixedTaskType)) {
            c = [];
          } else {
            retrievalAttempted = true;
            if (preRetrieved) {
              c = preRetrieved;
            } else {
              setProcessing({ messageId: assistantId, status: "retrieving" });
              c = await retrieve(query, ANSWER_CONTEXT_CHUNKS);
            }
          }
          const noSources = retrievalAttempted && c.length === 0;
          // Programa bounty, tanda 2 (puerta léxica de salud, patrón de
          // LabRat): pregunta de salud + ninguna fuente → el texto
          // seguro fijo, sin generar. Va ANTES del "no lo sé" de hechos:
          // para salud el texto seguro es el específico (llama si es
          // urgencia; la guía está en el pack Esencial), no el genérico.
          if (noSources && isHealthQuestion(query)) {
            const safe = healthSafeText(uiLang);
            assistantText = safe;
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: safe } : m)));
            return { chunks: c, noSourcesFound: noSources };
          }
          // RAG-GROUNDING 2026-10-11 (Fase 3, "mejor no inventar"): pregunta
          // de hechos + ninguna fuente → "no lo sé" honesto y determinista,
          // sin generar. Pedírselo al 0.5B por prompt no basta: inventa igual.
          if (noSources && isFactualQuestion(query)) {
            const idk = noSourcesAnswer(uiLang);
            assistantText = idk;
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: idk } : m)));
            return { chunks: c, noSourcesFound: noSources };
          }
          setProcessing({ messageId: assistantId, status: "thinking" });
          // Use the model's own chat template when its file ships one; the
          // plain prompt is only a fallback. Off-template, models ramble,
          // echo instructions, and reasoning models never open <think>.
          // C2-2026-10-06: verificar el presupuesto de contexto ANTES de
          // generar (la ruta del agent loop ya lo hace; esta ruta directa no).
          const useChatTemplate = llamaEngine.hasEmbeddedChatTemplate();
          // RAG-GROUNDING 2026-10-11: con fuentes, muestreo factual (0.3)
          // en vez del 0.7 de charla.
          // 0.1.34: sin fuentes, el preset de charla (con penalización de
          // repetición). Antes no se pasaba ninguno y el 0.5B corría sin
          // penalización: bucle «las aluminosas, las aluminosas…».
          const sampling = { samplingPreset: c.length > 0 ? ("factual" as const) : ("chat" as const) };
          const directMessages = useChatTemplate
            ? assembleChatMessages(query, c, systemPrompt, history, styleReminder, noSources)
            : undefined;
          const directPrompt = useChatTemplate
            ? undefined
            : assemblePrompt(query, c, systemPrompt, history, styleReminder, noSources);
          const promptText = useChatTemplate ? directMessages!.map((m) => m.content).join("\n") : directPrompt!;
          const nCtx = llamaEngine.getModelInfo()?.nCtx ?? 4096;
          // Estudio de modelos (2026-10-12): piso de generación del
          // modelo cargado — un modelo que razona (LFM2.5) con el
          // presupuesto normal puede gastar todos los tokens pensando
          // y no responder nunca. El piso se recorta a lo que el
          // contexto admite tras el prompt, y la aserción de abajo
          // sigue siendo la guarda final.
          const loadedEntry = MODEL_CATALOG.find((m) => m.filename === llamaEngine.getModelInfo()?.filename);
          const genFloor = loadedEntry?.capabilities?.minGenerationTokens ?? 0;
          const genTokens = Math.min(
            Math.max(maxTokens, genFloor),
            Math.max(512, nCtx - estimatePromptTokens(promptText) - 64)
          );
          const genInput = useChatTemplate
            ? { messages: directMessages!, nPredict: genTokens, onToken, ...sampling }
            : { prompt: directPrompt!, nPredict: genTokens, onToken, ...sampling };
          assertPromptBudget([{ role: "user", content: promptText }], nCtx, genTokens, "chat-directo");
          await llamaEngine.generate(genInput);
          // 5.1: flush final del buffer de tokens.
          flushTokenBuffer();
          return { chunks: c, noSourcesFound: noSources };
        };

        const adaptiveRoutingEnabled = await getAdaptiveRoutingEnabled();

        if (guideAnswered) {
          noSourcesFound = false;
        } else if (adaptiveRoutingEnabled) {
          try {
            const result = await runAdaptiveChat(
              { query, systemPrompt, styleReminder, history },
              maxTokens,
              {
                onToken,
                shouldStop: () => stopRequestedRef.current,
                onStepStart: (step) => {
                  setProcessing({
                    messageId: assistantId,
                    status: step.type === "retrieve" ? "retrieving" : "thinking",
                  });
                },
              }
            );

            // executeRoutingPlan doesn't throw when a required step's model
            // can't be resolved — it resolves normally with an empty answer
            // and a warning instead. And when NOTHING is available at all
            // (no model resolves to any role), planRoute never even builds
            // a generate step, so executor-level `warnings` stays empty too
            // — checking for that would miss this case entirely. The
            // simple, comprehensive signal is just "no answer text and the
            // user didn't stop it themselves" — a try/catch alone wouldn't
            // see either of these as a failure, but the user would still be
            // left with a blank response, so it's checked explicitly and
            // falls back the same way a thrown error does.
            if (result.answer.trim().length === 0 && !stopRequestedRef.current) {
              console.warn("[ChatScreen] adaptive routing produced no answer, falling back:", result.warnings, result.plan.reasonCodes);
              adaptiveTelemetry = { adaptiveRoutingUsed: true, outcome: "failure" };
              const fixed = await runFixedModelChat();
              chunks = fixed.chunks;
              noSourcesFound = fixed.noSourcesFound;
            } else {
              chunks = result.citations;
              // Executor reports retrievalAttempted; paired with zero
              // citations that's the honest no-result signal.
              noSourcesFound = result.retrievalAttempted && result.citations.length === 0;
              if (result.timedOut) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, timedOut: true } : m))
                );
              }
              if (result.modelUsed) setActiveModel(result.modelUsed);
              adaptiveTelemetry = {
                adaptiveRoutingUsed: true,
                modelId: result.plan.steps.find((s) => s.type === "generate")?.modelId,
                taskType: result.taskType,
                reasonCodes: result.plan.reasonCodes,
                modelSwitches: result.modelSwitches,
                crossMessageModelSwitch: result.crossMessageModelSwitch,
                modelResidency: result.modelResidency,
                modelLoadMs: result.modelLoadMs,
                retrievalUsed: chunks.length > 0,
                generationLatencyMs: result.generationLatencyMs,
                outcome: stopRequestedRef.current ? "cancelled" : "success",
              };
              // Override the generic ttftMs/tokPerSec the base
              // recordQueryStats() call below already computes (measured
              // from message-send start, which for this path includes
              // model load time) with executor.ts's precisely-scoped
              // value — model load time is measured separately
              // (modelLoadMs) and deliberately excluded from ttftMs here,
              // the whole point of this fix. Only assigned when actually
              // available (no generate step ran at all, e.g. no model
              // resolvable, leaves it unset) — QueryStats.ttftMs is a
              // required field, so setting it to undefined here would
              // overwrite the base object's generic fallback instead of
              // preserving it.
              if (result.ttftMs !== undefined) {
                adaptiveTelemetry.ttftMs = result.ttftMs;
                if (result.generationLatencyMs && result.generationLatencyMs > 0) {
                  adaptiveTelemetry.tokPerSec = tokensGenerated / (result.generationLatencyMs / 1000);
                }
              }
            }
          } catch (e: any) {
            // A routing failure must never leave the user without a
            // response — same fixed-active-model path as adaptive routing
            // being off, just reached via a caught exception instead.
            console.warn("[ChatScreen] adaptive routing threw, falling back to active model:", e?.message ?? String(e));
            adaptiveTelemetry = { adaptiveRoutingUsed: true, outcome: "failure" };
            const fixedFallback = await runFixedModelChat();
            chunks = fixedFallback.chunks;
            noSourcesFound = fixedFallback.noSourcesFound;
          }
        } else {
          const fixedPlain = await runFixedModelChat();
          chunks = fixedPlain.chunks;
          noSourcesFound = fixedPlain.noSourcesFound;
        }
      }
      // FIX 2026-10-09 (C2): flush del buffer de tokens en el path adaptivo.
      // runFixedModelChat ya lo hace, pero runAdaptiveChat no.
      flushTokenBuffer();

      const wasStopped = stopRequestedRef.current;

      // RAG-GROUNDING 2026-10-11: punto ÚNICO de decisión tras generar
      // (fijo y adaptativo; Deep Research tiene su propia síntesis y solo
      // recibe la red de "nunca vacío"). Aquí se sabe a la vez qué dijo el
      // modelo y qué dicen las fuentes:
      //  - con fuentes → se quitan frases sin respaldo; si no queda nada,
      //    "no lo sé" + extracto literal de la fuente (grounding.ts);
      //  - sin fuentes + pregunta de hechos → "no lo sé" honesto;
      //  - NEVER-SILENT: respuesta vacía → texto honesto, nunca burbuja vacía.
      let grounding: GroundingStatus | undefined;
      let provenance: SentenceProvenance[] | undefined;
      if (!wasStopped) {
        // 0.1.34: si el modelo entró en bucle, queda solo la primera vez.
        // Bounty tanda 8: una generación cortada (el usuario detuvo o
        // se agotó el presupuesto) no enseña una frase a medias.
        let finalText = guideAnswered
          ? assistantText
          : trimToCompleteSentences(trimRepetitionLoop(assistantText), wasStopped || llamaEngine.lastGenerationWasCut);
        if (guideAnswered) {
          // Verbatim guide text: nothing to verify or trim. Every sentence is the guide's (R1).
          provenance = guideAnswerProvenance(finalText);
        } else if (!deepResearchModeRef.current && chunks.length > 0 && isCreativeRequest(query)) {
          // 2026-10-30 (prueba física del dueño): petición creativa
          // («Cuéntame un cuento largo sobre un zorro que vive en un
          // faro») con documentos que casan solo por palabras sueltas —
          // el acta importada por el propio usuario traía zorro y faro y
          // salía al 85 %. El verificador juzgaba el cuento como una
          // respuesta de hechos sin apoyo y lo sustituía entero por el
          // «no lo sé» con extracto literal: la foto del dueño enseñó el
          // extracto del acta en lugar del cuento. Una creación no se
          // ancla a fuentes: el texto queda tal cual. Las preguntas de
          // hechos con fuentes se verifican igual que antes —
          // isCreativeRequest exige el objeto creado, así que «cuéntame
          // el número de emergencias de Chile» no entra por esta rama.
        } else if (!deepResearchModeRef.current && chunks.length > 0) {
          // 0.1.41 (prueba física, «¿qué es la inflación?»): se verificaba
          // el texto SIN recortar y el bucle volvía a la pantalla.
          const verified = verifyGroundedAnswer(finalText, chunks, uiLang);
          grounding = verified.status;
          if (verified.status !== "skipped") finalText = verified.text;
          provenance = verified.sentences;
        } else if (!deepResearchModeRef.current && noSourcesFound) {
          // Programa bounty, tanda 2: la puerta de salud manda sobre el
          // "no lo sé" genérico — una pregunta de salud sin fuentes (la
          // ruta adaptativa no tiene la puerta previa de la ruta fija)
          // cae al texto seguro, nunca a lo que el modelo haya escrito.
          if (isHealthQuestion(query) && finalText !== healthSafeText(uiLang)) {
            finalText = healthSafeText(uiLang);
            provenance = healthSafeProvenance(finalText);
          } else if (isFactualQuestion(query) && finalText !== noSourcesAnswer(uiLang)) {
            finalText = noSourcesAnswer(uiLang);
          }
        }
        // Programa bounty, tanda 2 (puerta de salud, segunda salida):
        // con fuentes que NO son de salud, las salidas que dejan texto
        // del modelo en pie («unverified»: la lengua no dejó juzgarlo)
        // o que enseñan el extracto de esa fuente como respuesta
        // («abstained») caen también al texto seguro si la pregunta es
        // de salud y ningún chunk es de un pack de salud. Lo
        // «grounded»/«partial» no se toca: está verificado frase a
        // frase contra sus fuentes, no es memoria del modelo.
        if (
          !deepResearchModeRef.current &&
          chunks.length > 0 &&
          (grounding === "unverified" || grounding === "abstained") &&
          isHealthQuestion(query) &&
          !hasHealthEvidence(chunks)
        ) {
          finalText = healthSafeText(uiLang);
          provenance = healthSafeProvenance(finalText);
          grounding = "abstained";
        }
        if (stripThinking(finalText).trim().length === 0) {
          finalText = agentFallbackText("emptyAnswer", uiLang);
        }
        if (finalText !== assistantText) {
          assistantText = finalText;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: finalText } : m))
          );
        }
      }

      // Programa bounty, tanda 1: la tarjeta de evidencia se calcula
      // aquí, al cerrar la respuesta, con la pregunta y las fuentes en
      // la mano — es el único punto donde las dos cosas conviven.
      const evidenceFirst = chunks.length > 0 ? buildEvidenceCard(chunks, query) : null;

      // Programa bounty, tanda 8: la caja de comprobación de fuentes
      // (sourceCheck.ts) — solo en la ruta sin verificación, donde
      // ninguna otra puerta ha juzgado las cifras contra las fuentes.
      const numberConflicts =
        grounding === "unverified" && chunks.length > 0 ? findNumberConflicts(assistantText, chunks) : [];

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                citations: chunks,
                stopped: wasStopped,
                noSourcesFound,
                grounding,
                provenance,
                evidenceFirst: evidenceFirst ?? undefined,
                numberConflicts: numberConflicts.length > 0 ? numberConflicts : undefined,
              }
            : m
        )
      );
      notification(wasStopped ? NotificationFeedbackType.Warning : NotificationFeedbackType.Success);

      const durationMs = performance.now() - startTime;
      const finalStats: QueryStats = {
        tokensGenerated,
        durationMs,
        ttftMs,
        tokPerSec: tokensGenerated > 0 ? tokensGenerated / ((durationMs - ttftMs) / 1000) : 0,
        peakRssBytes: peakRss.stop(),
        timestamp: Date.now(),
        totalLatencyMs: durationMs,
        modelId: baseModelId,
        ...(fixedTaskType ? { taskType: fixedTaskType, retrievalUsed: chunks.length > 0 } : {}),
        ...(adaptiveTelemetry ?? {}),
      };
      recordQueryStats(finalStats);
      // Persisted (SQLite), survives reload/restart — telemetry.ts's
      // recordQueryStats above stays the separate, unmodified in-memory
      // compatibility layer for the existing live Usage Stats display; this
      // is the new Phase 7 source of truth. Fire-and-forget: telemetry
      // must never block or fail the chat response the user already has.
      recordExecution({
        modelId: finalStats.modelId,
        taskType: finalStats.taskType,
        adaptiveRoutingUsed: finalStats.adaptiveRoutingUsed ?? false,
        reasonCodes: finalStats.reasonCodes,
        retrievalUsed: finalStats.retrievalUsed,
        modelSwitches: finalStats.modelSwitches,
        crossMessageModelSwitch: finalStats.crossMessageModelSwitch,
        modelResidency: finalStats.modelResidency,
        modelLoadMs: finalStats.modelLoadMs,
        ttftMs: finalStats.ttftMs,
        generationLatencyMs: finalStats.generationLatencyMs,
        totalLatencyMs: finalStats.totalLatencyMs,
        tokensGenerated: finalStats.tokensGenerated,
        tokPerSec: finalStats.tokPerSec,
        peakRssBytes: finalStats.peakRssBytes,
        outcome: finalStats.outcome ?? (wasStopped ? "cancelled" : "success"),
      }).catch(() => {});

      if (assistantText.trim().length > 0) {
        await finishAssistantMessage(sessionId, assistantId, assistantText);
      } else {
        await deleteMessage(assistantId);
      }

      const settings = memorySettingsRef.current;
      const allMessages = [...priorMessages, userMsg, { ...userMsg, id: assistantId, role: "assistant" as const, text: assistantText }];

      if (isNewSession && settings.autoGenerateTitles && !wasStopped) {
        // 0.1.61: título sin modelo (ver arriba).
        const title = titleFromQuestion(query);
        if (title) {
          await setSessionTitle(sessionId, title).catch(() => {});
          await refreshSessions();
        }
      } else if (settings.autoSummarize && !wasStopped) {
        const totalTurns = Math.floor(allMessages.length / 2);
        if (totalTurns > settings.historyTurnThreshold) {
          const olderMessages = allMessages.slice(0, -VERBATIM_MESSAGE_COUNT);
          if (olderMessages.length > 0) {
            const sid = sessionId;
            const turnsToSummarize: ConversationTurn[] = olderMessages.map((m) => ({
              role: m.role,
              text: m.role === "assistant" ? stripThinking(m.text) : m.text,
            }));
            const previousSummary = sessionSummaryRef.current;
            backgroundTaskRef.current = summarizeConversation(turnsToSummarize, previousSummary)
              .then(async (summary) => {
                sessionSummaryRef.current = summary;
                await setSessionSummary(sid, summary);
              })
              .catch(() => {})
              .finally(() => {
                backgroundTaskRef.current = null;
              });
          }
        }
      }

      await pruneSessions(settings.maxSavedSessions);

      // Lectura en voz alta (Fase C): solo si el usuario la activó.
      if (assistantText.trim().length > 0 && !wasStopped) {
        getReadAloudEnabled()
          .then((enabled) => {
            if (enabled) speakAloud(assistantText);
          })
          .catch(() => {});
      }
    } catch (e: any) {
      peakRss.stop();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, text: `Error: ${e?.message ?? e}` } : m
        )
      );
      // El error se enseña en pantalla pero no se persiste (como hasta
      // ahora): la fila borrador de esta respuesta desaparece.
      void deleteMessage(assistantId).catch(() => {});
      // Minimal failure record — adaptiveTelemetry is scoped inside the
      // inner try block above, not accessible here, so this can't say
      // whether adaptive routing was involved; still worth capturing that
      // a request failed at all, with what timing we do have.
      recordExecution({
        adaptiveRoutingUsed: false,
        modelId: baseModelId,
        totalLatencyMs: performance.now() - startTime,
        tokensGenerated,
        outcome: "failure",
        errorMessage: e?.message ?? String(e),
      }).catch(() => {});
    } finally {
      setGenerating(false);
      setStopping(false);
      setProcessing(null);
      setLiveTokPerSec(null);
      setDeepResearchActive(false);
    }
    } finally {
      // N3: always released — normal completion, early returns (self-knowledge
      // and agentic branches return above), and thrown errors all flow through
      // here, so error/retry keeps working and the send button is never wedged.
      sendGuardRef.current.release();
    }
  }, [input, generating, ready, activeSessionId, cancelBackgroundTask, refreshSessions, updateInput]);

  // send() itself isn't awaited by its callers (onPress/onSubmitEditing) —
  // stopAndAwaitGeneration needs a handle on the in-flight promise so a
  // session switch can wait for it to actually finish. Only the entry point
  // sets sendTaskRef; send() doesn't need to know about it.
  const handleSend = useCallback(() => {
    // Programa bounty, tanda 2: con una generación en curso el envío
    // normal NO entra. send() lo rechazaría igualmente, pero llamarlo
    // pisaría sendTaskRef — que es justo lo que stopAndAwaitGeneration
    // espera — y la generación viva quedaría sin su promesa. La única
    // vía de envío con generación en curso es la de emergencia, abajo.
    if (generating) return;
    followBottom.current = true;
    scrollToBottom(true);
    sendTaskRef.current = send().finally(() => {
      sendTaskRef.current = null;
    });
  }, [send, scrollToBottom, generating]);

  // Programa bounty, tanda 2 (emergencia primero, pieza 06 de Field
  // Atlas): lo de emergencia no hace cola. Si lo tecleado durante una
  // generación casa con los detectores de las rutas fijas
  // (emergencyGate.isEmergencyText), la pantalla ofrece enviarlo ya:
  // se detiene y se ESPERA la generación en curso por la vía de
  // stopAndAwaitGeneration (la misma de cambiar de sesión, que deja la
  // respuesta vieja asentada con su marca de detenida) y, cuando el
  // estado «generating» cae, el efecto envía el texto por el camino
  // normal — donde la ruta fija lo pinta al instante y primero.
  const emergencyPendingRef = useRef(false);
  const handleEmergencySend = useCallback(async () => {
    if (!isEmergencyText(inputValueRef.current, toFallbackLang(i18n.resolvedLanguage ?? i18n.language))) return;
    emergencyPendingRef.current = true;
    impact(ImpactFeedbackStyle.Heavy);
    await stopAndAwaitGeneration();
  }, [stopAndAwaitGeneration, i18n]);
  useEffect(() => {
    if (generating || !emergencyPendingRef.current) return;
    emergencyPendingRef.current = false;
    // Si al asentarse la generación el texto ya no es la emergencia
    // (se editó o se cambió de sesión), no se envía nada.
    if (!isEmergencyText(inputValueRef.current, toFallbackLang(i18n.resolvedLanguage ?? i18n.language))) return;
    handleSend();
  }, [generating, handleSend, i18n]);

  // 0.1.38: el toque en el chip es el commit. Si el texto, el idioma o el
  // modo cambiaron desde que se preparó, el chip ya no vale (cae en silencio).
  const runStaged = useCallback(() => {
    const cur = staged;
    if (!cur) return;
    if (
      cur.text !== inputValueRef.current ||
      cur.lang !== (i18n.resolvedLanguage ?? i18n.language) ||
      cur.deep !== deepResearchModeRef.current
    ) {
      recordChipDrop("stale_on_tap");
      setStaged(null);
      return;
    }
    followBottom.current = true;
    scrollToBottom(true);
    sendTaskRef.current = send({ text: cur.runText, draft: cur.draft }).finally(() => {
      sendTaskRef.current = null;
    });
  }, [staged, send, scrollToBottom, i18n]);

  // Cambio de idioma o de modo (Investigación): el chip preparado cae.
  // 0.1.43: el motivo registrado es el que cambió (si cambian los dos a
  // la vez, manda el idioma); al montar no cae nada porque no hay chip.
  const prevLangRef = useRef(i18n.language);
  const prevDeepRef = useRef(deepResearchEnabled);
  useEffect(() => {
    const langChanged = prevLangRef.current !== i18n.language;
    const modeChanged = prevDeepRef.current !== deepResearchEnabled;
    prevLangRef.current = i18n.language;
    prevDeepRef.current = deepResearchEnabled;
    if (langChanged) recordChipDrop("lang_changed");
    else if (modeChanged) recordChipDrop("mode_changed");
    setStaged(null);
  }, [i18n.language, deepResearchEnabled, recordChipDrop]);

  // FASE D6: Retry explícito para mensajes de error. Busca el último mensaje
  // del usuario y lo reenvía sin que el usuario tenga que reescribirlo.
  const retryLastMessage = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg && !generating) {
      updateInput(lastUserMsg.text, "typed");
      // Pequeño delay para que setInput se aplique antes de send()
      setTimeout(() => {
        followBottom.current = true;
        scrollToBottom(true);
        sendTaskRef.current = send().finally(() => {
          sendTaskRef.current = null;
        });
      }, 50);
    }
  }, [messages, generating, send, scrollToBottom]);

  // Cerrar Ajustes: lo que antes hacía solo su botón LISTO, ahora también
  // al cambiar de pestaña (voz, investigación profunda, modelo elegido).
  const closeSettings = async () => {
    setShowSettings(false);
    getVoiceInputEnabled().then(setVoiceInputEnabledState);
    // Deep Research is switched in Settings only.
    const drMode = await getDeepResearchMode();
    deepResearchModeRef.current = drMode;
    setDeepResearchEnabled(drMode);
    // Settings loads a newly chosen LLM itself; only re-run the full
    // init (with its loading screen) if what's loaded doesn't match.
    const llm = await resolveActiveModel("llm");
    if (ready && llamaEngine.getModelInfo()?.filename === llm.filename) {
      setActiveModel(llm);
    } else {
      initModels();
    }
  };

  const effectiveTab: MainTab = showSettings ? "settings" : showNido ? "nido" : activeTab;

  const selectTab = (tab: MainTab) => {
    if (showSettings && tab !== "settings") void closeSettings();
    setShowNido(tab === "nido");
    setShowSettings(tab === "settings");
    setShowGuide(false);
    setShowKnowledgeBase(false);
    setShowMemoryManager(false);
    setShowExecutionTelemetry(false);
    setShowAbout(false);
    setDrawerOpen(false);
    if (tab === "library" && activeTab !== "library") setLibrarySection("packs");
    setActiveTab(tab);
  };

  selectTabRef.current = selectTab;
  // 0.1.55 (auditoría): «Atrás» de Android cierra lo que está abierto y luego
  // vuelve al Chat; antes salía de la app desde cualquier pantalla. Las
  // pantallas con su propio manejador (diálogos de clave) se registran después
  // y tienen prioridad.
  backActionRef.current = () => {
    if (drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
    if (showGuide || showExecutionTelemetry || showKnowledgeBase || showMemoryManager || showAbout) {
      setShowGuide(false);
      setShowExecutionTelemetry(false);
      setShowKnowledgeBase(false);
      setShowMemoryManager(false);
      setShowAbout(false);
      return true;
    }
    if (showSettings || showNido || activeTab !== "chat") {
      selectTab("chat");
      return true;
    }
    return false;
  };

  const withTabs = (node: React.ReactNode) => (
    <View style={styles.flex}>
      <View style={styles.flex}>{node}</View>
      <BottomTabBar active={effectiveTab} onSelect={selectTab} />
    </View>
  );

  const drawerItems: DrawerItem[] = [
    { key: "emergency", icon: "warning", label: t("tabs.emergency"), onPress: () => selectTab("emergency") },
    { key: "guide", icon: "compass", label: t("guide.drawer"), onPress: () => setShowGuide(true) },
    { key: "prompts", icon: "ideas", label: t("chatScreen.drawerItems.prompts"), onPress: () => setShowPromptIdeas(true) },
    { key: "knowledge", icon: "knowledge", label: t("chatScreen.drawerItems.myDocuments"), onPress: () => {
      selectTab("library");
      // Después de selectTab (que vuelve a «Packs» al entrar): el último set gana.
      setLibrarySection("documents");
    } },
    { key: "memory", icon: "memory", label: t("chatScreen.drawerItems.memory"), onPress: () => setShowMemoryManager(true) },
    { key: "settings", icon: "settings", label: t("chatScreen.drawerItems.settings"), onPress: () => selectTab("settings") },
    { key: "telemetry", icon: "telemetry", label: t("chatScreen.drawerItems.telemetry"), onPress: () => setShowExecutionTelemetry(true) },
    { key: "nido", icon: "pairing", label: "NIDO", onPress: () => selectTab("nido") },
    { key: "about", icon: "info", label: t("chatScreen.drawerItems.about"), onPress: () => setShowAbout(true) },
  ];

  if (deviceEvalRequest) {
    return <EvaluationScreen deviceRequest={deviceEvalRequest} onClose={() => setDeviceEvalRequest(null)} />;
  }

  if (showGuide) {
    return <UserGuideScreen onClose={() => setShowGuide(false)} onTryExample={tryGuideExample} />;
  }

  if (showExecutionTelemetry) {
    return <ExecutionTelemetryScreen chatBusy={generating} onClose={() => setShowExecutionTelemetry(false)} />;
  }

  if (showKnowledgeBase) {
    return <KnowledgeBaseScreen onClose={() => setShowKnowledgeBase(false)} />;
  }

  if (showMemoryManager) {
    return <MemoryManagerScreen onClose={() => setShowMemoryManager(false)} />;
  }

  // 0.1.46: el botón de pánico va en la cabecera principal y en la de NIDO
  // (que sustituye a esta pantalla mientras está abierta).
  const panicNode = panicEnabled ? (
    <PanicButton
      onWiped={() => onRelaunchWizard?.()}
      onError={(msg) => setToast(`${t("panic.failedTitle")}: ${msg}`)}
    />
  ) : null;

  if (showAbout) {
    return <AboutScreen onClose={() => setShowAbout(false)} />;
  }

  if (showSettings) {
    return withTabs(
      <ModelSetupScreen
        mode="optional"
        onOpenGuide={() => {
          void closeSettings();
          setActiveTab("library");
          setShowGuide(true);
        }}
        onClose={async () => {
          setActiveTab("chat");
          await closeSettings();
        }}
        onRelaunchWizard={onRelaunchWizard}
        onOpenMemory={() => setShowMemoryManager(true)}
        onOpenTelemetry={() => setShowExecutionTelemetry(true)}
        onOpenAbout={() => setShowAbout(true)}
      />
    );
  }

  if (showNido) {
    return withTabs(
      <NidoScreen
        onClose={() => {
          setShowNido(false);
          setActiveTab("chat");
        }}
        panicSlot={panicNode}
      />
    );
  }

  if (activeTab === "emergency") {
    return withTabs(
      <EmergencyScreen
        onAsk={(question) => {
          // Como las ideas y los ejemplos de la guía: se escribe, no se envía solo.
          selectTab("chat");
          updateInput(question, "example");
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onOpenLibrary={() => selectTab("library")}
      />
    );
  }

  if (activeTab === "library") {
    return withTabs(
      <LibraryScreen
        key={librarySection}
        initialSection={librarySection}
        onOpenGuide={() => setShowGuide(true)}
        onOpenPromptIdeas={() => {
          selectTab("chat");
          setShowPromptIdeas(true);
        }}
      />
    );
  }

  const isDeepActive = deepResearchEnabled || deepResearchActive;

  return (
    <LinearGradient
      colors={[colors.bg.black, colors.bg.black]}
      style={styles.container}
    >
      {/* Rediseño 2026-10-10: sin halos de fondo. Eran colores fijos
          (cian/esmeralda de un diseño anterior) ajenos a la paleta del tema. */}

      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ChatHeader
          toneIcon={getPersonality(personalityId).icon}
          deepResearchActive={isDeepActive}
          activeModelLabel={activeModel?.label}
          onOpenDrawer={() => {
            refreshSessions();
            setDrawerOpen(true);
          }}
          onNewChat={resetToNewChat}
          panicSlot={panicNode}
        />

        {/* Deep Research Mode Banner */}
        {isDeepActive && (
          <View style={[styles.deepResearchBanner, { backgroundColor: colors.frontier.badgeBg, borderBottomColor: colors.frontier.badgeBorder }]}>
            <View style={styles.deepBannerPill}>
              <NidoIcon name="deep-research" size={14} />
              <Text style={[styles.deepBannerText, { color: colors.frontier.text }]}>
                {t("chatScreen.deepResearchBanner")}
              </Text>
            </View>
          </View>
        )}

        {loadError && (
          <ModelLoadErrorCard
            error={loadError}
            onOpenSettings={() => setShowSettings(true)}
            onRelaunchWizard={onRelaunchWizard}
            onRetry={initModels}
          />
        )}

        {!ready && !loadError && (
          <View style={[styles.loadingBanner, { backgroundColor: colors.emerald.bgSubtle, borderBottomColor: colors.emerald.border }]}>
            <ActivityIndicator color={colors.emerald[400]} size="small" />
            <Text style={[styles.loadingBannerText, { color: colors.text.accentEmerald }]}>{loadStatus}</Text>
          </View>
        )}

        {/* 0.1.51: la protección por hardware se ofrece aquí, no solo en Ajustes. */}
        <VaultOfferBanner />

        <FlatList
          ref={listRef}
          style={styles.flex}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          // Animated scrolling during active streaming fires on nearly every
          // token — each call starts a new scroll animation before the last
          // one finishes, so they fight each other and the view visibly
          // lags behind the growing text until generation stops and the
          // final call actually completes. Snap instantly while generating;
          // animate only for the normal (new message / not streaming) case.
          onContentSizeChange={() => {
            if (followBottom.current) scrollToBottom(!generating);
          }}
          // The list gets shorter when the keyboard opens; keep the end in view.
          onLayout={() => {
            if (followBottom.current) scrollToBottom();
          }}
          onScroll={onListScroll}
          scrollEventThrottle={100}
          renderItem={({ item }) => {
            const showProcessing =
              item.text === "" && processing?.messageId === item.id && processing.status !== "generating";
            const isStreamingThis = generating && item.role === "assistant" && processing?.messageId === item.id;
            const split = item.role === "assistant" ? splitThinking(item.text) : null;
            // Sources are attached when the reply finishes, so clean invented citations only then.
            const shownText = split
              ? isStreamingThis
                ? split.answer
                : splitInlineBullets(cleanCitations(split.answer, item.citations?.length))
              : item.text;
            const reasoningShown = shownReasoning.has(item.id);

            return (
              <Pressable accessibilityRole="button"
                onLongPress={item.role === "user" ? () => reuseMessage(item.text) : undefined}
                delayLongPress={350}
                style={[
                  // Asymmetric professional design (2026-10-05 research):
                  // - User: bubble (squircle, max 75%)
                  // - Assistant: full-width flowing text, no bubble, no label
                  item.role === "user"
                    ? [
                        styles.bubble,
                        styles.userBubble,
                        { backgroundColor: colors.emerald[500] },
                      ]
                    : [
                        styles.assistantContainer,
                      ],
                ]}
              >
                {/* Rediseño 2026-10-10: sin etiqueta «Tú» (la posición y el color
                    ya dicen quién habla). NIDO lleva su mascota como avatar. */}
                {item.role === "assistant" && <NidoMascot role="brand" size={26} />}
                <View style={item.role === "assistant" ? styles.assistantBody : styles.userBody}>

                {showProcessing ? (
                  <ProcessingIndicator
                    status={processing!.status as Exclude<ProcessingStatus, "idle">}
                    label={processing!.label}
                  />
                ) : (
                  <>
                    {/* Programa bounty, tanda 1: evidencia primero — la
                        fuente principal encima de la respuesta. Solo
                        existe al cerrar (se calcula con las citas), así
                        que durante el streaming no aparece ni empuja. */}
                    {item.role === "assistant" && item.evidenceFirst ? (
                      <EvidenceFirstCard card={item.evidenceFirst} />
                    ) : null}
                    {split?.thinking && reasoningShown && (
                      <Text style={[styles.reasoningText, { color: colors.text.dim, borderLeftColor: colors.border.default }]}>
                        {split.thinking}
                      </Text>
                    )}
                    {split?.thinkingInProgress && !split.answer && isStreamingThis ? (
                      <ReasoningPeek
                        thinking={split.thinking ?? ""}
                        expanded={reasoningShown}
                        onToggle={() => toggleReasoning(item.id)}
                      />
                    ) : split?.thinkingInProgress && !split.answer ? (
                      // Ended (stopped or out of tokens) while still reasoning.
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <NidoIcon name="activity" size={14} color={colors.text.dim} />
                        <Text style={[styles.reasoningText, { color: colors.text.dim, borderLeftColor: colors.border.default, marginBottom: 0, flex: 1 }]}>
                          {t("chatScreen.reasoningUnfinished")}
                        </Text>
                      </View>
                    ) : (
                      item.role === "user" ? (
                        <Text style={[styles.userText, { color: colors.text.inverse }]}>{shownText}</Text>
                      ) : (
                        <MarkdownMessage
                          content={shownText}
                          isStreaming={isStreamingThis}
                          citationColors={item.citations?.map((_, i) => sourceAccent(colors, i).solid)}
                        />
                      )
                    )}
                  </>
                )}

                {item.calls && item.calls.length > 0 && (
                  <View style={styles.callRow}>
                    {item.calls.map((c, i) => (
                      <Pressable
                        key={`${c.tel}-${i}`}
                        accessibilityRole="button"
                        accessibilityLabel={t("emergency.callA11y", { number: c.value, label: c.label })}
                        onPress={() => {
                          impact(ImpactFeedbackStyle.Medium);
                          // Abre el marcador con el número escrito; la llamada la hace la persona.
                          void Linking.openURL(c.tel).catch(() => {});
                        }}
                        style={[
                          styles.callBtn,
                          i === 0
                            ? { backgroundColor: colors.crimson[500], borderColor: colors.crimson[500] }
                            : { backgroundColor: colors.bg.surface, borderColor: colors.border.default },
                        ]}
                      >
                        <Text style={[styles.callBtnText, { color: i === 0 ? colors.text.inverse : colors.crimson[600] }]}>
                          {`${t("emergency.call")} ${c.value}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {item.guideChunkId ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      impact(ImpactFeedbackStyle.Light);
                      setGuideReaderChunkId(item.guideChunkId ?? null);
                    }}
                    style={[styles.callBtn, { alignSelf: "flex-start", marginTop: 8, backgroundColor: colors.emerald[500], borderColor: colors.emerald[500] }]}
                  >
                    <Text style={[styles.callBtnText, { color: colors.text.inverse }]}>{t("chatScreen.openFullGuide")}</Text>
                  </Pressable>
                ) : null}

                {item.citations && item.citations.length > 0 && (
                  <SourceFootnotes citations={item.citations} grounding={item.grounding} provenance={item.provenance} numberConflicts={item.numberConflicts} />
                )}

                {/* Honest no-result (2026-09-28): deterministic note when
                    retrieval was attempted and returned zero chunks. Gated
                    on non-empty text so stopped/empty replies don't show it. */}
                {item.noSourcesFound && item.text.length > 0 && (
                  <View style={[styles.stoppedBadge, { backgroundColor: colors.amber.bgSubtle, borderColor: colors.amber.border }]}>
                    <Text style={[styles.stoppedTag, { color: colors.text.accentAmber }]}>{t("chatScreen.noRelevantOfflineSources")}</Text>
                  </View>
                )}

                {item.stopped && (
                  <View style={[styles.stoppedBadge, styles.stoppedBadgeRow, { backgroundColor: colors.amber.bgSubtle, borderColor: colors.amber.border }]}>
                    <NidoIcon name="stop" size={12} color={colors.text.accentAmber} />
                    <Text style={[styles.stoppedTag, { color: colors.text.accentAmber }]}>{t("chatScreen.stoppedByUser")}</Text>
                  </View>
                )}

                {item.timedOut && (
                  // §4D glyph mapping (2026-10-05): ⏱ → NidoIcon "warning".
                  // Amber attention tag; meaning preserved, no longer text-only.
                  <View style={[styles.stoppedBadge, styles.stoppedBadgeRow, { backgroundColor: colors.amber.bgSubtle, borderColor: colors.amber.border }]}>
                    <NidoIcon name="warning" size={12} color={colors.text.accentAmber} />
                    <Text style={[styles.stoppedTag, { color: colors.text.accentAmber }]}>{t("chatScreen.stageTimedOut")}</Text>
                  </View>
                )}

                {item.interrupted && (
                  <View style={[styles.stoppedBadge, styles.stoppedBadgeRow, { backgroundColor: colors.amber.bgSubtle, borderColor: colors.amber.border }]}>
                    <NidoIcon name="pause" size={12} color={colors.text.accentAmber} />
                    <Text style={[styles.stoppedTag, { color: colors.text.accentAmber }]}>{t("chatScreen.interrupted")}</Text>
                  </View>
                )}

                {/* FASE D6: Botón retry explícito para mensajes de error.
                    El usuario no tiene que reescribir el mensaje. */}
                {item.role === "assistant" && item.text.startsWith("Error:") && (
                  <Pressable
                    onPress={retryLastMessage}
                    disabled={generating}
                    hitSlop={8}
                    style={[
                      styles.retryBtn,
                      { backgroundColor: colors.emerald.bgSubtle, borderColor: colors.emerald.border },
                      generating && { opacity: 0.5 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t("chatScreen.retry")}
                  >
                    <NidoIcon name="refresh" size={14} color={colors.emerald[600]} />
                    <Text style={[styles.retryBtnText, { color: colors.emerald[600] }]}>
                      {t("chatScreen.retry")}
                    </Text>
                  </Pressable>
                )}

                {item.role === "assistant" && item.text.length > 0 && (
                  <View style={[styles.bubbleFooter, { borderTopColor: colors.border.subtle }]}>
                    <Pressable accessibilityRole="button"
                      onPress={() => rateMessage(item.id, "up")}
                      hitSlop={6}
                      accessibilityLabel={t("chatScreen.rateUp")}
                      style={[
                        styles.footerBtn,
                        {
                          backgroundColor:
                            item.feedback === "up" ? colors.emerald.bgSubtle : colors.bg.subtle,
                          borderColor:
                            item.feedback === "up" ? colors.emerald.border : colors.border.subtle,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.footerGlyph,
                          {
                            color:
                              item.feedback === "up" ? colors.text.accentEmerald : colors.text.dim,
                          },
                        ]}
                      >
                        ▲
                      </Text>
                      {item.feedback === "up" && (
                        <Text
                          style={[
                            styles.footerBtnLabel,
                            { color: colors.text.accentEmerald },
                          ]}
                        >
                          {t("chatScreen.rateHelpful", "Helpful")}
                        </Text>
                      )}
                    </Pressable>

                    <Pressable accessibilityRole="button"
                      onPress={() => rateMessage(item.id, "down")}
                      hitSlop={6}
                      accessibilityLabel={t("chatScreen.rateDown")}
                      style={[
                        styles.footerBtn,
                        {
                          backgroundColor:
                            item.feedback === "down" ? colors.crimson.bgSubtle : colors.bg.subtle,
                          borderColor:
                            item.feedback === "down" ? colors.crimson.border : colors.border.subtle,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.footerGlyph,
                          {
                            color:
                              item.feedback === "down" ? colors.crimson[400] : colors.text.dim,
                          },
                        ]}
                      >
                        ▼
                      </Text>
                      {item.feedback === "down" && (
                        <Text
                          style={[
                            styles.footerBtnLabel,
                            { color: colors.crimson[400] },
                          ]}
                        >
                          {t("chatScreen.rateUnhelpful", "Unhelpful")}
                        </Text>
                      )}
                    </Pressable>

                    <View style={styles.footerSpacer} />

                    {split?.thinking && (
                      <Pressable accessibilityRole="button"
                        onPress={() => toggleReasoning(item.id)}
                        hitSlop={6}
                        accessibilityLabel={reasoningShown ? t("chatScreen.hideReasoning") : t("chatScreen.showReasoning")}
                        style={[
                          styles.footerBtn,
                          {
                            backgroundColor: reasoningShown ? colors.emerald.bgSubtle : colors.bg.subtle,
                            borderColor: reasoningShown ? colors.emerald.border : colors.border.subtle,
                          },
                        ]}
                      >
                        <NidoIcon name="activity" size={12} color={colors.text.dim} />
                      </Pressable>
                    )}

                    <Pressable accessibilityRole="button"
                      onPress={() => copyMessage(item.id, shownText)}
                      hitSlop={6}
                      accessibilityLabel={t("chatScreen.copyResponse")}
                      style={[
                        styles.footerBtn,
                        {
                          backgroundColor:
                            copiedMessageId === item.id ? colors.emerald.bgSubtle : colors.bg.subtle,
                          borderColor:
                            copiedMessageId === item.id ? colors.emerald.border : colors.border.subtle,
                        },
                      ]}
                    >
                      <NidoIcon
                        name={copiedMessageId === item.id ? "check" : "copy"}
                        size={12}
                        color={copiedMessageId === item.id ? colors.text.accentEmerald : colors.text.dim}
                      />
                      {copiedMessageId === item.id && (
                        <Text
                          style={[
                            styles.footerBtnLabel,
                            { color: colors.text.accentEmerald },
                          ]}
                        >
                          {t("chatScreen.copied", "Copied")}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                )}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <NidoMascot role="guide" size={120} />
              <Text style={[styles.emptyTitle, { color: colors.text.heading }]}>
                {t("chatScreen.emptyTitle", "Hi, I'm NIDO")}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.text.dim }]}>
                {t("chatScreen.emptySubtitle", "Your private agent. Everything stays on this device.")}
              </Text>
              {/* Rediseño 2026-10-10: sugerencias tocables para que el
                  usuario sepa qué puede pedir. Solo rellenan el campo. */}
              <View style={styles.suggestions}>
                {(
                  [
                    ["ideas", "reminder"],
                    ["memory", "note"],
                    ["knowledge", "documents"],
                    ["pairing", "message"],
                  ] as const
                ).map(([icon, key]) => (
                  <Pressable
                    key={key}
                    onPress={() => {
                      updateInput(t(`chatScreen.suggestions.${key}.prompt`), "example");
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    style={[styles.suggestion, { backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
                    accessibilityRole="button"
                    accessibilityLabel={t(`chatScreen.suggestions.${key}.title`)}
                  >
                    <View style={[styles.suggestionIcon, { backgroundColor: colors.emerald.bgSubtle }]}>
                      <NidoIcon name={icon} size={19} color={colors.text.accentEmerald} />
                    </View>
                    <View style={styles.suggestionText}>
                      <Text style={[styles.suggestionTitle, { color: colors.text.primary }]}>
                        {t(`chatScreen.suggestions.${key}.title`)}
                      </Text>
                      <Text style={[styles.suggestionHint, { color: colors.text.secondary }]} numberOfLines={1}>
                        {t(`chatScreen.suggestions.${key}.hint`)}
                      </Text>
                    </View>
                    <NidoIcon name="chev-right" size={14} color={colors.text.dim} />
                  </Pressable>
                ))}
              </View>
            </View>
          }
        />

        {/* Input Bar */}
        <View style={[styles.inputContainer, { backgroundColor: colors.bg.black, borderTopColor: "transparent" }]}>
          {staged && (
            <View style={styles.stagedWrap}>
              <View style={styles.stagedRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("chatScreen.staged.runA11y", { action: staged.label })}
                  onPress={runStaged}
                  disabled={!ready || generating}
                  style={[styles.stagedChip, { backgroundColor: colors.bg.input, borderColor: colors.border.default }]}
                >
                  <NidoIcon name="play" size={14} color={colors.text.primary} />
                  <Text numberOfLines={2} style={[styles.stagedText, { color: colors.text.primary }]}>
                    {staged.label}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("chatScreen.staged.dismiss")}
                  onPress={() => {
                    recordChipDrop("dismissed");
                    setStaged(null);
                  }}
                  hitSlop={10}
                  style={styles.stagedDismiss}
                >
                  <NidoIcon name="close" size={16} color={colors.text.dim} />
                </Pressable>
              </View>
              <Text style={[styles.stagedHint, { color: colors.text.dim }]}>
                {t(staged.draft ? "chatScreen.staged.hintDraft" : "chatScreen.staged.hint")}
              </Text>
            </View>
          )}
          {/* 0.1.55: tono e investigación, junto a donde se escribe (antes, en la cabecera y en Ajustes). */}
          <View style={styles.modeChips}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chatHeader.cycleTone")}
              onPress={cycleTone}
              disabled={generating}
              style={[styles.modeChip, { borderColor: colors.border.default, backgroundColor: colors.bg.surface }]}
            >
              <Text style={[styles.modeChipText, { color: colors.text.primary }]} numberOfLines={1}>
                {t("chatScreen.toneChip", { tone: t(`personalities.${personalityId}.label`) })}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: deepResearchEnabled }}
              accessibilityLabel={t("chatHeader.deepResearch")}
              onPress={() => void toggleDeepResearch()}
              disabled={generating}
              style={[
                styles.modeChip,
                deepResearchEnabled
                  ? { borderColor: colors.emerald[500], backgroundColor: colors.emerald.bgSubtle }
                  : { borderColor: colors.border.default, backgroundColor: colors.bg.surface },
              ]}
            >
              <NidoIcon name="deep-research" size={14} />
              <Text style={[styles.modeChipText, { color: deepResearchEnabled ? colors.emerald[600] : colors.text.primary }]}>
                {t("chatScreen.researchChip")}
              </Text>
            </Pressable>
          </View>
          <View style={[styles.inputRow, { backgroundColor: colors.bg.input, borderColor: colors.border.default }]}>
            {voiceInputEnabled && (
              <VoiceInputButton
                disabled={!ready || generating}
                onTranscript={(text) => {
                  // 0.1.38: el micrófono del chat es entrada de órdenes (dictado).
                  const prev = inputValueRef.current;
                  updateInput(prev ? `${prev} ${text}` : text, "dictated");
                }}
              />
            )}
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: colors.text.primary }]}
              value={input}
              onChangeText={(next) => updateInput(next)}
              placeholder={t("chatScreen.inputPlaceholder")}
              placeholderTextColor={colors.text.dim}
              // Programa bounty, tanda 2: se puede ESCRIBIR durante la
              // generación (antes: editable solo sin generar), para que
              // una emergencia se pueda teclear sin esperar. Enviar
              // sigue cerrado (handleSend no entra generando); la única
              // salida es el botón de emergencia de abajo.
              editable={ready}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              multiline={true}
              maxLength={4000}
            />
            {generating && (
              <Pressable accessibilityRole="button"
                style={styles.stopBtn}
                onPress={stopGeneration}
                disabled={stopping}
                hitSlop={8}
                accessibilityLabel={t("chatScreen.stopGeneration")}
              >
                {stopping ? (
                  <ActivityIndicator color={colors.text.primary} size="small" />
                ) : (
                  <NidoIcon name="stop" size={16} color={colors.text.inverse} />
                )}
              </Pressable>
            )}
            {/* Programa bounty, tanda 2: el envío de emergencia solo
                existe mientras se genera Y lo tecleado es una
                emergencia para las rutas fijas; en cualquier otro
                momento la fila es la de siempre. */}
            {generating && isEmergencyText(input, toFallbackLang(i18n.resolvedLanguage ?? i18n.language)) ? (
              <Pressable accessibilityRole="button"
                style={styles.emergencySendBtn}
                onPress={() => void handleEmergencySend()}
                hitSlop={8}
                accessibilityLabel={t("chatScreen.emergencySend")}
              >
                <NidoIcon name="send" size={16} color={colors.text.inverse} />
              </Pressable>
            ) : null}
            {!generating && (
              <Pressable accessibilityRole="button"
                style={[styles.sendBtn, (!ready || !input.trim()) && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!ready || !input.trim()}
                hitSlop={8}
                accessibilityLabel={t("chatScreen.sendMessage")}
              >
                <NidoIcon name="send" size={18} color={colors.text.inverse} />
              </Pressable>
            )}
          </View>
          <View style={styles.privacyHint}>
            <NidoIcon name="security" size={11} color={colors.text.dim} />
            <Text style={[styles.privacyHintText, { color: colors.text.dim }]}>
              {t("chatScreen.privacyHint")}
            </Text>
          </View>
        </View>

        {showOnboarding && (
          <GuideOnboarding
            onDone={finishOnboarding}
            onTryExample={tryGuideExample}
            onOpenGuide={() => {
              finishOnboarding();
              setShowGuide(true);
            }}
          />
        )}

        {showPromptIdeas && (
          <PromptIdeasCarousel
            onDismiss={() => setShowPromptIdeas(false)}
            onUsePrompt={(prompt) => {
              updateInput(prompt, "example");
              setShowPromptIdeas(false);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          />
        )}
      </View>

      {keyboardHeight === 0 && <BottomTabBar active="chat" onSelect={selectTab} />}
      <SourceReader chunkId={guideReaderChunkId} onClose={() => setGuideReaderChunkId(null)} />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={drawerItems}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={resetToNewChat}
        onSelectSession={selectSession}
        onDeleteSession={removeSession}
      />

      {toast && <Toast message={toast} onHide={() => setToast(null)} />}
    </LinearGradient>
  );
}

const getStyles = (colors: Colors, typography: Typography) => StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  ambientGlowTop: {
    position: "absolute",
    top: -90,
    left: -70,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.cyan.bgSubtle,
    opacity: 0.6,
  },
  ambientGlowTopDeep: {
    backgroundColor: colors.bg.subtle,
    opacity: 0.85,
  },
  ambientGlowBottom: {
    position: "absolute",
    bottom: -110,
    right: -90,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: colors.emerald.bgSubtle,
    opacity: 0.5,
  },
  ambientGlowBottomDeep: {
    backgroundColor: colors.cyan.bgSubtle,
    opacity: 0.7,
  },
  deepResearchBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    backgroundColor: colors.frontier.badgeBg,
    borderBottomWidth: 1,
    borderBottomColor: colors.frontier.badgeBorder,
  },
  deepBannerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  deepBannerIcon: {
    fontSize: 10,
  },
  deepBannerText: {
    ...typography.ui.caption,
    fontSize: 11,
    color: colors.text.secondary,
  },
  loadingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.emerald.bgSubtle,
    borderBottomWidth: 1,
    borderBottomColor: colors.emerald.border,
  },
  loadingBannerText: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    fontWeight: "500",
  },
  list: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  // Calm Agent empty state: warm welcome with mascot
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: calmSpacing.comfortable,
    paddingVertical: calmSpacing.spacious,
    gap: calmSpacing.comfortable,
  },
  emptyTitle: {
    ...calmType.hero,
    textAlign: "center",
  },
  emptySubtitle: {
    ...calmType.body,
    textAlign: "center",
  },
  bubble: {
    paddingVertical: calmSpacing.cozy,
    paddingHorizontal: calmSpacing.comfortable,
    borderRadius: calmRadii.bubble,
    maxWidth: "75%",
    gap: calmSpacing.tight,
    // No decorative shadows (research: hairlines over shadows)
    ...calmShadows.none,
  },
  userBubble: {
    // (backgroundColor set inline at the usage site)
    alignSelf: "flex-end",
    borderBottomRightRadius: 6,
    maxWidth: "78%",
  },
  assistantBubble: {
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    alignSelf: "flex-start",
    borderBottomLeftRadius: calmRadii.subtle,
    minWidth: 200,
  },
  // Professional asymmetric design: assistant messages flow full-width
  // without a bubble (ChatGPT/Claude convention). Generous vertical
  // rhythm, no chrome.
  assistantContainer: {
    paddingVertical: calmSpacing.cozy,
    paddingHorizontal: calmSpacing.tight,
    maxWidth: "100%",
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  assistantBody: { flex: 1, minWidth: 0 },
  userBody: {},
  userText: { ...typography.ui.bodyLg },
  suggestions: { alignSelf: "stretch", gap: calmSpacing.cozy, marginTop: calmSpacing.comfortable },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  suggestionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  suggestionText: { flex: 1, minWidth: 0 },
  suggestionTitle: { ...typography.ui.titleSm, fontWeight: "600" },
  suggestionHint: { ...typography.ui.subtext },
  privacyHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 6 },
  privacyHintText: { ...typography.ui.micro, fontWeight: "400" },
  bubbleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  bubbleRoleLabel: {
    ...typography.ui.caption,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  userRoleLabel: {
    color: colors.text.secondary,
  },
  assistantRoleLabel: {
    color: colors.text.secondary,
  },
  copyIcon: {
    fontSize: 14,
    paddingHorizontal: 4,
  },
  bubbleFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    paddingTop: 2,
    borderTopWidth: 0,
  },
  footerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.xs,
    borderWidth: 1,
  },
  footerGlyph: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
  },
  footerBtnLabel: {
    ...typography.ui.micro,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  reasoningText: {
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 17,
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 8,
  },
  footerSpacer: {
    flex: 1,
  },
  stoppedBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: colors.amber.bgSubtle,
    borderColor: colors.amber.border,
    borderWidth: 1,
    borderRadius: radii.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stoppedTag: {
    ...typography.ui.caption,
    color: colors.text.secondary,
    fontWeight: "600",
  },
  retryBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryBtnText: {
    ...typography.ui.body,
    fontWeight: "600",
  },
  stoppedBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    backgroundColor: colors.bg.cardElevated,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  stagedWrap: { marginBottom: 6, gap: 4 },
  stagedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stagedChip: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  stagedText: { flexShrink: 1, fontSize: 14, fontWeight: "600" },
  stagedDismiss: { padding: 4 },
  stagedHint: { fontSize: 12, paddingHorizontal: 4 },
  callRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  callBtn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  callBtnText: { ...typography.ui.titleSm },
  modeChips: { flexDirection: "row", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  modeChip: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: "70%",
  },
  modeChipText: { ...typography.ui.subtext, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 26,
    paddingVertical: 5,
    paddingLeft: 6,
    paddingRight: 5,
    ...calmShadows.whisper,
  },
  input: {
    flex: 1,
    color: colors.text.primary,
    borderColor: "transparent",
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 6,
    paddingVertical: 8,
    ...typography.ui.body,
    fontSize: 15,
    maxHeight: 120,
    textAlignVertical: "center",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.emerald[600],
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    opacity: 0.35,
  },
  sendBtnText: {
    color: colors.text.inverse,
    fontWeight: "800",
    fontSize: 16,
    marginLeft: 2,
  },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.crimson[600],
    alignItems: "center",
    justifyContent: "center",
  },
  // Programa bounty, tanda 2: el envío de emergencia junto al de
  // detener — mismo tamaño, carmesí más vivo y la flecha de enviar.
  emergencySendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.crimson[500],
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  stopBtnText: {
    color: colors.text.inverse,
    fontWeight: "800",
    fontSize: 14,
  },
});
