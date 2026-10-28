/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * PanicButton — 0.1.46, botón de pánico (como Briar).
 *
 * Mantenerlo pulsado 3 segundos borra TODOS los datos de NIDO (chats,
 * contactos, claves, memoria, modelos) con el mismo borrado verificado de
 * "Borrar todos los datos", pero sin pedir huella ni confirmación: en una
 * emergencia no hay tiempo. Soltarlo antes de los 3 s no hace nada. Solo
 * aparece si el usuario lo activó en Ajustes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeContext";
import { NidoIcon } from "./icons/NidoIcon";
import { impact, ImpactFeedbackStyle, notification, NotificationFeedbackType } from "../../services/haptics";

export const PANIC_HOLD_MS = 3000;

interface Props {
  /** Se llama tras un borrado completo (la app vuelve al asistente inicial). */
  onWiped: () => void;
  /** Se llama si el borrado falla (con el mensaje de error). */
  onError?: (message: string) => void;
}

export function PanicButton({ onWiped, onError }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wiping, setWiping] = useState(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    progress.stopAnimation();
    progress.setValue(0);
  }, [progress]);

  useEffect(() => cancel, [cancel]);

  const wipe = useCallback(async () => {
    timer.current = null;
    setWiping(true);
    notification(NotificationFeedbackType.Warning);
    try {
      const { resetAllAppData } = await import("../../services/appReset");
      await resetAllAppData();
      onWiped();
    } catch (e) {
      setWiping(false);
      progress.setValue(0);
      onError?.(String((e as Error)?.message ?? e));
    }
  }, [onWiped, onError, progress]);

  const start = useCallback(() => {
    if (wiping) return;
    cancel();
    impact(ImpactFeedbackStyle.Heavy); // se nota que empezó la cuenta
    Animated.timing(progress, { toValue: 1, duration: PANIC_HOLD_MS, useNativeDriver: false }).start();
    timer.current = setTimeout(() => void wipe(), PANIC_HOLD_MS);
  }, [cancel, progress, wipe, wiping]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        btn: {
          minWidth: 44,
          height: 32,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.crimson[500],
          overflow: "hidden",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "row",
          gap: 4,
          paddingHorizontal: 10,
        },
        fill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.crimson.border },
        label: { color: colors.crimson[600], fontSize: 12, fontWeight: "700" },
      }),
    [colors],
  );

  return (
    <Pressable
      onPressIn={start}
      onPressOut={cancel}
      disabled={wiping}
      accessibilityRole="button"
      accessibilityLabel={t("panic.buttonLabel")}
      accessibilityHint={t("panic.buttonHint")}
      // TalkBack: la acción "mantener pulsado" del lector de pantalla borra
      // directamente (ese gesto ya es deliberado; no hay 3 s que mantener).
      accessibilityActions={[{ name: "longpress", label: t("panic.buttonLabel") }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "longpress" && !wiping) void wipe();
      }}
      hitSlop={6}
    >
      <View style={styles.btn}>
        <Animated.View
          style={[styles.fill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]}
        />
        {/* 0.1.56: a shield, not «SOS»: the Emergency tab is where you ask for help. */}
        <NidoIcon name="security" size={14} color={colors.crimson[600]} />
        <Text style={styles.label}>{wiping ? t("panic.wiping") : t("panic.short")}</Text>
      </View>
    </Pressable>
  );
}
