// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Stub de expo-sharing para Jest: su build es ESM y Jest no lo transforma.
module.exports = {
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
};
