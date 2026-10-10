/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { AppState, StyleSheet, ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import "./src/i18n";
import { LanguageProvider } from "./src/i18n/LanguageContext";
import { ChatScreen } from "./src/ui/ChatScreen";
import { ModelSetupScreen } from "./src/ui/ModelSetupScreen";
// DEV-ONLY: V42 idle character PoC (Phase 1, Option D). Removable: delete
// src/ui/dev/ + assets/poc/ and the __DEV__ block below.
import { CharacterPreviewScreen } from "./src/ui/dev/CharacterPreviewScreen";
import { ModelManager } from "./src/models/ModelManager";
import {
  verifyCatalogSignature,
  ManifestTrustError,
} from "./src/models/manifestTrust";
import { MODEL_CATALOG } from "./src/models/manifest";
import { MANIFEST_SIGNATURE_BASE64 } from "./src/models/manifestSignature";
import { ThemeProvider, useTheme } from "./src/ui/theme";
import { initHaptics } from "./src/services/haptics";
import { runStartupRoutines } from "./src/routines/startup";
import { wipeInterrupted, recoverInterruptedWipe } from "./src/services/appReset";
import { getDatabaseKeyHex, KeyLossError } from "./src/privacy/keyManager";
import { KeyLossRecoveryScreen } from "./src/ui/KeyLossRecoveryScreen";
import { routeStartupError } from "./src/ui/keyLossRecovery";
import {
  BiometricCancelled,
  BiometricUnavailable,
  ensureUnlocked,
  lockNow,
} from "./src/security/biometricGate";
import { isPermissionFlowActive } from "./src/p2p/permissionGuard";

const modelManager = new ModelManager();

/**
 * C1-2026-10-06: ventana de gracia para "inactive" transitorio del sistema
 * (diálogos de permiso, llamadas entrantes, PiP...). Si la app vuelve a
 * "active" dentro de este plazo, no se re-bloquea. "background" real
 * siempre bloquea de inmediato.
 */
const TRANSIENT_INACTIVE_GRACE_MS = 3_000;

type Screen = "checking" | "wipe-recovering" | "wipe-blocked" | "startup-error" | "key-loss" | "locked" | "required-setup" | "chat";

/**
 * Pantalla de bloqueo: gate biométrico/PIN del sistema antes de mostrar
 * cualquier dato sensible. Es capa UX: el cifrado en reposo (SQLCipher +
 * Keystore) no depende de ella. Si el dispositivo no tiene nada enrolado,
 * se avisa de forma explícita y el usuario decide continuar (nunca bypass
 * silencioso).
 */
function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noGate, setNoGate] = useState(false);

  const tryUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureUnlocked(t("lockScreen.subtitle"));
      onUnlocked();
    } catch (e) {
      if (e instanceof BiometricUnavailable) {
        setNoGate(true); // degradado explícito: el usuario decide
      } else if (e instanceof BiometricCancelled) {
        setError(t("lockScreen.cancelled"));
      } else {
        setError(t("lockScreen.failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    tryUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.centered}>
      <Text style={[styles.lockTitle, { color: colors.text.primary }]}>{t("lockScreen.title")}</Text>
      <Text style={[styles.lockSubtitle, { color: colors.text.secondary }]}>
        {t("lockScreen.subtitle")}
      </Text>
      {noGate && (
        <Text style={[styles.lockWarning, { color: colors.amber[400] }]}>{t("lockScreen.noGate")}</Text>
      )}
      {error && !noGate && (
        <Text style={[styles.lockWarning, { color: colors.crimson[400] }]}>{error}</Text>
      )}
      <Pressable
        onPress={noGate ? onUnlocked : tryUnlock}
        disabled={busy}
        style={[styles.lockButton, { backgroundColor: colors.emerald[500] }, busy && { opacity: 0.6 }]}
      >
        <Text style={styles.lockButtonText}>
          {busy
            ? t("lockScreen.unlocking")
            : noGate
              ? t("lockScreen.continueWithoutGate")
              : error
                ? t("lockScreen.retry")
                : t("lockScreen.unlock")}
        </Text>
      </Pressable>
    </View>
  );
}

function AppContent() {
  const [screen, setScreen] = useState<Screen>("checking");
  const [modelsReady, setModelsReady] = useState(false);
  // R13: si la recuperación de un wipe interrumpido falla, la app no entra
  // en estado normal: se muestra el error y la opción de reintentar.
  const [wipeError, setWipeError] = useState<string | null>(null);
  // N4-RECOVERY-UI: el Keystore perdido/degradado debe emerger como la
  // pantalla honesta de recovery — nunca un crash genérico, un fallback
  // silencioso ni un falso first-run. La resolución de la DEK ya se intenta
  // de forma perezosa al arrancar (runStartupRoutines); esta comprobación
  // solo enruta el error tipado a la pantalla explícita.
  const [keyLossError, setKeyLossError] = useState<KeyLossError | null>(null);
  // DEV-ONLY PoC flag. Always false in release builds (__DEV__ gate below);
  // production home/chat flow is untouched.
  const [devPreview, setDevPreview] = useState(false);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const screenRef = useRef(screen);
  screenRef.current = screen;
  // C1-2026-10-06: timestamp del último "inactive" para la ventana de gracia
  // de overlays transitorios del sistema.
  const lastInactiveAtRef = useRef(0);

  /** Arranque normal: rutinas, modelos y gate biométrico. */
  const finishStartup = async () => {
    initHaptics();
    // Rutinas proactivas locales: notificaciones, vencidos, resumen diario.
    runStartupRoutines();
    try {
      // Meta #2 (update integrity): el catálogo de descargas debe estar
      // firmado por la clave de manifiestos de NIDO antes de confiar en sus
      // URLs/pins. Fail-closed con mensaje claro — nunca crash silencioso.
      verifyCatalogSignature(MODEL_CATALOG, MANIFEST_SIGNATURE_BASE64);
      const ready = await modelManager.requiredModelsPresent();
      setModelsReady(ready);
      setScreen("locked"); // el gate biométrico va antes de mostrar datos
    } catch (e) {
      // GAP-1 fix: si requiredModelsPresent() lanza (error de filesystem),
      // no quedarse en spinner infinito — mostrar error honesto con retry.
      // ManifestTrustError cae aquí también: mensaje claro, sin bypass.
      setWipeError(e instanceof Error ? e.message : String(e));
      setScreen("startup-error");
    }
  };

  /**
   * R13: un Clear All Data interrumpido (Android mató el proceso a mitad)
   * debe reanudarse y verificarse ANTES de que cualquier rutina toque las
   * bases, los modelos o la UI normal. Si la recuperación falla, fail
   * closed: no se entra al estado normal con restos a medias.
   */
  const runWipeRecovery = async () => {
    setWipeError(null);
    setScreen("wipe-recovering");
    try {
      await recoverInterruptedWipe();
    } catch (e) {
      setWipeError(e instanceof Error ? e.message : String(e));
      setScreen("wipe-blocked");
      return;
    }
    if (await enterKeyLossIfNeeded()) return;
    // FIX 2026-10-09 (CR-2): verificar si hay un staging de rekey pendiente
    // de un crash anterior. Si el rekey se interrumpió, completar la
    // recuperación antes de abrir la DB.
    try {
      const { checkStaleRekeyStaging } = await import("./src/security/keyRotation");
      const FS = await import("expo-file-system/legacy");
      const stagingPath = `${FS.documentDirectory}rekey-staging.json`;
      const { default: SecureStore } = await import("expo-secure-store");
      const SQLite = await import("expo-sqlite");
      const { applyDatabaseKey } = await import("./src/privacy/keyManager");
      const result = await checkStaleRekeyStaging(
        stagingPath,
        async (dekHex: string) => {
          await SecureStore.setItemAsync("nido_db_key", dekHex);
        },
        async (path: string, dekHex: string) => {
          const slash = path.lastIndexOf("/");
          const db = await SQLite.openDatabaseAsync(
            path.slice(slash + 1),
            { useNewConnection: true },
            path.slice(0, slash)
          );
          await applyDatabaseKey(db as any, dekHex, "rekey-recovery");
          return {
            exec: async (sql: string) => { await (db as any).execAsync(sql); },
            close: async () => { await (db as any).closeAsync(); },
          };
        }
      );
      if (result.recovered) {
        console.log("[startup] Rekey interrumpido recuperado.");
      }
    } catch (e) {
      // Si la recuperación falla, no bloquear el arranque — el usuario puede
      // rotar manualmente desde BackupScreen. Log para diagnóstico.
      console.warn("[startup] checkStaleRekeyStaging falló:", e instanceof Error ? e.message : e);
    }
    await finishStartup();
  };

  const runStartupGate = async () => {
    // R13 fail-closed: si el marcador de wipe no se puede ni comprobar, no
    // se entra a la UI normal. El reintento vuelve a comprobar primero: un
    // error de lectura nunca debe disparar un borrado completo a ciegas.
    setWipeError(null);
    setScreen("checking");
    try {
      if (await wipeInterrupted()) {
        await runWipeRecovery();
        return;
      }
    } catch (e) {
      setWipeError(e instanceof Error ? e.message : String(e));
      setScreen("wipe-blocked");
      return;
    }
    if (await enterKeyLossIfNeeded()) return;
    await finishStartup();
  };

  /**
   * N4-RECOVERY-UI: detectar la pérdida de clave ANTES de entrar a la UI
   * normal. Un KeyLossError significa "bases cifradas presentes, DEK
   * ausente": la app no puede funcionar y no debe fingir un first-run.
   * Devuelve true si enrutó a la pantalla honesta de recovery.
   */
  const enterKeyLossIfNeeded = async (): Promise<boolean> => {
    setKeyLossError(null);
    try {
      await getDatabaseKeyHex();
    } catch (e) {
      if (routeStartupError(e) === "key-loss") {
        setKeyLossError(e as KeyLossError);
        setScreen("key-loss");
        return true;
      }
      // Cualquier otro error de clave conserva el comportamiento previo:
      // emergerá de forma natural donde la base se use por primera vez.
    }
    return false;
  };

  useEffect(() => {
    runStartupGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background → bloquear; foreground → volver al gate si se estaba en chat o setup.
  // GAP-2 fix: background durante required-setup también re-bloquea (antes solo chat).
  // T-permiso-2026-10-06: un diálogo de permiso del sistema (p. ej.
  // Bluetooth) pausa la Activity ("inactive") sin que el usuario haya
  // salido de la app. No re-bloquear mientras ese flujo está activo.
  // C1-2026-10-06: generalizar a CUALQUIER "inactive" transitorio (no solo
  // permisos): otros overlays del sistema (llamadas, PiP, etc.) también
  // producen "inactive" breve. Si la app vuelve a "active" dentro de la
  // ventana de gracia, no se bloquea. "background" real siempre bloquea.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (isPermissionFlowActive()) return;
      if (s === "background") {
        lockNow();
        lastInactiveAtRef.current = 0;
      } else if (s === "inactive") {
        // Posible overlay transitorio: registrar el momento, decidir al volver.
        lastInactiveAtRef.current = Date.now();
      } else if (s === "active") {
        const inactiveAt = lastInactiveAtRef.current;
        lastInactiveAtRef.current = 0;
        // Si venimos de un "inactive" breve, fue un overlay transitorio del
        // sistema: no re-bloquear ni resetear la navegación.
        if (inactiveAt && Date.now() - inactiveAt < TRANSIENT_INACTIVE_GRACE_MS) {
          return;
        }
        lockNow();
        if (screenRef.current === "chat" || screenRef.current === "required-setup") {
          setScreen("locked");
        }
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg.terminal }]} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      {screen === "checking" && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.emerald[400]} size="large" />
        </View>
      )}
      {/* R13: reanudando un Clear All Data interrumpido (antes de todo lo demás). */}
      {screen === "wipe-recovering" && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.emerald[400]} size="large" />
          <Text style={[styles.lockSubtitle, { color: colors.text.secondary }]}>
            {t("modelSetupScreen.wipeRecovery.recovering")}
          </Text>
        </View>
      )}
      {/* R13: la recuperación falló: fail closed, reintentar o reinstalar. */}
      {screen === "wipe-blocked" && (
        <View style={styles.centered}>
          <Text style={[styles.lockTitle, { color: colors.text.primary }]}>
            {t("modelSetupScreen.wipeRecovery.blockedTitle")}
          </Text>
          <Text style={[styles.lockSubtitle, { color: colors.text.secondary }]}>
            {t("modelSetupScreen.wipeRecovery.blockedBody")}
          </Text>
          {wipeError && (
            <Text style={[styles.lockWarning, { color: colors.crimson[400] }]}>{wipeError}</Text>
          )}
          <Pressable
            onPress={runStartupGate}
            style={[styles.lockButton, { backgroundColor: colors.emerald[500] }]}
          >
            <Text style={styles.lockButtonText}>{t("modelSetupScreen.wipeRecovery.retry")}</Text>
          </Pressable>
        </View>
      )}
      {/* GAP-1: error honesto si la comprobación de modelos falla (filesystem).
          Nunca spinner infinito sin salida. */}
      {screen === "startup-error" && (
        <View style={styles.centered}>
          <Text style={[styles.lockTitle, { color: colors.text.primary }]}>
            {t("modelSetupScreen.startupError.title")}
          </Text>
          <Text style={[styles.lockSubtitle, { color: colors.text.secondary }]}>
            {t("modelSetupScreen.startupError.body")}
          </Text>
          {wipeError && (
            <Text style={[styles.lockWarning, { color: colors.crimson[400] }]}>{wipeError}</Text>
          )}
          <Pressable
            onPress={runStartupGate}
            style={[styles.lockButton, { backgroundColor: colors.emerald[500] }]}
          >
            <Text style={styles.lockButtonText}>{t("modelSetupScreen.startupError.retry")}</Text>
          </Pressable>
        </View>
      )}
      {screen === "locked" && (
        <LockScreen onUnlocked={() => setScreen(modelsReady ? "chat" : "required-setup")} />
      )}
      {/* N4-RECOVERY-UI: Keystore perdido/degradado con bases cifradas
          presentes: pantalla honesta de recovery, nunca un error genérico. */}
      {screen === "key-loss" && keyLossError && (
        <KeyLossRecoveryScreen
          error={keyLossError}
          onRecoveryComplete={runStartupGate}
          onRetryCheck={runStartupGate}
        />
      )}
      {screen === "required-setup" && (
        <ModelSetupScreen
          mode="required"
          onReady={() => setScreen("chat")}
          onKeyLossError={(e) => {
            // N4: el indexado del wizard detectó pérdida de clave — la misma
            // pantalla honesta de recuperación que usa el gate de arranque.
            // Tras recuperar, runStartupGate reintenta y vuelve al wizard.
            setKeyLossError(e);
            setScreen("key-loss");
          }}
        />
      )}
      {screen === "chat" && !devPreview && (
        <ChatScreen onRelaunchWizard={() => setScreen("required-setup")} />
      )}
      {/* DEV-ONLY: V42 idle character PoC entry. Not rendered in release
          builds. Remove together with src/ui/dev/ + assets/poc/. */}
      {__DEV__ && !devPreview && screen === "chat" && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setDevPreview(true)}
          style={styles.devPocButton}
        >
          <Text style={styles.devPocButtonText}>DEV · Character PoC</Text>
        </Pressable>
      )}
      {__DEV__ && devPreview && (
        <CharacterPreviewScreen onClose={() => setDevPreview(false)} />
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // DEV-ONLY PoC entry button. Remove with the PoC.
  devPocButton: {
    position: "absolute",
    right: 12,
    bottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  devPocButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  lockTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  lockSubtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
  },
  lockWarning: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 16,
  },
  lockButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  lockButtonText: {
    color: "#06110c",
    fontSize: 16,
    fontWeight: "700",
  },
});
