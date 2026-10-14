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
  moduleNameMapper: {
    // expo-sqlite es ESM puro; sin stub, cualquier pantalla que importe
    // secureDatabase (AboutScreen -> SkillsCard -> registry) revienta al
    // parsear. Mismo criterio que vitest.setup.mts.
    "^expo-sqlite$": "<rootDir>/jest-mocks/expo-sqlite.js",
    "^expo-file-system/legacy$": "<rootDir>/jest-mocks/expo-file-system-legacy.js",
    "^expo-notifications$": "<rootDir>/jest-mocks/expo-notifications.js",
    "^expo-sharing$": "<rootDir>/jest-mocks/expo-sharing.js",
    "^expo-local-authentication$": "<rootDir>/jest-mocks/expo-local-authentication.js",
    "^expo-clipboard$": "<rootDir>/jest-mocks/expo-clipboard.js",
    "^expo-modules-core(/.*)?$": "<rootDir>/jest-mocks/expo-modules-core.js",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  // 0.1.38: la primera prueba de un archivo carga y transforma en frío toda
  // la pantalla (AboutScreen arrastra medio árbol de la app); en el runner
  // de CI eso pasó de los 5 s por defecto sin que nada fallara de verdad.
  testTimeout: 30000,
};
