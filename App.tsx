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

const modelManager = new ModelManager();

type Screen = "checking" | "wipe-recovering" | "wipe-blocked" | "key-loss" | "locked" | "required-setup" | "chat";

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

  /** Arranque normal: rutinas, modelos y gate biométrico. */
  const finishStartup = async () => {
    initHaptics();
    // Rutinas proactivas locales: notificaciones, vencidos, resumen diario.
    runStartupRoutines();
    const ready = await modelManager.requiredModelsPresent();
    setModelsReady(ready);
    setScreen("locked"); // el gate biométrico va antes de mostrar datos
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

  // Background → bloquear; foreground → volver al gate si se estaba en chat.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") {
        lockNow();
      } else if (s === "active" && screenRef.current === "chat") {
        setScreen("locked");
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
            {t("wipeRecovery.recovering")}
          </Text>
        </View>
      )}
      {/* R13: la recuperación falló: fail closed, reintentar o reinstalar. */}
      {screen === "wipe-blocked" && (
        <View style={styles.centered}>
          <Text style={[styles.lockTitle, { color: colors.text.primary }]}>
            {t("wipeRecovery.blockedTitle")}
          </Text>
          <Text style={[styles.lockSubtitle, { color: colors.text.secondary }]}>
            {t("wipeRecovery.blockedBody")}
          </Text>
          {wipeError && (
            <Text style={[styles.lockWarning, { color: colors.crimson[400] }]}>{wipeError}</Text>
          )}
          <Pressable
            onPress={runStartupGate}
            style={[styles.lockButton, { backgroundColor: colors.emerald[500] }]}
          >
            <Text style={styles.lockButtonText}>{t("wipeRecovery.retry")}</Text>
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
        <ModelSetupScreen mode="required" onReady={() => setScreen("chat")} />
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
