// Builds the mdbase writer application manifest and its type pack.
//
// The pack provisions the writer's manuscript contract and also Reader's
// source contract (byte-identical copies of Reader's resources): the writer
// resolves citations against Reader sources, and shipping the same bytes
// makes provisioning a no-op in collections that already use Reader.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { dataContractDigest } from "@callumalpass/mdbase";
import { parse as parseYaml } from "yaml";

export const WRITER_TYPE_PACK_VERSION = "1.0.0-beta.3";

const projectRoot = resolve(import.meta.dirname, "..");
export const packResources = [
  { kind: "contract", mode: "managed", source: "contracts/dev.mdbase.writer.manuscript.md", target: "_contracts/dev.mdbase.writer.manuscript.md" },
  { kind: "contract", mode: "managed", source: "contracts/dev.mdbase.reader.source.md", target: "_contracts/dev.mdbase.reader.source.md" },
  { kind: "type", mode: "seed", source: "types/writer-manuscript.md", target: "_types/writer-manuscript.md" },
  { kind: "type", mode: "seed", source: "types/reader-source.md", target: "_types/reader-source.md" },
];

export async function buildWriterManifest({ origin = "https://writer.mdbase.dev", basePath = "/" } = {}) {
  const appUrl = new URL(normalizeBasePath(basePath), `${origin.replace(/\/$/u, "")}/`).href;
  const resources = await Promise.all(
    packResources.map(async (resource) => {
      const document = await readFile(resolve(projectRoot, "mdbase", resource.source), "utf8");
      return {
        ...resource,
        digest: `sha256:${createHash("sha256").update(document).digest("hex")}`,
        document,
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
  return {
    manifest_version: 1,
    id: "dev.mdbase.writer",
    name: "mdbase writer",
    homepage: appUrl,
    icon: new URL("favicon.svg", appUrl).href,
    redirect_uris: [appUrl],
    requirements: {
      access: "full_collection",
      contracts,
      // Capability groups (v2). The writer reads the collection, creates
      // manuscripts and edits records; it never deletes or renames them.
      capabilities: {
        contract_version: 2,
        required: ["collection.read", "records.create", "records.edit"],
      },
      files: { required: ["list", "read"], scope: { kind: "collection" } },
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
            resources: resources.map(({ kind, mode, source, target, digest }) => ({ kind, mode, source, target, digest })),
          },
          resources: resources.map(({ source, document }) => ({ source, document })),
        },
      ],
    },
  };
}

function parseFrontmatter(document) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(document);
  if (!match?.[1]) throw new Error("Contract resource has no YAML frontmatter.");
  return parseYaml(match[1]);
}

function normalizeBasePath(value) {
  return `/${value.replace(/^\/+|\/+$/gu, "")}/`.replace(/^\/\/$/u, "/");
}
