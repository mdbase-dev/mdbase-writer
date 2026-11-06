import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import { writerAppUrlsFor } from "./scripts/deployment-environment.mjs";

export default defineConfig({
  plugins: [react({ babel: { plugins: ["macros"] } }), lingui()],
  define: Object.fromEntries(Object.entries(writerAppUrlsFor("lab")).map(([app, url]) => [`import.meta.env.VITE_MDBASE_${app.toUpperCase()}_URL`, JSON.stringify(url)])),
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  test: { include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["./src/test/i18n.ts"] },
});
