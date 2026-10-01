import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection } from "@callumalpass/mdbase";
import type { CollectionDescription, JsonObject, MdbaseConnection, QueryInput } from "@mdbase-dev/connect";
import { MdbaseCollectionClient, connectFailure, connectProblem, connectSuccess } from "@mdbase-dev/connect/advanced";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import { ManuscriptWorkspace } from "../workspace/workspace.js";
import { describe, expect, it, vi } from "vitest";
import { annotationContract, ConnectBackend, manuscriptContract } from "./connect.js";

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
  let notify: (event: { type: string; payload: JsonObject }) => void = () => {};
  let resetWatch = () => {};
  const queryPages = vi.fn<(input: QueryInput) => ReturnType<MdbaseConnection<JsonObject>["queryPages"]>>(async function* (input: QueryInput) {
    const paths: string[] | undefined = input.where ? JSON.parse(input.where.replace(/^file\.path in /, "")) as string[] : undefined;
    const results = rows.filter((r) => (!input.types || input.types.some((t) => r.types.includes(t))) && (!paths || paths.includes(r.path))).map(({ body, ...row }) => ({ ...row, ...(input.includeBody ? { body } : {}), file: {} }));
    yield connectSuccess({ results, page: 0, offset: 0, loaded: results.length, complete: true });
  });
  const read = vi.fn(async ({ path }: { path: string }) => {
    const row = rows.find((r) => r.path === path)!;
    return connectSuccess({ ...row, frontmatter: row.frontmatter as JsonObject, effectiveFrontmatter: row.frontmatter as JsonObject, revision: "1", file: {} });
  });
  const connection = {
    describe: vi.fn(async () => connectSuccess(description)),
    queryPages, read,
    watch: async () => connectSuccess({ subscribe: (listener: typeof notify, onStatus?: (status: { state: string }) => void) => { notify = listener; resetWatch = () => onStatus?.({ state: "reset_required" }); }, close() {} }),
    records: { follow: () => () => {}, open: authority.records.open.bind(authority.records) },
    info: () => ({ collectionId: "test" }),
    files: { async *list() {} },
  };
  const backend = new ConnectBackend(connection as unknown as MdbaseConnection<JsonObject>);
  // Library normally supplies these source paths; use a contract query as it does in production.
  const original = connection.queryPages;
  const sourceNames = ["a", "b"];
  connection.queryPages = vi.fn(async function* (input: QueryInput) {
    if (input.contract || input.types?.includes("reader-source")) {
      yield connectSuccess({ results: sourceNames.map((key) => ({ path: `sources/${key}.md`, types: ["reader-source"], effectiveFrontmatter: { csl: { id: key, title: key } }, file: {} })), page: 0, offset: 0, loaded: 2, complete: true });
    } else yield* original(input);
  }) as typeof original;
  return { backend, connection, description, authority, rows, read, sourceNames, bodyQueries: () => connection.queryPages.mock.calls.filter(([q]) => q.includeBody).map(([q]) => q), metadataQueries: () => connection.queryPages.mock.calls.filter(([q]) => q.types?.some((t) => t === "highlight" || t === "reader-annotation") && !q.includeBody).map(([q]) => q), notify: (path: string) => notify({ type: "mdbase.record.modified", payload: { path } }), rename: (from: string, to: string) => notify({ type: "mdbase.record.renamed", payload: { from, to } }), reset: () => resetWatch() };
}

