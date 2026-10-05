import { defineConfig } from "vitest/config";

// Dedicated config for eval RUNNERS (*.run.test.ts): real evaluations
// with side effects (report files, console output). Launched explicitly
// via `npm run eval:local`, never as part of `npm test`.
export default defineConfig({
  test: {
    include: ["src/eval/localRetrieval.run.test.ts"],
  },
});
