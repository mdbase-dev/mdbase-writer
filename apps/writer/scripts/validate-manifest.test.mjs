import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { test } from "node:test";

import { buildWriterManifest } from "./writer-manifest.mjs";
import { validateManifestValue } from "./validate-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const [environment, origin] of Object.entries({
  lab: "https://lab.mdbase-writer.pages.dev",
  staging: "https://staging.mdbase-writer.pages.dev",
  production: "https://writer.mdbase.dev",
})) {
  test(`canonical validation accepts the ${environment} manifest and installation origins`, async () => {
    const manifest = await buildWriterManifest({ origin });
    assert.deepEqual(validateManifestValue(manifest), { valid: true, issues: [] });
  });
}

test("canonical validation still rejects unknown fields, environments and non-exact origins", async () => {
  const original = await buildWriterManifest();
  const changes = [
    manifest => { manifest.unrecognised = true; },
    manifest => { manifest.installation_origins.preview = { "app-runtime": ["https://preview.example"] }; },
    manifest => { manifest.installation_origins.staging["app-runtime"] = ["https://*.mdbase-writer.pages.dev"]; },
    manifest => { manifest.installation_origins.staging["app-runtime"] = ["https://staging.mdbase-writer.pages.dev/"]; },
  ];
  for (const change of changes) {
    const manifest = structuredClone(original);
    change(manifest);
    assert.equal(validateManifestValue(manifest).valid, false);
  }
});

test("the build CLI validates real files and exits nonzero on invalid input", async () => {
  const directory = await mkdtemp(resolve(root, ".manifest-validator-test-"));
  try {
    const source = resolve(directory, "manifest.json");
    const cli = resolve(root, "scripts/validate-manifest.mjs");
    const manifest = await buildWriterManifest({ origin: "https://staging.mdbase-writer.pages.dev" });
    const run = () => spawnSync(process.execPath, [cli, source], { encoding: "utf8" });
    await writeFile(source, JSON.stringify(manifest));
    const accepted = run();
    assert.equal(accepted.status, 0, accepted.stderr);
    manifest.unrecognised = true;
    await writeFile(source, JSON.stringify(manifest));
    assert.equal(run().status, 1);
    await writeFile(source, "not JSON");
    assert.equal(run().status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
