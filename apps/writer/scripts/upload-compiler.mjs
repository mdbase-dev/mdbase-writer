// Uploads the large WebAssembly modules to R2 under versioned keys:
// wasm/typst_ts_web_compiler-<version>.wasm (the Typst compiler, 28 MB) and
// wasm/pandoc-<version>.wasm (Pandoc, 58 MB, for the Word export). Pages
// cannot host them: they are larger than the 25 MiB asset limit. Idempotent;
// run when typst.ts or pandoc-wasm changes.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { assetsBucket } from "./deployment-environment.mjs";

const require = createRequire(import.meta.url);
const typstPackage = require.resolve("@myriaddreamin/typst-ts-web-compiler/package.json");
// pandoc-wasm exports no package.json subpath; find it beside the app.
const pandocDir = resolve(import.meta.dirname, "..", "node_modules", "pandoc-wasm");
const modules = [
  {
    file: resolve(typstPackage, "..", "pkg", "typst_ts_web_compiler_bg.wasm"),
    key: `wasm/typst_ts_web_compiler-${require(typstPackage).version}.wasm`,
  },
  {
    file: resolve(pandocDir, "src", "pandoc.wasm"),
    key: `wasm/pandoc-${JSON.parse(readFileSync(resolve(pandocDir, "package.json"), "utf8")).version}.wasm`,
  },
];
const only = process.argv[2];
for (const { file, key } of modules) {
  if (only && !key.includes(only)) continue;
  const result = spawnSync(
    "pnpm",
    ["dlx", "wrangler@4.120.0", "r2", "object", "put", `${assetsBucket}/${key}`, "--file", file, "--content-type", "application/wasm", "--cache-control", "public, max-age=31536000, immutable", "--remote"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
