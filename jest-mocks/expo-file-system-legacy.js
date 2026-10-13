// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Stub de expo-file-system/legacy para Jest (equivalente al mock global
// de vitest.setup.mts): su entrada legacy es TypeScript/ESM sin
// transformar y Jest no la puede parsear.
module.exports = {
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  deleteAsync: jest.fn(),
  moveAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(async () => ""),
  readDirectoryAsync: jest.fn(async () => []),
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(async () => ({ granted: false })),
    createFileAsync: jest.fn(),
  },
};
