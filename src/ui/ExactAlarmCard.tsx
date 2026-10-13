/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ExactAlarmCard — ¿los recordatorios llegan a la hora exacta? (0.1.32)
 *
 * En Android 12+ «alarmas y recordatorios» es un acceso especial que el
 * usuario concede en Ajustes; en Android 14 llega denegado a las apps
 * nuevas. Sin él, Android agrupa los avisos en reposo (Doze) y un
 * recordatorio puede llegar minutos tarde. Esta tarjeta lo dice y abre el
 * ajuste del sistema. Si no se puede saber (módulo nativo ausente), no se
 * muestra nada: nunca un estado inventado.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import { makeSurfaces } from "./theme/surfaces";
import { canScheduleExactAlarms, openExactAlarmSettings } from "exact-alarm";

export function ExactAlarmCard() {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const [exact, setExact] = useState<boolean | null>(null);
  const styles = useMemo(() => {
    const ui = makeSurfaces(colors, typography);
    return StyleSheet.create({
      box: { gap: 8, marginTop: 12 },
      title: ui.sectionLabel,
      ok: ui.note,
      okText: ui.noteText,
      warn: ui.warning,
      warnText: ui.warningText,
      button: ui.secondaryButton,
      buttonText: ui.secondaryButtonText,
    });
  }, [colors, typography]);

  const refresh = useCallback(() => {
    canScheduleExactAlarms()
      .then(setExact)
      .catch(() => setExact(null));
  }, []);

  useEffect(() => {
    refresh();
    // Al volver del ajuste del sistema se vuelve a comprobar.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (exact === null) return null;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t("exactAlarm.title")}</Text>
      {exact ? (
        <View style={styles.ok}>
          <Text style={styles.okText}>{t("exactAlarm.ok")}</Text>
        </View>
      ) : (
        <>
          <View style={styles.warn}>
            <Text style={styles.warnText}>{t("exactAlarm.off")}</Text>
          </View>
          <Pressable
            style={styles.button}
            onPress={() => void openExactAlarmSettings()}
            accessibilityRole="button"
            accessibilityLabel={t("exactAlarm.allow")}
          >
            <Text style={styles.buttonText}>{t("exactAlarm.allow")}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
