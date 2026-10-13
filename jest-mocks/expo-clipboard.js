// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.
//
// Stub de expo-clipboard para Jest: su build es ESM y Jest no lo transforma.
module.exports = {
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ""),
  hasStringAsync: jest.fn(async () => false),
  addClipboardListener: jest.fn(() => ({ remove: () => {} })),
};
