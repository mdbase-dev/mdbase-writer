import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection } from "@callumalpass/mdbase";
import { normalizeCollectionChange, type CollectionChange, type CollectionDescription, type JsonObject, type MdbaseConnection, type QueryInput, type QueryMetadataInput, type QueryMetadataRecord, type QueryRecord, type QueryPage, type ConnectOutcome } from "@mdbase-dev/connect";
import { MdbaseCollectionClient, connectFailure, connectProblem, connectSuccess } from "@mdbase-dev/connect/advanced";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import { ManuscriptWorkspace } from "../workspace/workspace.js";
import { describe, expect, it, vi } from "vitest";
import { annotationContract, ConnectBackend, manuscriptContract, sourceContract, commentContract } from "./connect.js";

vi.mock("../compile/client.js", () => ({ CompileClient: class {
  ready = Promise.resolve(0);
  send = vi.fn();
  onResult = () => () => {};
  onFailure = () => () => {};
  terminate() {}
} }));

const implementation = (name: string, fields: Record<string, string>) => ({ typeName: name, typeVersion: 1, digest: "test", fields });
const annotationType = implementation("highlight", { source: "reading", locator: "page" });
const annotation = { ...annotationContract, contractType: "record" as const, digest: "test", schema: {}, implementations: [annotationType] };
function fixture(contracts: CollectionDescription["contracts"] = [annotation], typeNames = contracts.length ? ["reader-source", ...contracts.flatMap((c) => c.implementations.map((i) => i.typeName))] : ["reader-annotation", "reader-source"]) {
  const description: CollectionDescription = { protocolVersion: 1, collectionId: "test", displayName: "Test", specVersion: "0.3", operations: [], changeCursor: 0, types: typeNames.map((name) => ({ name, schema: {}, extensions: {} })), contracts };
  const authority = createRecordTestAuthority();
  const rows: { path: string; types: string[]; frontmatter: JsonObject; body: string }[] = [
    { path: "annotations/a.md", types: ["highlight"], frontmatter: { reading: "[[../sources/a|A]]", page: { label: "p. 12" } }, body: "> Quote A\n\nPrivate note." },
    { path: "annotations/b.md", types: ["highlight"], frontmatter: { reading: "[[b]]" }, body: "> Quote B" },
    { path: "annotations/c.md", types: ["highlight"], frontmatter: { reading: "[[a]]" }, body: "> Another A" },
  ];
  let notify: (event: CollectionChange) => void = () => {};
  const describeRequests = vi.fn(async () => ({
    protocol_version: description.protocolVersion, collection_id: description.collectionId,
    display_name: description.displayName, spec_version: description.specVersion,
    operations: description.operations, change_cursor: description.changeCursor,
    types: description.types, configuration: description.configuration,
    contracts: description.contracts.map((c) => ({ ...c, contract_type: c.contractType,
      implementations: c.implementations.map((i) => ({ ...i, type_name: i.typeName, type_version: i.typeVersion })),
    })),
  }));
  const supports = async (id: string): Promise<ConnectOutcome<boolean>> => connectSuccess(description.authorityCapabilities?.includes(id) ?? false);
  const readRequests = vi.fn((payload: JsonObject) => ({ valid: true, result: { items: (payload["paths"] as string[]).map((path) => {
    const row = rows.find((r) => r.path === path);
    return row ? { path, status: "found", record: { ...row, revision: "hydrated", effective_frontmatter: row.frontmatter, file: {},
      body: payload["include_body"] ? row.body : undefined } } : { path, status: "missing" };
  }) } }));
  const client = new MdbaseCollectionClient<JsonObject>({ async operation<Result>(operation: string, payload: JsonObject): Promise<Result> {
    if (operation === "read") return readRequests(payload) as Result;
    if (operation !== "describe") throw new Error(`Unexpected operation ${operation}`);
    return await describeRequests() as Result;
  } }, undefined, supports);
  const emit = (type: string, payload: JsonObject = {}) => notify(normalizeCollectionChange({ type, payload, cursor: 1, occurred_at: "2026-01-01T00:00:00Z" }));
  let resetWatch = () => {};
  const sourceNames = ["a", "b"];
  const queryPages = vi.fn(async function* (input: QueryInput | QueryMetadataInput): AsyncGenerator<ConnectOutcome<QueryPage<JsonObject, QueryRecord<JsonObject> | QueryMetadataRecord>>> {
    const paths: string[] | undefined = input.where ? JSON.parse(input.where.replace(/^file\.path in /, "")) as string[] : undefined;
    const sources = sourceNames.map((key) => ({ path: `sources/${key}.md`, types: ["reader-source"], frontmatter: { csl: { id: key, title: key } }, body: "" }));
    const results = [...sources, ...rows].filter((r) => (!input.types || input.types.some((t) => r.types.includes(t))) && (!paths || paths.includes(r.path))).map(({ body, ...row }) => ({ ...row,
      ...(input.frontmatterMode !== "persisted" ? { effectiveFrontmatter: row.frontmatter } : {}),
      ...(input.includeBody ? { body } : {}), file: {} }));
    if (input.output === "metadata") {
      const narrow = results.map((r) => ({ path: r.path, types: r.types, revision: "discovery-only",
        values: Object.fromEntries((input.select ?? []).flatMap((s) => {
          if (typeof s === "string") throw new Error("Expected explicit named field selections");
          const field = /^record\[(.*)\]$/.exec(s.expression)?.[1];
          const value = field ? (r.frontmatter as JsonObject)[JSON.parse(field) as string] : undefined;
          return value === undefined ? [] : [[s.name, value]];
        })) as JsonObject,
      }));
      yield connectSuccess({ output: "metadata" as const, results: narrow, page: 0, offset: 0, loaded: narrow.length, complete: true });
    } else yield connectSuccess({ results, page: 0, offset: 0, loaded: results.length, complete: true });
  });
  const read = vi.fn(async ({ path }: { path: string }) => {
    const row = rows.find((r) => r.path === path)!;
    return connectSuccess({ ...row, frontmatter: row.frontmatter as JsonObject, effectiveFrontmatter: row.frontmatter as JsonObject, revision: "1", file: {} });
  });
  const connection = {
    describe: vi.fn(client.describe.bind(client)),
    supportsAuthorityFeature: vi.fn(supports),
    readMany: client.readMany.bind(client), queryAll: client.queryAll.bind(client),
    queryPages, read,
    watch: async () => connectSuccess({ subscribe: (listener: typeof notify, onStatus?: (status: { state: string }) => void) => { notify = listener; resetWatch = () => onStatus?.({ state: "reset_required" }); }, close() {} }),
    records: { follow: () => () => {}, open: authority.records.open.bind(authority.records) },
    info: () => ({ collectionId: "test" }),
    files: { async *list() {} },
  };
  const backend = new ConnectBackend(connection as unknown as MdbaseConnection<JsonObject>);
  // The mock implements both output shapes; expose the SDK's discriminated overloads.
  client.queryPages = connection.queryPages as MdbaseConnection<JsonObject>["queryPages"];
  return { backend, connection, description, describeRequests, readRequests, emit, authority, rows, read, sourceNames, bodyQueries: () => connection.queryPages.mock.calls.filter(([q]) => q.includeBody).map(([q]) => q), changedQueries: () => connection.queryPages.mock.calls.filter(([q]) => q.where && !q.types).map(([q]) => q), metadataQueries: () => connection.queryPages.mock.calls.filter(([q]) => q.types?.some((t) => t === "highlight" || t === "reader-annotation") && !q.includeBody).map(([q]) => q), notify: (path: string) => emit("mdbase.record.modified", { path }), rename: (from: string, to: string) => emit("mdbase.record.renamed", { from, to }), reset: () => resetWatch() };
}

