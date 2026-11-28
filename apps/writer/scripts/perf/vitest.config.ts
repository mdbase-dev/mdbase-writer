import { defineConfig } from "vitest/config";
import appConfig from "../../vitest.config.js";

// Opt-in only: never matched by the app's normal test or production build.
export default defineConfig({
  ...appConfig,
  test: { ...appConfig.test, include: ["scripts/perf/*.bench.{ts,tsx}"], testTimeout: 180_000, fileParallelism: false },
});
