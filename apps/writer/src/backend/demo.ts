// Explicit development/LAB fixture. All collection and record operations use
// Writer's one SDK backend over MemoryReplica; nothing here is persisted.
import { connect, MdbasePeopleClient, toPlain, type MdbaseApplicationConnection, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica, type MemoryContract } from "@mdbase-dev/sdk/testing";
import type { CslItem } from "@mdbase-writer/core";
import { splitFrontmatter } from "@mdbase-writer/core/records";
import manifest from "../generated/mdbase-app.json";
import { domainContract, type Domain } from "./collection.js";
import { personKey, personLink } from "./comments.js";
import { NativeWriterBackend } from "./native.js";
import { bodySummary, numberedPath, ok, fail, type JsonObject, type JsonValue } from "./types.js";

const markdown = import.meta.glob("../../demo/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const assets = import.meta.glob("../../demo/**/*.{svg,png,jpg}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const relative = (key: string) => key.replace(/^\.\.\/\.\.\/demo\//, "");

// MemoryReplica implements records/contracts but not the catalog. This is a
// fixed fixture catalog, not a production schema or a legacy client facade.
const definitions: readonly [Domain, string, readonly string[]][] = [
  ["manuscript", "writer-manuscript", ["title", "template", "csl", "authors", "abstract", "date", "lang"]],
  ["source", "reader-source", ["title", "csl"]],
  ["annotation", "reader-annotation", ["source", "locator"]],
  ["comment", "comment", ["document", "motivation", "status", "created_at", "created_by", "in_reply_to", "target", "suggestion", "resolved_at", "resolved_by", "modified_at", "deleted_at"]],
  ["person", "person", ["name"]],
];
const contracts: MemoryContract[] = definitions.map(([domain, type, fields]) => {
  const contract = domainContract(domain);
  return {...contract, type, contractDigest: manifest.requirements.contracts.find(c => c.id === contract.id)?.digest ?? "sha256:" + "0".repeat(64),
    fields: Object.fromEntries(fields.map(field => [field, field]))};
});
const catalog: wire.DescribeResult = {
  specVersion: "0.3.0", settings: new Map(), inclusion: {include: ["image"]}, issues: [],
  contracts: contracts.map(c => ({id: c.id, version: c.version, digest: c.contractDigest!, path: `_contracts/${c.id}.md`, contractType: "record", implementedBy: [c.type]})),
  types: contracts.map(c => ({name: c.type, path: `_types/${c.type}.md`, implements: [{contract: c.id, version: c.version, fields: new Map(Object.entries(c.fields))}]})),
};
/** Fixture seed values must be actual CBOR maps, including nested CSL data. */
export function demoValue(value: JsonValue): wire.Value {
  if (Array.isArray(value)) return value.map(demoValue);
  if (value !== null && typeof value === "object") return new Map(Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined).map(([key, item]) => [key, demoValue(item)]));
  return value;
}
export function seedDemoRecord(replica: MemoryReplica, path: string, frontmatter: JsonObject, body: string) {
  const value = frontmatter["type"];
  const types = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return replica.seed({path, types, frontmatter: Object.fromEntries(Object.entries(frontmatter).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined).map(([key, item]) => [key, demoValue(item)])), body});
}

