// Uploads the Typst compiler WebAssembly to R2 under a versioned key
// (wasm/typst_ts_web_compiler-<version>.wasm). Pages cannot host it: it is
// larger than the 25 MiB asset limit. Idempotent; run when typst.ts changes.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { assetsBucket } from "./deployment-environment.mjs";

const require = createRequire(import.meta.url);
const packageJson = require.resolve("@myriaddreamin/typst-ts-web-compiler/package.json");
const { version } = require(packageJson);
const file = resolve(packageJson, "..", "pkg", "typst_ts_web_compiler_bg.wasm");
const key = `wasm/typst_ts_web_compiler-${version}.wasm`;
const result = spawnSync(
  "pnpm",
  ["dlx", "wrangler@4.120.0", "r2", "object", "put", `${assetsBucket}/${key}`, "--file", file, "--content-type", "application/wasm", "--cache-control", "public, max-age=31536000, immutable", "--remote"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
