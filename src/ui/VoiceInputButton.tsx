/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, StyleSheet, Animated, Alert, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { NidoIcon } from "./components/icons/NidoIcon";
import { isVoiceInputAvailable, startListening, stopListening, VoiceEvent } from "../voice/VoiceInput";

interface Props {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}

const AURA_COLORS = ["#22d3ee", "#3b82f6", "#8b5cf6", "#ec4899"] as const; // cyan -> blue -> violet -> pink

function AuraRing({ active, delay }: { active: boolean; delay: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      opacity.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.9, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 900, useNativeDriver: true }),
        ]),
        Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, delay, scale, opacity]);

  return (
    <Animated.View
      style={[styles.ring, { opacity, transform: [{ scale }] }]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={AURA_COLORS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.ringGradient}
      />
    </Animated.View>
  );
}

/**
 * Gemini-style glowing mic: idle is a sleek metallic-gradient circle;
 * listening expands multi-color aura rings (cyan -> blue -> violet ->
 * pink) that pulse outward. Built with core Animated + expo-linear-gradient
 * (no react-native-reanimated) — see docs/MODELS.md for why.
 *
 * Backed by Android's built-in SpeechRecognizer with EXTRA_PREFER_OFFLINE
 * (src/voice/VoiceInput.ts) — not guaranteed available on GrapheneOS/
 * de-Googled builds; shows a clear "unavailable" message there instead of
 * pretending to listen.
 */
export function VoiceInputButton({ disabled, onTranscript }: Props) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    isVoiceInputAvailable().then(setAvailable).catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (!listening) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  const handlePress = async () => {
    if (available === false) {
      Alert.alert(
        t("voiceInputAlert.unavailableTitle"),
        t("voiceInputAlert.unavailableMessage")
      );
      return;
    }
    if (listening) {
      await stopListening();
      setListening(false);
      return;
    }
    setListening(true);
    try {
      const result = await startListening((event: VoiceEvent) => {
        if (event.type === "error") setListening(false);
      });
      if (result) onTranscript(result);
    } finally {
      setListening(false);
    }
  };

  return (
    <View style={styles.container}>
      {[0, 300, 600].map((delay) => (
        <AuraRing key={delay} active={listening} delay={delay} />
      ))}
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Pressable
          onPress={handlePress}
          disabled={disabled && !listening}
          hitSlop={8}
          style={(disabled || available === false) && styles.btnDisabled}
        >
          <LinearGradient
            colors={listening ? AURA_COLORS : ["#2a2a3a", "#16161f"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btn}
          >
            {listening ? (
              <Text style={styles.icon}>●</Text>
            ) : (
              <NidoIcon name="mic" size={20} color="#fff" />
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.4 },
  icon: { fontSize: 16, color: "#fff" },
  ring: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  ringGradient: {
    width: "100%",
    height: "100%",
    borderRadius: 20,
  },
});
