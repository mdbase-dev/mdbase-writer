// Builds the mdbase writer application manifest and its type pack.
//
// The pack provisions the writer's manuscript contract and also Reader's
// source contract (byte-identical copies of Reader's resources): the writer
// resolves citations against Reader sources, and shipping the same bytes
// makes provisioning a no-op in collections that already use Reader.
//
// It also provisions the published mdbase.comment pack, embedded exactly as
// mdbase contracts publishes it (dist/packs), so every app that comments
// installs the same bytes.
//
// Seed types belong to the collection once installed. Version 1 of the
// reader-source starter (pack beta.3) declared `type: { const: reader-source }`
// and required `type`, which fails in collections whose
// settings.explicit_type_keys record the type elsewhere (such as
// `[mdbase_type]`). Version 2 drops the pin, matching Reader's pack beta.4, and
// lists the exact bytes of every earlier reader-source starter, newest first
// (`upgrade_from`), so Connect can offer a reviewed upgrade from any of them: an
// unedited starter is replaced, and an edited one is merged three-way against
// the starter it was installed from, keeping collection edits. The list is
// Reader's own, byte for byte, kept under the same paths: baselines are named
// for the Reader pack version that first shipped them (Writer's beta.1 and
// beta.2 shipped Reader's beta.1 starter, its beta.3 Reader's beta.3 starter;
// Reader's beta.2 starter is listed because a collection may hold it). They are
// released bytes: never edit them.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { dataContractDigest } from "@callumalpass/mdbase";
import { parse as parseYaml } from "yaml";

// beta.5 ships the same starters as beta.4 and lists every earlier starter as an upgrade baseline.
export const WRITER_TYPE_PACK_VERSION = "1.0.0-beta.5";

const projectRoot = resolve(import.meta.dirname, "..");
export const packResources = [
  { kind: "contract", mode: "managed", source: "contracts/dev.mdbase.writer.manuscript.md", target: "_contracts/dev.mdbase.writer.manuscript.md" },
  { kind: "contract", mode: "managed", source: "contracts/dev.mdbase.reader.source.md", target: "_contracts/dev.mdbase.reader.source.md" },
  { kind: "type", mode: "seed", source: "types/writer-manuscript.md", target: "_types/writer-manuscript.md" },
  {
    kind: "type",
    mode: "seed",
    source: "types/reader-source.md",
    target: "_types/reader-source.md",
    upgradeFrom: [
      "baselines/1.0.0-beta.3/types/reader-source.md",
      "baselines/1.0.0-beta.2/types/reader-source.md",
      "baselines/1.0.0-beta.1/types/reader-source.md",
    ],
  },
];

/** The published comment pack: `{ manifest, resources, provides }`, as mdbase contracts builds it. */
export const COMMENT_PACK = "packs/mdbase.comment-1.0.1.json";

export async function buildWriterManifest({ origin = "https://writer.mdbase.dev", basePath = "/" } = {}) {
  const appUrl = new URL(normalizeBasePath(basePath), `${origin.replace(/\/$/u, "")}/`).href;
  const resources = await Promise.all(
    packResources.map(async (resource) => {
      const document = await readFile(resolve(projectRoot, "mdbase", resource.source), "utf8");
      const baselines = await Promise.all(
        (resource.upgradeFrom ?? []).map(async (path) => {
          const baseline = await readFile(resolve(projectRoot, "mdbase", path), "utf8");
          return { digest: sha256(baseline), version: parseFrontmatter(baseline).version, document: baseline };
        }),
      );
      return {
        ...resource,
        digest: sha256(document),
        document,
        ...(baselines.length === 0 ? {} : { upgrade_from: baselines }),
        ...(resource.kind === "contract" ? { contractDigest: dataContractDigest(parseFrontmatter(document)) } : {}),
      };
    }),
  );
  const contracts = resources
    .filter((r) => r.kind === "contract")
    .map((r) => {
      const contract = parseFrontmatter(r.document);
      return { id: contract.id, version: contract.version, digest: r.contractDigest };
    });
  const commentPack = JSON.parse(await readFile(resolve(projectRoot, "mdbase", COMMENT_PACK), "utf8"));
  return {
    manifest_version: 1,
    id: "dev.mdbase.writer",
    name: "mdbase writer",
    homepage: appUrl,
    icon: new URL("favicon.svg", appUrl).href,
    redirect_uris: [appUrl],
    requirements: {
      access: "full_collection",
      contracts: [...contracts, ...commentPack.provides],
      // Capability groups (v2). The writer reads the collection, creates
      // manuscripts and comments and edits records; it never deletes or
      // renames them (a withdrawn comment is kept, emptied).
      capabilities: {
        contract_version: 2,
        required: ["collection.read", "records.create", "records.edit"],
      },
      files: { required: ["list", "read"], scope: { kind: "collection" } },
      // The signed-in account, to sign comments with its person record. Optional:
      // without it, comments are unsigned.
      people: { version: 1, optional: ["identity"] },
    },
    provisions: {
      type_packs: [
        {
          provides: contracts,
          manifest: {
            kind: "mdbase.type-pack",
            id: "dev.mdbase.writer",
            version: WRITER_TYPE_PACK_VERSION,
            name: "mdbase writer",
            description: "Writer manuscripts, and the Reader source contract citations resolve against.",
            resources: resources.map(({ kind, mode, source, target, digest, upgrade_from }) => ({ kind, mode, source, target, digest, ...(upgrade_from ? { upgrade_from } : {}) })),
          },
          resources: resources.map(({ source, document }) => ({ source, document })),
        },
        commentPack,
      ],
    },
  };
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseFrontmatter(document) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(document);
  if (!match?.[1]) throw new Error("Pack resource has no YAML frontmatter.");
  return parseYaml(match[1]);
}

function normalizeBasePath(value) {
  return `/${value.replace(/^\/+|\/+$/gu, "")}/`.replace(/^\/\/$/u, "/");
}
