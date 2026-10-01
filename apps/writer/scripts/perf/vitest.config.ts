import { defineConfig } from "vitest/config";

// Opt-in only: never matched by the app's normal test or production build.
export default defineConfig({
  test: { include: ["scripts/perf/*.bench.ts"], testTimeout: 180_000, fileParallelism: false },
});
