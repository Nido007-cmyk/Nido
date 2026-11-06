/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Asistente de RCP manos libres (0.1.76).
 *
 * Pantalla completa para usar con el teléfono en el suelo: un pitido en
 * cada compresión (110 por minuto, módulo nativo nido-cpr), un
 * círculo grande que late con él, el conteo 30:2 si se eligió dar
 * respiraciones, y la voz del teléfono que lee la guía y avisa de las
 * respiraciones y de turnarse cada 2 minutos. El texto de primeros
 * auxilios es el de la guía NIDO Esencial, palabra por palabra
 * (src/cpr/cprCoach.ts y su prueba). La pantalla no se apaga mientras
 * dura. Sin red, sin modelo de IA.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { activateKeepAwake, deactivateKeepAwake } from "expo-keep-awake";
import { hasCprCamera, startBeeping, startCprCamera, stopBeeping, type CameraSamples } from "nido-cpr";
import { useTheme } from "../theme/ThemeContext";
import type { Colors } from "../theme/colors";
import type { Typography } from "../theme/typography";
import { NidoIcon } from "../components/icons/NidoIcon";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { speakAloud, stopSpeaking } from "../../voice/tts";
import {
  BEAT_MS,
  COMPRESSIONS_PER_CYCLE,
  CPR_BPM,
  CPR_GUIDE,
  cprLangOf,
  cprPhaseAt,
  formatElapsed,
  switchReminderDue,
  type CprMode,
} from "../../cpr/cprCoach";
import {
  camSamplesToMotion,
  estimateRate,
  INITIAL_CUE_STATE,
  INITIAL_RATE_TRACK,
  nextCue,
  trackRate,
  verdictFor,
  WINDOW_MS,
  type CueState,
  type MotionSample,
  type RateTrack,
} from "../../cpr/rateEstimator";

const KEEP_AWAKE_TAG = "nido-cpr-coach";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Número de emergencias del país elegido, si lo hay (abre el marcador). */
  emergency?: { value: string; tel: string } | null;
  onCall?: (tel: string) => void;
  /**
   * Modo práctica: sobre un cojín o un maniquí, nunca sobre una persona.
   * Solo aquí se ofrece el medidor de ritmo por cámara. En EE. UU., un
   * aparato que da a quien reanima una valoración en tiempo real de su RCP
   * (ritmo, profundidad…) es un «CPR aid with feedback», clase II
   * (21 CFR 870.5210(b)), y con software necesita autorización previa de
   * la FDA. Mientras NIDO no la tenga, la medición se ofrece para
   * practicar; en una emergencia real el asistente marca el ritmo con el
   * pitido y la guía, sin evaluar a nadie. Ver docs/CPR_ASSISTANT.md.
   */
  practice?: boolean;
}

