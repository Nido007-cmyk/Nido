/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.55 — nueva interfaz, fase 2: Ajustes agrupado y con buscador. Nada se
 * pierde: cada tarjeta que salió de «Acerca de» está ahora en Ajustes, y
 * cada sección vieja sigue en Ajustes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SETTINGS = readFileSync(new URL("./ModelSetupScreen.tsx", import.meta.url), "utf8");
const ABOUT = readFileSync(new URL("./AboutScreen.tsx", import.meta.url), "utf8");
const CHAT = readFileSync(new URL("./ChatScreen.tsx", import.meta.url), "utf8");

describe("Ajustes por grupos (0.1.55)", () => {
  it("las tarjetas que estaban en Acerca de viven ahora en Ajustes, una sola vez", () => {
    for (const card of ["SecurityStatusCard", "NetworkAuditCard", "CrashReportCard", "SkillsCard", "ScheduledTasksCard", "AgentPermissionsCard"]) {
      expect(SETTINGS).toContain(`<${card} />`);
      expect(ABOUT).not.toContain(`<${card} />`);
    }
  });

  it("Acerca de conserva el respaldo y las licencias", () => {
    expect(ABOUT).toContain("aboutScreen.backupOpen");
    expect(ABOUT).toContain("aboutScreen.licensesOpen");
  });

  it("cada sección de antes sigue en Ajustes", () => {
    for (const piece of [
      "<HardwareProtectionCard />",
      "settings.sealedHelloTitle",
      "settings.ratchetV5Title",
      "panic.settingTitle",
      "guide.helpButton",
      "<PersonalitySettings />",
      "<CatalogItemCard",
      "<CorpusSettingsTab",
      "<MemorySettings />",
      "<ExactAlarmCard />",
      "<UsageStatsContent />",
      "settings.delegationTitle",
      "<ThemeSelector />",
      "interfaceSettings.hapticFeedbackLabel",
      "<LanguageSelector />",
      "<VoiceSettings />",
      "modelSetupScreen.recovery.wizardButton",
      "modelSetupScreen.recovery.dangerButton",
      "backup.createButton",
      "backup.shareButton",
      "backup.saveToDownloads",
      "backup.restoreButton",
      "backup.restoreWithKeyButton",
    ]) {
      expect(SETTINGS).toContain(piece);
    }
  });

  it("nueve grupos con título y buscador", () => {
    for (const g of ["security", "assistant", "models", "memory", "appearance", "backup", "diagnostics", "help", "danger"]) {
      expect(SETTINGS).toContain(`settingsGroups.${g}`);
    }
    expect(SETTINGS).toContain("settingsSearch.placeholder");
    expect(SETTINGS).toContain("settingsSearch.empty");
  });

  it("desde Ajustes se abren Mi memoria, la telemetría, Acerca de y la clave del respaldo", () => {
    expect(SETTINGS).toContain("settingsMore.openMemory");
    expect(SETTINGS).toContain("settingsMore.openTelemetry");
    expect(SETTINGS).toContain("settingsMore.openAbout");
    expect(SETTINGS).toContain("<BackupScreen");
    expect(CHAT).toContain("onOpenMemory={() => setShowMemoryManager(true)}");
    expect(CHAT).toContain("onOpenTelemetry={() => setShowExecutionTelemetry(true)}");
    expect(CHAT).toContain("onOpenAbout={() => setShowAbout(true)}");
    // Las pantallas que se abren desde Ajustes van antes que Ajustes (vuelven a Ajustes al cerrar).
    expect(CHAT.indexOf("if (showMemoryManager)")).toBeLessThan(CHAT.indexOf("  if (showSettings) {"));
    expect(CHAT.indexOf("if (showAbout)")).toBeLessThan(CHAT.indexOf("  if (showSettings) {"));
    expect(CHAT.indexOf("if (showExecutionTelemetry)")).toBeLessThan(CHAT.indexOf("  if (showSettings) {"));
  });

  it("la Biblioteca muestra los paquetes con la misma lógica que Ajustes", () => {
    const LIB = readFileSync(new URL("./LibraryScreen.tsx", import.meta.url), "utf8");
    expect(LIB).toContain('<ModelSetupScreen mode="optional" section="knowledge"');
    expect(SETTINGS).toContain('section === "knowledge"');
  });

  it("la respuesta de números de emergencia trae botones para llamar", () => {
    expect(CHAT).toContain("factsHit?.calls");
    expect(CHAT).toContain("Linking.openURL(c.tel)");
  });

  it("tono e investigación están junto al cuadro de texto", () => {
    expect(CHAT).toContain("chatScreen.toneChip");
    expect(CHAT).toContain("chatScreen.researchChip");
    expect(CHAT).toContain("setDeepResearchMode(next)");
  });
});

describe("auditoría 0.1.55: orden de las respuestas fijas de seguridad", () => {
  it("monóxido primero; números: pack verificado antes que la tabla fija", () => {
    const i = (s: string) => CHAT.indexOf(s);
    expect(i("const coHit")).toBeGreaterThan(-1);
    expect(i("let numberHit")).toBeGreaterThan(-1);
    expect(i("await answerFromPackFacts(query, uiLang)")).toBeLessThan(i("let numberHit"));
    // 0.1.57: the "no lo adivino" text is redone with the packs' countries, still no number.
    expect(i("let numberHit")).toBeLessThan(i("unknownCountryText(uiLang, numberHit.countryUnknown.asked, names)"));
    expect(CHAT).toContain('safetyHit.kind === "emergency-number" && factsHit === null');
    expect(CHAT).toContain("smallTalkHit?.text ?? factsHit?.text ?? numberHit?.text ?? null");
  });
});
