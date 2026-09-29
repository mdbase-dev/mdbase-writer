import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { buildWriterManifest, COMMENT_PACK, packResources } from "./writer-manifest.mjs";

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
  assert.deepEqual(manifest.requirements.contracts.map((c) => c.id), ["dev.mdbase.writer.manuscript", "dev.mdbase.reader.source", "mdbase.comment"]);
  assert.deepEqual(manifest.provisions.type_packs.flatMap((p) => p.provides), manifest.requirements.contracts);
  assert.deepEqual(manifest.requirements.capabilities.required, ["collection.read", "records.create", "records.edit"]);
});

const publishedCommentPack = resolve(root, "../../../mdbase-contracts/dist", COMMENT_PACK.replace("packs/mdbase.comment-", "packs/mdbase.comment/"));

test("the comment pack is byte-identical to the one mdbase contracts publishes", { skip: !existsSync(publishedCommentPack) }, () => {
  assert.equal(readFileSync(resolve(root, "mdbase", COMMENT_PACK), "utf8"), readFileSync(publishedCommentPack, "utf8"));
});

test("identity is optional: comments are unsigned without it", async () => {
  const manifest = await buildWriterManifest();
  assert.deepEqual(manifest.requirements.people, { version: 1, optional: ["identity"] });
});
