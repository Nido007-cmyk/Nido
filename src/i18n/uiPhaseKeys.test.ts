/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * uiPhaseKeys.test.ts — FASE 2 (cierre UI).
 *
 * Verifica que las claves i18n agregadas en UI-FASE-1/2/4 existan en los
 * tres locales (ES/EN/PT) y no estén vacías:
 * - Recuperación de revocaciones (nido.*)
 * - Lectura en voz alta (voiceSettings.*)
 * - Backup/restore (backup.*)
 * - Placeholder de propuesta (negotiations.*)
 */

import { describe, it, expect } from "vitest";
import es from "./locales/es.json";
import en from "./locales/en.json";
import pt from "./locales/pt.json";

function get(obj: any, path: string): unknown {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

const REQUIRED_KEYS = [
  // UI-FASE-1: recuperación de revocaciones
  "nido.revocationStoreCorruptTitle",
  "nido.revocationStoreCorruptBody",
  "nido.revocationRecoveryTitle",
  "nido.revocationRecoveryMessage",
  "nido.revocationRecoveryConfirm",
  "nido.revocationRecovering",
  "nido.revocationRecoveryDone",
  "nido.revocationRecoveryFailed",
  // UI-FASE-2: TTS
  "voiceSettings.readAloudLabel",
  "voiceSettings.readAloudValue",
  // UI-FASE-4: backup/restore
  "backup.createButton",
  "backup.shareButton",
  "backup.restoreButton",
  "backup.errorTitle",
  "backup.shareFailed",
  "backup.sharingUnavailable",
  "backup.noBackupsTitle",
  "backup.noBackupsBody",
  "backup.createFailed",
  "backup.invalidTitle",
  "backup.invalidBody",
  "backup.restoreTitle",
  "backup.restoreConfirm",
  "backup.restoreConfirmButton",
  "backup.restoreDoneTitle",
  "backup.restoreDoneBody",
  "backup.restoreFailed",
  "backup.pickerFailed",
  "backup.cancel",
  "backup.ok",
  "backup.sectionDesc",
  "backup.screenTitle",
  "backup.screenDesc",
  "backup.createNow",
  "backup.showKey",
  "backup.rotateKey",
  "backup.saveToDownloads",
  "backup.close",
  "backup.lastBackup",
  "backup.warning",
  // UI-FASE-4: negociaciones
  "negotiations.proposePlaceholder",
];

describe("UI phase i18n keys", () => {
  for (const lang of [
    ["es", es],
    ["en", en],
    ["pt", pt],
  ] as const) {
    describe(lang[0], () => {
      for (const key of REQUIRED_KEYS) {
        it(key, () => {
          const v = get(lang[1], key);
          expect(typeof v, `${lang[0]}.${key}`).toBe("string");
          expect((v as string).length, `${lang[0]}.${key} non-empty`).toBeGreaterThan(0);
        });
      }
    });
  }
});
