import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildWriterManifest } from "./writer-manifest.mjs";
import { writerDeployments } from "./deployment-environment.mjs";
import { writerSdkTarget } from "./writer-sdk.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const target = writerSdkTarget(process.env);
const manifest = await buildWriterManifest({
  origin: process.env.MDBASE_WRITER_ORIGIN ?? writerDeployments[target ?? "lab"].origin,
  basePath: process.env.MDBASE_WRITER_BASE_PATH ?? "/",
});
const document = `${JSON.stringify(manifest, null, 2)}\n`;
for (const target of [resolve(projectRoot, "public", ".well-known", "mdbase-app.json"), resolve(projectRoot, "src", "generated", "mdbase-app.json")]) {
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, document);
}