describe("annotation loading", () => {
  it("uses narrow identities but typed query bodies even when document batches are advertised", async () => {
    const f = fixture();
    f.description.authorityCapabilities = ["query-metadata-v1", "read-many-documents-v1"];
    f.rows[0]!.frontmatter["unrelated"] = "Not part of discovery";
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: f.rows.map((r) => r.path) });
    expect(f.metadataQueries()).toEqual([{ types: ["highlight"], frontmatterMode: "persisted", output: "metadata",
      select: [{ name: "csl", expression: 'record["csl"]' }, { name: "title", expression: 'record["title"]' },
        { name: "reading", expression: 'record["reading"]' }, { name: "file_mtime", expression: "file.mtime" }] }]);
    const annotations = await f.backend.annotationsForSource("sources/a.md");
    expect(annotations).toMatchObject({ ok: true, value: [{ quote: "Quote A", locator: "p. 12" }, { quote: "Another A" }] });
    expect(f.bodyQueries()).toEqual([{ types: ["highlight"], where: 'file.path in ["annotations/a.md","annotations/c.md"]', frontmatterMode: "persisted", includeBody: true }]);
    expect(f.readRequests).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    // Background path refresh still uses SDK readMany; only display bodies changed.
    f.rows[0]!.body = "> Updated quotation";
    f.notify("annotations/a.md");
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ quote: "Another A" }, { quote: "Updated quotation" }] });
    expect(f.readRequests).toHaveBeenCalledExactlyOnceWith({ paths: ["annotations/a.md"], include_body: false, include_document: false });
    f.backend.dispose();
  });

  it("selects every binding needed by co-typed records, not just the query's type", async () => {
    const f = fixture([{ ...annotation, implementations: [annotationType, implementation("other-highlight", { source: "ref", locator: "location" })] }]);
    f.description.authorityCapabilities = ["query-metadata-v1"];
    f.rows[0]!.types.push("other-highlight");
    f.rows[0]!.frontmatter["ref"] = "[[b]]";
    // Both type queries return the row; its first role still uses reading, not ref.
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ path: "annotations/a.md" }, { path: "annotations/c.md" }] });
    const second = f.connection.queryPages.mock.calls.find(([q]) => q.output === "metadata" && q.types?.includes("other-highlight"))?.[0];
    expect(second?.select).toEqual(expect.arrayContaining([
      { name: "reading", expression: 'record["reading"]' }, { name: "ref", expression: 'record["ref"]' },
    ]));
    f.backend.dispose();
  });

  it.each([false, true])("keeps source-scoped ambiguity rejection with metadata support=%s", async (metadata) => {
    const f = fixture();
    f.description.authorityCapabilities = metadata ? ["query-metadata-v1"] : [];
    f.rows.push({ path: "other/a.md", types: ["reader-source"], frontmatter: { csl: { id: "other-a" } }, body: "" });
    // The explicit relative link still resolves; the bare [[a]] is ambiguous.
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ path: "annotations/a.md" }] });
    expect(await f.backend.annotationsForSource("other/a.md")).toEqual({ ok: true, value: [] });
    expect(f.connection.queryPages.mock.calls.some(([q]) => q.where?.includes("asFile"))).toBe(false);
    f.backend.dispose();
  });

  it("uses narrow comment documents/replies without losing mapped scoped bodies", async () => {
    const contract = { ...commentContract, contractType: "record" as const, digest: "test", schema: {},
      implementations: [implementation("feedback", { document: "about", created_at: "date", in_reply_to: "parent", target: "anchor" })] };
    const f = fixture([contract]);
    f.description.authorityCapabilities = ["query-metadata-v1", "read-many-documents-v1"];
    f.rows.splice(0, f.rows.length,
      { path: "comments/a.md", types: ["feedback"], frontmatter: { about: "[[sources/a]]", date: "2026-01-01", anchor: { quote: { exact: "Quote" } } }, body: "Root body" },
      { path: "comments/reply.md", types: ["feedback"], frontmatter: { about: "[[elsewhere]]", date: "2026-01-02", parent: "[[a]]" }, body: "Reply body" },
      { path: "comments/other.md", types: ["feedback"], frontmatter: { about: "[[sources/b]]", date: "2026-01-02" }, body: "Unselected body" },
    );
    expect(await f.backend.comments(["sources/a.md"])).toMatchObject({ ok: true, value: [
      { path: "comments/a.md", text: "Root body", target: { quote: { exact: "Quote" } } },
      { path: "comments/reply.md", text: "Reply body", inReplyTo: "[[a]]" },
    ] });
    const discovery = f.connection.queryPages.mock.calls.map(([q]) => q).find((q) => q.types?.includes("feedback") && q.output === "metadata");
    expect(discovery?.select).toEqual([
      { name: "csl", expression: 'record["csl"]' }, { name: "title", expression: 'record["title"]' },
      { name: "about", expression: 'record["about"]' }, { name: "date", expression: 'record["date"]' }, { name: "parent", expression: 'record["parent"]' },
      { name: "file_mtime", expression: "file.mtime" },
    ]);
    expect(f.bodyQueries()).toEqual([{ types: ["feedback"], where: 'file.path in ["comments/a.md","comments/reply.md"]', frontmatterMode: "persisted", includeBody: true }]);
    expect(f.readRequests).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    f.backend.dispose();
  });

  it("surfaces discovery denial without probing or downgrading", async () => {
    const f = fixture();
    f.connection.supportsAuthorityFeature.mockResolvedValueOnce(connectFailure(connectProblem<"access_denied">("access_denied", "Denied discovery")));
    expect(await f.backend.annotationPaths()).toEqual({ ok: false, message: "Denied discovery" });
    expect(f.connection.queryPages).not.toHaveBeenCalled();
    f.backend.dispose();
  });

  it("does not downgrade a failed advertised metadata query", async () => {
    const f = fixture();
    f.description.authorityCapabilities = ["query-metadata-v1"];
    f.connection.queryPages.mockImplementationOnce(async function* () { yield connectFailure(connectProblem("operation_invalid", "Broken advertised output", { details: { diagnostics: [] } })); });
    expect(await f.backend.annotationPaths()).toEqual({ ok: false, message: "Broken advertised output" });
    expect(f.connection.queryPages).toHaveBeenCalledTimes(1);
    expect(f.connection.queryPages.mock.calls[0]?.[0].output).toBe("metadata");
    f.backend.dispose();
  });
  it("discovers all identities without bodies, then reads only the selected source with mapped fields", async () => {
    const f = fixture();
    await f.backend.library();
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: f.rows.map((r) => r.path) });
    expect(f.read).not.toHaveBeenCalled();
    const result = await f.backend.annotationsForSource("sources/a.md");
    expect(result).toMatchObject({ ok: true, value: [{ path: "annotations/a.md", quote: "Quote A", note: "Private note.", locator: "p. 12" }, { path: "annotations/c.md", quote: "Another A" }] });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.readRequests).not.toHaveBeenCalled();
    expect(f.connection.queryPages.mock.calls.some(([q]) => q.output === "metadata")).toBe(false);
    expect(f.bodyQueries()).toEqual([{ types: ["highlight"], where: 'file.path in ["annotations/a.md","annotations/c.md"]', frontmatterMode: "persisted", includeBody: true }]);
    await f.backend.annotationsForSource("sources/b.md");
    const b = await f.backend.annotationsForSource("sources/b.md");
    await f.backend.annotationsForSource("sources/a.md");
    expect(f.bodyQueries()).toHaveLength(2);
    f.rows[0]!.body = "> New quote";
    f.notify("annotations/a.md");
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ quote: "Another A" }, { quote: "New quote" }] });
    expect(f.bodyQueries()).toHaveLength(3);
    expect(f.metadataQueries()).toHaveLength(1);
    expect(f.changedQueries()[0]?.where).toBe('file.path in ["annotations/a.md"]');
    expect(await f.backend.annotationsForSource("sources/b.md")).toBe(b);
    expect(f.bodyQueries()).toHaveLength(3);
    f.backend.dispose();
  });

  it("uses the body parser's link rules for source names ending in image extensions", async () => {
    const f = fixture();
    f.sourceNames.push("plot.png");
    f.rows.push({ path: "annotations/image-name.md", types: ["highlight"], frontmatter: { reading: "[[plot.png|Source title]]" }, body: "> Quotation from a source note named plot.png.md" });
    await f.backend.library();
    expect(await f.backend.annotationsForSource("sources/plot.png.md")).toMatchObject({ ok: true, value: [{ path: "annotations/image-name.md", source: "plot.png.md" }] });
    expect(f.bodyQueries()).toHaveLength(1);
    expect(f.read).not.toHaveBeenCalled();
    f.backend.dispose();
  });

  it("falls back only for an absent contract, and retains empty annotation paths", async () => {
    const f = fixture([]);
    f.rows[0]!.types = ["reader-annotation"];
    f.rows[0]!.body = "";
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: ["annotations/a.md"] });
    expect(f.connection.queryPages).toHaveBeenCalledWith({ types: ["reader-annotation"], frontmatterMode: "persisted" }, expect.objectContaining({ pageSize: 1_000 }));
    f.backend.dispose();
  });

  it("treats a collection with no Reader contracts or types as empty without probes", async () => {
    const f = fixture([], []);
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: [] });
    expect(await f.backend.library()).toEqual({ ok: true, value: [] });
    expect(await f.backend.annotationsForSource("sources/a.md")).toEqual({ ok: true, value: [] });
    expect(f.connection.queryPages).not.toHaveBeenCalled();
    f.backend.dispose();
  });

  it("rediscovers newly installed Reader types on a typed schema change", async () => {
    const f = fixture([], []);
    f.description.configuration = { settings: { types_folder: "schemas/kinds" } };
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: [] });
    f.description.types.push({ name: "reader-annotation", schema: {}, extensions: {} });
    f.rows[0]!.types = ["reader-annotation"];
    f.rows[0]!.frontmatter["source"] = "[[sources/a]]";
    f.emit("mdbase.type.changed", { path: "schemas/kinds/reader-annotation.md" });
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: ["annotations/a.md"] });
    expect(f.describeRequests).toHaveBeenCalledTimes(2);
    f.backend.dispose();
  });

  it("does not fall back for a known contract without implementations or failed describe", async () => {
    const f = fixture([{ ...annotation, implementations: [] }]);
    expect(await f.backend.annotationPaths()).toMatchObject({ ok: false });
    expect(f.connection.queryPages).not.toHaveBeenCalled();
    f.backend.dispose();
    const failed = fixture();
    failed.connection.describe.mockRejectedValueOnce(new Error("Temporary describe failure"));
    await expect(failed.backend.annotationPaths()).rejects.toThrow("Temporary describe failure");
    expect(failed.connection.queryPages).not.toHaveBeenCalled();
    expect((await failed.backend.annotationPaths()).ok).toBe(true);
    failed.backend.dispose();
  });

  it("does not hide a failed metadata query with a starter-type fallback", async () => {
    const f = fixture();
    f.connection.queryPages.mockImplementationOnce(async function* () { throw new Error("Metadata query failed"); });
    await expect(f.backend.annotationPaths()).rejects.toThrow("Metadata query failed");
    expect(f.connection.queryPages).toHaveBeenCalledTimes(1);
    expect(f.connection.queryPages.mock.calls[0]?.[0].types).toEqual(["highlight"]);
    expect((await f.backend.annotationPaths()).ok).toBe(true);
    f.backend.dispose();
  });

  it("invalidates source caches on renames and gaps, and forwards reconciliation", async () => {
    const f = fixture();
    await f.backend.library();
    await f.backend.annotationPaths();
    await f.backend.annotationsForSource("sources/a.md");
    const events: (readonly string[])[] = [];
    f.backend.onExternalChange((paths) => events.push(paths));
    f.rows[0]!.path = "annotations/renamed.md";
    f.rename("annotations/a.md", "annotations/renamed.md");
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ path: "annotations/c.md" }, { path: "annotations/renamed.md" }] });
    f.reset();
    await f.backend.annotationsForSource("sources/a.md");
    expect(f.bodyQueries()).toHaveLength(3);
    expect(events).toEqual([["annotations/a.md", "annotations/renamed.md"], []]);
    expect(f.describeRequests).toHaveBeenCalledTimes(2);
    f.backend.dispose();
  });

  it("ignores known source, comment and note changes for annotation caches", async () => {
    const f = fixture();
    f.rows.push({ path: "comments/known.md", types: ["comment"], frontmatter: {}, body: "Comment" }, { path: "notes/known.md", types: ["note"], frontmatter: {}, body: "Note" });
    await f.backend.index();
    await f.backend.library();
    const cached = await f.backend.annotationsForSource("sources/a.md");
    const queries = f.connection.queryPages.mock.calls.length;
    for (const path of ["sources/a.md", "comments/known.md", "notes/known.md"]) f.notify(path);
    expect(await f.backend.annotationPaths()).toMatchObject({ ok: true });
    expect(await f.backend.annotationsForSource("sources/a.md")).toBe(cached);
    expect(f.connection.queryPages).toHaveBeenCalledTimes(queries + 1);
    expect(f.changedQueries()).toHaveLength(1);
    f.backend.dispose();
  });

  it("moves one changed entry between sources without discarding unrelated caches", async () => {
    const f = fixture();
    await f.backend.library();
    await f.backend.annotationsForSource("sources/a.md");
    await f.backend.annotationsForSource("sources/b.md");
    f.rows[0]!.frontmatter["reading"] = "[[b]]";
    f.notify("annotations/a.md");
    expect(await f.backend.annotationsForSource("sources/b.md")).toMatchObject({ ok: true, value: [{ path: "annotations/b.md" }, { path: "annotations/a.md" }] });
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ path: "annotations/c.md" }] });
    expect(f.metadataQueries()).toHaveLength(1);
    expect(f.changedQueries()[0]?.where).toBe('file.path in ["annotations/a.md"]');
    f.backend.dispose();
  });

  it("drops a deleted annotation entry without re-querying other sources", async () => {
    const f = fixture();
    await f.backend.library();
    await f.backend.annotationsForSource("sources/a.md");
    const b = await f.backend.annotationsForSource("sources/b.md");
    f.rows.splice(0, 1);
    f.notify("annotations/a.md");
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: ["annotations/b.md", "annotations/c.md"] });
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ path: "annotations/c.md" }] });
    expect(await f.backend.annotationsForSource("sources/b.md")).toBe(b);
    expect(f.metadataQueries()).toHaveLength(1);
    f.backend.dispose();
  });

  it("keeps annotations cached through a burst of open-manuscript autosave echoes", async () => {
    const f = fixture([annotation, { ...manuscriptContract, contractType: "record", digest: "test", schema: {}, implementations: [implementation("paper", { title: "heading" })] }]);
    const path = "manuscripts/main.md";
    f.rows.push({ path, types: ["paper"], frontmatter: { type: "paper", heading: "Main" }, body: "# Main" });
    f.authority.seed(path, { frontmatter: { type: "paper", heading: "Main" }, body: "# Main" });
    vi.stubGlobal("fetch", async () => new Response("<xml/>"));
    const workspace = new ManuscriptWorkspace(f.backend, path);
    try {
      await vi.waitFor(() => expect(workspace.getSnapshot().phase).toBe("ready"));
      await vi.waitFor(() => expect(workspace.getSnapshot().annotationsLoad.phase).toBe("ready"));
      const cached = await f.backend.annotationsForSource("sources/a.md");
      const version = workspace.getSnapshot().annotationVersion;
      const queries = f.connection.queryPages.mock.calls.length;
      for (let i = 0; i < 20; i++) {
        workspace.setBody(path, `# Main\n\nEdit ${i}`);
        await workspace.retrySave();
        f.notify(path);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_100));
      expect(await f.backend.annotationsForSource("sources/a.md")).toBe(cached);
      expect(f.connection.queryPages).toHaveBeenCalledTimes(queries + 1);
      expect(f.metadataQueries()).toHaveLength(1);
      expect(workspace.getSnapshot().annotationVersion).toBe(version);
    } finally { await workspace.dispose(); f.backend.dispose(); f.authority.watch.close(); vi.unstubAllGlobals(); }
  });

  it.each([false, true])("pages a large source in 500-path query batches with document support=%s", async (documents) => {
    const f = fixture();
    f.description.authorityCapabilities = documents ? ["query-metadata-v1", "read-many-documents-v1"] : [];
    for (let i = 0; i < 700; i++) f.rows.push({ path: `annotations/extra-${i}.md`, types: ["highlight"], frontmatter: { reading: "[[a]]" }, body: "> More evidence" });
    await f.backend.library();
    const result = await f.backend.annotationsForSource("sources/a.md");
    expect(result.ok && result.value.length).toBe(702);
    expect(f.readRequests).not.toHaveBeenCalled();
    expect(f.bodyQueries()).toHaveLength(2);
    expect(f.bodyQueries().every((q) => JSON.parse(q.where!.replace(/^file\.path in /, "")).length <= 500)).toBe(true);
    f.connection.queryPages.mockImplementationOnce(async function* () { yield connectFailure<"access_denied">(connectProblem<"access_denied">("access_denied", "Temporary body query failure")); });
    expect(await f.backend.annotationsForSource("sources/b.md")).toMatchObject({ ok: false, message: "Temporary body query failure" });
    expect((await f.backend.annotationsForSource("sources/b.md")).ok).toBe(true);
    f.backend.dispose();
  });

  it("shares successful collection reads and retries failed cache loads", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.backend.index(), f.backend.index()]);
    expect(a).toBe(b);
    await f.backend.library();
    await f.backend.listManuscripts();
    const count = f.connection.queryPages.mock.calls.length;
    await Promise.all([f.backend.index(), f.backend.library(), f.backend.listManuscripts()]);
    expect(f.connection.queryPages).toHaveBeenCalledTimes(count);
    f.backend.dispose();
  });

  it("incrementally creates, renames and deletes notes, sources, annotations and mapped comments", async () => {
    const source = { ...sourceContract, contractType: "record" as const, digest: "test", schema: {}, implementations: [implementation("reader-source", { csl: "csl" })] };
    const comments = { ...commentContract, contractType: "record" as const, digest: "test", schema: {}, implementations: [implementation("feedback", { document: "about", created_at: "date", in_reply_to: "parent" })] };
    const f = fixture([annotation, source, comments]);
    f.rows.push({ path: "manuscripts/main.md", types: ["note"], frontmatter: {}, body: "Main" });
    await Promise.all([f.backend.index(), f.backend.library(), f.backend.annotationPaths(), f.backend.comments(["manuscripts/main.md"])]);
    const deltas: unknown[] = [];
    f.backend.onCollectionChange((delta) => deltas.push(delta));
    for (const [kind, type, fm] of [
      ["note", "note", {}],
      ["source", "reader-source", { csl: { id: "added", title: "Added" } }],
      ["annotation", "highlight", { reading: "[[sources/a]]" }],
      ["comment", "feedback", { about: "[[main]]", date: "2026-01-01" }],
    ] as const) {
      const row = { path: `records/${kind}.md`, types: [type] as string[], frontmatter: fm as JsonObject, body: "> Body" };
      f.rows.push(row);
      f.notify(row.path);
      expect((await f.backend.flushChanges()).ok).toBe(true);
      expect(await f.backend.index()).toMatchObject({ ok: true, value: { recordPaths: expect.arrayContaining([row.path]) } });
      if (kind === "source") expect(await f.backend.library()).toMatchObject({ ok: true, value: expect.arrayContaining([expect.objectContaining({ key: "added", path: row.path })]) });
      if (kind === "annotation") expect(await f.backend.annotationPaths()).toMatchObject({ ok: true, value: expect.arrayContaining([row.path]) });
      if (kind === "comment") expect(await f.backend.comments(["manuscripts/main.md"])).toMatchObject({ ok: true, value: [expect.objectContaining({ path: row.path, text: "> Body" })] });
      const old = row.path;
      row.path = `records/${kind}-renamed.md`;
      f.rename(old, row.path);
      await f.backend.flushChanges();
      const index = await f.backend.index();
      expect(index.ok && index.value.recordPaths.includes(old)).toBe(false);
      expect(index.ok && index.value.recordPaths.includes(row.path)).toBe(true);
      if (kind === "source") expect(await f.backend.library()).toMatchObject({ ok: true, value: expect.arrayContaining([expect.objectContaining({ path: row.path })]) });
      if (kind === "annotation") expect(await f.backend.annotationPaths()).toMatchObject({ ok: true, value: expect.arrayContaining([row.path]) });
      if (kind === "comment") expect(await f.backend.comments(["manuscripts/main.md"])).toMatchObject({ ok: true, value: [expect.objectContaining({ path: row.path })] });
      f.rows.splice(f.rows.indexOf(row), 1);
      f.notify(row.path);
      await f.backend.flushChanges();
      const removed = await f.backend.index();
      expect(removed.ok && removed.value.recordPaths.includes(row.path)).toBe(false);
      if (kind === "source") { const result = await f.backend.library(); expect(result.ok && result.value.some((s) => s.key === "added")).toBe(false); }
      if (kind === "annotation") { const result = await f.backend.annotationPaths(); expect(result.ok && result.value.includes(row.path)).toBe(false); }
      if (kind === "comment") expect(await f.backend.comments(["manuscripts/main.md"])).toEqual({ ok: true, value: [] });
    }
    expect(f.changedQueries()).toHaveLength(12);
    expect(deltas).toHaveLength(12);
    const before = f.connection.queryPages.mock.calls.length;
    await f.backend.reconcile();
    expect(f.connection.queryPages.mock.calls.length).toBeGreaterThan(before);
    expect(deltas.at(-1)).toMatchObject({ reset: true });
    f.backend.dispose();
  });

  it("selects scoped comment bodies with relative/bare documents and replies, then adds a chapter", async () => {
    const c = { ...commentContract, contractType: "record" as const, digest: "test", schema: {}, implementations: [implementation("feedback", { document: "about", created_at: "date", in_reply_to: "parent" })] };
    const f = fixture([annotation, c]);
    f.rows.push(
      { path: "manuscripts/main.md", types: ["note"], frontmatter: {}, body: "Main" },
      { path: "chapters/next.md", types: ["note"], frontmatter: {}, body: "Next" },
      { path: "notes/elsewhere.md", types: ["note"], frontmatter: {}, body: "Other" },
      { path: "comments/root.md", types: ["feedback"], frontmatter: { about: "[[../manuscripts/main]]", date: "2026-01-01" }, body: "Root body" },
      { path: "comments/reply.md", types: ["feedback"], frontmatter: { about: "[[elsewhere]]", parent: "[[root]]", date: "2026-01-02" }, body: "Reply body" },
      { path: "comments/chapter.md", types: ["feedback"], frontmatter: { about: "[[next]]", date: "2026-01-01" }, body: "Chapter body" },
      { path: "comments/other.md", types: ["feedback"], frontmatter: { about: "[[elsewhere]]", date: "2026-01-01" }, body: "Other body" },
    );
    expect(await f.backend.comments(["manuscripts/main.md"])).toMatchObject({ ok: true, value: [expect.objectContaining({ path: "comments/root.md" }), expect.objectContaining({ path: "comments/reply.md" })] });
    expect(f.bodyQueries().map((q) => q.where)).toEqual(['file.path in ["comments/root.md","comments/reply.md"]']);
    const more = await f.backend.comments(["manuscripts/main.md", "chapters/next.md"]);
    expect(more.ok && more.value.length).toBe(3);
    expect(f.bodyQueries()[1]?.where).toBe('file.path in ["comments/chapter.md"]');
    f.backend.dispose();
  });

  it("loads all scoped comments in bounded batches and handles a known note type transition", async () => {
    const c = { ...commentContract, contractType: "record" as const, digest: "test", schema: {}, implementations: [implementation("feedback", { document: "about", created_at: "date" })] };
    const f = fixture([annotation, c]);
    const note = { path: "main.md", types: ["note"], frontmatter: {} as JsonObject, body: "Main" };
    f.rows.push(note, ...Array.from({ length: 702 }, (_, i) => ({ path: `comments/${i}.md`, types: ["feedback"], frontmatter: { about: "[[main]]", date: "2026-01-01" }, body: `Comment ${i}` })));
    const loaded = await f.backend.comments(["main.md"]);
    expect(loaded.ok && loaded.value.length).toBe(702);
    expect(f.bodyQueries()).toHaveLength(2);
    expect(f.bodyQueries().every((q) => (JSON.parse(q.where!.replace(/^file\.path in /, "")) as string[]).length <= 500)).toBe(true);
    await f.backend.annotationPaths();
    note.types = ["highlight"]; note.frontmatter = { reading: "[[sources/a]]" };
    f.notify(note.path); await f.backend.flushChanges();
    expect(await f.backend.annotationPaths()).toMatchObject({ ok: true, value: expect.arrayContaining(["main.md"]) });
    const index = await f.backend.index();
    expect(index.ok && index.value.notePaths.includes("main.md")).toBe(false);
    f.backend.dispose();
  });

  it("coalesces bursts, queues one follow-up and retains failed paths for retry", async () => {
    const f = fixture();
    await f.backend.index();
    const original = f.connection.queryPages.getMockImplementation()!;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    f.connection.queryPages.mockImplementationOnce(async function* (input) { started(); await new Promise<void>((resolve) => { release = resolve; }); yield* original(input); });
    f.notify("annotations/a.md"); f.notify("annotations/b.md");
    const first = f.backend.flushChanges();
    await entered;
    f.notify("annotations/c.md");
    expect(f.backend.flushChanges()).toBe(first);
    release();
    await first;
    expect(f.changedQueries()).toHaveLength(2);
    f.connection.queryPages.mockImplementationOnce(async function* () { throw new Error("Transient metadata failure"); });
    f.notify("annotations/a.md");
    expect(await f.backend.flushChanges()).toMatchObject({ ok: false });
    expect(await f.backend.flushChanges()).toMatchObject({ ok: true });
    f.backend.dispose();
  });

  it.each(["mdbase.collection.invalidated", "future.event", "mdbase.contract.changed", "mdbase.config.changed", "mdbase.view.changed"])("reconciles %s without guessing payload paths", async (type) => {
    const f = fixture();
    await f.backend.library();
    await f.backend.annotationPaths();
    const events: (readonly string[])[] = [];
    f.backend.onExternalChange((paths) => events.push(paths));
    f.emit(type, { path: "annotations/a.md" });
    expect((await f.backend.flushChanges()).ok).toBe(true);
    expect(f.describeRequests).toHaveBeenCalledTimes(2);
    expect(events).toEqual([[]]);
    f.backend.dispose();
  });

  it("keeps classified metadata and lazy bodies when the SDK description TTL expires", async () => {
    const f = fixture();
    await f.backend.index();
    await f.backend.library();
    const cached = await f.backend.annotationsForSource("sources/a.md");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
    try {
      f.notify("annotations/b.md");
      expect((await f.backend.flushChanges()).ok).toBe(true);
      expect(f.describeRequests).toHaveBeenCalledTimes(2);
      expect(await f.backend.annotationsForSource("sources/a.md")).toBe(cached);
      expect(await f.backend.annotationPaths()).toMatchObject({ value: ["annotations/a.md", "annotations/b.md", "annotations/c.md"] });
    } finally { vi.restoreAllMocks(); f.backend.dispose(); }
  });

  it("never removes entries from a failed batch, even when sibling batches succeed", async () => {
    const f = fixture();
    for (let i = 0; i < 501; i++) f.rows.push({ path: `notes/${i}.md`, types: ["note"], frontmatter: {}, body: "Note" });
    await f.backend.index();
    f.connection.queryPages.mockImplementationOnce(async function* () {
      yield connectFailure(connectProblem<"access_denied">("access_denied", "Batch failed"));
    });
    for (let i = 0; i < 501; i++) f.notify(`notes/${i}.md`);
    expect(await f.backend.flushChanges()).toEqual({ ok: false, message: "Batch failed" });
    const index = await f.backend.index();
    expect(index.ok && index.value.recordPaths.length).toBe(506);
    expect(await f.backend.flushChanges()).toEqual({ ok: true, value: undefined });
    expect(f.changedQueries()).toHaveLength(4);
    f.backend.dispose();
  });

  it("does not cache partial selected bodies after a sibling batch fails", async () => {
    const f = fixture();
    for (let i = 0; i < 501; i++) f.rows.push({ path: `annotations/extra-${i}.md`, types: ["highlight"], frontmatter: { reading: "[[a]]" }, body: "> Evidence" });
    await f.backend.library();
    await f.backend.annotationPaths();
    f.connection.queryPages.mockImplementationOnce(async function* () {
      yield connectFailure(connectProblem<"access_denied">("access_denied", "Batch failed"));
    });
    expect(await f.backend.annotationsForSource("sources/a.md")).toEqual({ ok: false, message: "Batch failed" });
    const result = await f.backend.annotationsForSource("sources/a.md");
    expect(result.ok && result.value.length).toBe(503);
    expect(f.bodyQueries()).toHaveLength(4);
    f.backend.dispose();
  });

  it("shares describe between bindings and metadata, and retries failed queries/reads", async () => {
    const f = fixture([annotation, { ...manuscriptContract, contractType: "record", digest: "test", schema: {}, implementations: [implementation("paper", { title: "heading" })] }]);
    await Promise.all([f.backend.manuscriptBindings(), f.backend.annotationPaths()]);
    expect(f.describeRequests).toHaveBeenCalledTimes(1);
    await f.backend.library();
    f.connection.queryPages.mockImplementationOnce(async function* () { throw new Error("Read failed"); });
    await expect(f.backend.annotationsForSource("sources/b.md")).rejects.toThrow("Read failed");
    expect((await f.backend.annotationsForSource("sources/b.md")).ok).toBe(true);
    f.backend.dispose();
  });
});

