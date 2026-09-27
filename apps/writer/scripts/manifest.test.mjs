import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { buildWriterManifest, packResources } from "./writer-manifest.mjs";

const root = resolve(import.meta.dirname, "..");

test("the Reader resources are byte-identical to Reader's own", { skip: !existsSync(resolve(root, "../../../mdbase-reader")) }, () => {
  for (const r of packResources.filter((p) => p.source.includes("reader"))) {
    const ours = readFileSync(resolve(root, "mdbase", r.source), "utf8");
    const theirs = readFileSync(resolve(root, "../../../mdbase-reader/apps/reader/mdbase", r.source), "utf8");
    assert.equal(ours, theirs, `${r.source} differs from Reader's copy`);
  }
});

test("the manifest declares exactly the contracts its pack provides", async () => {
  const manifest = await buildWriterManifest();
  assert.deepEqual(manifest.requirements.contracts.map((c) => c.id), ["dev.mdbase.writer.manuscript", "dev.mdbase.reader.source"]);
  assert.deepEqual(manifest.provisions.type_packs[0].provides, manifest.requirements.contracts);
  assert.deepEqual(manifest.requirements.capabilities.required, ["collection.read", "records.create", "records.edit"]);
});
