import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, MdbaseError, MdbasePeopleClient, type MdbaseApplicationConnection, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import { NativeWriterBackend } from "./native.js";
import { nativeWriterSchema } from "./native-schema.js";

// Native catalog/type metadata are explicit stand-ins. All record/file/session
// operations use actual public SDK over MemoryReplica, not native acceptance.
const clients: MdbaseClient[] = [];
const backends: NativeWriterBackend[] = [];
afterEach(() => {for (const backend of backends.splice(0)) backend.dispose(); for (const client of clients.splice(0)) client.close(); vi.restoreAllMocks();});
function catalog(): wire.DescribeResult {
  const definitions = manifest.requirements.contracts.map((contract, index) => ({contract, type: ["native-manuscript", "native-source", "native-comment"][index] ?? "unknown"}));
  const mappings: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    "native-manuscript": {title: "heading", template: "layout", csl: "style"},
    "native-source": {title: "heading", csl: "citation"},
    "native-comment": {document: "document", motivation: "motivation", status: "status", created_at: "created_at", created_by: "created_by", in_reply_to: "in_reply_to", target: "target", suggestion: "suggestion", resolved_at: "resolved_at", resolved_by: "resolved_by", modified_at: "modified_at", deleted_at: "deleted_at"},
  };
  return {specVersion: "0.3.0", settings: new Map([["explicit_type_keys", ["type"]]]), inclusion: {include: ["image"]}, issues: [],
    contracts: definitions.map(({contract, type}) => ({...contract, digest: contract.digest.replace(/^sha256:/, ""), path: `_contracts/${contract.id}.md`, contractType: "record", implementedBy: [type]})),
    types: definitions.map(({contract, type}) => ({name: type, path: `_types/${type}.md`, implements: [{contract: contract.id, version: contract.version, fields: new Map(Object.entries(mappings[type] ?? {}))}]}))};
}
async function fixture() {
  const replica = new MemoryReplica({confirmDelayMs: 0});
  const manuscript = replica.seed({path: "manuscripts/original.md", types: ["native-manuscript"], frontmatter: {type: "native-manuscript", heading: "Original", layout: "article", style: "apa"}, body: "Original manuscript\n"});
  replica.seed({path: "sources/paper.md", types: ["native-source"], frontmatter: {type: "native-source", heading: "Citation source", citation: new Map([["id", "paper"], ["type", "article-journal"], ["title", "Citation source"]])}, body: "Lazy source body\n"});
  replica.seed({path: "notes/chapter.md", frontmatter: {custom: "keep"}, body: "# A chapter\n"});
  const client = await connect({connector: replica.connector(), app: {name: "writer-native-test", version: "test"}, reconnect: false}); clients.push(client);
  const description = catalog(); vi.spyOn(client, "describe").mockResolvedValue(description);
  const metadata = vi.fn(async () => {throw new Error("Identity was not approved");});
  const current = vi.fn(() => true);
  const connection: MdbaseApplicationConnection = {id: client.collection, displayName: "Writing", scope: {account: "fixture-account", installation: "fixture-installation", collection: client.collection}, generation: "fixture-generation", records: client, files: client.files,
    people: new MdbasePeopleClient(client, {collection: client.collection, request: metadata, isCurrent: current}), isCurrent: current};
  const caller = new AbortController();
  const backend = new NativeWriterBackend(connection, {collectionName: "Writing", signal: caller.signal}); backends.push(backend);
  return {replica, client, description, metadata, current, caller, backend, manuscript};
}

