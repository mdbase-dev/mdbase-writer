import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildWriterManifest } from "./writer-manifest.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = await buildWriterManifest({
  origin: process.env.MDBASE_WRITER_ORIGIN ?? "https://writer.mdbase.dev",
  basePath: process.env.MDBASE_WRITER_BASE_PATH ?? "/",
});
const document = `${JSON.stringify(manifest, null, 2)}\n`;
for (const target of [resolve(projectRoot, "public", ".well-known", "mdbase-app.json"), resolve(projectRoot, "src", "generated", "mdbase-app.json")]) {
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, document);
}
