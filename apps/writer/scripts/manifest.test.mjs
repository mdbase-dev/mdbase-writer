import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { Collection, V03Operations } from "@callumalpass/mdbase";
import { parse as parseYaml } from "yaml";

import { buildWriterManifest, COMMENT_PACK, packResources } from "./writer-manifest.mjs";

const root = resolve(import.meta.dirname, "..");

test("the Reader resources are byte-identical to Reader's own", { skip: !existsSync(resolve(root, "../../../mdbase-reader")) }, () => {
  for (const r of packResources.filter((p) => p.source.includes("reader"))) {
    for (const source of [r.source, r.upgradeFrom].filter(Boolean)) {
      const ours = readFileSync(resolve(root, "mdbase", source), "utf8");
      const theirs = readFileSync(resolve(root, "../../../mdbase-reader/apps/reader/mdbase", source), "utf8");
      assert.equal(ours, theirs, `${source} differs from Reader's copy`);
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
// `upgrade_from` included; beta.4's pin was confirmed with the mdbase CLI's `packs assess`.
const releasedDigests = {
  "1.0.0-beta.4": "sha256:b8334c4a7b602b7a84737450c33a5de645f4c5c15e49f445dbfc568ec6542689",
};
// Exact bytes of the version-1 reader-source starter released in Writer's beta.3 (and
// Reader's beta.3), which beta.4 upgrades from.
const beta3SeedDigests = {
  "types/reader-source.md": "sha256:82869c12234662297cc273aab993732d35827b8a2ba8ad74bec18975cadf0c1a",
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

test("the reader-source seed upgrades from the exact beta.3 starter", async () => {
  const pack = await writerPack();
  const seeds = pack.manifest.resources.filter((resource) => resource.upgrade_from);
  assert.deepEqual(seeds.map((seed) => seed.source), Object.keys(beta3SeedDigests));
  for (const seed of seeds) {
    assert.equal(seed.mode, "seed");
    assert.equal(seed.upgrade_from.digest, beta3SeedDigests[seed.source]);
    assert.equal(sha256(seed.upgrade_from.document), seed.upgrade_from.digest);
    assert.equal(frontmatter(seed.upgrade_from.document).version, 1);
  }
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
