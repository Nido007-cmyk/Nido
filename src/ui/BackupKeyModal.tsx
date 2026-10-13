/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * BackupKeyModal — la clave de cifrado en un modal copiable, compartido
 * por la pantalla de respaldo (BackupScreen) y la tarjeta de Ajustes
 * (ModelSetupScreen).
 *
 * FIX 2026-10-09 (K4): modal copiable en vez de Alert (el texto de un
 * Alert no se puede copiar). La ruta de Ajustes siguió mostrando la
 * clave en una alerta del sistema hasta 2026-10-12: desde ahí la clave
 * no se podía copiar, solo anotarla o fotografiarla (evidencia física,
 * Tab A9+). Este componente es ahora la única superficie que la muestra.
 *
 * La copia usa copySecret (marcada sensible; se borra sola a los 60 s)
 * y muestra confirmación visible: antes el botón copiaba en silencio y
 * parecía que no hacía nada (evidencia física, 2026-10-12).
 *
 * 0.1.29 (M-1, auditoría 2026-10-13): ya NO es un <Modal> de React Native.
 * En Android, Modal abre su propia ventana (un Dialog) y FLAG_SECURE es un
 * flag por ventana: el de MainActivity no la cubre por sí mismo, así que
 * la clave podía salir en capturas, grabaciones y en Recientes. Ahora es
 * una capa a pantalla completa DENTRO de la ventana de la actividad, que
 * sí lleva FLAG_SECURE. Por eso cada pantalla la monta en su contenedor
 * raíz (no dentro de un ScrollView). El botón Atrás la cierra, como antes.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, BackHandler } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import { makeSurfaces } from "./theme/surfaces";
import { copySecret } from "../utils/secretClipboard";

export interface BackupKeyModalProps {
  /** La clave a mostrar; null = modal cerrado. */
  dek: string | null;
  /** Dónde se guardó el backup ("" si la clave se consulta sin crear). */
  dest: string;
  onClose: () => void;
}

export function BackupKeyModal({ dek, dest, onClose }: BackupKeyModalProps) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  useEffect(() => {
    if (dek === null) setCopied(false);
  }, [dek]);
  // Atrás cierra la capa (antes: onRequestClose del Modal).
  useEffect(() => {
    if (dek === null) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [dek, onClose]);

  const ui = makeSurfaces(colors, typography);
  const styles = StyleSheet.create({
    button: ui.primaryButton,
    buttonText: ui.primaryButtonText,
    buttonSecondary: ui.secondaryButton,
    buttonSecondaryText: ui.secondaryButtonText,
    modalOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1000,
      elevation: 1000,
      backgroundColor: colors.bg.modalOverlay,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    modalBox: { borderRadius: 20, padding: 20, width: "100%", maxWidth: 400, gap: 4 },
    modalTitle: { ...typography.ui.title, fontWeight: "700", marginBottom: 8 },
    modalText: { ...typography.ui.body },
    dekText: { fontSize: 13, fontFamily: "monospace", lineHeight: 18 },
    modalButtons: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
    copiedNote: { ...typography.ui.body, marginTop: 12, fontWeight: "600" },
  });

  const handleCopy = async () => {
    if (!dek) return;
    try {
      await copySecret(dek);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 4000);
    } catch {
      // Sin confirmación si la copia falla.
    }
  };

  if (dek === null) return null;
  return (
    <View style={styles.modalOverlay} accessibilityViewIsModal>
      <View style={[styles.modalBox, { backgroundColor: colors.bg.card }]}>
        <Text style={[styles.modalTitle, { color: colors.text.primary }]}>
          {dest ? t("backup.dekTitle") : t("backup.keyTitle")}
        </Text>
        <Text style={[styles.modalText, { color: colors.text.primary }]}>
          {dest ? `${t("backup.dekSavedIn")}\n${dest}\n\n` : ""}
          {t("backup.dekCopyPrompt")}
          {"\n\n"}
        </Text>
        <Text selectable style={[styles.dekText, { color: colors.text.primary }]}>
          {dek}
        </Text>
        <Text style={[styles.modalText, { color: colors.text.primary }]}>
          {"\n"}
          {t("backup.dekWarning")}
        </Text>
        {/* FIX 2026-10-09: advertencia anti-fraude (ataques reales documentados:
            actores roban claves de backup con bots falsos de "soporte") */}
        <Text
          style={[
            styles.modalText,
            { color: colors.crimson[500], fontWeight: "bold" },
          ]}
        >
          {"\n"}
          {t("backup.dekFraudWarning")}
        </Text>
        <View style={styles.modalButtons}>
          <Pressable
            style={styles.button}
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel={t("backup.copyKey")}
          >
            <Text style={styles.buttonText}>{t("backup.copyKey")}</Text>
          </Pressable>
          <Pressable
            style={styles.buttonSecondary}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("backup.understood")}
          >
            <Text style={styles.buttonSecondaryText}>{t("backup.understood")}</Text>
          </Pressable>
        </View>
        {copied && (
          <Text style={[styles.copiedNote, { color: colors.text.primary }]}>
            {t("backup.keyCopiedNote")}
          </Text>
        )}
      </View>
    </View>
  );
}
