import React, { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet } from "react-native";

/** Simple auto-dismissing toast. Renders nothing when `message` is null. */
export function Toast({ message, onHide }: { message: string | null; onHide: () => void }) {
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

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    // Just below the screen headers (the chat header is the taller one).
    top: 96,
    alignSelf: "center",
    zIndex: 10,
    elevation: 10,
    backgroundColor: "rgba(20,20,30,0.95)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  text: { color: "#eee", fontSize: 13, fontWeight: "600" },
});
