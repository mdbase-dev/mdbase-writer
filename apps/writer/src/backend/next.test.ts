import { connect, ERROR_CODES, mdbaseError, type ErrorCode, type MdbaseClient, type Write } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManuscriptWorkspace } from "../workspace/workspace.js";
import { NextBackend } from "./next.js";
import { nextProblem, problemFrom } from "./next-errors.js";
import type { CollectionDelta, RecordLease } from "./types.js";

vi.mock("../compile/client.js", () => ({ CompileClient: class {
  ready = Promise.resolve(0);
  send = vi.fn();
  onResult = () => () => {};
  onFailure = () => () => {};
  terminate() {}
} }));

const owned: { dispose(): void }[] = [];
const app = { name: "writer-test", version: "0" };

async function client(replica: MemoryReplica): Promise<MdbaseClient> {
  const c = await connect({ app, connector: replica.connector(), reconnect: false });
  owned.push({ dispose: () => c.close() });
  return c;
}

async function fixture() {
  // Confirmation is explicit (`confirmAll`) so pending and confirmed can be told apart.
  const replica = new MemoryReplica({ confirmDelayMs: null });
  replica.seed({ path: "manuscripts/paper.md", types: ["writer-manuscript"], frontmatter: { type: "writer-manuscript", title: "Paper", csl: "apa" }, body: "# Intro\n\n![[chapters/one]]\n" });
  replica.seed({ path: "chapters/one.md", body: "# One\n\nFirst paragraph.\n\nSecond paragraph.\n" });
  replica.seed({ path: "sources/darwin.md", types: ["reader-source"], frontmatter: { type: "reader-source", csl: new Map<string, string>([["id", "darwin1859"], ["title", "Origin"], ["type", "book"]]) }, body: "" });
  replica.seed({ path: "people/jordan.md", types: ["person"], frontmatter: { type: "person", name: "Jordan Ellis" }, body: "" });
  replica.seed({ path: "comments/c1.md", types: ["comment"], frontmatter: { type: "comment", document: "[[chapters/one]]", motivation: "commenting", status: "open", created_at: "2026-10-01T00:00:00Z" }, body: "Expand this.\n" });
  const db = await client(replica);
  await db.files.upload("figures/plot.svg", new TextEncoder().encode("<svg/>"));
  replica.confirmAll();
  const backend = new NextBackend(db, { collectionName: "Test" });
  owned.push(backend);
  return { replica, db, backend };
}

async function open(backend: NextBackend, path: string, idleMs: number | false = 10): Promise<RecordLease> {
  const opened = await backend.records.open(path, { autosave: idleMs === false ? false : { idleMs } });
  if (!opened.ok) throw new Error(opened.problem.message ?? opened.problem.code);
  owned.push({ dispose: () => opened.value.release() });
  return opened.value;
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => {
  for (const item of owned.splice(0).reverse()) item.dispose();
  vi.unstubAllGlobals();
});

