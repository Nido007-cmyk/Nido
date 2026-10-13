// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Stub de expo-sqlite para Jest (equivalente al mock global de
// vitest.setup.mts): el paquete real es ESM y Jest no lo transforma;
// los tests de componentes nunca ejercitan estos valores.
module.exports = {
  openDatabaseAsync: jest.fn(),
  openDatabaseSync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
  deleteDatabaseSync: jest.fn(),
};
