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
} from "react-native";
import { BackupKeyModal } from "./BackupKeyModal";
import { saveBackupToFolder } from "./backupShare";
import { backupErrorText } from "./backupErrorText";
import { useTranslation } from "react-i18next";
import { useTheme } from "./theme";
import { makeSurfaces } from "./theme/surfaces";
import * as Backup from "../security/backup";
import { unlockForSecret } from "../security/biometricGate";

export function BackupScreen({ onClose }: { onClose: () => void }) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  // FIX 2026-10-09 (K4/K5): DEK en modal copiable con biométrico, no en Alert.
  const [dekModal, setDekModal] = useState<{ dek: string; dest: string } | null>(null);

  // 0.1.29 (B-2): misma política en todas las puertas de la clave. Sin PIN
  // en el teléfono se avisa de forma visible ANTES de mostrarla.
  const revealKey = (dek: string, dest: string, noLock: boolean) => {
    if (!noLock) {
      setDekModal({ dek, dest });
      return;
    }
    Alert.alert(
      t("backup.noLockTitle"),
      t("backup.noLockBody"),
      [{ text: t("backup.understood"), onPress: () => setDekModal({ dek, dest }) }],
      { cancelable: false },
    );
  };

  const handleCreateBackup = async () => {
    setBusy(true);
    try {
      const { documentDirectory } = await import("expo-file-system/legacy");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dest = `${documentDirectory}nido-backup-${timestamp}.db`;
      await Backup.createBackup(dest);
      const key = await Backup.exportDatabaseKey();
      setLastBackup(dest);
      // K5/R2: desbloqueo antes de mostrar la clave. 0.1.29 (B-2): sin PIN
      // en el teléfono se avisa de forma visible y se muestra (negarle la
      // clave de un respaldo ya creado es peor); cancelar no la muestra.
      let noLock: boolean;
      try {
        noLock = (await unlockForSecret(t("backup.unlockReason"))) === "no-lock";
      } catch {
        Alert.alert(t("backup.cancelledTitle"), t("backup.keyNotShown"));
        return;
      }
      // K4: modal copiable en vez de Alert (el texto de Alert no se puede copiar).
      revealKey(key, dest, noLock);
    } catch (e) {
      Alert.alert(t("backup.errorTitle"), backupErrorText(e, t, "backup.createFailed"));
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
              await unlockForSecret(t("backup.rotateTitle"));
            } catch {
              return;
            }
            setBusy(true);
            try {
              const { rotateAllDatabaseKeys } = await import("../security/keyRotation");
              const SQLite = await import("expo-sqlite");
              const { applyDatabaseKey } = await import("../privacy/keyManager");

              // FIX 2026-10-09 (CR2-PATH, CR2-MULTIDB): no hardcodear el path.
              // rotateAllDatabaseKeys deriva las rutas canónicas de
              // MANAGED_DB_NAMES vía getCurrentDriver() y rota las 3 DBs
              // con el mismo DEK nuevo.
              // HW-VAULT: si la bóveda está activa, la DEK nueva se protege con
              // PIN/huella (dos diálogos: proteger y verificar).
              const { setRewrapPrompts } = await import("../security/keyVault");
              setRewrapPrompts({
                protect: { title: t("vault.promptTitle"), subtitle: t("vault.rewrapProtect") },
                verify: { title: t("vault.promptTitle"), subtitle: t("vault.rewrapVerify") },
              });
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
                  // HW-VAULT: por keyManager, que la envuelve si la bóveda está activa
                  // (escribir "nido_db_key" a mano dejaría la DEK en claro y el blob viejo).
                  const { storeDatabaseKeyHex } = await import("../privacy/keyManager");
                  await storeDatabaseKeyHex(dekHex);
                },
                undefined,
                t("backup.rotateTitle")
              );
              
              if (result.ok) {
                Alert.alert(
                  t("backup.rotatedTitle"),
                  t("backup.rotatedBody")
                );
              } else {
                Alert.alert(
                  t("backup.errorTitle"),
                  result.code ? t(`backup.rotateErrors.${result.code}`) : result.error ?? t("backup.rotateFailed")
                );
              }
            } catch (e) {
              Alert.alert(t("backup.errorTitle"), backupErrorText(e, t, "backup.rotateFailed"));
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
      // SAF: pedir al usuario que elija dónde guardar (Descargas). La
      // copia vive en backupShare.saveBackupToFolder (compartida con la
      // tarjeta de Ajustes desde 2026-10-12).
      const copied = await saveBackupToFolder(lastBackup);
      if (copied === null) {
        Alert.alert(t("backup.cancelledTitle"), t("backup.noPermission"));
        return;
      }
      Alert.alert(t("backup.savedTitle"), t("backup.savedBody", { files: copied.join("\n") }));
    } catch (e) {
      Alert.alert(t("backup.errorTitle"), backupErrorText(e, t, "backup.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleShowKey = async () => {
    setBusy(true);
    try {
      // FIX 2026-10-09 (H-3): desbloqueo para ver la DEK. 0.1.29 (B-2):
      // misma política que al crear el respaldo (antes aquí se bloqueaba
      // sin PIN y allí no).
      let noLock: boolean;
      try {
        noLock = (await unlockForSecret(t("backup.unlockReason"))) === "no-lock";
      } catch {
        Alert.alert(t("backup.cancelledTitle"), t("backup.keyNotShown"));
        return;
      }
      const key = await Backup.exportDatabaseKey();
      // La clave se muestra en el mismo modal copiable que al crear el
      // respaldo: el texto de un Alert no se puede copiar.
      revealKey(key, "", noLock);
    } catch (e) {
      Alert.alert(t("backup.errorTitle"), backupErrorText(e, t, "backup.keyFailed"));
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
  });

  return (
    <View style={{ flex: 1 }}>
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

    </ScrollView>
      {/* FIX 2026-10-09 (K4): modal con clave copiable. Desde 2026-10-12
          vive en BackupKeyModal, compartido con la tarjeta de Ajustes.
          0.1.29 (M-1): es una capa de la misma ventana, así que va en la
          raíz de la pantalla y no dentro del ScrollView. */}
      <BackupKeyModal
        dek={dekModal?.dek ?? null}
        dest={dekModal?.dest ?? ""}
        onClose={() => setDekModal(null)}
      />
    </View>
  );
}