describe("NextBackend discovery", () => {
  it("lists manuscripts, sources and files from a live query without reading bodies", async () => {
    const { db, backend } = await fixture();
    const get = vi.spyOn(db, "get");
    const manuscripts = await backend.listManuscripts();
    expect(manuscripts).toEqual({ ok: true, value: [expect.objectContaining({ path: "manuscripts/paper.md", title: "Paper", style: "apa" })] });
    const index = await backend.index();
    expect(index.ok && [...index.value.recordPaths].sort()).toEqual(["chapters/one.md", "comments/c1.md", "manuscripts/paper.md", "people/jordan.md", "sources/darwin.md"]);
    expect(index.ok && index.value.filePaths).toEqual(["figures/plot.svg"]);
    expect(index.ok && index.value.notePaths).toContain("chapters/one.md");
    const library = await backend.library();
    expect(library.ok && library.value.map((e) => e.key)).toEqual(["darwin1859"]);
    // The discovery subscription carries frontmatter only.
    expect(backend["live"].records.length).toBe(5);
    expect(backend["live"].records.every((r) => r.body === undefined)).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it("applies live diffs to the lists and tells listeners which paths changed", async () => {
    const { replica, backend } = await fixture();
    await backend.listManuscripts();
    const deltas: CollectionDelta[] = [];
    const paths: string[][] = [];
    backend.onCollectionChange((delta) => deltas.push(delta));
    backend.onExternalChange((changed) => paths.push([...changed]));
    const other = await client(replica);
    await other.create({ path: "manuscripts/second.md", type: "writer-manuscript", frontmatter: { type: "writer-manuscript", title: "A second" }, body: "" });
    await vi.waitFor(() => expect(deltas.some((d) => d.manuscripts?.some((m) => m.title === "A second"))).toBe(true));
    expect(paths).toContainEqual(["manuscripts/second.md"]);
    const listed = await backend.listManuscripts();
    expect(listed.ok && listed.value.map((m) => m.title)).toEqual(["A second", "Paper"]);
  });
});

describe("NextBackend bodies", () => {
  it("reads a body on demand, once, and again after it changes", async () => {
    const { replica, db, backend } = await fixture();
    const get = vi.spyOn(db, "get");
    expect(await backend.readBody("chapters/one.md")).toEqual({ ok: true, value: "# One\n\nFirst paragraph.\n\nSecond paragraph.\n" });
    await backend.readBody("chapters/one.md");
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[1]).toEqual({ body: true });
    const other = await client(replica);
    const view = await other.get({ path: "chapters/one.md" }, { body: true });
    await other.update(view, { body: "# One\n\nRewritten.\n" });
    await vi.waitFor(async () => expect(await backend.readBody("chapters/one.md")).toEqual({ ok: true, value: "# One\n\nRewritten.\n" }));
  });

  it("reads comment bodies only for the requested manuscript records", async () => {
    const { db, backend } = await fixture();
    const get = vi.spyOn(db, "find");
    const comments = await backend.comments(["chapters/one.md"]);
    expect(comments.ok && comments.value.map((c) => [c.path, c.text.trim()])).toEqual([["comments/c1.md", "Expand this."]]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(await backend.comments(["manuscripts/paper.md"])).toEqual({ ok: true, value: [] });
  });

  it("lists and downloads files", async () => {
    const { backend } = await fixture();
    await backend.index();
    const bytes = await backend.readFile("figures/plot.svg");
    expect(bytes.ok && new TextDecoder().decode(bytes.value)).toBe("<svg/>");
    expect(await backend.readFile("figures/missing.png")).toEqual({ ok: false, message: "No file at figures/missing.png." });
  });
});

describe("NextBackend record sessions", () => {
  it("autosaves an edit, is pending until confirmed, then saved", async () => {
    const { replica, backend } = await fixture();
    const { session } = await open(backend, "chapters/one.md");
    expect(session.getSnapshot()).toMatchObject({ state: "saved", dirty: false, body: "# One\n\nFirst paragraph.\n\nSecond paragraph.\n" });
    session.setBody("# One\n\nFirst paragraph, edited.\n\nSecond paragraph.\n");
    expect(session.getSnapshot()).toMatchObject({ state: "unsaved", dirty: true });
    // Accepted by the replica (pending): no longer dirty, not yet confirmed.
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ state: "saving", dirty: false }));
    expect(replica.allRecords.find((r) => r.path === "chapters/one.md")).toMatchObject({ pending: true, body: "# One\n\nFirst paragraph, edited.\n\nSecond paragraph.\n" });
    replica.confirmAll();
    await vi.waitFor(() => expect(session.getSnapshot().state).toBe("saved"));
    expect(replica.allRecords.find((r) => r.path === "chapters/one.md")).toMatchObject({ pending: false });
    expect(session.getSnapshot().record.body).toBe("# One\n\nFirst paragraph, edited.\n\nSecond paragraph.\n");
  });

  it("sends frontmatter patches with the view they were made from", async () => {
    const { replica, db, backend } = await fixture();
    const update = vi.spyOn(db, "update");
    const { session } = await open(backend, "manuscripts/paper.md", false);
    session.patchFrontmatter({ csl: "chicago-notes-bibliography" });
    expect(await session.flush()).toEqual({ ok: true });
    expect(update.mock.calls[0]?.[0]).toMatchObject({ path: "manuscripts/paper.md" });
    expect(update.mock.calls[0]?.[1]).toEqual({ patch: { csl: "chicago-notes-bibliography" } });
    replica.confirmAll();
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ state: "saved", frontmatter: expect.objectContaining({ csl: "chicago-notes-bibliography" }) }));
  });

  it("shows a second client's edit live when there is nothing local", async () => {
    const { replica, backend } = await fixture();
    const { session } = await open(backend, "chapters/one.md");
    const seen = vi.fn();
    session.subscribe(seen);
    const other = await client(replica);
    const view = await other.get({ path: "chapters/one.md" }, { body: true });
    await other.update(view, { body: "# One\n\nFirst paragraph.\n\nSecond paragraph, from elsewhere.\n" });
    await vi.waitFor(() => expect(session.getSnapshot().body).toBe("# One\n\nFirst paragraph.\n\nSecond paragraph, from elsewhere.\n"));
    expect(session.getSnapshot()).toMatchObject({ state: "saved", dirty: false });
    expect(seen).toHaveBeenCalled();
  });

  it("keeps local edits over a concurrent change, and surfaces a rejected merge as a conflict", async () => {
    const { replica, backend } = await fixture();
    const { session } = await open(backend, "chapters/one.md", false);
    session.setBody("# One\n\nFirst paragraph, mine.\n\nSecond paragraph.\n");
    const other = await client(replica);
    const view = await other.get({ path: "chapters/one.md" }, { body: true });
    await (await other.update(view, { body: "# One\n\nFirst paragraph.\n\nSecond paragraph, theirs.\n" })).receipt;
    replica.confirmAll();
    // The live change arrives but does not replace unsaved text.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.getSnapshot()).toMatchObject({ state: "unsaved", body: "# One\n\nFirst paragraph, mine.\n\nSecond paragraph.\n" });
    // MemoryReplica does not merge: the body edit's base no longer matches, so the receipt is a `conflict` rejection.
    const flushed = await session.flush();
    expect(flushed).toMatchObject({ ok: false, problem: { code: "conflict" } });
    expect(session.getSnapshot()).toMatchObject({ state: "conflict", body: "# One\n\nFirst paragraph, mine.\n\nSecond paragraph.\n", remote: { body: "# One\n\nFirst paragraph.\n\nSecond paragraph, theirs.\n" } });
    session.resolve({ body: "# One\n\nFirst paragraph, mine.\n\nSecond paragraph, theirs.\n" });
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ state: "saving", dirty: false }));
    replica.confirmAll();
    await vi.waitFor(() => expect(session.getSnapshot().state).toBe("saved"));
    expect(replica.allRecords.find((r) => r.path === "chapters/one.md")?.body).toBe("# One\n\nFirst paragraph, mine.\n\nSecond paragraph, theirs.\n");
  });

  it("maps a rejected receipt to an error the workspace shows, keeping the text", async () => {
    const { replica, db, backend } = await fixture();
    const update = vi.spyOn(db, "update");
    const { session } = await open(backend, "chapters/one.md", false);
    session.setBody("# One\n\nNot valid here.\n");
    expect(await session.flush()).toEqual({ ok: true });
    const write = await (update.mock.results[0]?.value as Promise<Write>);
    replica.reject(write.mutationId, { code: "invalid_record", recovery: "fix_request", message: "missing field" });
    await vi.waitFor(() => expect(session.getSnapshot().state).toBe("error"));
    // (MemoryReplica does not roll a rejected record back, so the base is not compared here.)
    expect(session.getSnapshot()).toMatchObject({ body: "# One\n\nNot valid here.\n", problem: { code: "invalid_record", message: nextProblem("invalid_record").message } });
  });

  it("marks a session deleted when the record goes away", async () => {
    const { replica, backend } = await fixture();
    const { session } = await open(backend, "chapters/one.md");
    const other = await client(replica);
    await other.delete(await other.get({ path: "chapters/one.md" }));
    await vi.waitFor(() => expect(session.getSnapshot().state).toBe("deleted"));
  });

  it("opens one shared session per record", async () => {
    const { backend } = await fixture();
    const a = await open(backend, "chapters/one.md");
    const b = await open(backend, "chapters/one.md");
    expect(a.session).toBe(b.session);
    expect(await backend.records.open("chapters/missing.md")).toMatchObject({ ok: false, problem: { code: "not_found" } });
  });

  it("drives a manuscript workspace", async () => {
    const { replica, backend } = await fixture();
    const workspace = new ManuscriptWorkspace(backend, "manuscripts/paper.md");
    owned.push({ dispose: () => void workspace.dispose() });
    await vi.waitFor(() => expect(workspace.getSnapshot().phase).toBe("ready"));
    await vi.waitFor(() => expect(workspace.getSnapshot().records.has("chapters/one.md")).toBe(true));
    workspace.setBody("chapters/one.md", "# One\n\nFrom the workspace.\n");
    expect(await workspace.retrySave()).toEqual({ ok: true, value: undefined });
    replica.confirmAll();
    await vi.waitFor(() => expect(workspace.getSnapshot().records.get("chapters/one.md")?.snapshot.state).toBe("saved"));
    expect(workspace.hasUnsavedChanges()).toBe(false);
  });
});

