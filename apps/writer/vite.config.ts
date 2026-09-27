import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@myriaddreamin/typst-ts-web-compiler", "@myriaddreamin/typst-ts-renderer"] },
  resolve: {
    dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/language", "@lezer/common", "@lezer/highlight", "@lezer/markdown"],
  },
  server: { host: "127.0.0.1", port: 5320, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