export function CprCoach({ visible, onClose, emergency, onCall, practice = false }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => getStyles(colors, typography), [colors, typography]);
  const { t, i18n } = useTranslation();
  const guide = CPR_GUIDE[cprLangOf(i18n.resolvedLanguage ?? i18n.language)];

  const [mode, setMode] = useState<CprMode>("continuous");
  const [running, setRunning] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [now, setNow] = useState(0);
  const [pulse, setPulse] = useState(false);
  const [showStop, setShowStop] = useState(false);
  // Medidor de ritmo por cámara (opcional, apagado por defecto).
  const [camWanted, setCamWanted] = useState(false);
  const [camState, setCamState] = useState<"off" | "starting" | "on" | "failed">("off");
  const [rate, setRate] = useState<number | null>(null);
  const camStop = useRef<(() => void) | null>(null);
  const samples = useRef<MotionSample[]>([]);
  const cue = useRef<CueState>(INITIAL_CUE_STATE);
  const track = useRef<RateTrack>(INITIAL_RATE_TRACK);
  const lastEstimateAt = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const startedAt = useRef(0);
  const lastCount = useRef(0);
  const lastPhase = useRef<string>("");
  const lastCycle = useRef(0);
  const lastSlot = useRef(0);
  const nativeBeep = useRef(false);
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  const say = useCallback((text: string) => {
    if (voiceRef.current) void speakAloud(text);
  }, []);

  const stopCamera = useCallback(() => {
    camStop.current?.();
    camStop.current = null;
    samples.current = [];
    cue.current = INITIAL_CUE_STATE;
    track.current = INITIAL_RATE_TRACK;
    setRate(null);
    setCamState("off");
  }, []);

  // Cada lote de la cámara (~4 por segundo): se guarda, y como mucho dos
  // veces por segundo se calcula el ritmo. En la pausa de respiraciones no
  // se mide (el movimiento es otro) y se empieza de cero al volver.
  const onSamples = useCallback(
    (b: CameraSamples) => {
      const p = cprPhaseAt(Date.now() - startedAt.current, modeRef.current);
      if (p.phase === "breaths") {
        samples.current = [];
        cue.current = { ...cue.current, recent: [] };
        track.current = INITIAL_RATE_TRACK;
        setRate(null);
        return;
      }
      for (const m of camSamplesToMotion(b)) samples.current.push(m);
      const last = samples.current[samples.current.length - 1]?.t ?? 0;
      while (samples.current.length && samples.current[0].t < last - WINDOW_MS - 1000) samples.current.shift();
      if (last - lastEstimateAt.current < 500) return;
      lastEstimateAt.current = last;
      const k = trackRate(track.current, estimateRate(samples.current), last);
      track.current = k.state;
      setRate(k.shown);
      const r = nextCue(cue.current, k.shown !== null ? verdictFor(k.shown) : null, last);
      cue.current = r.state;
      if (r.cue) say(t(`cpr.cue.${r.cue}`));
    },
    [say, t]
  );

  const stop = useCallback(() => {
    stopCamera();
    stopBeeping();
    stopSpeaking();
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    impact(ImpactFeedbackStyle.Heavy);
    activateKeepAwake(KEEP_AWAKE_TAG);
    startedAt.current = Date.now();
    lastCount.current = 0;
    lastPhase.current = "compressions";
    lastCycle.current = 1;
    lastSlot.current = 0;
    nativeBeep.current = startBeeping(CPR_BPM, mode === "30:2" ? COMPRESSIONS_PER_CYCLE : 0);
    setNow(0);
    setRunning(true);
    // La guía, palabra por palabra: dónde van las manos y cómo empujar.
    say(`${guide.compressions[1]} ${guide.compressions[2]}`);
    if (practice && camWanted && hasCprCamera()) {
      setCamState("starting");
      void startCprCamera(onSamples, () => {
        camStop.current?.();
        camStop.current = null;
        setRate(null);
        setCamState("failed");
      }).then((stopFn) => {
        if (!stopFn) {
          setCamState("failed");
          return;
        }
        camStop.current = stopFn;
        setCamState("on");
      });
    }
  }, [camWanted, guide, mode, onSamples, practice, say]);

  // El reloj de la pantalla. El pitido lo lleva el hilo nativo; esto solo
  // pinta, cuenta y habla en los cambios de fase.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      setNow(elapsed);
      const p = cprPhaseAt(elapsed, mode);
      if (p.total !== lastCount.current && p.phase === "compressions") {
        lastCount.current = p.total;
        setPulse(true);
        setTimeout(() => setPulse(false), Math.min(160, BEAT_MS / 3));
        if (!nativeBeep.current) impact(ImpactFeedbackStyle.Medium);
      }
      if (p.phase !== lastPhase.current) {
        lastPhase.current = p.phase;
        if (p.phase === "breaths") say(t("cpr.voice.breaths"));
        else say(t("cpr.voice.compressions"));
      }
      if (mode === "30:2" && p.phase === "compressions" && p.cycle !== lastCycle.current) {
        lastCycle.current = p.cycle;
        nativeBeep.current = startBeeping(CPR_BPM, COMPRESSIONS_PER_CYCLE);
      }
      const slot = switchReminderDue(elapsed, mode, lastSlot.current);
      if (slot !== null) {
        lastSlot.current = slot;
        say(guide.switchLine);
      }
    }, 40);
    return () => clearInterval(id);
  }, [running, mode, guide, say, t]);

  // Cerrar la pantalla o salir de la app para el pitido y la voz.
  useEffect(() => {
    if (!visible && running) stop();
  }, [visible, running, stop]);
  useEffect(() => () => stop(), [stop]);

  const close = useCallback(() => {
    stop();
    onClose();
  }, [onClose, stop]);

  const phase = cprPhaseAt(now, mode);
  const breaths = running && phase.phase === "breaths";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">{practice ? t("cpr.practice.title") : t("cpr.title")}</Text>
            <Text style={styles.subtitle}>{guide.title}</Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("cpr.close")} style={styles.closeBtn} hitSlop={8}>
            <NidoIcon name="close" size={20} color={colors.text.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {practice ? (
            <View style={styles.practiceBanner} accessibilityRole="alert">
              <Text style={styles.practiceText}>{t("cpr.practice.banner")}</Text>
            </View>
          ) : null}

          {!practice && emergency && onCall ? (
            <Pressable
              onPress={() => onCall(emergency.tel)}
              style={styles.callBtn}
              accessibilityRole="button"
              accessibilityLabel={t("cpr.callA11y", { number: emergency.value })}
            >
                            <Text style={styles.callText}>{t("cpr.call", { number: emergency.value })}</Text>
            </Pressable>
          ) : null}

          {!running ? (
            <>
              <Text style={styles.section}>{guide.headings.before}</Text>
              {guide.before.map((l) => (
                <Text key={l} style={styles.line}>{`• ${l}`}</Text>
              ))}

              <Text style={styles.section}>{t("cpr.chooseMode")}</Text>
              <Pressable
                onPress={() => setMode("continuous")}
                style={[styles.option, mode === "continuous" && styles.optionOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === "continuous" }}
              >
                <Text style={styles.optionTitle}>{t("cpr.modeContinuous")}</Text>
                <Text style={styles.optionHint}>{guide.breaths[2]}</Text>
              </Pressable>
              <Pressable
                onPress={() => setMode("30:2")}
                style={[styles.option, mode === "30:2" && styles.optionOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === "30:2" }}
              >
                <Text style={styles.optionTitle}>{t("cpr.mode302")}</Text>
                <Text style={styles.optionHint}>{guide.breaths[0]}</Text>
              </Pressable>

              {practice && hasCprCamera() ? (
                <Pressable
                  onPress={() => setCamWanted((v) => !v)}
                  style={[styles.option, camWanted && styles.optionOn]}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: camWanted }}
                  testID="cpr-camera-toggle"
                >
                  <Text style={styles.optionTitle}>{`${camWanted ? "☑" : "☐"} ${t("cpr.camera.toggle")}`}</Text>
                  <Text style={styles.optionHint}>{t("cpr.camera.hint")}</Text>
                </Pressable>
              ) : null}

              <Pressable onPress={start} style={styles.startBtn} accessibilityRole="button" testID="cpr-start">
                <Text style={styles.startText}>{t("cpr.start")}</Text>
              </Pressable>
              <Text style={styles.note}>{t("cpr.howItWorks", { bpm: CPR_BPM })}</Text>
            </>
          ) : (
            <>
              <View style={styles.center}>
                <View
                  style={[styles.beat, breaths ? styles.beatBreaths : null, pulse && !breaths ? styles.beatOn : null]}
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={breaths ? t("cpr.breathsNow") : t("cpr.compressionCount", { count: phase.count })}
                >
                  <Text style={styles.beatCount}>{breaths ? "2" : String(phase.count)}</Text>
                  <Text style={styles.beatLabel}>
                    {breaths ? t("cpr.breathsNow") : mode === "30:2" ? t("cpr.ofThirty") : t("cpr.compressions")}
                  </Text>
                </View>
                <Text style={styles.elapsed}>{formatElapsed(now)}</Text>
                {camState !== "off" ? (
                  <View style={styles.rateBox} accessibilityLiveRegion="polite">
                    {camState === "starting" ? (
                      <Text style={styles.rateHint}>{t("cpr.camera.starting")}</Text>
                    ) : camState === "failed" ? (
                      <Text style={styles.rateHint}>{t("cpr.camera.failed")}</Text>
                    ) : rate && !breaths ? (
                      <>
                        <Text style={styles.rateValue}>{t("cpr.camera.rate", { bpm: rate })}</Text>
                        <Text
                          style={[
                            styles.rateVerdict,
                            { color: verdictFor(rate) === "good" ? colors.text.accentEmerald : colors.id === "nightgarden" ? colors.crimson[400] : colors.crimson[600] },
                          ]}
                        >
                          {t(`cpr.cue.${verdictFor(rate)}`)}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.rateHint}>{t("cpr.camera.looking")}</Text>
                    )}
                  </View>
                ) : null}
                {!nativeBeep.current ? <Text style={styles.note}>{t("cpr.noBeep")}</Text> : null}
              </View>

              <View style={styles.row}>
                <Pressable onPress={() => setVoiceOn((v) => !v)} style={styles.secondaryBtn} accessibilityRole="switch" accessibilityState={{ checked: voiceOn }}>
                  <Text style={styles.secondaryText}>{voiceOn ? t("cpr.voiceOn") : t("cpr.voiceOff")}</Text>
                </Pressable>
                <Pressable onPress={stop} style={[styles.secondaryBtn, styles.stopBtn]} accessibilityRole="button" testID="cpr-stop">
                  <Text style={[styles.secondaryText, { color: colors.text.inverse }]}>{t("cpr.stop")}</Text>
                </Pressable>
              </View>

              <Text style={styles.section}>{guide.headings.compressions}</Text>
              {guide.compressions.map((l, i) => (
                <Text key={l} style={styles.line}>{`${i + 1}. ${l}`}</Text>
              ))}
              {mode === "30:2" ? (
                <>
                  <Text style={styles.section}>{guide.headings.breaths}</Text>
                  <Text style={styles.line}>{`• ${guide.breaths[1]}`}</Text>
                </>
              ) : null}
            </>
          )}

          <Pressable onPress={() => setShowStop((v) => !v)} accessibilityRole="button" style={styles.disclosure}>
            <Text style={styles.section}>{`${guide.headings.stop} ${showStop ? "▴" : "▾"}`}</Text>
          </Pressable>
          {showStop ? guide.stop.map((l) => <Text key={l} style={styles.line}>{`• ${l}`}</Text>) : null}

          <Text style={styles.source}>
            {t("cpr.source", { title: guide.title, sources: guide.sources, verified: guide.verified })}
          </Text>
          <Text style={styles.note}>{t("cpr.notForBabies")}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function getStyles(colors: Colors, typography: Typography) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg.black },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 12 },
    title: { ...typography.ui.titleLg, color: colors.text.heading },
    subtitle: { ...typography.ui.caption, color: colors.text.secondary, marginTop: 2 },
    closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    body: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },
    section: { ...typography.ui.titleSm, color: colors.text.heading, marginTop: 16 },
    line: { ...typography.ui.body, color: colors.text.primary },
    note: { ...typography.ui.caption, color: colors.text.dim, marginTop: 8 },
    source: { ...typography.ui.caption, color: colors.text.secondary, marginTop: 20 },
    callBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 52,
      borderRadius: 14,
      backgroundColor: colors.crimson[500],
      marginTop: 4,
    },
    callText: { ...typography.ui.titleSm, color: colors.text.inverse },
    option: {
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: 14,
      padding: 14,
      backgroundColor: colors.bg.card,
      gap: 4,
    },
    optionOn: { borderColor: colors.emerald[500], backgroundColor: colors.emerald.bgSubtle },
    optionTitle: { ...typography.ui.titleSm, color: colors.text.primary },
    optionHint: { ...typography.ui.caption, color: colors.text.secondary },
    startBtn: {
      marginTop: 16,
      minHeight: 64,
      borderRadius: 32,
      backgroundColor: colors.crimson[500],
      alignItems: "center",
      justifyContent: "center",
    },
    startText: { ...typography.ui.title, color: colors.text.inverse },
    center: { alignItems: "center", marginTop: 12, gap: 8 },
    beat: {
      width: 220,
      height: 220,
      borderRadius: 110,
      borderWidth: 6,
      borderColor: colors.crimson[500],
      backgroundColor: colors.bg.card,
      alignItems: "center",
      justifyContent: "center",
    },
    beatOn: { backgroundColor: colors.crimson[500], transform: [{ scale: 0.94 }] },
    beatBreaths: { borderColor: colors.emerald[500], backgroundColor: colors.emerald.bgSubtle },
    beatCount: { fontSize: 72, fontWeight: "700", color: colors.text.heading },
    beatLabel: { ...typography.ui.titleSm, color: colors.text.secondary },
    elapsed: { ...typography.ui.title, color: colors.text.secondary, fontVariant: ["tabular-nums"] },
    row: { flexDirection: "row", gap: 12, marginTop: 12 },
    secondaryBtn: {
      flex: 1,
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border.default,
      backgroundColor: colors.bg.card,
      alignItems: "center",
      justifyContent: "center",
    },
    stopBtn: { backgroundColor: colors.text.primary, borderColor: colors.text.primary },
    secondaryText: { ...typography.ui.titleSm, color: colors.text.primary },
    disclosure: { minHeight: 44, justifyContent: "center" },
    practiceBanner: {
      borderRadius: 14,
      padding: 12,
      backgroundColor: colors.amber.bgSubtle,
      borderWidth: 1,
      borderColor: colors.amber.border,
    },
    practiceText: { ...typography.ui.body, color: colors.text.primary },
    rateBox: {
      alignItems: "center",
      minHeight: 56,
      justifyContent: "center",
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 14,
      backgroundColor: colors.bg.card,
      borderWidth: 1,
      borderColor: colors.border.default,
      alignSelf: "stretch",
    },
    rateValue: { ...typography.ui.title, color: colors.text.heading, fontVariant: ["tabular-nums"] },
    rateVerdict: { ...typography.ui.titleSm },
    rateHint: { ...typography.ui.caption, color: colors.text.secondary, textAlign: "center" },
  });
}