export class DemoWriterBackend extends NativeWriterBackend {
  override readonly kind = "demo";
  override readonly draftNamespace = "demo";
  private readonly lastWritten = new Map<string, {body: string; modified: string}>();
  constructor(connection: MdbaseApplicationConnection, readonly replica: MemoryReplica, readonly sdkClient: MdbaseClient) {
    super(connection, {collectionName: "Demo collection", signal: new AbortController().signal});
  }
  override async listManuscripts() {
    const listed = await super.listManuscripts();
    if (!listed.ok) return listed;
    return ok(await Promise.all(listed.value.map(async manuscript => {
      const body = await this.readBody(manuscript.path);
      if (!body.ok) return manuscript;
      let written = this.lastWritten.get(manuscript.path);
      if (!written || written.body !== body.value) {
        written = {body: body.value, modified: new Date(Date.now() - (written ? 0 : (this.lastWritten.size * 4 + 2) * 86_400_000)).toISOString()};
        this.lastWritten.set(manuscript.path, written);
      }
      return {...manuscript, ...bodySummary(body.value), modified: written.modified};
    })));
  }
  override async people() {
    const people = this.replica.allRecords.filter(r => r.types.includes("person")).map(r => ({path: r.path, name: (toPlain(r.frontmatter) as JsonObject)["name"]}));
    const names = new Map(people.filter((p): p is {path: string; name: string} => typeof p.name === "string").map(p => [personKey(p.path), p.name]));
    const me = people.find(p => p.name === "Jordan Ellis");
    return {names, ...(me ? {me: {link: personLink(me.path), name: "Jordan Ellis"}, signing: {kind: "linked" as const}} : {signing: {kind: "unlinked" as const}})};
  }
  // Demo-only uploads exercise SDK file APIs, not a production permission change.
  async writeFile(path: string, bytes: Uint8Array) {
    try {
      let target = path;
      const files = new Set<string>();
      for await (const file of this.sdkClient.files.list()) files.add(file.path);
      for (let n = 2; files.has(target); n++) target = numberedPath(path, n);
      await (await this.sdkClient.files.upload(target, bytes)).confirmed;
      await this.reconcile();
      return ok(target);
    } catch (error) { return fail<string>(error instanceof Error ? error.message : "Demo upload failed."); }
  }
  override dispose() {super.dispose(); this.sdkClient.close();}
}

export async function createMemoryWriter(seed: (replica: MemoryReplica) => void): Promise<DemoWriterBackend> {
  const replica = new MemoryReplica({confirmDelayMs: 0, contracts});
  seed(replica);
  const client = await connect({connector: replica.connector(), app: {name: "writer-demo", version: "demo"}, reconnect: false});
  client.describe = async () => catalog;
  // MemoryReplica only derives scalar `type` updates, not Core's type lists.
  // Supply that missing catalog behavior in this disposable fixture only.
  const submit = client.submit.bind(client);
  client.submit = async (...args) => {
    const writes = await submit(...args);
    for (const record of replica.allRecords) {
      const declared = record.frontmatter.get("type");
      if (Array.isArray(declared)) record.types = declared.filter((value): value is string => typeof value === "string");
    }
    return writes;
  };
  const connection: MdbaseApplicationConnection = {id: client.collection, displayName: "Demo collection",
    scope: {account: "demo", installation: "demo", collection: client.collection}, generation: "demo",
    records: client, files: client.files, isCurrent: () => true,
    // This fixture's people() supplies the demo author; no account is contacted.
    people: new MdbasePeopleClient(client, {collection: client.collection, request: async () => {throw new Error("No demo account");}, isCurrent: () => true})};
  return new DemoWriterBackend(connection, replica, client);
}
export async function createDemoBackend(): Promise<DemoWriterBackend> {
  const library = (await import("../../demo/library.json")).default as CslItem[];
  const backend = await createMemoryWriter(replica => {
    for (const [key, text] of Object.entries(markdown)) {
      const {body, frontmatter} = splitFrontmatter(text);
      seedDemoRecord(replica, relative(key), frontmatter as JsonObject, body);
    }
    for (const item of library) {
      const path = `sources/${item.id}.md`;
      const existing = replica.allRecords.find(r => r.path === path);
      seedDemoRecord(replica, path, {...(existing ? toPlain(existing.frontmatter) as JsonObject : {}), type: "reader-source", csl: item as JsonObject}, existing?.body ?? "");
    }
  });
  try {
    for (const [key, url] of Object.entries(assets)) await (await backend.sdkClient.files.upload(relative(key), new Uint8Array(await (await fetch(url)).arrayBuffer()))).confirmed;
    return backend;
  } catch (error) {backend.dispose(); throw error;}
}
