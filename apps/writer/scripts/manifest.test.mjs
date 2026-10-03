import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { Collection, V03Operations } from "@callumalpass/mdbase";
import { parse as parseYaml } from "yaml";

import { buildWriterManifest, COMMENT_PACK, packResources } from "./writer-manifest.mjs";

const root = resolve(import.meta.dirname, "..");

// Compare against Reader's published main, not whatever branch the sibling checkout is on.
const reader = resolve(root, "../../../mdbase-reader");
const readerMain = (source) => execFileSync("git", ["-C", reader, "show", `origin/main:apps/reader/mdbase/${source}`], { encoding: "utf8" });
test("the Reader resources are byte-identical to Reader's main", { skip: !existsSync(resolve(reader, ".git")) }, () => {
  for (const r of packResources.filter((p) => p.source.includes("reader"))) {
    for (const source of [r.source, ...(r.upgradeFrom ?? [])]) {
      const ours = readFileSync(resolve(root, "mdbase", source), "utf8");
      assert.equal(ours, readerMain(source), `${source} differs from Reader's main`);
    }
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

// Published identities must not change. Add a new version/digest instead of updating this pin.
// Pack digests are SHA-256 over the canonical (sorted-key) JSON of the whole pack manifest,
// `upgrade_from` included; the beta.4 and beta.5 pins were confirmed with the mdbase CLI's `packs assess`.
const releasedDigests = {
  "1.0.0-beta.4": "sha256:b8334c4a7b602b7a84737450c33a5de645f4c5c15e49f445dbfc568ec6542689",
  "1.0.0-beta.5": "sha256:21dfd856f03330244d2675ef0dc983461adf6ad71262a570256c7dd706dcf4e4",
};
// Every earlier reader-source starter, newest first, by the Reader pack that first shipped it:
// Reader's (and Writer's) beta.3, Reader's beta.2, and Reader's beta.1 (Writer's beta.1 and beta.2).
const earlierStarters = {
  "types/reader-source.md": [
    "sha256:82869c12234662297cc273aab993732d35827b8a2ba8ad74bec18975cadf0c1a",
    "sha256:54f46e7c3bb70e1cea5a37afa458406a0acf2be7f195c8893160782d87254990",
    "sha256:e8a3fca643d335e684810c2e83bc9e9c3fc702ecf5a23d29283615902e0cfa55",
  ],
};

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function frontmatter(document) {
  return parseYaml(/^---\n([\s\S]*?)\n---\n/u.exec(document)[1]);
}

async function writerPack() {
  const manifest = await buildWriterManifest();
  return manifest.provisions.type_packs.find((pack) => pack.manifest.id === "dev.mdbase.writer");
}

test("the released Writer pack digest stays immutable and is independent of deployment origin", async () => {
  const pack = await writerPack();
  assert.equal(
    sha256(canonicalJson(pack.manifest)),
    releasedDigests[pack.manifest.version],
    "Type-pack contents changed: publish a new pack version and add its digest; do not alter an existing release pin.",
  );
  const staging = await buildWriterManifest({ origin: "https://staging.writer.mdbase.dev" });
  assert.deepEqual(staging.provisions.type_packs[0], pack);
});

test("the reader-source seed lists every earlier starter, newest first, as exact bytes", async () => {
  const pack = await writerPack();
  const documents = new Map(pack.resources.map(({ source, document }) => [source, document]));
  const seeds = pack.manifest.resources.filter((resource) => resource.upgrade_from);
  assert.deepEqual(seeds.map((seed) => seed.source), Object.keys(earlierStarters));
  for (const seed of seeds) {
    assert.equal(seed.kind, "type");
    assert.equal(seed.mode, "seed");
    assert.deepEqual(seed.upgrade_from.map(({ digest }) => digest), earlierStarters[seed.source]);
    const type = frontmatter(documents.get(seed.source));
    for (const { digest, document, version } of seed.upgrade_from) {
      assert.equal(sha256(document), digest);
      assert.notEqual(digest, seed.digest);
      const starter = frontmatter(document);
      assert.equal(starter.kind, type.kind);
      assert.equal(starter.name, type.name);
      assert.equal(version, starter.version);
      assert.equal(version, 1);
    }
  }
});

// Rebuilt from its baseline, beta.4 (one baseline object, no version) keeps its released pin.
test("the beta.4 pack is reproducible from the listed beta.3 baseline", async () => {
  const pack = structuredClone((await writerPack()).manifest);
  pack.version = "1.0.0-beta.4";
  for (const resource of pack.resources.filter(({ upgrade_from }) => upgrade_from)) {
    const { digest, document } = resource.upgrade_from[0];
    resource.upgrade_from = { digest, document };
  }
  assert.equal(sha256(canonicalJson(pack)), releasedDigests["1.0.0-beta.4"]);
});

test("starter types neither declare nor require the type key", async () => {
  // A collection records a record's type under its own settings.explicit_type_keys, which
  // need not be `type` (some use [mdbase_type] because `type` holds CSL data).
  const manifest = await buildWriterManifest();
  for (const pack of manifest.provisions.type_packs) {
    const documents = new Map(pack.resources.map(({ source, document }) => [source, document]));
    for (const resource of pack.manifest.resources.filter(({ kind }) => kind === "type")) {
      const schema = frontmatter(documents.get(resource.source)).schema.value;
      for (const key of ["type", "types"]) {
        assert.equal(Object.hasOwn(schema.properties ?? {}, key), false, `${resource.source} declares ${key}`);
        assert.equal((schema.required ?? []).includes(key), false, `${resource.source} requires ${key}`);
      }
    }
  }
});

for (const typeKeys of ["[type]", "[mdbase_type]"]) {
  test(`records created by type name are valid where explicit_type_keys is ${typeKeys}`, async (t) => {
    // Connect's engine installs the packs (and applies the seed upgrades); this writes the
    // Writer pack's resources directly so @callumalpass/mdbase can validate records
    // against them. The comment starter is mdbase contracts' to test.
    const collectionRoot = await mkdtemp(join(tmpdir(), "writer-pack-"));
    t.after(() => rm(collectionRoot, { recursive: true, force: true }));
    const pack = await writerPack();
    const documents = new Map(pack.resources.map(({ source, document }) => [source, document]));
    for (const resource of pack.manifest.resources) {
      await mkdir(dirname(join(collectionRoot, resource.target)), { recursive: true });
      await writeFile(join(collectionRoot, resource.target), documents.get(resource.source));
    }
    await writeFile(join(collectionRoot, "mdbase.yaml"), `spec_version: 0.3.0\nsettings:\n  explicit_type_keys: ${typeKeys}\n`);
    const opened = await Collection.open(collectionRoot);
    assert.ok(opened.collection, opened.error?.message);
    const operations = new V03Operations(opened.collection);
    const created = [];
    try {
      created.push(
        await operations.create({
          path: "sources/example.md",
          type: "reader-source",
          frontmatter: {
            id: "src_example",
            title: "Example source",
            kind: "document",
            saved_at: "2026-08-09T14:21:00+10:00",
            // In a [mdbase_type] collection `type` is ordinary data, such as a CSL type.
            ...(typeKeys === "[mdbase_type]" ? { type: "article-journal" } : {}),
          },
        }),
      );
    } finally {
      await opened.collection.close();
    }
    for (const result of created) assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  });
}
