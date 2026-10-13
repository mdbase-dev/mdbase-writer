import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, MdbaseError, MdbasePeopleClient, type ChangesWatch, type MdbaseApplicationConnection, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica, type MemoryContract } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import { NativeWriterBackend } from "./native.js";
import { nativeObject, nativeWriterSchema } from "./native-schema.js";

// Native catalog/type metadata are explicit stand-ins. All record/file/session
// operations use actual public SDK over MemoryReplica, not native acceptance.
const clients: MdbaseClient[] = [];
const backends: NativeWriterBackend[] = [];
afterEach(() => {for (const backend of backends.splice(0)) backend.dispose(); for (const client of clients.splice(0)) client.close(); vi.restoreAllMocks();});
function catalog(): wire.DescribeResult {
  const definitions = manifest.requirements.contracts.map((contract, index) => ({contract, type: ["native-manuscript", "native-source", "native-comment"][index] ?? "unknown"}));
  const mappings: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    "native-manuscript": {title: "/meta/heading", template: "layout", csl: "style"},
    "native-source": {title: "heading", csl: "citation"},
    "native-comment": {document: "document", motivation: "motivation", status: "/review/state", created_at: "created_at", created_by: "created_by", in_reply_to: "in_reply_to", target: "target", suggestion: "suggestion", resolved_at: "resolved_at", resolved_by: "resolved_by", modified_at: "/review/modified", deleted_at: "/review/deleted"},
  };
  return {specVersion: "0.3.0", settings: new Map([["explicit_type_keys", ["type"]]]), inclusion: {include: ["image"]}, issues: [],
    contracts: definitions.map(({contract, type}) => ({...contract, path: `_contracts/${contract.id}.md`, contractType: "record", implementedBy: [type]})),
    types: definitions.map(({contract, type}) => ({name: type, path: `_types/${type}.md`, implements: [{contract: contract.id, version: contract.version, fields: new Map(Object.entries(mappings[type] ?? {}))}]}))};
}
async function fixture(beforeBackend?: (client: MdbaseClient) => void) {
  const description = catalog();
  const contracts: MemoryContract[] = description.types.flatMap(type => (type.implements ?? []).map(implementation => {
    const contract = description.contracts.find(candidate => candidate.id === implementation.contract && candidate.version === implementation.version);
    if (!contract || !implementation.version) throw new Error("Missing exact fixture contract");
    return {id: contract.id, version: implementation.version, type: type.name, contractDigest: contract.digest, fields: Object.fromEntries(implementation.fields ?? new Map())};
  }));
  const replica = new MemoryReplica({confirmDelayMs: 0, contracts});
  const manuscript = replica.seed({path: "manuscripts/original.md", types: ["native-manuscript"], frontmatter: {type: "native-manuscript", meta: new Map([["heading", "Original"]]), layout: "article", style: "apa"}, body: "Original manuscript\n"});
  replica.seed({path: "sources/paper.md", types: ["native-source"], frontmatter: {type: "native-source", heading: "Citation source", citation: new Map([["id", "paper"], ["type", "article-journal"], ["title", "Citation source"]])}, body: "Lazy source body\n"});
  replica.seed({path: "notes/chapter.md", frontmatter: {custom: "keep"}, body: "# A chapter\n"});
  const client = await connect({connector: replica.connector(), app: {name: "writer-native-test", version: "test"}, reconnect: false}); clients.push(client);
  vi.spyOn(client, "describe").mockResolvedValue(description);
  const metadata = vi.fn(async () => {throw new Error("Identity was not approved");});
  const current = vi.fn(() => true);
  const connection: MdbaseApplicationConnection = {id: client.collection, displayName: "Writing", scope: {account: "fixture-account", installation: "fixture-installation", collection: client.collection}, generation: "fixture-generation", records: client, files: client.files,
    people: new MdbasePeopleClient(client, {collection: client.collection, request: metadata, isCurrent: current}), isCurrent: current};
  const caller = new AbortController();
  beforeBackend?.(client);
  const backend = new NativeWriterBackend(connection, {collectionName: "Writing", signal: caller.signal}); backends.push(backend);
  return {replica, client, description, metadata, current, caller, backend, manuscript};
}

