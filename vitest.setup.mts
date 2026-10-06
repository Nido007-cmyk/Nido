import { vi } from "vitest";

/**
 * vitest.setup.mts — mocks globales para módulos nativos.
 *
 * src/security/secureDatabase.ts usa import ES de primer nivel para
 * expo-sqlite y expo-file-system/legacy (fix 2026-10-06 del
 * "undefined is not a function" en openAndMigrate). En Node/vitest esos
 * módulos nativos no existen (expo-sqlite importa 'react-native', cuya
 * sintaxis Flow rompe el parser); sin mock, cualquier test que importe
 * secureDatabase (directa o transitivamente) falla al cargar.
 *
 * Estos mocks son benignos: los tests usan setSecureDbTestDriver() con
 * FakeDriver y nunca llaman prodDriver(), así que los valores mockeados
 * jamás se ejercitan. Los archivos de test con necesidades específicas
 * declaran su propio vi.mock (tiene precedencia sobre este global).
 */
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(),
  openDatabaseSync: vi.fn(),
  deleteDatabaseAsync: vi.fn(),
  deleteDatabaseSync: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: vi.fn(),
  deleteAsync: vi.fn(),
  moveAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
}));
