import { defineConfig } from "vitest/config";

// Dedicated config for the blind-evaluation RUNNER (docs/BLIND_EVAL.md):
// launched explicitly via `npm run eval:blind`, never as part of
// `npm test` (which excludes *.run.test.ts by pattern).
export default defineConfig({
  test: {
    include: ["src/eval/blindRun.run.test.ts", "src/eval/blindRun2.run.test.ts"],
  },
});
