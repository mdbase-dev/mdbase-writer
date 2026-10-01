import { readFileSync } from "node:fs";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, type WriterBackend } from "../backend/types.js";
import { NO_PEOPLE } from "../backend/comments.js";
import { DraftStore, type LocalDraft } from "./drafts.js";
import { ManuscriptWorkspace } from "./workspace.js";

vi.mock("../compile/client.js", () => ({ CompileClient: class {
  ready = Promise.resolve(0);
  send = vi.fn();
  onResult = () => () => {};
  onFailure = () => () => {};
  exportPdf = vi.fn(async () => ({ bytes: new Uint8Array([1]) }));
  terminate() {}
} }));
vi.mock("../export/pandoc.js", () => ({ toDocx: vi.fn(async () => ({ id: 1, bytes: new Uint8Array([1]), warnings: [] })) }));

const workspaces: ManuscriptWorkspace[] = [];
let serial = 0;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal("fetch", async (url: string) => {
    const name = url.split("?")[0]!.split("/").pop()!;
    if (name.endsWith(".docx")) return new Response(new Uint8Array([1]));
    return new Response(readFileSync(new URL(`../../../../packages/core/assets/csl/${name}`, import.meta.url), "utf8"));
  });
});
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.dispose()));
  vi.unstubAllGlobals();
});
function fixture() {
  const authority = createRecordTestAuthority();
  authority.records.follow(authority.watch);
  authority.seed("main.md", { body: "# Main\n\n![[chapters/one]]\n", frontmatter: { type: "custom", local_title: "Mapped title", local_style: "chicago-notes-bibliography" } });
  authority.seed("chapters/one.md", { body: "# First chapter\n\n![[two]]\n" });
  authority.seed("chapters/two.md", { body: "# Nested chapter\n\nComplete text.\n\n![Figure](image.svg)\n" });
  const backend: WriterBackend = {
    kind: "demo", collectionName: "Tests", draftNamespace: `test-${serial++}`,
    records: { open: async (...args) => {
      const result = await authority.records.open(...args);
      if (!result.ok || args[0] !== "main.md") return result;
      // The in-memory authority has no type engine. Supply the type identity
      // a real contract-implementing collection returns on record reads.
      const session = result.value.session;
      const original = session.getSnapshot;
      const proxy = new Proxy(session, { get(target, key) {
        if (key === "getSnapshot") return () => { const snapshot = original(); return { ...snapshot, record: { ...snapshot.record, types: ["custom"] } }; };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      return { ...result, value: { ...result.value, session: proxy } };
    } },
    manuscriptBindings: async () => ok([{ name: "custom", fields: { title: "local_title", csl: "local_style", authors: "local_authors" } }]),
    listManuscripts: async () => ok([]), createManuscript: async () => fail("unused"), adoptManuscript: async () => fail("unused"), createRecord: async () => fail("unused"),
    index: async () => ok({ recordPaths: ["main.md", "chapters/one.md", "chapters/two.md"], filePaths: ["chapters/image.svg"], notePaths: [] }),
    library: async () => ok([]), annotations: async () => ok([]), readBody: async (path) => ok(authority.get(path)?.body ?? ""),
    readFile: vi.fn(async () => ok(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'))),
    comments: async () => ok([]), people: async () => NO_PEOPLE, createComment: async () => fail("unused"), changeComment: async () => fail("unused"),
    onExternalChange: () => () => {}, dispose() {},
  };
  const open = () => { const workspace = new ManuscriptWorkspace(backend, "main.md"); workspaces.push(workspace); return workspace; };
  return { backend, authority, open };
}
const ready = async (workspace: ManuscriptWorkspace) => vi.waitFor(() => expect(workspace.getSnapshot().phase).toBe("ready"));

describe("workspace reliability", () => {
  it("normalizes custom fields for the editor and compiler and maps settings back", async () => {
    const { authority, open } = fixture();
    const workspace = open();
    await ready(workspace);
    expect(workspace.getSnapshot().records.get("main.md")?.snapshot.frontmatter["title"]).toBe("Mapped title");
    workspace.patchFrontmatter("main.md", { title: "New title", authors: [{ name: "Writer" }] });
    expect((await workspace.retrySave()).ok).toBe(true);
    expect(authority.get("main.md")?.frontmatter).toMatchObject({ local_title: "New title", local_authors: [{ name: "Writer" }] });
    expect(authority.get("main.md")?.frontmatter).not.toHaveProperty("title");
  });
  it("loads all nested chapters and images for an early export without a preview result", async () => {
    const { backend, open } = fixture();
    const baseOpen = backend.records.open.bind(backend.records);
    vi.spyOn(backend.records, "open").mockImplementation(async (...args) => { if (args[0] !== "main.md") await new Promise((resolve) => setTimeout(resolve, 15)); return baseOpen(...args); });
    const workspace = open();
    await ready(workspace);
    expect(workspace.getSnapshot().result).toBeUndefined();
    const bundle = await workspace.exportBundle();
    expect(bundle.problems).toEqual([]);
    // ZIP entries are stored without compression, so their text remains inspectable.
    const text = new TextDecoder().decode(bundle.bytes);
    expect(text).toContain("Complete text.");
    expect(text).toContain("Mapped title");
    expect(text).toContain("media/chapters/image.svg");
    expect(backend.readFile).toHaveBeenCalledWith("chapters/image.svg");
  });
  it("reports failed images on the Markdown range and lets a retry repair the export", async () => {
    const { backend, open } = fixture();
    let failing = true;
    backend.readFile = async () => failing ? fail("Temporary download failure") : ok(new Uint8Array([1]));
    const workspace = open();
    await ready(workspace);
    const first = await workspace.exportBundle();
    expect(first.problems.join("\n")).toContain("Temporary download failure");
    expect(workspace.dependencyDiagnostics()).toEqual([expect.objectContaining({ record: "chapters/two.md", from: expect.any(Number), message: expect.stringContaining("Temporary download failure") })]);
    failing = false;
    await workspace.retryAssets();
    expect(workspace.dependencyDiagnostics()).toEqual([]);
    expect((await workspace.exportBundle()).problems).toEqual([]);
  });
  it("warns that a custom PDF template does not carry over to Word", async () => {
    const { backend, open } = fixture();
    const index = backend.index;
    backend.index = async () => { const result = await index(); return result.ok ? ok({ ...result.value, filePaths: [...result.value.filePaths, "custom.typ"] }) : result; };
    const read = backend.readFile;
    backend.readFile = async (path) => path === "custom.typ" ? ok(new TextEncoder().encode("#let template(title: none, subtitle: none, authors: (), abstract: none, date: none, body) = body")) : read(path);
    const workspace = open();
    await ready(workspace);
    workspace.patchFrontmatter("main.md", { template: "custom.typ" });
    const out = await workspace.exportDocx();
    expect(out.bytes).toBeDefined();
    expect(out.problems.join("\n")).toContain("Word uses the article styles");
  });
  it("requires explicit review of persisted drafts and preserves unrelated remote metadata", async () => {
    const { backend, authority, open } = fixture();
    const saved = authority.get("main.md")!;
    authority.editElsewhere("main.md", { patch: { unrelated: "new remote value" } });
    const draft: LocalDraft = { version: 1, body: "Recovered text", frontmatter: { ...saved.frontmatter, local_title: "Recovered title" }, baseFrontmatter: saved.frontmatter, baseBody: saved.body ?? "", revision: saved.revision, updated: "2026-01-01" };
    new DraftStore(backend.draftNamespace!).write("main.md", draft);
    const workspace = open();
    await ready(workspace);
    expect(workspace.getSnapshot().recoveredDrafts.has("main.md")).toBe(true);
    workspace.setBody("main.md", "Must not overwrite recovery");
    expect(workspace.getSnapshot().records.get("main.md")?.snapshot.body).toBe(saved.body);
    expect((await workspace.retrySave()).ok).toBe(false);
    workspace.restoreDraft("main.md");
    expect((await workspace.retrySave()).ok).toBe(true);
    expect(authority.get("main.md")?.body).toBe("Recovered text");
    expect(authority.get("main.md")?.frontmatter).toMatchObject({ local_title: "Recovered title", unrelated: "new remote value" });
    expect(new DraftStore(backend.draftNamespace!).read("main.md")).toBeNull();
  });
  it("surfaces failed flushes and retains the unsent draft until retry succeeds", async () => {
    const { backend, authority, open } = fixture();
    const workspace = open();
    await ready(workspace);
    workspace.setBody("main.md", "Unsent draft");
    authority.failNextWrite({ problem_version: 1, code: "access_denied", category: "authorization", recovery: "reauthorize", message: "Offline for this test" });
    expect((await workspace.retrySave()).ok).toBe(false);
    expect(new DraftStore(backend.draftNamespace!).read("main.md")?.body).toBe("Unsent draft");
    expect((await workspace.retrySave()).ok).toBe(true);
    expect(new DraftStore(backend.draftNamespace!).read("main.md")).toBeNull();
  });
  it("backs up a setting mid-pause and flushes it before navigation or export", async () => {
    const { backend, authority, open } = fixture();
    const workspace = open();
    await ready(workspace);
    workspace.stageFrontmatter("main.md", { title: "Uncommitted title" });
    expect(workspace.getSnapshot().pendingSettings).toBe(true);
    expect(new DraftStore(backend.draftNamespace!).read("main.md")?.frontmatter["local_title"]).toBe("Uncommitted title");
    expect(authority.get("main.md")?.frontmatter["local_title"]).toBe("Mapped title");
    expect((await workspace.retrySave()).ok).toBe(true);
    expect(authority.get("main.md")?.frontmatter["local_title"]).toBe("Uncommitted title");
    expect(workspace.getSnapshot().pendingSettings).toBe(false);
  });
  it("keeps a focused setting downloadable when the record is deleted elsewhere", async () => {
    const { backend, authority, open } = fixture();
    const workspace = open();
    await ready(workspace);
    workspace.stageFrontmatter("main.md", { title: "Unsent title before deletion" });
    authority.deleteElsewhere("main.md");
    await vi.waitFor(() => expect(workspace.getSnapshot().records.get("main.md")?.snapshot.state).toBe("deleted"));
    expect((await workspace.retrySave()).ok).toBe(false);
    expect(workspace.localDrafts().find(([path]) => path === "main.md")?.[1]).toContain("Unsent title before deletion");
    expect(new DraftStore(backend.draftNamespace!).read("main.md")?.frontmatter["local_title"]).toBe("Unsent title before deletion");
  });
  it("offers saved local drafts even if opening the collection fails", async () => {
    const { backend, open } = fixture();
    new DraftStore(backend.draftNamespace!).write("main.md", { version: 1, body: "Missing collection draft", frontmatter: {}, baseBody: "", baseFrontmatter: {}, revision: "old", updated: new Date().toISOString() });
    backend.index = async () => { throw new Error("Collection temporarily unavailable"); };
    const workspace = open();
    await vi.waitFor(() => expect(workspace.getSnapshot().phase).toBe("failed"));
    expect(workspace.getSnapshot().recoveredDrafts.has("main.md")).toBe(true);
    expect(workspace.localDrafts()[0]).toEqual(["main.md", "---\n{}\n---\n\nMissing collection draft"]);
  });
  it("handles thrown startup failures and retries opening", async () => {
    const { backend, open } = fixture();
    const index = backend.index;
    backend.index = async () => { throw new Error("Index temporarily unavailable"); };
    const workspace = open();
    await vi.waitFor(() => expect(workspace.getSnapshot().phase).toBe("failed"));
    expect(workspace.getSnapshot().problem).toContain("temporarily unavailable");
    backend.index = index;
    await workspace.retryOpen();
    expect(workspace.getSnapshot().phase).toBe("ready");
  });
});