it("installed authority/SDK: unknown types are empty and typed path filters batch bodies safely",  async () => {
  const root = await mkdtemp(join(tmpdir(), "writer-query-"));
  let collection: Collection | undefined;
  try {
    await Collection.init(root, { config: { name: "Query test" } });
    await mkdir(join(root, "_types"), { recursive: true });
    await writeFile(join(root, "_types/highlight.md"), "---\nkind: mdbase.type\nname: highlight\nversion: 1\nschema:\n  dialect: json-schema-2020-12\n  value:\n    type: object\n    properties:\n      type: { const: highlight }\n---\n");
    await writeFile(join(root, "a.md"), "---\ntype: highlight\nsource: '[[sources/a]]'\nextra: retained\n---\n\n> Body not requested\n");
    await writeFile(join(root, 'quoted"name.md'), "---\ntype: highlight\n---\n\n> Quoted filename\n");
    await writeFile(join(root, "unrelated.md"), "---\ntype: highlight\n---\n\n> Unrelated body\n");
    const opened = await Collection.open(root);
    collection = opened.collection!;
    const operations = collection.v03Operations();
    const client = new MdbaseCollectionClient({ async operation<Result>(_operation: string, input: unknown): Promise<Result> {
      return await operations.query(input as Parameters<typeof operations.query>[0]) as Result;
    } });
    const queried = await client.query({ types: ["highlight"], select: ["source"], frontmatterMode: "persisted" });
    expect(queried.ok).toBe(true);
    if (!queried.ok) throw new Error(queried.problem.message);
    expect(queried.value.results[0]).toMatchObject({ path: "a.md", frontmatter: { source: "[[sources/a]]", extra: "retained" }, values: { source: "[[sources/a]]" } });
    expect(queried.value.results[0]).not.toHaveProperty("body");
    expect(await client.query({ types: ["reader-annotation"] })).toMatchObject({ ok: true, value: { results: [] } });
    const paths = ["a.md", 'quoted"name.md'];
    const bodies = await client.readMany([...paths, "missing.md", paths[0]!], { types: ["highlight"], frontmatterMode: "persisted", includeBody: true, batchSize: 1 });
    expect(bodies.ok).toBe(true);
    if (bodies.ok) {
      expect(bodies.value.errors).toEqual([]);
      expect(bodies.value.results.map((r) => r.status)).toEqual(["found", "found", "missing", "found"]);
      expect(bodies.value.results[0]).toMatchObject({ record: { body: expect.stringContaining("Body not requested") } });
      expect(bodies.value.results[1]).toMatchObject({ record: { body: expect.stringContaining("Quoted filename") } });
    }
    const changed = await client.readMany(paths, { frontmatterMode: "both" });
    expect(changed.ok).toBe(true);
    if (changed.ok) {
      expect(changed.value.results.map((r) => r.path)).toEqual(paths);
      expect(changed.value.results[0]).toHaveProperty("record.frontmatter");
      expect(changed.value.results[0]).toHaveProperty("record.effectiveFrontmatter");
      expect(changed.value.results[0]).not.toHaveProperty("record.body");
    }
  } finally { await collection?.close(); await rm(root, { recursive: true, force: true }); }
});
