/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Test de componente de ModelSetupScreen (0.1.112): la pantalla de
// modelos no tenía test de componente y el cable del interruptor de
// NPU solo estaba probado por lectura (verificación de la 0.1.111,
// bloque UI-GUÍA). Aquí se prueba lo que la orden del dueño manda:
// - El texto de la GPU automática (settings.gpuAccelTitle/Desc) está
//   SIEMPRE en la sección de modelos: la GPU no tiene interruptor,
//   pero ya no es invisible.
// - El interruptor de NPU (settings.npuAccelTitle) SOLO aparece
//   cuando la sonda del motor detecta el chip (probeNpuDevice), y
//   nace apagado: es la visibilidad condicionada de la puerta.
// La maquinaria pesada (motor, descargas, pestañas hijas) va
// sustituida; lo que se renderiza de verdad es la pantalla, su
// sección de modelos y el acordeón real.
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

// La sonda de NPU que el motor «detecta» en cada prueba: null = el
// teléfono no trae chip que la puerta reconozca.
let mockNpuDevice: string | null = null;

// La carga residente que el motor declara en cada prueba (tanda
// too-heavy): null = ningún modelo cargado en el motor, aunque el
// ajuste marque uno como activo.
let mockResidentInfo: { filename: string; nCtx: number; memoryProfile?: string } | null = null;

jest.mock("./theme", () => {
  const { daylightTheme } = require("./theme/colors");
  const { getTypography } = require("./theme/typography");
  return {
    useTheme: () => ({
      themeId: "daylight",
      fontScale: "standard",
      colors: daylightTheme,
      typography: getTypography("standard"),
      setTheme: async () => {},
      setFontScale: async () => {},
    }),
  };
});

// La `t` ha de ser ESTABLE entre renders: la pantalla memoriza
// efectos sobre ella (refreshStatus) y una `t` nueva en cada render
// los vuelve a disparar en bucle (la real de i18next es estable).
const stableT = (key: string) => key;
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: "es" },
  }),
}));

jest.mock("../services/haptics", () => ({
  impact: jest.fn(),
  notification: jest.fn(),
  setHapticsEnabledCache: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    probeNpuDevice: jest.fn(async () => mockNpuDevice),
    getModelInfo: () => mockResidentInfo,
    benchLoadedModel: async () => null,
  },
  BenchUnavailableError: class BenchUnavailableError extends Error {},
  BenchTimeoutError: class BenchTimeoutError extends Error {},
}));

jest.mock("../models/ModelManager", () => ({
  ModelManager: class {
    statusAll = async () => [];
  },
}));

jest.mock("../models/settings", () => ({
  getActiveModelId: async () => null,
  setActiveModelId: async () => {},
  getHapticsEnabled: async () => true,
  setHapticsEnabled: async () => {},
  getScreenCaptureAllowed: async () => false,
}));

jest.mock("../models/defaultModel", () => ({
  defaultLlmForDevice: () => ({ id: "qwen3-0.6b-q4km" }),
}));

jest.mock("../models/installState", () => ({
  getInstallRecord: async () => null,
}));

jest.mock("../models/installNotice", () => ({
  installNoticeFor: () => null,
}));

jest.mock("../services/downloadManager", () => ({
  startDownload: async () => {},
  discardPartialDownload: async () => {},
  getDownloadState: () => null,
  isDownloading: () => false,
  subscribeDownloads: () => () => {},
}));

jest.mock("../services/appReset", () => ({
  resetAllAppData: async () => {},
}));

jest.mock("../rag/seedCorpus", () => ({
  seedKnowledgeBaseIfEmpty: async () => {},
}));

jest.mock("../rag/packs", () => ({
  closePack: async () => {},
  prepareVectorIndexes: async () => {},
}));

jest.mock("../rag/vectorIndex", () => ({
  deletePackIndexes: async () => {},
}));

jest.mock("../security/secureDatabase", () => ({
  DbLifecycleEndedError: class extends Error {},
}));

jest.mock("../config/featureFlags", () => ({
  isFeatureEnabled: () => false,
  loadFeatureFlags: async () => {},
  setFeatureEnabled: async () => {},
}));

jest.mock("./useSecureScreen", () => ({
  useSecureScreen: () => {},
}));

