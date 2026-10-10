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
import * as Backup from "../security/backup";
import { requireUnlock, BiometricUnavailable } from "../security/biometricGate";

export function BackupScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
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
        await requireUnlock("Ver tu clave de respaldo");
      } catch (e) {
        // A11 (auditoría 2026-10-10): decidir por el tipo de error, no por
        // el texto del mensaje (cambiar la redacción cambiaba el comportamiento).
        const isUnavailable = e instanceof BiometricUnavailable;
        if (!isUnavailable) {
          // Usuario canceló: no mostrar.
          Alert.alert("Cancelado", "No se mostró la clave.");
          return;
        }
        // Sin biométrico: advertir y continuar bajo consentimiento.
        // (El usuario ya creó el backup; negarle la clave es peor.)
      }
      // K4: modal copiable en vez de Alert (el texto de Alert no se puede copiar).
      setDekModal({ dek: key, dest });
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo crear el backup.");
    } finally {
      setBusy(false);
    }
  };

  // FIX 2026-10-09 (CR-2): rotación de DEK (F-KEY-1) con UI.
  const handleRotateKey = async () => {
    Alert.alert(
      "Rotar clave de cifrado",
      "Esto generará una nueva clave y re-cifrará tu base de datos. " +
      "Los backups anteriores NO se podrán restaurar con la clave nueva. " +
      "¿Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Rotar",
          style: "destructive",
          onPress: async () => {
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
                  "Clave rotada",
                  "Tu base de datos ahora usa una nueva clave de cifrado. " +
                  "Guarda la nueva clave desde 'Ver mi clave de cifrado'. " +
                  "Los backups viejos necesitarán la clave anterior."
                );
              } else {
                Alert.alert("Error", result.error ?? "No se pudo rotar la clave.");
              }
            } catch (e) {
              Alert.alert("Error", e instanceof Error ? e.message : "No se pudo rotar la clave.");
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
      Alert.alert("Sin backup", "Primero crea un backup con el botón de arriba.");
      return;
    }
    setBusy(true);
    try {
      const FS = await import("expo-file-system/legacy");
      // SAF: pedir al usuario que elija dónde guardar (Descargas).
      const perms = await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perms.granted) {
        Alert.alert("Cancelado", "Sin permiso no se puede guardar.");
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
      Alert.alert("Guardado", `Backup copiado a Descargas:\n${copied.join("\n")}`);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const handleShowKey = async () => {
    setBusy(true);
    try {
      // FIX 2026-10-09 (H-3): biométrico obligatorio para ver la DEK.
      try {
        await requireUnlock("Ver clave de cifrado");
      } catch {
        Alert.alert("Cancelado", "No se mostró la clave.");
        return;
      }
      const key = await Backup.exportDatabaseKey();
      Alert.alert(
        "Tu clave de cifrado",
        `Cópiala y guárdala en un lugar seguro, separada del backup:\n\n${key}`,
        [{ text: "OK" }]
      );
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo obtener la clave.");
    } finally {
      setBusy(false);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.surface, padding: 20 },
    title: { fontSize: 22, fontWeight: "700", color: colors.text.primary, marginBottom: 8 },
    desc: { fontSize: 14, color: colors.text.secondary, marginBottom: 20, lineHeight: 20 },
    button: {
      backgroundColor: "#4A6B4F",
      borderRadius: 10,
      padding: 16,
      alignItems: "center",
      marginBottom: 12,
    },
    buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: colors.border?.default ?? "#ccc",
      borderRadius: 10,
      padding: 16,
      alignItems: "center",
      marginBottom: 12,
    },
    buttonSecondaryText: { color: colors.text.primary, fontWeight: "600", fontSize: 16 },
    warning: {
      backgroundColor: "#FFF3CD",
      borderRadius: 8,
      padding: 12,
      marginTop: 16,
    },
    warningText: { fontSize: 13, color: "#856404", lineHeight: 18 },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    modalBox: { borderRadius: 12, padding: 20, width: "100%", maxWidth: 400 },
    modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
    modalText: { fontSize: 14, lineHeight: 20 },
    dekText: { fontSize: 13, fontFamily: "monospace", lineHeight: 18 },
    modalButtons: { flexDirection: "row", gap: 12, marginTop: 16 },
  });

  return (
    <ScrollView style={styles.container}>
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
          <ActivityIndicator color="#fff" />
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
            <Text style={[styles.modalTitle, { color: colors.text.primary }]}>{t("backup.dekTitle")}</Text>
            <Text style={[styles.modalText, { color: colors.text.primary }]}>
              {t("backup.dekSavedIn")}{"\n"}{dekModal?.dest}{"\n\n"}
              {t("backup.dekCopyPrompt")}{"\n\n"}
            </Text>
            <Text selectable style={[styles.dekText, {"color": colors.text.primary}]}>{dekModal?.dek}</Text>
            <Text style={[styles.modalText, {"color": colors.text.primary}]}>
              {"\n"}{t("backup.dekWarning")}
            </Text>
            {/* FIX 2026-10-09: advertencia anti-fraude (ataques reales documentados:
                actores roban claves de backup con bots falsos de "soporte") */}
            <Text style={[styles.modalText, {"color": "#ff6b6b", "fontWeight": "bold"}]}>
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