describe("annotation loading", () => {
  it("discovers all identities without bodies, then reads only the selected source with mapped fields", async () => {
    const f = fixture();
    await f.backend.library();
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: f.rows.map((r) => r.path) });
    expect(f.read).not.toHaveBeenCalled();
    const result = await f.backend.annotationsForSource("sources/a.md");
    expect(result).toMatchObject({ ok: true, value: [{ path: "annotations/a.md", quote: "Quote A", note: "Private note.", locator: "p. 12" }, { path: "annotations/c.md", quote: "Another A" }] });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.bodyQueries()).toEqual([{ types: ["highlight"], where: 'file.path in ["annotations/a.md","annotations/c.md"]', frontmatterMode: "persisted", includeBody: true }]);
    await f.backend.annotationsForSource("sources/b.md");
    const b = await f.backend.annotationsForSource("sources/b.md");
    await f.backend.annotationsForSource("sources/a.md");
    expect(f.bodyQueries()).toHaveLength(2);
    f.rows[0]!.body = "> New quote";
    f.notify("annotations/a.md");
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ quote: "New quote" }, { quote: "Another A" }] });
    expect(f.bodyQueries()).toHaveLength(3);
    expect(f.metadataQueries()).toHaveLength(2);
    expect(f.metadataQueries()[1]?.where).toBe('file.path in ["annotations/a.md"]');
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
    expect(f.connection.queryPages).toHaveBeenCalledWith({ types: ["reader-annotation"], frontmatterMode: "persisted" }, { pageSize: 1_000 });
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

  it("rediscovers newly installed Reader types on a schema-folder change", async () => {
    const f = fixture([], []);
    f.description.configuration = { settings: { types_folder: "schemas/kinds" } };
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: [] });
    f.description.types.push({ name: "reader-annotation", schema: {}, extensions: {} });
    f.rows[0]!.types = ["reader-annotation"];
    f.rows[0]!.frontmatter["source"] = "[[sources/a]]";
    f.notify("schemas/kinds/reader-annotation.md");
    expect(await f.backend.annotationPaths()).toEqual({ ok: true, value: ["annotations/a.md"] });
    expect(f.connection.describe).toHaveBeenCalledTimes(2);
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
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ path: "annotations/renamed.md" }, { path: "annotations/c.md" }] });
    f.reset();
    await f.backend.annotationsForSource("sources/a.md");
    expect(f.bodyQueries()).toHaveLength(3);
    expect(events).toEqual([["annotations/a.md", "annotations/renamed.md"], []]);
    expect(f.connection.describe).toHaveBeenCalledTimes(2);
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
    expect(f.connection.queryPages).toHaveBeenCalledTimes(queries);
    f.backend.dispose();
  });

  it("moves one changed entry between sources without discarding unrelated caches", async () => {
    const f = fixture();
    await f.backend.library();
    await f.backend.annotationsForSource("sources/a.md");
    await f.backend.annotationsForSource("sources/b.md");
    f.rows[0]!.frontmatter["reading"] = "[[b]]";
    f.notify("annotations/a.md");
    expect(await f.backend.annotationsForSource("sources/b.md")).toMatchObject({ ok: true, value: [{ path: "annotations/a.md" }, { path: "annotations/b.md" }] });
    expect(await f.backend.annotationsForSource("sources/a.md")).toMatchObject({ ok: true, value: [{ path: "annotations/c.md" }] });
    expect(f.metadataQueries()).toHaveLength(2);
    expect(f.metadataQueries()[1]?.where).toBe('file.path in ["annotations/a.md"]');
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
    expect(f.metadataQueries()).toHaveLength(2);
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
      expect(f.connection.queryPages).toHaveBeenCalledTimes(queries);
      expect(workspace.getSnapshot().annotationVersion).toBe(version);
    } finally { await workspace.dispose(); f.backend.dispose(); f.authority.watch.close(); vi.unstubAllGlobals(); }
  });

  it("pages a large source in bounded path batches and propagates body-query errors", async () => {
    const f = fixture();
    for (let i = 0; i < 700; i++) f.rows.push({ path: `annotations/extra-${i}.md`, types: ["highlight"], frontmatter: { reading: "[[a]]" }, body: "> More evidence" });
    await f.backend.library();
    const result = await f.backend.annotationsForSource("sources/a.md");
    expect(result.ok && result.value.length).toBe(702);
    expect(f.bodyQueries()).toHaveLength(2);
    expect(f.bodyQueries().every((q) => JSON.parse(q.where!.replace(/^file\.path in /, "")).length <= 500)).toBe(true);
    f.connection.queryPages.mockImplementationOnce(async function* () { yield connectFailure<"access_denied">(connectProblem<"access_denied">("access_denied", "Temporary body query failure")); });
    expect(await f.backend.annotationsForSource("sources/b.md")).toMatchObject({ ok: false, message: "Temporary body query failure" });
    expect((await f.backend.annotationsForSource("sources/b.md")).ok).toBe(true);
    f.backend.dispose();
  });

  it("shares describe between bindings and metadata, and retries failed queries/reads", async () => {
    const f = fixture([annotation, { ...manuscriptContract, contractType: "record", digest: "test", schema: {}, implementations: [implementation("paper", { title: "heading" })] }]);
    await Promise.all([f.backend.manuscriptBindings(), f.backend.annotationPaths()]);
    expect(f.connection.describe).toHaveBeenCalledTimes(1);
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
    const pages = [];
    for await (const page of client.queryPages({ types: ["highlight"], where: `file.path in ${JSON.stringify(paths)}`, frontmatterMode: "persisted", includeBody: true }, { pageSize: 1 })) {
      expect(page.ok).toBe(true);
      if (page.ok) pages.push(...page.value.results);
    }
    expect(pages.map((r) => r.path).sort()).toEqual(paths.sort());
    expect(pages.map((r) => r.body)).toEqual([expect.stringContaining("Body not requested"), expect.stringContaining("Quoted filename")]);
  } finally { await collection?.close(); await rm(root, { recursive: true, force: true }); }
});
