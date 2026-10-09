// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

// Jest configuration for React Native component/widget tests.
// Architecture decision (2026-10-05): Dual runner setup.
// - Vitest: existing unit tests for pure logic (unchanged)
// - Jest: NEW, exclusively for React Native component rendering tests
// Reason: Vitest/Vite cannot parse React Native's Flow-typed source.
// Jest with the react-native preset is the standard path for
// @testing-library/react-native.
// Scope: src/**/*.component.test.{ts,tsx} only. Never migrate unit tests.
module.exports = {
  preset: "@react-native/jest-preset",
  testEnvironment: "node",
  testMatch: ["**/*.component.test.{ts,tsx}"],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "babel-jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(react-native|@react-native|@testing-library)/)",
  ],
  setupFilesAfterEnv: ["@testing-library/react-native"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
};
