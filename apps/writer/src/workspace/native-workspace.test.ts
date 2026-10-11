import { afterEach, expect, it, vi } from "vitest";
import { connect, MdbasePeopleClient, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import { NativeWriterBackend } from "../backend/native.js";
import { ManuscriptWorkspace } from "./workspace.js";

// Only compilation, catalog classification and the unapproved identity endpoint
// are stand-ins. The workspace/domain boundary and native SDK records are real.
vi.mock("../compile/client.js", () => ({CompileClient: class {
  ready = Promise.resolve(0); send = vi.fn();
  onResult = () => () => {}; onFailure = () => () => {};
  terminate() {}
}}));
vi.mock("../async.js", async importOriginal => {
  const original = await importOriginal<typeof import("../async.js")>();
  return {...original, fetchChecked: vi.fn(async () => new Response(""))};
});
let workspace: ManuscriptWorkspace | undefined;
let backend: NativeWriterBackend | undefined;
let client: MdbaseClient | undefined;
afterEach(async () => {await workspace?.dispose(); backend?.dispose(); client?.close(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

it("runs existing manuscript/chapter editing and mapped settings on one borrowed native SDK client", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key)});
  const replica = new MemoryReplica({confirmDelayMs: 0});
  const main = replica.seed({path: "manuscripts/main.md", types: ["fixture-manuscript"], frontmatter: {type: "fixture-manuscript", heading: "Native title", unrelated: "preserved"}, body: "# Main\n\n![[chapters/first]]\n"});
  const chapter = replica.seed({path: "chapters/first.md", body: "Native chapter\n"});
  const native = await connect({connector: replica.connector(), app: {name: "native-workspace-test", version: "test"}, reconnect: false}); client = native;
  const description: wire.DescribeResult = {specVersion: "0.3.0", settings: new Map([["explicit_type_keys", ["type"]]]), inclusion: {include: ["image"]}, issues: [],
    contracts: manifest.requirements.contracts.map((contract, index) => ({...contract, digest: contract.digest.replace(/^sha256:/, ""), path: `_contracts/${contract.id}.md`, contractType: "record", implementedBy: [`fixture-${["manuscript", "source", "comment"][index]}`]})),
    types: manifest.requirements.contracts.map((contract, index) => ({name: `fixture-${["manuscript", "source", "comment"][index]}`, path: `_types/type-${index}.md`, implements: [{contract: contract.id, version: contract.version, fields: new Map([["title", "heading"], ["template", "layout"], ["csl", "style"]])}]}))};
  vi.spyOn(native, "describe").mockResolvedValue(description);
  const isCurrent = () => true;
  backend = new NativeWriterBackend({id: native.collection, displayName: "Writing", scope: {account: "fixture-account", installation: "fixture-installation", collection: native.collection}, generation: "fixture-generation", records: native, files: native.files, isCurrent,
    people: new MdbasePeopleClient(native, {collection: native.collection, isCurrent, request: async () => {throw new Error("Identity unapproved");}})}, {collectionName: "Writing", signal: new AbortController().signal});
  const peer = await native.records.open(chapter, {autosave: {idleMs: 1_000}, timeoutMs: 15_000});
  const close = vi.spyOn(native, "close");
  workspace = new ManuscriptWorkspace(backend, main.path);
  await vi.waitFor(() => expect(workspace?.getSnapshot().phase).toBe("ready"));
  await vi.waitFor(() => {
    const snapshot = workspace?.getSnapshot();
    expect({indexLoad: snapshot?.indexLoad, paths: snapshot?.recordPaths, opened: [...(snapshot?.records.keys() ?? [])], problems: [...(snapshot?.recordProblems ?? [])], mainBody: snapshot?.records.get(main.path)?.snapshot.body}).toMatchObject({indexLoad: {phase: "ready"}, paths: expect.arrayContaining([chapter.path]), mainBody: "# Main\n\n![[chapters/first]]\n", problems: [], opened: expect.arrayContaining([chapter.path])});
  });
  expect(workspace.getSnapshot().records.get(main.path)?.snapshot.frontmatter["title"]).toBe("Native title");
  workspace.setBody(chapter.path, "Edited native chapter\n");
  workspace.patchFrontmatter(main.path, {title: "Mapped native title"});
  expect((await workspace.retrySave()).ok).toBe(true);
  const saved = await native.get(main.id, {body: true});
  expect(saved.id).toBe(main.id); expect(saved.frontmatter.get("heading")).toBe("Mapped native title");
  expect(saved.frontmatter.get("unrelated")).toBe("preserved"); expect(saved.frontmatter.has("title")).toBe(false);
  expect((await native.get(chapter.id, {body: true})).body).toBe("Edited native chapter\n");
  await workspace.dispose(); backend.dispose(); expect(close).not.toHaveBeenCalled();
  peer.session.setBody("Peer remains active\n"); await peer.session.flush();
  expect((await native.get(chapter.id, {body: true})).body).toBe("Peer remains active\n"); peer.release();
});
