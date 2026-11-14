// Development/test data over Writer's production SDK backend. No account or network.
import type { JsonObject } from "@mdbase-dev/sdk";
import { createTestApp, type MemoryContract, type TestApp, type TestAppCollection } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import { domainContract, type Domain } from "./collection.js";
import { NativeWriterBackend } from "./native.js";
import { numberedPath, ok, type WriterBackend } from "./types.js";

const definitions: readonly [Domain, string, readonly string[]][] = [
  ["manuscript", "writer-manuscript", ["title", "template", "csl", "authors", "abstract", "date", "lang"]],
  ["source", "reader-source", ["title", "csl"]],
  ["annotation", "reader-annotation", ["source", "locator"]],
  ["comment", "comment", ["document", "motivation", "status", "created_at", "created_by", "in_reply_to", "target", "suggestion", "resolved_at", "resolved_by", "modified_at", "deleted_at"]],
  ["person", "person", ["name", "identities"]],
];
export const demoContracts: MemoryContract[] = definitions.map(([domain, type, fields]) => {
  const contract = domainContract(domain);
  const digest = manifest.requirements.contracts.find(candidate => candidate.id === contract.id)?.digest;
  return { ...contract, type, fields: Object.fromEntries(fields.map(field => [field, field])), ...(digest ? { contractDigest: digest } : {}) };
});
export function demoRecord(path: string, frontmatter: JsonObject, body: string) {
  const type = frontmatter["type"];
  const types = typeof type === "string" ? [type] : Array.isArray(type) ? type.filter((t): t is string => typeof t === "string") : [];
  return { path, types, frontmatter, body };
}

export class DemoWriterBackend extends NativeWriterBackend {
  override readonly kind: WriterBackend["kind"] = "demo";
  readonly replica;
  private readonly fixtureLifetime;
  constructor(readonly fixture: TestApp, private readonly assets: Map<string, string>, override readonly draftNamespace: string) {
    const client = fixture.client();
    const connection = fixture.mdbase.connection(client.collection);
    if (!connection) throw new Error("Missing demo collection");
    // The demo owns this connection; a real view borrows its SDK connection.
    const lifetime = new AbortController();
    super(connection, { collectionName: connection.displayName, signal: lifetime.signal });
    this.fixtureLifetime = lifetime;
    this.replica = fixture.replica();
  }
  override async index() {
    const result = await super.index();
    return result.ok ? ok({ ...result.value, filePaths: [...result.value.filePaths, ...this.assets.keys()] }) : result;
  }
  override async readFile(path: string) {
    const url = this.assets.get(path);
    if (!url) return super.readFile(path);
    return ok(new Uint8Array(await (await fetch(url)).arrayBuffer()));
  }
  async writeFile(path: string, bytes: Uint8Array, mediaType?: string) {
    let target = path;
    for (let n = 2; this.assets.has(target); n++) target = numberedPath(path, n);
    this.assets.set(target, URL.createObjectURL(new Blob([bytes as BlobPart], mediaType ? { type: mediaType } : {})));
    await this.reconcile();
    return ok(target);
  }
  override dispose() {
    super.dispose();
    for (const url of this.assets.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    this.fixtureLifetime.abort();
    void this.fixture.close();
  }
}

export async function createDemoApp(collection: TestAppCollection) {
  return createTestApp({
    declaration: { id: "writer.demo", name: "Writer demo", origin: "https://lab.mdbase-writer.pages.dev", environment: "lab", manifest },
    collections: [{ ...collection, contracts: demoContracts }],
    people: [{ name: "Jordan Ellis", role: "owner" }],
  });
}