describe("native Writer domain backend", () => {
  it("discovers mapped manuscripts/library/index without bodies or identity requests", async () => {
    const h = await fixture(); const query = vi.spyOn(h.client, "query"); const get = vi.spyOn(h.client, "get");
    const manuscripts = await h.backend.listManuscripts();
    expect(manuscripts).toEqual({ok: true, value: [{path: "manuscripts/original.md", title: "Original", template: "article", style: "apa"}]});
    const library = await h.backend.library();
    expect(library.ok && library.value[0]?.key).toBe("paper");
    const index = await h.backend.index();
    expect(index.ok && index.value.recordPaths).toContain("sources/paper.md");
    expect(index.ok && index.value.notePaths).not.toContain("sources/paper.md");
    expect(index.ok && index.value.notePaths).toContain("notes/chapter.md");
    expect(query.mock.calls.every(call => !call[1]?.body && !call[1]?.document)).toBe(true);
    expect(get).not.toHaveBeenCalled(); expect(h.metadata).not.toHaveBeenCalled();
    expect("writeFile" in h.backend).toBe(false);
  });
  it("discovers all records across actual SDK pages rather than truncating the native index", async () => {
    const h = await fixture();
    for (let index = 0; index < 501; index++) h.replica.seed({path: `notes/page-${index}.md`, body: `Note ${index}`});
    const result = await h.backend.index();
    expect(result.ok && result.value.recordPaths).toHaveLength(504);
    expect(result.ok && result.value.recordPaths).toContain("notes/page-500.md");
  });
  it.each(["changed snapshot", "repeated cursor"]) ("refuses unsafe metadata pagination: %s", async failure => {
    const h = await fixture(); const actual = await h.client.query({}, {effective: true});
    vi.spyOn(h.client, "pages").mockImplementation(async function* () {
      yield {...actual, records: [], complete: false, cursor: "original-cursor"};
      yield {...actual, records: [], complete: false, ...(failure === "changed snapshot" ? {asOf: actual.asOf + 1, cursor: "next-cursor"} : {cursor: "original-cursor"})};
      throw new Error("The repository must stop before requesting another unsafe page");
    });
    expect(await h.backend.index()).toMatchObject({ok: false, message: expect.stringContaining(failure === "changed snapshot" ? "snapshot changed" : "cursor repeated")});
  });
  it.each(["protected", "wrong identity"]) ("does not expose a lazy body from %s native readback", async failure => {
    const h = await fixture(); await h.backend.index();
    const get = h.client.get.bind(h.client);
    vi.spyOn(h.client, "get").mockImplementation(async (...args) => {
      const record = await get(...args);
      return failure === "protected" ? {...record, state: {...record.state, unresolved: 1}} : {...record, id: crypto.randomUUID()};
    });
    expect((await h.backend.readBody("manuscripts/original.md")).ok).toBe(false);
  });
  it("refuses changed exact contract digest and never uses starter-name fallback", async () => {
    const h = await fixture(); const first = h.description.contracts[0]; if (!first) throw new Error("Missing fixture contract");
    first.digest = "f".repeat(64);
    expect((await h.backend.listManuscripts()).ok).toBe(false);
    first.digest = manifest.requirements.contracts[0]?.digest.replace(/^sha256:/, "") ?? "";
    const schema = nativeWriterSchema(h.description);
    expect(schema.roles(["writer-manuscript"]).size).toBe(0);
    expect(schema.roles(["native-manuscript"]).has("manuscript")).toBe(true);
  });
  it("opens the same native record session, saves/readbacks, and never closes a peer lease/client", async () => {
    const h = await fixture(); const close = vi.spyOn(h.client, "close");
    const peer = await h.client.records.open({path: "manuscripts/original.md"}, {autosave: false});
    const opened = await h.backend.records.open("manuscripts/original.md", {autosave: false}); if (!opened.ok) throw new Error("Native lease missing");
    expect(opened.value.session.getNativeSnapshot().record.id).toBe(h.manuscript.id);
    opened.value.session.setBody("Changed through native lease\n");
    expect((await opened.value.session.flush()).ok).toBe(true);
    expect((await h.client.get(h.manuscript.id, {body: true})).body).toBe("Changed through native lease\n");
    h.backend.dispose(); expect(close).not.toHaveBeenCalled();
    peer.session.setBody("Peer still active\n"); expect((await peer.session.flush()).ok).toBe(true); peer.release();
  });
  it("creates a mapped manuscript and chapter only after confirmed current native readback", async () => {
    const h = await fixture();
    const created = await h.backend.createManuscript({title: "Launch", template: "article", style: "apa"});
    expect(created).toEqual({ok: true, value: "manuscripts/launch.md"});
    const actual = await h.client.get({path: "manuscripts/launch.md"}, {body: true});
    expect(actual.frontmatter.get("heading")).toBe("Launch"); expect(actual.state.state).toBe("confirmed");
    const chapter = await h.backend.createRecord("notes/chapter.md", "# New chapter\n");
    expect(chapter).toEqual({ok: true, value: "notes/chapter-2.md"});
  });
  it("adopts a note with original UUID/body/custom metadata preserved by native CAS", async () => {
    const h = await fixture();
    // MemoryReplica stores explicit seed types; it does not run native Core's
    // catalog reclassification. Only this returned type metadata is a stand-in;
    // UUID/revision/full source/CAS/receipt/readback stay actual public SDK data.
    const get = h.client.get.bind(h.client);
    vi.spyOn(h.client, "get").mockImplementation(async (...args) => {
      const record = await get(...args);
      const declared = record.frontmatter.get("type");
      if (typeof declared === "string") record.types = [...new Set([...record.types, declared])];
      return record;
    });
    const original = await h.client.get({path: "notes/chapter.md"}, {body: true, document: true});
    expect(await h.backend.adoptManuscript(original.path)).toEqual({ok: true, value: original.path});
    const changed = await h.client.get(original.id, {body: true});
    expect(changed.id).toBe(original.id); expect(changed.body).toBe(original.body);
    expect(changed.frontmatter.get("custom")).toBe("keep"); expect(changed.types).toContain("native-manuscript");
  });
  it("reads native files by original file UUID/digest and keeps upload unavailable", async () => {
    const h = await fixture(); const bytes = new Uint8Array([1, 2, 3]);
    const original = await h.client.files.upload("figures/image.png", bytes); await original.confirmed;
    const read = await h.backend.readFile("figures/image.png");
    expect(read).toEqual({ok: true, value: bytes});
    expect("writeFile" in h.backend).toBe(false);
  });
  it("creates/reads/resolves an unsigned native comment without inventing an account", async () => {
    const h = await fixture();
    const created = await h.backend.createComment({document: "manuscripts/original.md", text: "Review this sentence"});
    if (!created.ok) throw new Error(created.message);
    expect(created.value.createdBy).toBeUndefined();
    const listed = await h.backend.comments(["manuscripts/original.md"]);
    expect(listed.ok && listed.value.map(comment => comment.path)).toContain(created.value.path);
    const changed = await h.backend.changeComment(created.value, {kind: "resolve"});
    expect(changed.ok && changed.value.status).toBe("resolved");
  });
  it.each(["untyped", "sdk-mid", "mismatched-sdk-mid"])("recovers a %s lost create reply by the original SDK MID without creating a duplicate", async mode => {
    const h = await fixture();
    const original = h.client.create.bind(h.client);
    const submitted: string[] = [];
    vi.spyOn(h.client, "create").mockImplementationOnce(async (input, options) => {
      if (!options?.mutationId) throw new Error("Missing original MID");
      submitted.push(options.mutationId);
      const write = await original(input, options); await write.confirmed;
      if (mode === "untyped") throw new Error("Lost original reply");
      throw new MdbaseError({code: "outcome_unknown", recovery: "resolve_outcome", message: "Lost original reply"},
        {mutationId: mode === "sdk-mid" ? write.mutationId : crypto.randomUUID()});
    });
    const lost = await h.backend.createRecord("notes/unknown.md", "Original intent\n");
    expect(lost.ok).toBe(false);
    if (mode === "mismatched-sdk-mid") expect(lost).toMatchObject({message: "Writer lost the original mutation identity."});
    const receipt = vi.spyOn(h.client, "awaitReceipt");
    const recover = await h.backend.createRecord("notes/unknown.md", "Fresh retry must not submit\n");
    expect(recover).toMatchObject({ok: false, message: expect.stringContaining("recovered the original operation")});
    expect(receipt).toHaveBeenCalledWith(submitted[0], 5_000, expect.any(AbortSignal));
    expect(h.client.create).toHaveBeenCalledOnce();
    const queried = await h.client.query({}, {body: true});
    const records = queried.records.filter(record => record.path === "notes/unknown.md");
    expect(records).toHaveLength(1); expect(records[0]?.body).toBe("Original intent\n");
  });
  it("fences late retired data and aborts only the repository watch/scope", async () => {
    const h = await fixture(); const close = vi.spyOn(h.client, "close");
    const pending = h.backend.listManuscripts(); h.current.mockReturnValue(false);
    expect((await pending).ok).toBe(false);
    h.caller.abort(); expect((await h.backend.readBody("manuscripts/original.md")).ok).toBe(false);
    expect(close).not.toHaveBeenCalled(); expect(h.client.link).toBe("open");
  });
});
