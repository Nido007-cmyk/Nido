/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * BackupScreen — NIDO: respaldo y restauración de la base cifrada.
 *
 * Permite al usuario:
 * 1. Crear un backup de la base de datos cifrada.
 * 2. Ver y copiar su clave de cifrado (necesaria para restaurar).
 * 3. Restaurar desde un backup (con confirmación).
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import { makeSurfaces } from "./theme/surfaces";
import * as Backup from "../security/backup";
import { requireUnlock, BiometricUnavailable } from "../security/biometricGate";

export function BackupScreen({ onClose }: { onClose: () => void }) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  // FIX 2026-10-09 (K4/K5): DEK en modal copiable con biométrico, no en Alert.
  const [dekModal, setDekModal] = useState<{ dek: string; dest: string } | null>(null);

  const handleCreateBackup = async () => {
    setBusy(true);
    try {
      const { documentDirectory } = await import("expo-file-system/legacy");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dest = `${documentDirectory}nido-backup-${timestamp}.db`;
      await Backup.createBackup(dest);
      const key = await Backup.exportDatabaseKey();
      setLastBackup(dest);
      // K5/R2: biométrico antes de mostrar la clave. Si no hay biométrico
      // configurado (tablets de prueba), advertir pero permitir continuar —
      // bloquear por completo dejaba al usuario sin acceso a su DEK (R2).
      try {
        await requireUnlock(t("backup.unlockReason"));
      } catch (e) {
        // A11 (auditoría 2026-10-10): decidir por el tipo de error, no por
        // el texto del mensaje (cambiar la redacción cambiaba el comportamiento).
        const isUnavailable = e instanceof BiometricUnavailable;
        if (!isUnavailable) {
          // Usuario canceló: no mostrar.
          Alert.alert(t("backup.cancelledTitle"), t("backup.keyNotShown"));
          return;
        }
        // Sin biométrico: advertir y continuar bajo consentimiento.
        // (El usuario ya creó el backup; negarle la clave es peor.)
      }
      // K4: modal copiable en vez de Alert (el texto de Alert no se puede copiar).
      setDekModal({ dek: key, dest });
    } catch (e) {
      Alert.alert(t("backup.errorTitle"), e instanceof Error ? e.message : t("backup.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  // FIX 2026-10-09 (CR-2): rotación de DEK (F-KEY-1) con UI.
  const handleRotateKey = async () => {
    Alert.alert(
      t("backup.rotateTitle"),
      t("backup.rotateBody"),
      [
        { text: t("backup.cancel"), style: "cancel" },
        {
          text: t("backup.rotateConfirm"),
          style: "destructive",
          onPress: async () => {
            // Rotar la clave es una operación sensible: pide desbloqueo.
            // Sin bloqueo configurado en el teléfono se permite continuar,
            // igual que al crear un respaldo.
            try {
              await requireUnlock(t("backup.rotateTitle"));
            } catch (e) {
              if (!(e instanceof BiometricUnavailable)) return;
            }
            setBusy(true);
            try {
              const { rotateAllDatabaseKeys } = await import("../security/keyRotation");
              const { default: SecureStore } = await import("expo-secure-store");
              const SQLite = await import("expo-sqlite");
              const { applyDatabaseKey } = await import("../privacy/keyManager");

              // FIX 2026-10-09 (CR2-PATH, CR2-MULTIDB): no hardcodear el path.
              // rotateAllDatabaseKeys deriva las rutas canónicas de
              // MANAGED_DB_NAMES vía getCurrentDriver() y rota las 3 DBs
              // con el mismo DEK nuevo.
              const result = await rotateAllDatabaseKeys(
                async (path: string, dekHex: string) => {
                  const slash = path.lastIndexOf("/");
                  const db = await SQLite.openDatabaseAsync(
                    path.slice(slash + 1),
                    { useNewConnection: true },
                    path.slice(0, slash)
                  );
                  await applyDatabaseKey(db as any, dekHex, "rekey");
                  return {
                    exec: async (sql: string) => { await (db as any).execAsync(sql); },
                    close: async () => { await (db as any).closeAsync(); },
                  };
                },
                async (dekHex: string) => {
                  await SecureStore.setItemAsync("nido_db_key", dekHex);
                }
              );
              
              if (result.ok) {
                Alert.alert(
                  t("backup.rotatedTitle"),
                  t("backup.rotatedBody")
                );
              } else {
                Alert.alert(t("backup.errorTitle"), result.error ?? t("backup.rotateFailed"));
              }
            } catch (e) {
              Alert.alert(t("backup.errorTitle"), e instanceof Error ? e.message : t("backup.rotateFailed"));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const handleSaveToDownloads = async () => {
    if (!lastBackup) {
      Alert.alert(t("backup.noBackupsTitle"), t("backup.createFirst"));
      return;
    }
    setBusy(true);
    try {
      const FS = await import("expo-file-system/legacy");
      // SAF: pedir al usuario que elija dónde guardar (Descargas).
      const perms = await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perms.granted) {
        Alert.alert(t("backup.cancelledTitle"), t("backup.noPermission"));
        return;
      }
      // FIX 2026-10-09 (C1): copiar los 3 archivos (db + manifest + knowledge).
      // Si no, K1/K2/K3 no protegen el flujo de Descargas.
      const filesToCopy = [lastBackup];
      const manifestUri = `${lastBackup}.manifest.json`;
      const knowledgeUri = `${lastBackup}.knowledge.db`;
      try {
        const mi = await FS.getInfoAsync(manifestUri);
        if (mi.exists) filesToCopy.push(manifestUri);
      } catch { /* noop */ }
      try {
        const ki = await FS.getInfoAsync(knowledgeUri);
        if (ki.exists) filesToCopy.push(knowledgeUri);
      } catch { /* noop */ }
      const copied: string[] = [];
      for (const srcUri of filesToCopy) {
        const fileName = srcUri.split("/").pop() ?? "nido-backup.db";
        const destUri = await FS.StorageAccessFramework.createFileAsync(
          perms.directoryUri,
          fileName,
          "application/octet-stream"
        );
        const content = await FS.readAsStringAsync(srcUri, {
          encoding: FS.EncodingType.Base64,
        });
        await FS.writeAsStringAsync(destUri, content, {
          encoding: FS.EncodingType.Base64,
        });
        copied.push(fileName);
      }
      Alert.alert(t("backup.savedTitle"), t("backup.savedBody", { files: copied.join("\n") }));
    } catch (e) {
      Alert.alert(t("backup.errorTitle"), e instanceof Error ? e.message : t("backup.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleShowKey = async () => {
    setBusy(true);
    try {
      // FIX 2026-10-09 (H-3): biométrico obligatorio para ver la DEK.
      try {
        await requireUnlock(t("backup.unlockReason"));
      } catch {
        Alert.alert(t("backup.cancelledTitle"), t("backup.keyNotShown"));
        return;
      }
      const key = await Backup.exportDatabaseKey();
      // La clave se muestra en el mismo modal copiable que al crear el
      // respaldo: el texto de un Alert no se puede copiar.
      setDekModal({ dek: key, dest: "" });
    } catch (e) {
      Alert.alert(t("backup.errorTitle"), e instanceof Error ? e.message : t("backup.keyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const ui = makeSurfaces(colors, typography);
  const styles = StyleSheet.create({
    container: ui.page,
    content: { padding: 16, gap: 12, paddingBottom: 48 },
    title: { ...ui.topBarTitle, marginTop: 8 },
    desc: ui.body,
    button: ui.primaryButton,
    buttonText: ui.primaryButtonText,
    buttonSecondary: ui.secondaryButton,
    buttonSecondaryText: ui.secondaryButtonText,
    warning: ui.warning,
    warningText: ui.warningText,
    modalOverlay: {
      flex: 1,
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
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("backup.screenTitle")}</Text>
      <Text style={styles.desc}>
        {t("backup.screenDesc")}
      </Text>

      <Pressable
        style={styles.button}
        onPress={handleCreateBackup}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("backup.createNow")}
      >
        {busy ? (
          <ActivityIndicator color={colors.text.inverse} />
        ) : (
          <Text style={styles.buttonText}>{t("backup.createNow")}</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.buttonSecondary}
        onPress={handleShowKey}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("backup.showKey")}
      >
        <Text style={styles.buttonSecondaryText}>{t("backup.showKey")}</Text>
      </Pressable>

      {/* FIX 2026-10-09 (CR-2): rotación de DEK (F-KEY-1). */}
      <Pressable
        style={styles.buttonSecondary}
        onPress={handleRotateKey}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("backup.rotateKey")}
      >
        <Text style={styles.buttonSecondaryText}>{t("backup.rotateKey")}</Text>
      </Pressable>

      {/* FIX 2026-10-09: guardar directo en Descargas vía SAF. */}
      <Pressable
        style={[styles.buttonSecondary, !lastBackup && { opacity: 0.5 }]}
        onPress={handleSaveToDownloads}
        disabled={busy || !lastBackup}
        accessibilityRole="button"
        accessibilityLabel={t("backup.saveToDownloads")}
      >
        <Text style={styles.buttonSecondaryText}>{t("backup.saveToDownloads")}</Text>
      </Pressable>

      {lastBackup && (
        <Text style={styles.desc}>{t("backup.lastBackup", { path: lastBackup })}</Text>
      )}

      <View style={styles.warning}>
        <Text style={styles.warningText}>
          {t("backup.warning")}
        </Text>
      </View>

      <Pressable
        style={styles.buttonSecondary}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t("backup.close")}
      >
        <Text style={styles.buttonSecondaryText}>{t("backup.close")}</Text>
      </Pressable>

      {/* FIX 2026-10-09 (K4): modal con clave copiable */}
      <Modal visible={dekModal !== null} transparent animationType="fade" onRequestClose={() => setDekModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.bg.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text.primary }]}>
              {dekModal?.dest ? t("backup.dekTitle") : t("backup.keyTitle")}
            </Text>
            <Text style={[styles.modalText, { color: colors.text.primary }]}>
              {dekModal?.dest ? `${t("backup.dekSavedIn")}\n${dekModal.dest}\n\n` : ""}
              {t("backup.dekCopyPrompt")}{"\n\n"}
            </Text>
            <Text selectable style={[styles.dekText, {"color": colors.text.primary}]}>{dekModal?.dek}</Text>
            <Text style={[styles.modalText, {"color": colors.text.primary}]}>
              {"\n"}{t("backup.dekWarning")}
            </Text>
            {/* FIX 2026-10-09: advertencia anti-fraude (ataques reales documentados:
                actores roban claves de backup con bots falsos de "soporte") */}
            <Text style={[styles.modalText, {"color": colors.crimson[500], "fontWeight": "bold"}]}>
              {"\n"}{t("backup.dekFraudWarning")}
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.button}
                onPress={() => {
                  if (dekModal) void Clipboard.setStringAsync(dekModal.dek);
                }}
                accessibilityRole="button"
                accessibilityLabel={t("backup.copyKey")}
              >
                <Text style={styles.buttonText}>{t("backup.copyKey")}</Text>
              </Pressable>
              <Pressable
                style={styles.buttonSecondary}
                onPress={() => setDekModal(null)}
                accessibilityRole="button"
                accessibilityLabel={t("backup.understood")}
              >
                <Text style={styles.buttonSecondaryText}>{t("backup.understood")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
