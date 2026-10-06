import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // Mocks globales de módulos nativos (ver vitest.setup.mts): sin esto,
    // el import ES de primer nivel de expo-sqlite en secureDatabase.ts
    // rompe la carga de tests en Node (sintaxis Flow de react-native).
    setupFiles: ["./vitest.setup.mts"],
    // Eval RUNNERS (*.run.test.ts) perform real evaluations with side
    // effects (report files, console output) and are launched explicitly
    // via npm scripts (e.g. `npm run eval:local`), not as part of the
    // unit suite.
    // Component tests (*.component.test.tsx) run under Jest, not Vitest
    // (dual-runner architecture, 2026-10-05).
    exclude: [
      ...configDefaults.exclude,
      "**/*.run.test.ts",
      "**/*.component.test.{ts,tsx}",
    ],
  },
});
