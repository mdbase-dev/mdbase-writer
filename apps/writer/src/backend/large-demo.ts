// Imported only by the DEV ?demo=large branch. No account, daemon or production data.
import type { CollectionDescription, JsonObject, MdbaseConnection, QueryInput, QueryMetadataInput, QueryRecord } from "@mdbase-dev/connect";
import { MdbaseCollectionClient, connectSuccess } from "@mdbase-dev/connect/advanced";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import { counts, generateCollection } from "../../scripts/perf/generator.js";
import { annotationContract, commentContract, ConnectBackend, manuscriptContract, sourceContract } from "./connect.js";

export async function createLargeDemoBackend() {
  const authority = createRecordTestAuthority();
  const rows = new Map<string, QueryRecord<JsonObject>>();
  generateCollection((path, type, fields, body) => {
    const frontmatter = { type, ...fields };
    authority.seed(path, { frontmatter, body });
    rows.set(path, { path, types: [type], frontmatter, body, file: { path } });
  }, 300, true);
  const contracts = [
    [manuscriptContract, "writer-manuscript", ["title", "csl", "template"]],
    [sourceContract, "reader-source", ["title", "csl"]],
    [annotationContract, "reader-annotation", ["source", "locator"]],
    [commentContract, "comment", ["document", "created_at", "status", "motivation", "target", "in_reply_to"]],
  ] as const;
  const description: CollectionDescription = { protocolVersion: 1, collectionId: "large-demo", displayName: "Large demo", specVersion: "0.3", operations: [], changeCursor: 0, types: [], contracts: contracts.map(([contract, typeName, fields]) => ({ ...contract, contractType: "record", digest: "demo", schema: {}, implementations: [{ typeName, typeVersion: 1, digest: "demo", fields: Object.fromEntries(fields.map((f) => [f, f])) }] })) };
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
  const stop = authority.watch.subscribe((change) => {
    const paths = change.kind === "record.renamed" ? [change.from, change.to]
      : change.kind === "record.created" || change.kind === "record.updated" || change.kind === "record.deleted" ? [change.path] : [];
    for (const path of paths) {
      if (typeof path !== "string") continue;
      const record = authority.get(path);
      if (!record) rows.delete(path);
      else rows.set(path, { ...record, types: [String(record.frontmatter["type"] ?? "note")] });
    }
  });
  const client = new MdbaseCollectionClient<JsonObject>({ async operation<Result>(operation: string): Promise<Result> {
    if (operation !== "describe") throw new Error(`Unexpected large demo operation ${operation}`);
    await delay();
    return {
      protocol_version: description.protocolVersion, collection_id: description.collectionId,
      display_name: description.displayName, spec_version: description.specVersion,
      operations: description.operations, change_cursor: description.changeCursor, types: description.types,
      contracts: description.contracts.map((c) => ({ ...c, contract_type: c.contractType,
        implementations: c.implementations.map((i) => ({ ...i, type_name: i.typeName, type_version: i.typeVersion })),
      })),
    } as Result;
  } });
  const connection = {
    info: () => ({ collectionId: "large-demo", displayName: "Large demo" }),
    describe: client.describe.bind(client), readMany: client.readMany.bind(client), queryAll: client.queryAll.bind(client),
    supportsAuthorityFeature: async () => connectSuccess(false),
    async *queryPages(input: QueryInput = {}, options: { pageSize?: number } = {}) {
      const type = input.contract ? contracts.find(([c]) => c.id === input.contract!.id)?.[1] : undefined;
      const paths = input.where ? new Set<string>(JSON.parse(input.where.replace(/^file\.path in /, ""))) : undefined;
      const selected = [...rows.values()].filter((r) => (!type || r.types.includes(type)) && (!input.types || input.types.some((t) => r.types.includes(t))) && (!paths || paths.has(r.path)));
      const size = options.pageSize ?? 500;
      for (let offset = 0; offset < Math.max(1, selected.length); offset += size) {
        await delay();
        const results = selected.slice(offset, offset + size).map(({ body, frontmatter, ...r }) => ({ ...r, ...(input.frontmatterMode !== "effective" ? { frontmatter } : {}), ...(input.frontmatterMode !== "persisted" ? { effectiveFrontmatter: frontmatter } : {}), ...(input.includeBody ? { body } : {}) }));
        yield connectSuccess({ results, page: offset / size, offset, loaded: results.length, complete: offset + size >= selected.length });
      }
    },
    records: authority.records,
    read: async ({ path }: { path: string }) => { await delay(); const record = authority.get(path); if (!record) throw new Error(`Missing ${path}`); return connectSuccess(record); },
    watch: async () => connectSuccess({ ...authority.watch, status: { state: "connected", cursor: 0, recovered: false }, problem: null }),
    people: { directory: async () => connectSuccess({ people: [], account: {}, me: { status: "unlinked" } }) },
    files: { async *list() { for (let i = 0; i < counts.files; i++) yield { path: `files/image-${i}.png`, fileId: String(i), revision: "1", contentDigest: "sha256:" + "0".repeat(64), size: 1, mediaType: "image/png", mediaClass: "image", modifiedAt: "2026-01-01T00:00:00Z" }; } },
  };
  function pages(input: QueryMetadataInput, options?: { pageSize?: number }): AsyncGenerator<never>;
  function pages(input?: QueryInput, options?: { pageSize?: number }): ReturnType<typeof connection.queryPages>;
  function pages(input: QueryInput | QueryMetadataInput = {}, options?: { pageSize?: number }) {
    if (input.output === "metadata") throw new Error("Legacy demo does not support metadata output");
    return connection.queryPages(input, options);
  }
  client.queryPages = pages;
  const backend = new ConnectBackend(connection as unknown as MdbaseConnection<JsonObject>);
  const dispose = backend.dispose.bind(backend);
  backend.dispose = () => { dispose(); stop(); authority.watch.close(); };
  return Object.assign(backend, { authority });
}
