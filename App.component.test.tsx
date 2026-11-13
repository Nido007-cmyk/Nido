/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Integración de App entera del lector de guías como documentos
// (verificación 2026-11-08 de la pieza «las guías se abren como
// documentos»): las pruebas de GuideLibraryScreen cubren la pantalla
// suelta; estas cubren el FLUJO REAL de App.tsx: arranque sin modelo →
// gate → wizard (required-setup) → entrada «Leer las guías» → biblioteca
// sembrada → lector con el texto completo → vuelta exacta a la pantalla
// madre → re-bloqueo sin que la capa tape el gate ni reaparezca sola.
// Los motores van mockeados y espiados a nivel de App: durante todo el
// flujo, cero llamadas a llamaEngine.load y embeddingEngine.load, y
// ChatScreen (sustituido por un marcador) jamás se monta en esta ruta.
import React from "react";
import { AppState, ScrollView } from "react-native";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import App from "./App";
import i18n from "./src/i18n";
import en from "./src/i18n/locales/en.json";
import es from "./src/i18n/locales/es.json";
import pt from "./src/i18n/locales/pt.json";

const LOCALES = { en, es, pt } as const;

const LONG_BODY = [
  "INICIO-DEL-DOCUMENTO: comprueba la respuesta de la persona.",
  "Paso intermedio uno: abre la vía aérea y observa el pecho.",
  "Paso intermedio dos: comprime fuerte y rápido en el centro del pecho.",
  "Paso intermedio tres: alterna compresiones y respiraciones de rescate.",
  "FIN-DEL-DOCUMENTO: sigue hasta que llegue ayuda o la persona reaccione.",
].join("\n\n");

const mockState = {
  modelsReady: false,
  ensureUnlockedImpl: (async () => {}) as () => Promise<void>,
  packs: [{ id: "pack-1", label: "Pack Semilla", format: "sqlite-pack" }] as Array<Record<string, unknown>>,
  guidesByPack: {
    "pack-1": [
      { id: 1, key: "guia-larga", lang: "es", title: "Guía larga de prueba", category: "primeros-auxilios", region: "", sources: "IFRC 2025", verified: "2026-11-07" },
      { id: 2, key: "guia-corta", lang: "es", title: "Guía corta de prueba", category: "primeros-auxilios", region: "", sources: "IFRC 2025", verified: "2026-11-07" },
    ],
  } as Record<string, Array<Record<string, unknown>>>,
  docs: {
    "pack-1:1": { title: "Guía larga de prueba", source: "NIDO — Guía larga de prueba", body: LONG_BODY },
    "pack-1:2": { title: "Guía corta de prueba", source: "NIDO — Guía corta de prueba", body: "Texto breve." },
  } as Record<string, Record<string, unknown> | null>,
};

const mockLlamaLoad = jest.fn();
const mockEmbeddingLoad = jest.fn();
const mockLockNow = jest.fn();
const mockInstallBundled = jest.fn(async () => {});

jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default
);
jest.mock("./src/ui/ChatScreen", () => {
  const ReactLocal = require("react");
  const { Text: TextLocal, Pressable: PressableLocal } = require("react-native");
  const enLocal = require("./src/i18n/locales/en.json");
  return {
    // 0.1.86: el doble ejerce el contrato de la prop nueva: pinta el
    // botón de entrada al lector con la clave guideLibrary.open cuando
    // App le pasa onOpenLibrary, como el ChatScreen real hace dentro
    // de Ajustes > Biblioteca (CorpusSettingsTab). Sin la prop, el
    // marcador es el de siempre y el botón no existe.
    ChatScreen: ({ onOpenLibrary }: { onOpenLibrary?: () => void }) =>
      ReactLocal.createElement(
        ReactLocal.Fragment,
        null,
        ReactLocal.createElement(TextLocal, null, "CHAT-MARKER"),
        onOpenLibrary
          ? ReactLocal.createElement(
              PressableLocal,
              { onPress: onOpenLibrary, accessibilityRole: "button", accessibilityLabel: enLocal.guideLibrary.open },
              ReactLocal.createElement(TextLocal, null, enLocal.guideLibrary.open)
            )
          : null
      ),
  };
});
jest.mock("./src/ui/ModelSetupScreen", () => {
  const ReactLocal = require("react");
  const { Text: TextLocal } = require("react-native");
  return { ModelSetupScreen: () => ReactLocal.createElement(TextLocal, null, "WIZARD-MARKER") };
});
// El importador de packs firmados entra en el grafo real del wizard
// (ModelSetupScreen → ImportedPacksSection → packImporter) y arrastra
// expo-document-picker, cuyo build publicado es ESM y jest no lo
// transforma: sin este mock, cargar App entera revienta con «Cannot
// use import statement outside a module». La superficie del
// importador tiene su propia prueba de componentes; aquí solo se
// neutraliza su carga.
jest.mock("./src/services/packImporter", () => ({
  listImportedPacks: async () => [],
  importPackFromFile: async () => ({ status: "cancelled" }),
  removeImportedPack: async () => {},
}));
// documentImporter (App lo importa al nivel del módulo) arrastra el
// MISMO paquete ESM por su línea 7: se neutraliza el paquete entero.
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: async () => ({ canceled: true, assets: [] }),
}));
// El wizard real (dentro del ModelSetupScreen real) importa
// expo-keep-awake, otro paquete con main en TypeScript sin compilar.
jest.mock("expo-keep-awake", () => ({
  activateKeepAwake: async () => {},
  deactivateKeepAwake: async () => {},
  useKeepAwake: () => {},
}));
// La familia expo de esta versión publica sus entradas en ESM o en
// TypeScript sin compilar y jest no transforma node_modules (salvo la
// lista corta de jest.config.js): cargar App entera con el wizard real
// arrastra varios de esos paquetes (notificaciones vía tareas
// programadas, compartir vía respaldo, voz, cripto, degradados).
// Ninguna prueba de este flujo ejercita esas superficies: se
// neutraliza la carga de cada paquete, como la casa ya hace en
// jest-mocks/ para expo-sqlite y compañía.
jest.mock("expo", () => ({ isRunningInExpoGo: () => true }));
jest.mock("expo-crypto", () => ({
  digestStringAsync: async () => "",
  CryptoDigestAlgorithm: { SHA256: "SHA-256", SHA512: "SHA-512" },
  getRandomBytesAsync: async (n: number) => new Uint8Array(n),
  randomUUID: () => "00000000-0000-0000-0000-000000000000",
}));
jest.mock("expo-speech", () => ({
  speak: () => {},
  stop: async () => {},
  isSpeakingAsync: async () => false,
}));
jest.mock("expo-linear-gradient", () => {
  const ReactLocal = require("react");
  const { View: ViewLocal } = require("react-native");
  return {
    LinearGradient: ({ children }: { children?: React.ReactNode }) =>
      ReactLocal.createElement(ViewLocal, null, children),
  };
});
// El módulo nativo de RCP entra por la pantalla de emergencia, que el
// chat real monta: su índice es TypeScript sin compilar y su puente
// nativo no existe en jest. Doble con la misma forma que usa la
// prueba propia de CprPractice.
jest.mock("nido-cpr", () => ({
  hasCprCamera: () => false,
  startBeepingAt: () => 0,
  startBeeping: () => false,
  stopBeeping: () => {},
  startCprCamera: async () => () => {},
}));
// Los assets empaquetados entran por ModelManager (App lo importa al
// nivel del módulo): otro índice TypeScript local sin compilar.
jest.mock("bundled-assets", () => ({
  listBundledAssets: async () => [],
  copyBundledAssetToFile: async () => 0,
}));
// El almacén seguro se pide por require perezoso dentro de keyManager
// (con su propio try/catch), pero en jest el paquete ESM revienta al
// PARSEAR, antes de que el catch pueda actuar: se neutraliza también.
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
// El transporte Bluetooth se pide por require perezoso con su propio
// try/catch (nativeTransport, batteryHint): mismo problema de parseo
// con el índice TypeScript del módulo local.
jest.mock("nido-p2p", () => ({}));
// Calendario y contactos se piden por import diferido dentro de los
// handlers de herramientas del agente (con try/catch en un caso, sin
// él en otros): ambos paquetes publican entradas sin compilar o ESM.
jest.mock("expo-calendar", () => ({
  getCalendarPermissions: async () => ({ status: "granted", canAskAgain: false }),
  requestCalendarPermissions: async () => ({ status: "granted", canAskAgain: false }),
  getCalendars: async () => [],
}));
jest.mock("expo-contacts", () => ({
  getContactsAsync: async () => ({ data: [] }),
  getPermissionsAsync: async () => ({ status: "granted", canAskAgain: false }),
  requestPermissionsAsync: async () => ({ status: "granted", canAskAgain: false }),
}));
// La raíz de expo-file-system (API nueva, clase File) se pide por
// import diferido dentro de un handler de herramientas; su entrada es
// TypeScript sin compilar. El submódulo /legacy ya tiene su stub en
// jest-mocks/ vía moduleNameMapper: este mock es solo para la raíz.
jest.mock("expo-file-system", () => ({
  File: class {
    async arrayBuffer() {
      return new ArrayBuffer(0);
    }
  },
  Paths: { cache: { uri: "file:///cache/" }, document: { uri: "file:///docs/" } },
}));
// El índice vectorial pide los vectores nativos por require perezoso
// con try/catch (vectorIndex.nativeVectors): el índice TypeScript del
// módulo local revienta al parsear antes del catch.
jest.mock("nido-vectors", () => ({ default: null }));
jest.mock("./src/ui/KeyLossRecoveryScreen", () => ({ KeyLossRecoveryScreen: () => null }));
jest.mock("./src/ui/dev/CharacterPreviewScreen", () => ({ CharacterPreviewScreen: () => null }));
jest.mock("./src/models/ModelManager", () => ({
  ModelManager: class {
    requiredModelsPresent = async () => mockState.modelsReady;
    installBundled = (...args: unknown[]) => mockInstallBundled(...args);
  },
}));
jest.mock("./src/models/manifestTrust", () => ({
  verifyCatalogSignature: () => {},
  ManifestTrustError: class ManifestTrustError extends Error {},
}));
jest.mock("./src/models/settings", () => ({
  deviceDefaultLanguage: () => "en",
  getLanguageId: async () => "en",
  setLanguageId: async () => {},
  // 0.1.95: la pestaña de Emergencia del asistente y el modelo de búsqueda activo.
  getEmergencyRegion: async () => null,
  setEmergencyRegion: async () => {},
  getActiveModelId: async () => null,
  setActiveModelId: async () => {},
}));
jest.mock("./src/config/featureFlags", () => ({ loadFeatureFlags: async () => {} }));
jest.mock("./src/routines/startup", () => ({ runStartupRoutines: () => {} }));
jest.mock("./src/services/appReset", () => ({
  wipeInterrupted: async () => false,
  recoverInterruptedWipe: async () => {},
}));
jest.mock("./src/security/screenCapture", () => ({ initScreenCapture: async () => {} }));
jest.mock("./src/services/documentImporter", () => ({ sweepOrphanedCollectionExports: async () => {} }));
jest.mock("./src/services/haptics", () => ({
  initHaptics: () => {},
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));
jest.mock("./src/privacy/keyManager", () => ({
  getDatabaseKeyHex: async () => "ab".repeat(32),
  isDatabaseKeyUnlocked: () => true,
  storeDatabaseKeyHex: async () => {},
  applyDatabaseKey: async () => {},
  KeyLossError: class KeyLossError extends Error {
    code = "NIDO_KEY_LOST";
    constructor(_deps?: unknown, message?: string) {
      super(message ?? "key lost");
    }
  },
}));
jest.mock("./src/security/biometricGate", () => ({
  ensureUnlocked: () => mockState.ensureUnlockedImpl(),
  // Cierre, no captura directa: la factoría se ejecuta durante la
  // cadena de imports inicial, antes de que la constante mockLockNow
  // se inicialice, y una captura por valor dejaba lockNow en
  // undefined (ensureUnlocked, que ya era un cierre, sí funcionaba).
  lockNow: () => mockLockNow(),
  markUnlockedNow: () => {},
  BiometricCancelled: class BiometricCancelled extends Error {},
  BiometricUnavailable: class BiometricUnavailable extends Error {},
}));
jest.mock("./src/security/keyVault", () => ({
  isVaultActive: async () => false,
  getStrictLockSeconds: async () => null,
  lockAndTerminate: async () => {},
  unlockVault: async () => {},
}));
jest.mock("./src/i18n/LanguageContext", () => {
  const ReactLocal = require("react");
  return {
    LanguageProvider: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement(ReactLocal.Fragment, null, children),
    useLanguage: () => ({ languageId: "en", setLanguage: async () => {} }),
    LANGUAGES: [],
  };
});
jest.mock("./src/ui/theme", () => {
  const ReactLocal = require("react");
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement(ReactLocal.Fragment, null, children),
    useTheme: () => ({
      colors: {
        bg: { black: "#000", cardElevated: "#111", terminal: "#000" },
        text: { heading: "#fff", primary: "#eee", secondary: "#bbb", dim: "#888", inverse: "#000" },
        border: { default: "#333" },
        emerald: { 400: "#0f0", 500: "#0c0", 600: "#0a0", bgSubtle: "#021" },
        amber: { 400: "#fa0" },
        crimson: { 400: "#f00" },
      },
      typography: { ui: { title: {}, body: {}, caption: {} } },
    }),
  };
});
jest.mock("./src/ui/theme/calm", () => ({
  calmSpacing: { tight: 4, cozy: 8, comfortable: 16, generous: 48 },
  calmRadii: { soft: 12 },
}));
jest.mock("./src/ui/components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("./src/rag/packs", () => ({
  knowledgePacks: async () => mockState.packs,
  listPackGuides: async (packId: string) => mockState.guidesByPack[packId] ?? [],
  readPackGuide: async (packId: string, guideId: number) => mockState.docs[`${packId}:${guideId}`] ?? null,
  loadAllPackFacts: async () => ({ regions: [], facts: [], outdatedPacks: [] }),
  closeAllPacks: async () => {},
  prepareVectorIndexes: async () => {},
}));
// Cierres por la misma razón que lockNow arriba: una captura directa
// de mockLlamaLoad/mockEmbeddingLoad quedaría en undefined.
jest.mock("./src/inference/LlamaEngine", () => ({
  llamaEngine: { load: (...args: unknown[]) => mockLlamaLoad(...args) },
}));
jest.mock("./src/rag/embed", () => ({
  embeddingEngine: { load: (...args: unknown[]) => mockEmbeddingLoad(...args) },
}));

