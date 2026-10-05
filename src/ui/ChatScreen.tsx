import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  Keyboard,
  ActivityIndicator,
  Animated,
  AppState,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { impact, notification, ImpactFeedbackStyle, NotificationFeedbackType } from "../services/haptics";
import { NidoIcon } from "./components/icons/NidoIcon";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { llamaEngine } from "../inference/LlamaEngine";
import { embeddingEngine } from "../rag/embed";
import { retrieve, assemblePrompt, RetrievedChunk, ConversationTurn } from "../rag/retrieve";
import { assembleChatMessages, ANSWER_CONTEXT_CHUNKS } from "../rag/pure";
import { classifyTask, isRetrievalIrrelevant } from "../routing/classify";
import type { TaskType } from "../routing/types";
import { onSeedProgress, seedKnowledgeBaseIfEmpty } from "../rag/seedCorpus";
import { MODEL_CATALOG, CORPUS_CATALOG, REQUIRED_MODELS, CatalogModel } from "../models/manifest";
import { subscribeDownloads, listDownloadStates } from "../services/downloadManager";
import {
  getActiveModelId,
  getHidePromptIdeas,
  getPersonalityId,
  setPersonalityId,
  getCustomSystemPrompt,
  getMaxTokens,
  getMemorySettings,
  MemorySettings as MemorySettingsType,
  DEFAULT_MEMORY_SETTINGS,
  getDeepResearchMode,
  getVoiceInputEnabled,
  getReadAloudEnabled,
  getAdaptiveRoutingEnabled,
} from "../models/settings";
import { runDeepResearch, ResearchProgress } from "../services/orchestrator";
import { runAdaptiveChat } from "../services/adaptiveChat";
import { speakAloud } from "../voice/tts";
import { showSecureAlert } from "nido-secure-dialog";
// NIDO agent: loop agéntico local con herramientas (Fase A).
import { classifyIntent } from "../agent/loop/intent";
import { runAgentLoop } from "../agent/loop/agentLoop";
import { buildToolHandlers } from "../agent/tools/handlers";
import { snapshot as loadMemorySnapshot } from "../agent/memory/memoryStore";
import { getPersonality, PersonalityId, PERSONALITIES } from "../constants/personalities";
import {
  createSession,
  addMessage as persistMessage,
  getMessages as getSessionMessages,
  listSessions,
  deleteSession,
  setSessionTitle,
  setSessionSummary,
  pruneSessions,
  setMessageFeedback,
  ChatSession,
} from "../services/chatHistory";
import { generateSessionTitle, summarizeConversation } from "../services/summarize";
import { PromptIdeasCarousel } from "./PromptIdeasCarousel";
import { VoiceInputButton } from "./VoiceInputButton";
import { ProcessingIndicator, ProcessingStatus } from "./ProcessingIndicator";
import { Drawer, DrawerItem } from "./Drawer";
import { AboutScreen } from "./AboutScreen";
import { KnowledgeBaseScreen } from "./KnowledgeBaseScreen";
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
import { answerKnowledgeQueryWithCategory, toIdentityLocale, knowledgeSessionTitle } from "../rag/selfKnowledge";
import { recordQueryStats, trackPeakRss, startAppMemoryTracking, QueryStats } from "../services/telemetry";
import { recordExecution } from "../services/executionTelemetry";
import { getMemoryInfo } from "ram-monitor";
import { useTheme, colors, typography } from "./theme";
import { spacing, radii, shadows } from "./theme/spacing";
import { calmSpacing, calmRadii, calmType, calmShadows } from "./theme/calm";

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
  stopped?: boolean;
  timedOut?: boolean;
  interruptedByBackground?: boolean;
  feedback?: "up" | "down" | null;
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
  const fallback = REQUIRED_MODELS.find((m) => m.kind === kind)!;
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
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [loadStatus, setLoadStatus] = useState(t("chatScreen.initializingCore"));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showPromptIdeas, setShowPromptIdeas] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [showExecutionTelemetry, setShowExecutionTelemetry] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNido, setShowNido] = useState(false);
  const [voiceInputEnabled, setVoiceInputEnabledState] = useState(true);
  const showSettingsRef = useRef(false);
  showSettingsRef.current = showSettings;
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
      const hide = await getHidePromptIdeas();
      if (!hide) setShowPromptIdeas(true);
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
          setMessages(records.map((r) => ({ id: r.id, role: r.role, text: r.text, feedback: r.feedback })));
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
      setInput(text);
      inputRef.current?.focus();
      impact(ImpactFeedbackStyle.Medium);
      setToast(t("chatScreen.messageReused"));
    },
    [t]
  );

  const cycleTone = useCallback(async () => {
    const customPrompt = (await getCustomSystemPrompt()) ?? "";
    const order = PERSONALITIES.map((p) => p.id).filter((id) => id !== "custom" || customPrompt.trim().length > 0);
    const next = order[(order.indexOf(personalityId) + 1) % order.length];
    setPersonalityIdState(next);
    await setPersonalityId(next);
    impact(ImpactFeedbackStyle.Light);
    setToast(t("chatScreen.toneChanged", { tone: `${getPersonality(next).icon} ${t(`personalities.${next}.label`)}` }));
  }, [personalityId, t]);

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
        setLoadStatus(`${t("chatScreen.indexingKnowledgeBase")} ${p.done.toLocaleString()} / ${p.total.toLocaleString()}`)
      );
      await seedKnowledgeBaseIfEmpty().finally(stopProgress);
      setReady(true);
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
    if (!__DEV__ || !ready || deviceEvalRequest) return;
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
   * Per docs/ADAPTIVE_ROUTING.md §14: no AppState handling existed anywhere
   * in the app before this — an in-flight generation (or, once the
   * execution engine exists, a multi-step routing pipeline) would just keep
   * burning CPU/battery invisibly if the user backgrounded the app, with no
   * cancellation and no way to know it happened. Default policy: background
   * -> stop immediately (reusing the exact same stop path as the Stop
   * button — no second cancellation mechanism), mark the in-progress
   * message as interrupted so it's visibly explained rather than silently
   * truncated, and let the user retry by just asking again.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "background") return;
      if (!sendTaskRef.current) return;
      const interruptedId = processingRef.current?.messageId;
      stopAndAwaitGeneration().then(() => {
        if (interruptedId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === interruptedId ? { ...m, interruptedByBackground: true } : m))
          );
        }
      });
    });
    return () => sub.remove();
  }, [stopAndAwaitGeneration]);

  const resetToNewChat = useCallback(async () => {
    await stopAndAwaitGeneration();
    await cancelBackgroundTask();
    setMessages([]);
    setActiveSessionId(null);
    sessionSummaryRef.current = null;
    impact(ImpactFeedbackStyle.Medium);
  }, [stopAndAwaitGeneration, cancelBackgroundTask]);

  const selectSession = useCallback(async (id: string) => {
    await stopAndAwaitGeneration();
    await cancelBackgroundTask();
    const records = await getSessionMessages(id);
    followBottom.current = true;
    setMessages(records.map((r) => ({ id: r.id, role: r.role, text: r.text, feedback: r.feedback })));
    setActiveSessionId(id);
    const session = sessions.find((s) => s.id === id);
    sessionSummaryRef.current = session?.summary ?? null;
  }, [stopAndAwaitGeneration, cancelBackgroundTask, sessions]);

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSession(id);
      await refreshSessions();
      if (id === activeSessionId) await resetToNewChat();
    },
    [activeSessionId, refreshSessions, resetToNewChat]
  );

  const send = useCallback(async () => {
    const query = input.trim();
    if (!query || generating) return;
    // N3 (2026-09-28): synchronous in-flight guard. `setGenerating(true)` is
    // batched, so two taps in the same tick both see stale `generating ===
    // false` through the closure. The ref is set synchronously here, before
    // any await, so the second tap observes the first and bails out. Release
    // happens in the outer finally: every exit path (early returns, errors)
    // passes through it, so the button can never be left permanently blocked.
    if (!sendGuardRef.current.tryAcquire()) return;
    try {

    await cancelBackgroundTask();

    setInput("");
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
    const kbAnswer = kbQueryMeta !== null ? kbQueryMeta.answer : null;
    if (kbAnswer !== null) {
      assistantText = kbAnswer;
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, text: kbAnswer } : m))
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
        await persistMessage(sessionId, "assistant", kbAnswer, assistantId);
      }

      const kbSettings = memorySettingsRef.current;
      // D/F3 (2026-09-28): the answer above is deterministic and model-free,
      // so its session title must be too. generateSessionTitle would invoke
      // llamaEngine.generate purely for bookkeeping — instead use the
      // deterministic title derived from the already-trusted category.
      // Synchronous and model-free: no background task, no retry path.
      if (isNewSession && kbSettings.autoGenerateTitles) {
        const sid = sessionId;
        const kbTitle = knowledgeSessionTitle(query, kbLocale);
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
    const agentIntent = classifyIntent(query);
    if (agentIntent === "recordar" || agentIntent === "actuar") {
      setProcessing({ messageId: assistantId, status: "thinking" });
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
        const agentResult = await runAgentLoop(query, {
          engine: llamaEngine,
          handlers: buildToolHandlers({ requestConfirm }),
          loadMemory: () => loadMemorySnapshot().catch(() => null),
          maxSteps: 3,
          nPredict: agentMaxTokens,
        });
        assistantText = agentResult.response;
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
          await persistMessage(sessionId, "assistant", assistantText, assistantId);
        }

        const agentSettings = memorySettingsRef.current;
        if (isNewSession && agentSettings.autoGenerateTitles) {
          const sid = sessionId;
          backgroundTaskRef.current = generateSessionTitle(query)
            .then(async (title) => {
              await setSessionTitle(sid, title);
              await refreshSessions();
            })
            .catch(() => {})
            .finally(() => {
              backgroundTaskRef.current = null;
            });
        }
        await pruneSessions(agentSettings.maxSavedSessions);
      } catch (e: any) {
        peakRss.stop();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: `Error: ${e?.message ?? e}` } : m
          )
        );
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
        if (firstToken) {
          firstToken = false;
          firstTokenTime = performance.now();
          ttftMs = firstTokenTime - startTime;
          setProcessing({ messageId: assistantId, status: "generating" });
        } else {
          const elapsedSinceFirst = (performance.now() - firstTokenTime) / 1000;
          if (elapsedSinceFirst > 0) setLiveTokPerSec(tokensGenerated / elapsedSinceFirst);
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + piece } : m))
        );
      };

      let chunks: RetrievedChunk[];
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
            setProcessing({ messageId: assistantId, status: "retrieving" });
            c = await retrieve(query, ANSWER_CONTEXT_CHUNKS);
          }
          const noSources = retrievalAttempted && c.length === 0;
          setProcessing({ messageId: assistantId, status: "thinking" });
          // Use the model's own chat template when its file ships one; the
          // plain prompt is only a fallback. Off-template, models ramble,
          // echo instructions, and reasoning models never open <think>.
          await llamaEngine.generate(
            llamaEngine.hasEmbeddedChatTemplate()
              ? { messages: assembleChatMessages(query, c, systemPrompt, history, styleReminder, noSources), nPredict: maxTokens, onToken }
              : { prompt: assemblePrompt(query, c, systemPrompt, history, styleReminder, noSources), nPredict: maxTokens, onToken }
          );
          return { chunks: c, noSourcesFound: noSources };
        };

        const adaptiveRoutingEnabled = await getAdaptiveRoutingEnabled();

        if (adaptiveRoutingEnabled) {
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

      const wasStopped = stopRequestedRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, citations: chunks, stopped: wasStopped, noSourcesFound } : m
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
        await persistMessage(sessionId, "assistant", assistantText, assistantId);
      }

      const settings = memorySettingsRef.current;
      const allMessages = [...priorMessages, userMsg, { ...userMsg, id: assistantId, role: "assistant" as const, text: assistantText }];

      if (isNewSession && settings.autoGenerateTitles && !wasStopped) {
        const sid = sessionId;
        backgroundTaskRef.current = generateSessionTitle(query)
          .then(async (title) => {
            await setSessionTitle(sid, title);
            await refreshSessions();
          })
          .catch(() => {})
          .finally(() => {
            backgroundTaskRef.current = null;
          });
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
  }, [input, generating, activeSessionId, cancelBackgroundTask, refreshSessions]);

  // send() itself isn't awaited by its callers (onPress/onSubmitEditing) —
  // stopAndAwaitGeneration needs a handle on the in-flight promise so a
  // session switch can wait for it to actually finish. Only the entry point
  // sets sendTaskRef; send() doesn't need to know about it.
  const handleSend = useCallback(() => {
    followBottom.current = true;
    scrollToBottom(true);
    sendTaskRef.current = send().finally(() => {
      sendTaskRef.current = null;
    });
  }, [send, scrollToBottom]);

  const drawerItems: DrawerItem[] = [
    { key: "prompts", icon: "ideas", label: t("chatScreen.drawerItems.prompts"), onPress: () => setShowPromptIdeas(true) },
    { key: "knowledge", icon: "knowledge", label: t("chatScreen.drawerItems.myDocuments"), onPress: () => setShowKnowledgeBase(true) },
    { key: "settings", icon: "settings", label: t("chatScreen.drawerItems.settings"), onPress: () => setShowSettings(true) },
    { key: "telemetry", icon: "telemetry", label: t("chatScreen.drawerItems.telemetry"), onPress: () => setShowExecutionTelemetry(true) },
    { key: "nido", icon: "pairing", label: "NIDO", onPress: () => setShowNido(true) },
    { key: "about", icon: "info", label: t("chatScreen.drawerItems.about"), onPress: () => setShowAbout(true) },
  ];

  if (deviceEvalRequest) {
    return <EvaluationScreen deviceRequest={deviceEvalRequest} onClose={() => setDeviceEvalRequest(null)} />;
  }

  if (showSettings) {
    return (
      <ModelSetupScreen
        mode="optional"
        onClose={async () => {
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
        }}
        onRelaunchWizard={onRelaunchWizard}
      />
    );
  }

  if (showExecutionTelemetry) {
    return <ExecutionTelemetryScreen chatBusy={generating} onClose={() => setShowExecutionTelemetry(false)} />;
  }

  if (showKnowledgeBase) {
    return <KnowledgeBaseScreen onClose={() => setShowKnowledgeBase(false)} />;
  }

  if (showNido) {
    return <NidoScreen onClose={() => setShowNido(false)} />;
  }

  if (showAbout) {
    return <AboutScreen onClose={() => setShowAbout(false)} />;
  }

  const isDeepActive = deepResearchEnabled || deepResearchActive;

  return (
    <LinearGradient
      colors={isDeepActive ? [colors.frontier.gradientStart, colors.bg.terminal] : [colors.bg.terminal, colors.bg.surface]}
      style={styles.container}
    >
      {/* Ambient background glows */}
      <View
        style={[styles.ambientGlowTop, isDeepActive && styles.ambientGlowTopDeep]}
        pointerEvents="none"
      />
      <View
        style={[styles.ambientGlowBottom, isDeepActive && styles.ambientGlowBottomDeep]}
        pointerEvents="none"
      />

      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ChatHeader
          toneIcon={getPersonality(personalityId).icon}
          deepResearchActive={isDeepActive}
          liveTokPerSec={liveTokPerSec}
          activeModelLabel={activeModel?.label}
          onOpenDrawer={() => {
            refreshSessions();
            setDrawerOpen(true);
          }}
          onCycleTone={cycleTone}
          onNewChat={resetToNewChat}
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
              <Pressable
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
                        { backgroundColor: colors.bg.cardElevated, borderColor: colors.border.focus },
                      ]
                    : [
                        styles.assistantContainer,
                      ],
                ]}
              >
                {/* Role label: only for user (assistant asymmetry speaks for itself) */}
                {item.role === "user" && (
                  <View style={styles.bubbleHeader}>
                    <Text
                      style={[
                        styles.bubbleRoleLabel,
                        styles.userRoleLabel,
                        { color: colors.text.accentCyan },
                      ]}
                    >
                      {t("chatScreen.roleYou")}
                    </Text>
                  </View>
                )}

                {showProcessing ? (
                  <ProcessingIndicator
                    status={processing!.status as Exclude<ProcessingStatus, "idle">}
                    label={processing!.label}
                  />
                ) : (
                  <>
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
                      <MarkdownMessage content={shownText} isStreaming={isStreamingThis} />
                    )}
                  </>
                )}

                {item.citations && item.citations.length > 0 && (
                  <SourceFootnotes citations={item.citations} />
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
                  // No timer glyph in the frozen icon set: the timeout badge is
                  // text-only (the amber badge styling already signals status).
                  <View style={[styles.stoppedBadge, { backgroundColor: colors.amber.bgSubtle, borderColor: colors.amber.border }]}>
                    <Text style={[styles.stoppedTag, { color: colors.text.accentAmber }]}>{t("chatScreen.stageTimedOut")}</Text>
                  </View>
                )}

                {item.interruptedByBackground && (
                  <View style={[styles.stoppedBadge, styles.stoppedBadgeRow, { backgroundColor: colors.amber.bgSubtle, borderColor: colors.amber.border }]}>
                    <NidoIcon name="pause" size={12} color={colors.text.accentAmber} />
                    <Text style={[styles.stoppedTag, { color: colors.text.accentAmber }]}>{t("chatScreen.interruptedByBackground")}</Text>
                  </View>
                )}

                {item.role === "assistant" && item.text.length > 0 && (
                  <View style={[styles.bubbleFooter, { borderTopColor: colors.border.subtle }]}>
                    <Pressable
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

                    <Pressable
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
                      <Pressable
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

                    <Pressable
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
              </Pressable>
            );
          }}
        />

        {/* Input Bar */}
        <View style={[styles.inputContainer, { backgroundColor: colors.bg.cardElevated, borderTopColor: colors.border.default }]}>
          <View style={styles.inputRow}>
            {voiceInputEnabled && (
              <VoiceInputButton
                disabled={!ready || generating}
                onTranscript={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))}
              />
            )}
            <TextInput
              ref={inputRef}
              style={[styles.input, { backgroundColor: colors.bg.input, color: colors.text.primary, borderColor: colors.border.default }]}
              value={input}
              onChangeText={setInput}
              placeholder={t("chatScreen.inputPlaceholder")}
              placeholderTextColor={colors.text.dim}
              editable={ready && !generating}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              multiline={false}
            />
            {generating ? (
              <Pressable
                style={styles.stopBtn}
                onPress={stopGeneration}
                disabled={stopping}
                hitSlop={8}
                accessibilityLabel={t("chatScreen.stopGeneration")}
              >
                {stopping ? (
                  <ActivityIndicator color={colors.text.primary} size="small" />
                ) : (
                  <NidoIcon name="stop" size={16} color="#FFFFFF" />
                )}
              </Pressable>
            ) : (
              <Pressable
                style={[styles.sendBtn, (!ready || !input.trim()) && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!ready || !input.trim()}
                hitSlop={8}
                accessibilityLabel={t("chatScreen.sendMessage")}
              >
                <NidoIcon name="send" size={18} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
        </View>

        {showPromptIdeas && (
          <PromptIdeasCarousel
            onDismiss={() => setShowPromptIdeas(false)}
            onUsePrompt={(prompt) => {
              setInput(prompt);
              setShowPromptIdeas(false);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          />
        )}
      </View>

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

const styles = StyleSheet.create({
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
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    opacity: 0.6,
  },
  ambientGlowTopDeep: {
    backgroundColor: "rgba(139, 92, 246, 0.25)",
    opacity: 0.85,
  },
  ambientGlowBottom: {
    position: "absolute",
    bottom: -110,
    right: -90,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    opacity: 0.5,
  },
  ambientGlowBottomDeep: {
    backgroundColor: "rgba(6, 182, 212, 0.18)",
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
    ...typography.mono.xs,
    fontSize: 9,
    color: colors.frontier.text,
    fontWeight: "700",
    letterSpacing: 0.4,
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
    ...typography.mono.xs,
    color: colors.text.accentEmerald,
    fontWeight: "600",
  },
  list: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.lg,
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
    backgroundColor: "#13213B",
    borderWidth: 1,
    borderColor: "rgba(6, 182, 212, 0.35)",
    alignSelf: "flex-end",
    borderBottomRightRadius: calmRadii.subtle,
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
    paddingVertical: calmSpacing.comfortable,
    paddingHorizontal: calmSpacing.cozy,
    maxWidth: "100%",
    alignSelf: "stretch",
  },
  bubbleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  bubbleRoleLabel: {
    ...typography.mono.xs,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  userRoleLabel: {
    color: colors.text.accentCyan,
  },
  assistantRoleLabel: {
    color: colors.text.accentEmerald,
  },
  copyIcon: {
    fontSize: 14,
    paddingHorizontal: 4,
  },
  bubbleFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
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
    ...typography.mono.xs,
    color: colors.text.accentAmber,
    fontWeight: "700",
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
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg.input,
    color: colors.text.primary,
    borderColor: colors.border.default,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...typography.ui.body,
    fontSize: 14,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    backgroundColor: colors.emerald[600],
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    opacity: 0.35,
    backgroundColor: colors.border.elevated,
  },
  sendBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
    marginLeft: 2,
  },
  stopBtn: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    backgroundColor: colors.crimson[600],
    alignItems: "center",
    justifyContent: "center",
  },
  stopBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
  },
});
