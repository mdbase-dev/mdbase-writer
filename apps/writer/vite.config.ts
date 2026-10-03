import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// pandoc-wasm exports only its self-loading entry; the worker loads the module
// itself (from R2 when deployed), so it imports the loader and binary directly.
const pandocWasm = resolve(dirname(fileURLToPath(import.meta.url)), "node_modules", "pandoc-wasm");
const pandocVersion = (JSON.parse(readFileSync(resolve(pandocWasm, "package.json"), "utf8")) as { version: string }).version;

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  define: { __PANDOC_WASM_VERSION__: JSON.stringify(pandocVersion) },
  optimizeDeps: {
    // Deferred compiler/export worker imports are missed by the initial crawl.
    // Discovering these mid-session reloads the page and resets the demo collection.
    include: [
      "@myriaddreamin/typst.ts/compiler",
      "@myriaddreamin/typst.ts/options.init",
      "@myriaddreamin/typst.ts/renderer",
      "pandoc-wasm/core",
    ],
    exclude: ["@myriaddreamin/typst-ts-web-compiler", "@myriaddreamin/typst-ts-renderer"],
  },
  resolve: {
    alias: [
      { find: /^pandoc-wasm\/core$/, replacement: resolve(pandocWasm, "src", "core.js") },
      { find: /^pandoc-wasm\/pandoc\.wasm\?url$/, replacement: `${resolve(pandocWasm, "src", "pandoc.wasm")}?url` },
    ],
    dedupe: ["react", "react-dom", "@codemirror/state", "@codemirror/view", "@codemirror/language", "@lezer/common", "@lezer/highlight", "@lezer/markdown"],
  },
  server: { host: "127.0.0.1", port: 5320, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
