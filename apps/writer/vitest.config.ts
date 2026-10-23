import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";

export default defineConfig({
  plugins: [react({ babel: { plugins: ["macros"] } }), lingui()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  test: { include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["./src/test/i18n.ts"] },
});
