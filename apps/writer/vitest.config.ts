import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react({ babel: { plugins: ["macros"] } }), lingui()],
  resolve: {
    alias: { "@writer/i18n": fileURLToPath(new URL("./src/i18n/app.ts", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