// Public watch lifecycle stand-ins only; no private SDK fault hooks.
function controlledWatch(initialState: ChangesWatch["state"] = "active", ready: Promise<void> = Promise.resolve()) {
  let state = initialState;
  const listeners = new Set<Parameters<ChangesWatch["subscribe"]>[0]>();
  const stop = vi.fn(() => {state = "closed";});
  const watch: ChangesWatch = Object.assign(stop, {ready, state, error: null,
    subscribe: (listener: Parameters<ChangesWatch["subscribe"]>[0]) => {listeners.add(listener); return () => {listeners.delete(listener);};}});
  Object.defineProperty(watch, "state", {get: () => state});
  return {watch, stop, listeners, publish(next: ChangesWatch["state"]) {state = next; for (const listener of listeners) listener(next, null);}};
}

describe("native Writer domain backend", () => {
  it("discovers mapped manuscripts/library/index without bodies or identity requests", async () => {
    const h = await fixture(); const query = vi.spyOn(h.client, "query"); const get = vi.spyOn(h.client, "get");
    const projected = await h.client.queryContract({id: "dev.mdbase.writer.manuscript", version: "1.0.0-beta.2"}, {pageSize: 128});
    expect(projected.records[0]?.implementations[0]?.fields.get("title")).toBe("Original");
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
  it("unrelated invalid definitions do not hide Writer records or untyped notes", async () => {
    const h = await fixture();
    h.description.issues.push({code: "type_invalid", severity: "error", message: "An unrelated custom type is invalid", details: new Map([["path", "_types/unrelated.md"]])});
    expect(await h.backend.listManuscripts()).toMatchObject({ok: true, value: [{path: "manuscripts/original.md"}]});
    expect(await h.backend.index()).toMatchObject({ok: true, value: {notePaths: expect.arrayContaining(["notes/chapter.md"])}});
    expect(await h.backend.readBody("notes/chapter.md")).toEqual({ok: true, value: "# A chapter\n"});
    const first = h.description.contracts[0]; if (!first) throw new Error("Missing original contract");
    first.digest = `sha256:${"f".repeat(64)}`;
    expect(() => nativeWriterSchema(h.description)).toThrow("exact native contracts");
  });
  it("opens a catalog whose contract digests use the wire's sha256: form", async () => {
    // UX-001: a fresh collection's describe reports `sha256:<hex>` digests,
    // the same form as the manifest. Writer must not require bare hex.
    const h = await fixture();
    expect(h.description.contracts.every(contract => contract.digest.startsWith("sha256:"))).toBe(true);
    expect(await h.backend.listManuscripts()).toMatchObject({ok: true, value: [{path: "manuscripts/original.md"}]});
    expect((await h.backend.index()).ok).toBe(true);
    expect((await h.backend.library()).ok).toBe(true);
  });
  it("opens a collection whose catalog has no settings (null)", async () => {
    // UX-001: a fresh collection without mdbase.yaml settings reports `settings: null`;
    // Writer failed "Writer requires a native field map." and loaded nothing.
    const h = await fixture();
    (h.description as {settings: unknown}).settings = null;
    expect(await h.backend.listManuscripts()).toMatchObject({ok: true, value: [{path: "manuscripts/original.md"}]});
    expect((await h.backend.index()).ok).toBe(true);
  });
  it("lists untyped records as untyped notes rather than dropping them", async () => {
    const h = await fixture();
    const index = await h.backend.index();
    expect(index.ok && index.value.untypedPaths).toEqual(["notes/chapter.md"]);
    expect(index.ok && index.value.notePaths).toContain("notes/chapter.md");
  });
  it("an error in one of Writer's own types makes only that type unavailable", async () => {
    const h = await fixture();
    h.description.issues.push({code: "type_invalid", severity: "error", message: "Bad comment type", details: new Map([["path", "_types/native-comment.md"]])});
    expect(await h.backend.listManuscripts()).toMatchObject({ok: true, value: [{path: "manuscripts/original.md"}]});
    expect((await h.backend.library()).ok).toBe(true);
    const index = await h.backend.index();
    expect(index).toMatchObject({ok: true, value: {notePaths: expect.arrayContaining(["notes/chapter.md"]),
      unavailableTypes: [{name: "native-comment", message: expect.stringContaining("Comments")}]}});
    expect(await h.backend.comments()).toMatchObject({ok: false, message: expect.stringContaining("native-comment")});
    expect(await h.backend.createComment({document: "manuscripts/original.md", text: "Hi"})).toMatchObject({ok: false, message: expect.stringContaining("native-comment")});
  });
  it("an error in the manuscript type leaves notes and sources usable", async () => {
    const h = await fixture();
    h.description.issues.push({code: "type_invalid", severity: "error", message: "Bad manuscript type", details: new Map([["path", "_types/native-manuscript.md"]])});
    expect(await h.backend.listManuscripts()).toMatchObject({ok: false, message: expect.stringContaining("native-manuscript")});
    expect(await h.backend.library()).toMatchObject({ok: true, value: [{key: "paper"}]});
    const index = await h.backend.index();
    expect(index.ok && index.value.notePaths).not.toContain("manuscripts/original.md");
    expect(index.ok && index.value.notePaths).toContain("notes/chapter.md");
    expect(await h.backend.readBody("notes/chapter.md")).toEqual({ok: true, value: "# A chapter\n"});
  });
  it("one record with an invalid projection does not block the collection", async () => {
    const h = await fixture();
    const original = h.client.queryContract.bind(h.client);
    vi.spyOn(h.client, "queryContract").mockImplementation(async (contract, options) => {
      const result = await original(contract, options);
      return {...result, records: result.records.map(record => ({...record, implementations: record.implementations.map(implementation => ({...implementation, issues: [{code: "field_invalid", severity: "error" as const, message: "bad"}]}))}))};
    });
    expect((await h.backend.index()).ok).toBe(true);
    expect(await h.backend.listManuscripts()).toMatchObject({ok: true, value: [{path: "manuscripts/original.md"}]});
  });
  it("recreates an ended watch in the background with backoff and never duplicates it", async () => {
    const initial = controlledWatch(), second = controlledWatch("starting"), third = controlledWatch("starting");
    const h = await fixture(client => {vi.spyOn(client, "watchChanges").mockReturnValueOnce(initial.watch).mockReturnValueOnce(second.watch).mockReturnValueOnce(third.watch);});
    const watch = vi.mocked(h.client.watchChanges);
    expect((await h.backend.index()).ok).toBe(true);
    const notified = vi.fn(); h.backend.onExternalChange(notified);
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    try {
      initial.publish("stale");
      expect(notified).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(499); expect(watch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(watch).toHaveBeenCalledTimes(2);
      expect(initial.stop).toHaveBeenCalledOnce(); expect(initial.listeners.size).toBe(0);
      second.publish("active");
      expect(notified).toHaveBeenCalledTimes(2); // Reconnected: reload what changed meanwhile.
      second.publish("failed");
      expect(notified).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(500); expect(watch).toHaveBeenCalledTimes(3);
      third.publish("failed"); // Never active: retry later, doubling the wait.
      await vi.advanceTimersByTimeAsync(999); expect(watch).toHaveBeenCalledTimes(3);
      // A read while a retry is pending recreates once and cancels the timer.
      const read = h.backend.index(); await vi.advanceTimersByTimeAsync(0);
      expect((await read).ok).toBe(true);
      expect(watch).toHaveBeenCalledTimes(4); expect(third.stop).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(60_000); expect(watch).toHaveBeenCalledTimes(4);
      h.backend.dispose();
      await vi.advanceTimersByTimeAsync(120_000); expect(watch).toHaveBeenCalledTimes(4);
    } finally {vi.useRealTimers();}
  });
  it.each(["stale", "failed"] as const)("recreates its own %s watch on discovery and fences its retired callbacks", async state => {
    const initial = controlledWatch();
    const h = await fixture(client => {vi.spyOn(client, "watchChanges").mockReturnValueOnce(initial.watch);});
    const watch = vi.mocked(h.client.watchChanges); const close = vi.spyOn(h.client, "close");
    expect((await h.backend.index()).ok).toBe(true);
    const notified = vi.fn(); h.backend.onExternalChange(notified);
    initial.publish(state);
    expect((await h.backend.index()).ok).toBe(true);
    expect(watch).toHaveBeenCalledTimes(2); expect(initial.stop).toHaveBeenCalledOnce(); expect(initial.listeners.size).toBe(0);
    const old = watch.mock.calls[0]?.[1]; if (!old) throw new Error("Missing original watch callback");
    const calls = notified.mock.calls.length;
    old({changes: [], cursor: "retired-watch", reset: true});
    expect(notified).toHaveBeenCalledTimes(calls);
    const current = watch.mock.results[1]?.value;
    h.backend.dispose(); expect(current.state).toBe("closed"); expect(close).not.toHaveBeenCalled();
  });
  it("a replacement watch failure fails the pending read without an invalidation/retry loop", async () => {
    const initial = controlledWatch(); let reject!: (error: Error) => void;
    const replacement = controlledWatch("starting", new Promise<void>((_, failed) => {reject = failed;}));
    const h = await fixture(client => {vi.spyOn(client, "watchChanges").mockReturnValueOnce(initial.watch).mockReturnValueOnce(replacement.watch);});
    expect((await h.backend.index()).ok).toBe(true);
    const notified = vi.fn(); h.backend.onExternalChange(notified);
    initial.publish("failed");
    const read = h.backend.index();
    replacement.publish("failed"); reject(new Error("Replacement watch refused"));
    expect(await read).toMatchObject({ok: false});
    expect(notified).toHaveBeenCalledOnce(); expect(h.client.watchChanges).toHaveBeenCalledTimes(2);
  });
  it("refuses unsupported contract metadata without projecting raw fields locally", async () => {
    const h = await fixture();
    const query = vi.spyOn(h.client, "queryContract").mockRejectedValue(new MdbaseError({code: "upgrade_required", recovery: "upgrade", message: "Contract queries unsupported", reason: "contract_query_unsupported"}));
    expect(await h.backend.listManuscripts()).toMatchObject({ok: false, message: expect.stringContaining("upgrade_required")});
    expect(query).toHaveBeenCalledWith({id: "dev.mdbase.writer.manuscript", version: "1.0.0-beta.2"}, expect.objectContaining({pageSize: 128, signal: expect.any(AbortSignal)}));
  });
  it("discovers all records across actual SDK pages rather than truncating the native index", async () => {
    const h = await fixture();
    for (let index = 0; index < 501; index++) h.replica.seed({path: `notes/page-${index}.md`, body: `Note ${index}`});
    for (let index = 0; index < 129; index++) h.replica.seed({path: `manuscripts/page-${index}.md`, types: ["native-manuscript"], frontmatter: {meta: new Map([["heading", `Book ${index}`]])}});
    const query = vi.spyOn(h.client, "queryContract");
    const result = await h.backend.index();
    expect(result.ok && result.value.recordPaths).toHaveLength(633);
    expect(result.ok && result.value.recordPaths).toContain("notes/page-500.md");
    const manuscripts = await h.backend.listManuscripts();
    expect(manuscripts.ok && manuscripts.value).toHaveLength(130);
    expect(manuscripts.ok && manuscripts.value.some(book => book.path === "manuscripts/page-128.md" && book.title === "Book 128")).toBe(true);
    expect(query.mock.calls.some(call => call[1]?.cursor !== undefined)).toBe(true);
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
    first.digest = `sha256:${"f".repeat(64)}`;
    expect((await h.backend.listManuscripts()).ok).toBe(false);
    first.digest = manifest.requirements.contracts[0]?.digest ?? "";
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
  it("refuses unsupported contract projection without using raw comment fields as a fallback", async () => {
    const h = await fixture();
    const row = h.replica.seed({path: "comments/unsupported.md", types: ["native-comment"], frontmatter: {type: "native-comment", document: "manuscripts/original.md", motivation: "commenting", status: "open", created_at: "2026-06-10T12:00:00Z"}, body: "Unconfirmed contract text\n"});
    const read = vi.spyOn(h.client, "getContract").mockRejectedValue(new MdbaseError({code: "upgrade_required", recovery: "upgrade", message: "Contract records unsupported", reason: "contract_records_unsupported"}));
    expect(await h.backend.comments()).toMatchObject({ok: false, message: expect.stringContaining("upgrade_required")});
    expect(read).toHaveBeenCalledWith(row.id, {id: "mdbase.comment", version: "1.0.0", type: "native-comment"}, expect.any(AbortSignal));
  });
  it("creates a mapped manuscript and chapter only after confirmed current native readback", async () => {
    const h = await fixture();
    const created = await h.backend.createManuscript({title: "Launch", template: "article", style: "apa"});
    expect(created).toEqual({ok: true, value: "manuscripts/launch.md"});
    const actual = await h.client.get({path: "manuscripts/launch.md"}, {body: true});
    expect(nativeObject(actual.frontmatter)["meta"]).toMatchObject({heading: "Launch"}); expect(actual.state.state).toBe("confirmed");
    const chapter = await h.backend.createRecord("notes/chapter.md", "# New chapter\n");
    expect(chapter).toEqual({ok: true, value: "notes/chapter-2.md"});
  });
  it("creates a manuscript when the confirmed receipt still carries the optimistic pending view", async () => {
    // UX-001 (LAB): the confirmed receipt had no records, so write.records kept the
    // submit-time pending view and Writer reported a failed create that had succeeded.
    const h = await fixture(); const create = h.client.create.bind(h.client);
    vi.spyOn(h.client, "create").mockImplementation(async (...args: Parameters<typeof create>) => {
      const write = await create(...args);
      const pending = write.records.map(record => ({...record, state: {state: "pending" as const, confirmedSeq: 0}}));
      Object.defineProperty(write, "confirmed", {value: write.confirmed.then(receipt => { write.receipt = {...write.receipt, records: pending}; return receipt; })});
      return write;
    });
    expect(await h.backend.createManuscript({title: "Pending view", template: "article", style: "apa"})).toEqual({ok: true, value: "manuscripts/pending-view.md"});
  });
  it("adopts a note with original UUID/body/custom metadata preserved by native CAS", async () => {
    const h = await fixture();
    const original = await h.client.get({path: "notes/chapter.md"}, {body: true, document: true});
    const update = vi.spyOn(h.client, "update");
    expect(await h.backend.adoptManuscript(original.path)).toEqual({ok: true, value: original.path});
    const changed = await h.client.get(original.id, {body: true});
    expect(changed.id).toBe(original.id); expect(changed.body).toBe(original.body);
    expect(changed.frontmatter.get("custom")).toBe("keep"); expect(changed.types).toContain("native-manuscript");
    expect(nativeObject(changed.frontmatter)["meta"]).toMatchObject({heading: "A chapter"});
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).toMatchObject({contract: {id: "dev.mdbase.writer.manuscript", version: "1.0.0-beta.2", type: "native-manuscript"}, promote: true, patch: {title: "A chapter"}, ifRevision: original.revision});
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
    if (!changed.ok) throw new Error(changed.message);
    const update = vi.spyOn(h.client, "update");
    const withdrawn = await h.backend.changeComment(changed.value, {kind: "withdraw"});
    expect(withdrawn.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).toMatchObject({body: "", contract: {id: "mdbase.comment", version: "1.0.0", type: "native-comment"}});
    const raw = await h.client.get({path: changed.value.path}, {body: true});
    expect(raw.body).toBe("");
    expect(raw.frontmatter.get("review")).toBeInstanceOf(Map);
    const review = nativeObject(raw.frontmatter)["review"];
    expect(review).toMatchObject({state: "resolved", deleted: expect.any(String), modified: expect.any(String)});
    expect(raw.frontmatter.has("deleted_at")).toBe(false);
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
  it("retries a lost create reply under the same intent into the one original record", async () => {
    const h = await fixture();
    const original = h.client.create.bind(h.client);
    const submitted: string[] = [];
    vi.spyOn(h.client, "create").mockImplementation(async (input, options) => {
      if (options?.mutationId !== undefined) return original(input, options); // the SDK's own MID-bound step
      const write = await original(input, options); submitted.push(write.mutationId);
      if (submitted.length > 1) return write;
      await write.confirmed; throw new Error("Lost original reply");
    });
    const intent = "new-manuscript-1";
    expect((await h.backend.createManuscript({title: "Launch", template: "article", style: "apa", intent})).ok).toBe(false);
    expect(await h.backend.createManuscript({title: "Launch", template: "article", style: "apa", intent})).toEqual({ok: true, value: "manuscripts/launch.md"});
    expect(submitted).toHaveLength(2); expect(submitted[1]).toBe(submitted[0]);
    const queried = await h.client.query({}, {});
    expect(queried.records.filter(record => record.path.startsWith("manuscripts/launch"))).toHaveLength(1);
  });
  it("retries a lost comment reply under the same intent into the one original comment", async () => {
    const h = await fixture();
    const original = h.client.create.bind(h.client);
    vi.spyOn(h.client, "create").mockImplementationOnce(async (input, options) => {
      const write = await original(input, options); await write.confirmed; throw new Error("Lost original reply");
    });
    const input = {document: "manuscripts/original.md", text: "Once", intent: "new-comment-1"};
    expect((await h.backend.createComment(input)).ok).toBe(false);
    const created = await h.backend.createComment(input);
    if (!created.ok) throw new Error(created.message);
    const listed = await h.backend.comments(["manuscripts/original.md"]);
    expect(listed.ok && listed.value.filter(comment => comment.text === "Once").map(comment => comment.path)).toEqual([created.value.path]);
  });
  it("fences late retired data and aborts only the repository watch/scope", async () => {
    const h = await fixture(); const close = vi.spyOn(h.client, "close");
    const pending = h.backend.listManuscripts(); h.current.mockReturnValue(false);
    expect((await pending).ok).toBe(false);
    h.caller.abort(); expect((await h.backend.readBody("manuscripts/original.md")).ok).toBe(false);
    expect(close).not.toHaveBeenCalled(); expect(h.client.link).toBe("open");
  });
});