let appStateHandlers: Array<(s: string) => void> = [];

function fireAppState(state: string) {
  // Se disparan TODOS los handlers registrados: el de App.tsx y los de
  // cualquier pantalla montada en el árbol real (p. ej. ExactAlarmCard,
  // dentro del ModelSetupScreen real, se suscribe en su propio efecto).
  // Es lo que el sistema operativo hace en el dispositivo.
  for (const h of [...appStateHandlers]) h(state);
}

async function renderApp(lang: "en" | "es" | "pt" = "en") {
  await i18n.changeLanguage(lang);
  await render(<App />);
}

async function renderAppToWizard(lang: "en" | "es" | "pt" = "en") {
  await renderApp(lang);
  // El arranque termina en el gate (desbloqueo mockeado: pasa) y sin
  // modelo el destino es el wizard de instalación requerida.
  expect(await screen.findByText("WIZARD-MARKER", {}, { timeout: 8000 })).toBeTruthy();
}

function expectNoEngines() {
  expect(mockLlamaLoad).not.toHaveBeenCalled();
  expect(mockEmbeddingLoad).not.toHaveBeenCalled();
}

describe("App · lector de guías sin modelo (integración)", () => {
  let appStateSpy: jest.SpyInstance;

  beforeEach(() => {
    mockState.modelsReady = false;
    mockState.ensureUnlockedImpl = async () => {};
    mockLlamaLoad.mockClear();
    mockEmbeddingLoad.mockClear();
    mockLockNow.mockClear();
    appStateHandlers = [];
    appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(((type: string, cb: (s: string) => void) => {
      if (type === "change") appStateHandlers.push(cb);
      return { remove: () => {} };
    }) as never);
  });

  afterEach(() => {
    appStateSpy.mockRestore();
    // Blindaje: una promesa de desbloqueo que nunca resuelve no puede
    // colgar el arranque de las pruebas siguientes.
    mockState.ensureUnlockedImpl = async () => {};
    mockState.modelsReady = false;
  });

  it("sin modelo, la entrada «Leer las guías» está visible en el wizard y abre la biblioteca", async () => {
    await renderAppToWizard();
    const entry = screen.getByLabelText(en.guideLibrary.open);
    expect(entry).toBeTruthy();
    expect(screen.getByText(en.guideLibrary.open)).toBeTruthy();
    expect(screen.queryByText("CHAT-MARKER")).toBeNull();

    fireEvent.press(entry);
    expect(await screen.findByText(en.guideLibrary.title)).toBeTruthy();
    expect(screen.getByText(en.guideLibrary.intro)).toBeTruthy();
    expect(screen.getByText("Pack Semilla")).toBeTruthy();
    expect(screen.getByText("Guía larga de prueba")).toBeTruthy();
    expect(screen.getByText("Guía corta de prueba")).toBeTruthy();
    // Mientras la biblioteca está abierta, la entrada del wizard no se duplica.
    expect(screen.queryByLabelText(en.guideLibrary.open)).toBeNull();
    expect(screen.queryByText("CHAT-MARKER")).toBeNull();
    expectNoEngines();
  });

  it("el lector muestra el texto COMPLETO de la guía, dentro de un ScrollView, y volver regresa a la lista", async () => {
    await renderAppToWizard();
    fireEvent.press(screen.getByLabelText(en.guideLibrary.open));
    fireEvent.press(await screen.findByText("Guía larga de prueba"));

    const first = await screen.findByText(/INICIO-DEL-DOCUMENTO/);
    expect(first).toBeTruthy();
    expect(screen.getByText(/FIN-DEL-DOCUMENTO/)).toBeTruthy();
    // El documento vive dentro de un ScrollView: el texto largo se
    // desplaza y la cabecera (con el botón de volver) queda fuera.
    // El árbol de RNTL 14 (test-renderer) solo expone nodos host, así
    // que el ScrollView compuesto se reconoce subiendo por la cadena
    // de fibras (unstable_fiber.return) del nodo del texto hasta dar
    // con una cuyo elementType sea el ScrollView de react-native.
    let fiber: { elementType?: unknown; return?: unknown } | null =
      (first as { unstable_fiber?: { elementType?: unknown; return?: unknown } }).unstable_fiber ?? null;
    let insideScroll = false;
    while (fiber) {
      if (fiber.elementType === ScrollView) insideScroll = true;
      fiber = (fiber.return as { elementType?: unknown; return?: unknown } | null) ?? null;
    }
    expect(insideScroll).toBe(true);
    const expectedSource = en.sourceReader.source.replace("{{source}}", "NIDO — Guía larga de prueba");
    expect(screen.getByText(expectedSource)).toBeTruthy();

    fireEvent.press(screen.getByLabelText(en.guideLibrary.back));
    expect(await screen.findByText("Guía corta de prueba")).toBeTruthy();
    expectNoEngines();
  });

  it("cerrar la biblioteca vuelve a la pantalla madre exacta (el wizard)", async () => {
    await renderAppToWizard();
    fireEvent.press(screen.getByLabelText(en.guideLibrary.open));
    await screen.findByText("Guía larga de prueba");
    fireEvent.press(screen.getByLabelText(en.common.done));
    expect(await screen.findByText("WIZARD-MARKER")).toBeTruthy();
    expect(screen.getByLabelText(en.guideLibrary.open)).toBeTruthy();
    expect(screen.queryByText(en.guideLibrary.intro)).toBeNull();
    expectNoEngines();
  });

  it("al re-bloquear, la capa no tapa el gate ni reaparece sola tras desbloquear", async () => {
    await renderAppToWizard();
    fireEvent.press(screen.getByLabelText(en.guideLibrary.open));
    await screen.findByText("Guía larga de prueba");

    // El siguiente desbloqueo queda pendiente (la biometría del
    // sistema está en pantalla): el gate debe quedar visible, sin la
    // biblioteca pintada por encima. El resolver se captura para
    // simular después la biometría aceptada, como ocurre en el
    // dispositivo: el desbloqueo automático de LockScreen completa y
    // la app vuelve a su pantalla sin que nadie toque un botón.
    let resolveGate: (() => void) | null = null;
    mockState.ensureUnlockedImpl = () =>
      new Promise<void>((res) => { resolveGate = res; });
    expect(appStateHandlers.length).toBeGreaterThan(0);
    // act asíncrono esperado, como hace la prueba de CprPractice con
    // su propio listener de AppState: con act síncrono la actualización
    // de pantalla que dispara el handler quedaba sin vaciar en este
    // renderer y la prueba leía el árbol anterior al re-bloqueo.
    await act(async () => { fireAppState("background"); await Promise.resolve(); });
    await act(async () => { fireAppState("active"); await Promise.resolve(); });

    expect(await screen.findByText(en.lockScreen.title)).toBeTruthy();
    expect(mockLockNow).toHaveBeenCalled();
    expect(screen.queryByText(en.guideLibrary.title)).toBeNull();
    expect(screen.queryByText("Guía larga de prueba")).toBeNull();
    expect(screen.queryByText("WIZARD-MARKER")).toBeNull();

    // Al desbloquear de nuevo se vuelve al wizard, con la biblioteca
    // CERRADA: la capa no puede reaparecer sin que el usuario la abra.
    expect(resolveGate).not.toBeNull();
    await act(async () => {
      resolveGate!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("WIZARD-MARKER", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByText(en.guideLibrary.intro)).toBeNull();
    expect(screen.getByLabelText(en.guideLibrary.open)).toBeTruthy();
    expectNoEngines();
  });

  it("con modelos listos, el desbloqueo va al chat como siempre (flujo intacto)", async () => {
    mockState.modelsReady = true;
    await renderApp();
    expect(await screen.findByText("CHAT-MARKER", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByText("WIZARD-MARKER")).toBeNull();
  });

  it("0.1.86: con la app ya configurada, la entrada desde el chat abre el lector con los packs, y cerrar vuelve al chat", async () => {
    mockState.modelsReady = true;
    await renderApp();
    expect(await screen.findByText("CHAT-MARKER", {}, { timeout: 8000 })).toBeTruthy();
    // La entrada en uso normal: App pasa onOpenLibrary a ChatScreen
    // (el real la reenvía a Ajustes > Biblioteca, CorpusSettingsTab).
    const entry = screen.getByLabelText(en.guideLibrary.open);
    fireEvent.press(entry);
    expect(await screen.findByText(en.guideLibrary.title)).toBeTruthy();
    expect(screen.getByText(en.guideLibrary.intro)).toBeTruthy();
    expect(screen.getByText("Pack Semilla")).toBeTruthy();
    expect(screen.getByText("Guía larga de prueba")).toBeTruthy();
    // Cerrar vuelve a la pantalla madre: el chat, con su entrada.
    fireEvent.press(screen.getByLabelText(en.common.done));
    expect(await screen.findByText("CHAT-MARKER")).toBeTruthy();
    expect(screen.getByLabelText(en.guideLibrary.open)).toBeTruthy();
    expect(screen.queryByText(en.guideLibrary.intro)).toBeNull();
    expectNoEngines();
  });

  it("0.1.86: con la app ya configurada, al re-bloquear la capa del lector desaparece y no reaparece sola", async () => {
    mockState.modelsReady = true;
    await renderApp();
    expect(await screen.findByText("CHAT-MARKER", {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.press(screen.getByLabelText(en.guideLibrary.open));
    await screen.findByText("Guía larga de prueba");

    let resolveGate: (() => void) | null = null;
    mockState.ensureUnlockedImpl = () =>
      new Promise<void>((res) => { resolveGate = res; });
    await act(async () => { fireAppState("background"); await Promise.resolve(); });
    await act(async () => { fireAppState("active"); await Promise.resolve(); });

    expect(await screen.findByText(en.lockScreen.title)).toBeTruthy();
    expect(mockLockNow).toHaveBeenCalled();
    expect(screen.queryByText(en.guideLibrary.title)).toBeNull();
    expect(screen.queryByText("Guía larga de prueba")).toBeNull();

    expect(resolveGate).not.toBeNull();
    await act(async () => {
      resolveGate!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("CHAT-MARKER", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByText(en.guideLibrary.intro)).toBeNull();
    expect(screen.getByLabelText(en.guideLibrary.open)).toBeTruthy();
    expectNoEngines();
  });

  for (const lang of ["es", "en", "pt"] as const) {
    it(`en ${lang.toUpperCase()}, la entrada y los títulos de la biblioteca usan sus cadenas propias`, async () => {
      const loc = LOCALES[lang];
      await renderAppToWizard(lang);
      expect(screen.getByText(loc.guideLibrary.open)).toBeTruthy();
      expect(screen.queryByText("guideLibrary.open")).toBeNull();
      fireEvent.press(screen.getByLabelText(loc.guideLibrary.open));
      expect(await screen.findByText(loc.guideLibrary.title)).toBeTruthy();
      expect(screen.getByText(loc.guideLibrary.intro)).toBeTruthy();
      expect(screen.queryByText("guideLibrary.title")).toBeNull();
      expect(screen.queryByText("guideLibrary.intro")).toBeNull();
      expectNoEngines();
    });
  }
});

// 0.1.95: Emergencia antes del modelo. En el asistente de instalación, la
// pestaña de Emergencia se abre como capa propia (no monta ChatScreen ni
// carga motores) y el arranque instala desde el APK los packs con los
// números y las guías.
describe("App · Emergencia sin modelo (0.1.95)", () => {
  let appStateSpy: jest.SpyInstance;

  beforeEach(() => {
    mockState.modelsReady = false;
    mockState.ensureUnlockedImpl = async () => {};
    mockLlamaLoad.mockClear();
    mockEmbeddingLoad.mockClear();
    mockInstallBundled.mockClear();
    appStateHandlers = [];
    appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(((type: string, cb: (s: string) => void) => {
      if (type === "change") appStateHandlers.push(cb);
      return { remove: () => {} };
    }) as never);
  });

  afterEach(() => {
    appStateSpy.mockRestore();
  });

  it("el arranque instala desde el APK los dos packs de primer arranque, de la carpeta packs/", async () => {
    await renderAppToWizard();
    const ids = mockInstallBundled.mock.calls.map((c) => (c[0] as { id: string }).id);
    // Instalación nueva en inglés: la variante bge, la misma que elegirá el asistente.
    expect(ids).toEqual(["nido-esencial", "nido-local"]);
    for (const c of mockInstallBundled.mock.calls) expect(c[1]).toBe("packs");
  });

  it("sin modelo, la entrada de Emergencia abre la pestaña sin chat ni motores, y cerrar vuelve al asistente", async () => {
    await renderAppToWizard();
    fireEvent.press(screen.getByTestId("setup-open-emergency"));
    expect(await screen.findByText(en.emergency.disclaimer)).toBeTruthy();
    // Sin chat todavía: la caja «describe lo que pasa» no aparece.
    expect(screen.queryByTestId("emergency-describe-card")).toBeNull();
    expect(screen.queryByText("CHAT-MARKER")).toBeNull();
    expectNoEngines();
    fireEvent.press(screen.getByTestId("setup-close-emergency"));
    expect(await screen.findByTestId("setup-open-emergency")).toBeTruthy();
    expect(screen.queryByText(en.emergency.disclaimer)).toBeNull();
  });

  it("instalación nueva en español: la variante multilingüe, no una copia que nadie pidió", async () => {
    await renderAppToWizard("es");
    const ids = mockInstallBundled.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(ids).toEqual(["nido-esencial-e5", "nido-local-e5"]);
  });

  it("con modelos listos, el chat no cambia: no hay entrada del asistente", async () => {
    mockState.modelsReady = true;
    await renderApp();
    expect(await screen.findByText("CHAT-MARKER", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId("setup-open-emergency")).toBeNull();
  });
});

