/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Práctica de RCP (0.1.76): para aprender y practicar sobre un cojín
 * firme o un maniquí, nunca sobre una persona.
 *
 * Por qué solo práctica: una herramienta que marca el ritmo de la RCP o
 * la evalúa mientras se reanima a alguien es un producto sanitario
 * regulado (en EE. UU., «CPR aid», 21 CFR 870.5210; con evaluación del
 * ritmo, clase II con autorización previa de la FDA). NIDO no se mete
 * ahí: esto es formación. En una emergencia, NIDO enseña el número de
 * emergencias y la guía, como siempre. Ver docs/CPR_PRACTICE.md.
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
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activateKeepAwake, deactivateKeepAwake } from "expo-keep-awake";
import { hasCprCamera, startBeepingAt, startCprCamera, stopBeeping, type CameraSamples } from "nido-cpr";
import { createCameraSession, type CameraSession } from "../../cpr/cameraSession";
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
import { createPracticeClock, monotonicNow, originFromNativeStart } from "../../cpr/practiceClock";

const KEEP_AWAKE_TAG = "nido-cpr-practice";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function CprPractice({ visible, onClose }: Props) {
  // 0.1.90: este <Modal> abre ventana propia y no hereda la caja
  // segura de la raíz de App: la raíz suma los insets de arriba y de
  // abajo del sistema, sobre su diseño (la cabecera y el final del
  // contenido quedaban bajo las barras del sistema).
  const insets = useSafeAreaInsets();
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
  const [camState, setCamState] = useState<"off" | "starting" | "on" | "failed" | "paused">("off");
  const [rate, setRate] = useState<number | null>(null);
  /** El ciclo de vida de la cámara (src/cpr/cameraSession.ts): nunca queda abierta sin verse. */
  const camSession = useRef<CameraSession | null>(null);
  const samples = useRef<MotionSample[]>([]);
  const cue = useRef<CueState>(INITIAL_CUE_STATE);
  const track = useRef<RateTrack>(INITIAL_RATE_TRACK);
  const lastEstimateAt = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // El reloj de la práctica (F-3): monotónico, anclado al instante
  // que el metrónomo devuelve al arrancar. El reloj de pared ya no
  // manda sobre fases, conteo ni rearme (src/cpr/practiceClock.ts).
  const clock = useRef(createPracticeClock());
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

  const stopCamera = useCallback((paused = false) => {
    camSession.current?.stop(paused);
    samples.current = [];
    cue.current = INITIAL_CUE_STATE;
    track.current = INITIAL_RATE_TRACK;
    setRate(null);
    if (!camSession.current) setCamState(paused ? "paused" : "off");
  }, []);

  // Cada lote de la cámara (~4 por segundo): se guarda, y como mucho dos
  // veces por segundo se calcula el ritmo. En la pausa de respiraciones no
  // se mide (el movimiento es otro) y se empieza de cero al volver.
  const onSamplesRef = useRef<(b: CameraSamples) => void>(() => {});
  const onSamples = useCallback(
    (b: CameraSamples) => {
      const p = cprPhaseAt(clock.current.elapsedAt(monotonicNow()), modeRef.current);
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
  onSamplesRef.current = onSamples;

  const startCamera = useCallback(() => {
    if (!hasCprCamera()) return;
    if (!camSession.current) {
      camSession.current = createCameraSession(
        {
          open: (onError) =>
            startCprCamera(
              (b) => onSamplesRef.current(b),
              () => {
                setRate(null);
                onError();
              },
            ),
        },
        setCamState,
      );
    }
    camSession.current.start();
  }, []);

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
    lastCount.current = 0;
    lastPhase.current = "compressions";
    lastCycle.current = 1;
    lastSlot.current = 0;
    const t0 = startBeepingAt(CPR_BPM, mode === "30:2" ? COMPRESSIONS_PER_CYCLE : 0);
    nativeBeep.current = t0 !== null;
    clock.current.start(originFromNativeStart(t0, monotonicNow()));
    setNow(0);
    setRunning(true);
    // La guía, palabra por palabra: dónde van las manos y cómo empujar.
    say(`${guide.compressions[1]} ${guide.compressions[2]}`);
    if (camWanted) startCamera();
  }, [camWanted, guide, mode, say, startCamera]);

  // El reloj de la pantalla. El pitido lo lleva el hilo nativo; esto solo
  // pinta, cuenta y habla en los cambios de fase. El tiempo sale del
  // reloj de la práctica (monotónico), nunca del reloj de pared.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const elapsed = clock.current.elapsedAt(monotonicNow());
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
        const tCycle = startBeepingAt(CPR_BPM, COMPRESSIONS_PER_CYCLE);
        nativeBeep.current = tCycle !== null;
        // El rearme produce un origen nuevo por bloque: el reloj se
        // reancla a ese instante para que el bloque pintado y el
        // pitado empiecen juntos, sin romper la continuidad del
        // conteo (el reloj nunca retrocede).
        if (tCycle !== null) clock.current.reanchor(p.cycle, originFromNativeStart(tCycle, monotonicNow()));
      }
      const slot = switchReminderDue(elapsed, mode, lastSlot.current);
      if (slot !== null) {
        lastSlot.current = slot;
        say(guide.switchLine);
      }
    }, 40);
    return () => clearInterval(id);
  }, [running, mode, guide, say, t]);

  // La cámara nunca sigue encendida con NIDO fuera de la vista: al pasar a
  // segundo plano (botón de inicio, pantalla bloqueada, otra app) se apaga,
  // y al volver se enciende otra vez si la práctica sigue y el medidor
  // estaba activado. El pitido y la cuenta siguen (docs/CPR_PRACTICE.md).
  const runningRef = useRef(running);
  runningRef.current = running;
  const camWantedRef = useRef(camWanted);
  camWantedRef.current = camWanted;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      const wanted = runningRef.current && camWantedRef.current;
      if (st !== "active") {
        if (wanted) stopCamera(true);
      } else if (wanted) {
        startCamera();
      }
    });
    return () => sub.remove();
  }, [startCamera, stopCamera]);

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
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">{t("cpr.practice.title")}</Text>
            <Text style={styles.subtitle}>{guide.title}</Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("cpr.close")} style={styles.closeBtn} hitSlop={8}>
            <NidoIcon name="close" size={20} color={colors.text.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.practiceBanner} accessibilityRole="alert">
            <Text style={styles.practiceText}>{t("cpr.practice.banner")}</Text>
          </View>

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

              {hasCprCamera() ? (
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
                    ) : camState === "paused" ? (
                      <Text style={styles.rateHint}>{t("cpr.camera.paused")}</Text>
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
