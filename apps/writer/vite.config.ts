import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig, loadEnv, type UserConfig } from "vite";

import type * as SdkOfflineShell from "@mdbase-dev/sdk/offline-shell/build";
import { writerAppUrlsFor, writerDeployments } from "./scripts/deployment-environment.mjs";
import { verifiedWriterSdk, writerSdkTarget } from "./scripts/writer-sdk.mjs";

// pandoc-wasm exports only its self-loading entry; the worker loads the module
// itself (from R2 when deployed), so it imports the loader and binary directly.
const pandocWasm = resolve(dirname(fileURLToPath(import.meta.url)), "node_modules", "pandoc-wasm");
const pandocVersion = (JSON.parse(readFileSync(resolve(pandocWasm, "package.json"), "utf8")) as { version: string }).version;

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  // The bundled SDK original decides which Connect a build talks to, so an
  // explicit lab/staging/production build compiles against that environment's
  // verified original and nothing else. Only local development may leave
  // the environment unselected.
  const environment = { ...loadEnv(mode, import.meta.dirname, ""), ...process.env };
  const target = writerSdkTarget(environment);
  if (command === "build" && target === undefined) {
    throw new Error("Writer builds need an explicit VITE_MDBASE_ENV (lab, staging or production); refusing to default to production.");
  }
  const sdk = target === undefined ? undefined : await verifiedWriterSdk(target);
  const appUrls = writerAppUrlsFor(target ?? "lab", environment);
  const { offlineShellPlugin } = (await import(sdk?.offlineShellUrl ?? "@mdbase-dev/sdk/offline-shell/build")) as typeof SdkOfflineShell;
  return {
    plugins: [react({ babel: { plugins: ["macros"] } }), lingui(), offlineShellPlugin()],
    worker: { format: "es" },
    define: {
      __PANDOC_WASM_VERSION__: JSON.stringify(pandocVersion),
      ...Object.fromEntries(Object.entries(appUrls).map(([app, url]) => [`import.meta.env.VITE_MDBASE_${app.toUpperCase()}_URL`, JSON.stringify(url)])),
      // The legacy Connect session must not fall back to production either.
      "import.meta.env.VITE_MDBASE_CONNECT_URL": JSON.stringify(writerDeployments[target ?? "lab"].connectUrl),
      "import.meta.env.VITE_MDBASE_CONNECT_LOOPBACK_URL": JSON.stringify(writerDeployments[target ?? "lab"].loopbackUrl),
    },
    optimizeDeps: {
      // Deferred compiler/export worker imports are missed by the initial crawl.
      // Discovering these mid-session reloads the page and resets the demo collection.
      include: [
        "@lingui/core",
        "@mdbase-dev/sdk/testing",
        "@myriaddreamin/typst.ts/compiler",
        "@myriaddreamin/typst.ts/options.init",
        "@myriaddreamin/typst.ts/renderer",
        "pandoc-wasm/core",
      ],
      exclude: ["@myriaddreamin/typst-ts-web-compiler", "@myriaddreamin/typst-ts-renderer"],
    },
    resolve: {
      alias: [
        ...(sdk?.aliases ?? []),
        { find: /^pandoc-wasm\/core$/, replacement: resolve(pandocWasm, "src", "core.js") },
        { find: /^pandoc-wasm\/pandoc\.wasm\?url$/, replacement: `${resolve(pandocWasm, "src", "pandoc.wasm")}?url` },
      ],
      dedupe: ["react", "react-dom", "@codemirror/state", "@codemirror/view", "@codemirror/language", "@lezer/common", "@lezer/highlight", "@lezer/markdown"],
    },
    server: { host: "127.0.0.1", port: 5320, strictPort: true },
    build: { target: "es2022", sourcemap: true,
      rollupOptions: { output: {
        entryFileNames: environment["VITE_MDBASE_WRITER_BUILD_ID"]
          ? `assets/[name]-[hash]-${environment["VITE_MDBASE_WRITER_BUILD_ID"].slice(0, 12)}.js`
          : "assets/[name]-[hash].js",
      } },
    },
  };
});
