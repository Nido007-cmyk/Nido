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
import { useTheme } from "./theme";
import * as Backup from "../security/backup";

export function BackupScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  const handleCreateBackup = async () => {
    setBusy(true);
    try {
      const { documentDirectory } = await import("expo-file-system/legacy");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dest = `${documentDirectory}nido-backup-${timestamp}.db`;
      await Backup.createBackup(dest);
      const key = await Backup.exportDatabaseKey();
      setLastBackup(dest);
      Alert.alert(
        "Backup creado",
        `Guardado en:\n${dest}\n\nTU CLAVE (cópiala y guárdala separada del backup):\n\n${key}\n\nSin esta clave el backup es inútil.`,
        [{ text: "Entendido" }]
      );
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo crear el backup.");
    } finally {
      setBusy(false);
    }
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
      const fileName = lastBackup.split("/").pop() ?? "nido-backup.db";
      const destUri = await FS.StorageAccessFramework.createFileAsync(
        perms.directoryUri,
        fileName,
        "application/octet-stream"
      );
      const content = await FS.readAsStringAsync(lastBackup, {
        encoding: FS.EncodingType.Base64,
      });
      await FS.writeAsStringAsync(destUri, content, {
        encoding: FS.EncodingType.Base64,
      });
      Alert.alert("Guardado", `Backup copiado a Descargas como:\n${fileName}`);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const handleShowKey = async () => {
    setBusy(true);
    try {
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
  });

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Backup & Recovery</Text>
      <Text style={styles.desc}>
        Tu base de datos está cifrada. El backup copia el archivo cifrado. Necesitas
        guardar tu clave por separado — sin ella, el backup no se puede restaurar.
        Ningún servidor ve tus datos en ningún momento.
      </Text>

      <Pressable style={styles.button} onPress={handleCreateBackup} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Crear backup ahora</Text>
        )}
      </Pressable>

      <Pressable style={styles.buttonSecondary} onPress={handleShowKey} disabled={busy}>
        <Text style={styles.buttonSecondaryText}>Ver mi clave de cifrado</Text>
      </Pressable>

      {/* FIX 2026-10-09: guardar directo en Descargas vía SAF. */}
      <Pressable
        style={[styles.buttonSecondary, !lastBackup && { opacity: 0.5 }]}
        onPress={handleSaveToDownloads}
        disabled={busy || !lastBackup}
      >
        <Text style={styles.buttonSecondaryText}>Guardar en Descargas</Text>
      </Pressable>

      {lastBackup && (
        <Text style={styles.desc}>Último backup: {lastBackup}</Text>
      )}

      <View style={styles.warning}>
        <Text style={styles.warningText}>
          Importante: guarda el archivo de backup y tu clave en lugares diferentes.
          Si pierdes la clave, nadie (ni NIDO) puede recuperar tus datos.
        </Text>
      </View>

      <Pressable style={styles.buttonSecondary} onPress={onClose}>
        <Text style={styles.buttonSecondaryText}>Cerrar</Text>
      </Pressable>
    </ScrollView>
  );
}
