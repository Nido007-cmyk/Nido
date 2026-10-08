/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet } from "react-native";
import { useTheme } from "./theme/ThemeContext";
import type { Colors } from "./theme/colors";

/** Simple auto-dismissing toast. Renders nothing when `message` is null. */
export function Toast({ message, onHide }: { message: string | null; onHide: () => void }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(onHide);
    }, 1800);
    return () => clearTimeout(timer);
  }, [message, opacity, onHide]);

  if (!message) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="none">
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const getStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      position: "absolute",
      // Just below the screen headers (the chat header is the taller one).
      top: 96,
      alignSelf: "center",
      zIndex: 10,
      elevation: 10,
      // Inverted pill: dark in daylight, light in night garden.
      backgroundColor: colors.text.primary,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.border.subtle,
    },
    text: { color: colors.text.inverse, fontSize: 13, fontWeight: "600" },
  });