// Las piezas hijas con maquinaria propia van sustituidas por un
// marcador vacío: lo que se prueba es la sección de modelos de
// esta pantalla, no las pestañas.
const nullChild = (name: string) => ({
  [name]: () => null,
});
jest.mock("./CatalogItemCard", () => ({
  CatalogItemCard: () => null,
}));
jest.mock("./CorpusSettingsTab", () => nullChild("CorpusSettingsTab"));
jest.mock("./PersonalitySettings", () => nullChild("PersonalitySettings"));
jest.mock("./UsageStatsContent", () => nullChild("UsageStatsContent"));
jest.mock("./VoiceSettings", () => nullChild("VoiceSettings"));
jest.mock("./MemorySettings", () => nullChild("MemorySettings"));
jest.mock("./SetupWizardScreen", () => nullChild("SetupWizardScreen"));
jest.mock("./BackupScreen", () => nullChild("BackupScreen"));
jest.mock("./HardwareProtectionCard", () => nullChild("HardwareProtectionCard"));
jest.mock("./ExactAlarmCard", () => nullChild("ExactAlarmCard"));
jest.mock("./DailySummaryCard", () => nullChild("DailySummaryCard"));
jest.mock("./SecurityStatusCard", () => nullChild("SecurityStatusCard"));
jest.mock("./NetworkAuditCard", () => nullChild("NetworkAuditCard"));
jest.mock("./AgentPermissionsCard", () => nullChild("AgentPermissionsCard"));
jest.mock("./SkillsCard", () => nullChild("SkillsCard"));
jest.mock("./ScheduledTasksCard", () => nullChild("ScheduledTasksCard"));
jest.mock("./CrashReportCard", () => nullChild("CrashReportCard"));
jest.mock("./BackupKeyModal", () => nullChild("BackupKeyModal"));
jest.mock("./Toast", () => nullChild("Toast"));
jest.mock("./components/ThemeSelector", () => nullChild("ThemeSelector"));
jest.mock("./components/LanguageSelector", () => nullChild("LanguageSelector"));
jest.mock("./components/calm/NidoMascot", () => nullChild("NidoMascot"));
jest.mock("./components/icons/NidoIcon", () => ({
  NidoIcon: () => null,
  isIconName: () => true,
}));
jest.mock("./components/PrivateTextInput", () => {
  const { TextInput } = require("react-native");
  return { PrivateTextInput: TextInput };
});

async function renderModelsSection() {
  const { ModelSetupScreen } = require("./ModelSetupScreen");
  await render(<ModelSetupScreen mode="optional" onClose={() => {}} />);
  // La sección de modelos nace cerrada (acordeón real): se abre
  // tocando su cabecera, como hace la persona en la app.
  await fireEvent.press(screen.getByLabelText("modelSetupScreen.sections.models"));
}

describe("ModelSetupScreen · aceleración en la UI (0.1.112)", () => {
  beforeEach(() => {
    mockNpuDevice = null;
    mockResidentInfo = null;
  });

  it("el texto de la GPU automática está siempre en la sección de modelos", async () => {
    await renderModelsSection();
    expect(screen.getByText("settings.gpuAccelTitle")).toBeTruthy();
    expect(screen.getByText("settings.gpuAccelDesc")).toBeTruthy();
  });

  it("sin chip detectado, el interruptor de NPU ni se pinta", async () => {
    await renderModelsSection();
    expect(screen.queryByText("settings.npuAccelTitle")).toBeNull();
    expect(screen.queryByLabelText("settings.npuAccelTitle")).toBeNull();
    // Y la GPU automática sigue explicada: no depende del chip.
    expect(screen.getByText("settings.gpuAccelDesc")).toBeTruthy();
  });

  it("con chip detectado, el interruptor de NPU aparece y nace apagado", async () => {
    mockNpuDevice = "HTP0";
    await renderModelsSection();
    expect(await screen.findByText("settings.npuAccelTitle")).toBeTruthy();
    expect(screen.getByText("settings.npuAccelDesc")).toBeTruthy();
    const toggle = screen.getByLabelText("settings.npuAccelTitle");
    expect(toggle.props.value ?? toggle.props.accessibilityState?.checked ?? false).toBe(false);
    // La explicación de la GPU convive con la del NPU.
    expect(screen.getByText("settings.gpuAccelDesc")).toBeTruthy();
  });
});

describe("ModelSetupScreen · medir velocidad (tanda too-heavy, 0.1.115)", () => {
  beforeEach(() => {
    mockResidentInfo = null;
  });

  it("sin modelo residente, medir nace deshabilitado y la nota «sin modelo» se pinta sin pulsar", async () => {
    // La foto del dueño: la sección decía «No model is loaded yet»
    // con el botón activo; lo pulsó y la medición se quedó en
    // «Measuring…». Pulsar y esperar para aprender lo que la
    // pantalla ya sabía es el defecto: sin residente, la nota se
    // pinta antes y el botón no corre.
    await renderModelsSection();
    expect(screen.getByText("modelSetupScreen.benchNoModel")).toBeTruthy();
    const btn = screen.getByLabelText("modelSetupScreen.benchRun");
    expect(btn.props.disabled ?? btn.props.accessibilityState?.disabled).toBe(true);
  });

  it("con modelo residente, el botón nace habilitado y sin la nota previa", async () => {
    mockResidentInfo = { filename: "qwen3-0.6b-q4_k_m.gguf", nCtx: 2048, memoryProfile: "default" };
    await renderModelsSection();
    const btn = screen.getByLabelText("modelSetupScreen.benchRun");
    expect(btn.props.disabled ?? btn.props.accessibilityState?.disabled ?? false).toBe(false);
    expect(screen.queryByText("modelSetupScreen.benchNoModel")).toBeNull();
  });
});