describe("NextBackend writes", () => {
  it("retries a create at a numbered path when the path is taken", async () => {
    const { replica, backend } = await fixture();
    expect(await backend.createManuscript({ title: "Paper", template: "article", style: "apa" })).toEqual({ ok: true, value: "manuscripts/paper-2.md" });
    expect(await backend.createRecord("chapters/one.md", "# Another\n")).toEqual({ ok: true, value: "chapters/one-2.md" });
    expect(replica.allRecords.find((r) => r.path === "manuscripts/paper-2.md")).toMatchObject({ types: ["writer-manuscript"], pending: true });
  });

  it("does not retry a create for other problems", async () => {
    const { db, backend } = await fixture();
    const create = vi.spyOn(db, "create").mockRejectedValue(mdbaseError("forbidden", "no"));
    expect(await backend.createRecord("notes/new.md", "")).toEqual({ ok: false, message: nextProblem("forbidden").message });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("writes comments and changes them with a patch", async () => {
    const { replica, backend } = await fixture();
    const created = await backend.createComment({ document: "chapters/one.md", text: "A new thought" });
    expect(created.ok && created.value).toMatchObject({ document: "[[chapters/one]]", status: "open" });
    const path = created.ok ? created.value.path : "";
    expect(replica.allRecords.find((r) => r.path === path)).toMatchObject({ types: ["comment"], body: "A new thought\n" });
    const thread = await backend.comments(["chapters/one.md"]);
    const comment = thread.ok ? thread.value.find((c) => c.path === "comments/c1.md") : undefined;
    const resolved = await backend.changeComment(comment!, { kind: "resolve" });
    expect(resolved.ok && resolved.value.status).toBe("resolved");
    expect(replica.allRecords.find((r) => r.path === "comments/c1.md")?.frontmatter.get("status")).toBe("resolved");
  });

  it("reads person names but signs nothing (no people directory yet)", async () => {
    const { backend } = await fixture();
    const people = await backend.people();
    expect(people.names.get("people/jordan")).toBe("Jordan Ellis");
    expect(people.me).toBeUndefined();
    expect(people.signing?.kind).toBe("unavailable");
  });
});

describe("mdbase-next problems", () => {
  it("has Writer text and a recovery for every SDK error code", () => {
    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) {
      const problem = nextProblem(code);
      expect(problem.code).toBe(code);
      expect(problem.message.length).toBeGreaterThan(5);
      expect(problem.recovery).toBeTruthy();
    }
    expect(Object.keys(ERROR_CODES)).toHaveLength(15);
  });

  it("treats no device online as waiting, not an error", () => {
    expect(problemFrom(mdbaseError("unavailable", "x", "no_device_online"))).toMatchObject({ code: "unavailable", waitingForDevice: true, recovery: "wait", message: "Waiting for one of your devices to come online." });
    expect(problemFrom(mdbaseError("unavailable", "x"))).not.toHaveProperty("waitingForDevice");
    expect(problemFrom(mdbaseError("unauthenticated", "x"))).toMatchObject({ recovery: "reconnect" });
    expect(problemFrom(new Error("boom"))).toMatchObject({ code: "internal", recovery: "report" });
  });

  it("maps a refused connection", async () => {
    const replica = new MemoryReplica({ refuse: { code: "upgrade_required", recovery: "upgrade", message: "too old" } });
    const failed = await connect({ app, connector: replica.connector(), reconnect: false }).catch((error: unknown) => error);
    expect(problemFrom(failed)).toMatchObject({ code: "upgrade_required", recovery: "upgrade" });
  });
});

describe("next-demo", () => {
  it("serves the bundled demo manuscripts through NextBackend", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    const { createNextDemoBackend } = await import("./next-demo.js");
    const backend = await createNextDemoBackend();
    owned.push(backend);
    const manuscripts = await backend.listManuscripts();
    expect(manuscripts.ok && manuscripts.value.map((m) => m.path)).toContain("manuscripts/patient-observation.md");
    const library = await backend.library();
    expect(library.ok && library.value.length).toBeGreaterThan(0);
    const comments = await backend.comments();
    expect(comments.ok && comments.value.length).toBe(3);
  });
});
