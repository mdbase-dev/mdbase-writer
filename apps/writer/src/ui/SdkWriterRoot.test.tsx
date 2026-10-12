// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connect, MdbasePeopleClient, type Mdbase, type MdbaseApplicationConnection, type MdbaseApplicationEntry, type MdbaseApplicationSnapshot, type MdbaseClient, type MdbaseSnapshot, type wire } from "@mdbase-dev/sdk";
import { createApplicationFixture, MemoryReplica } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import { App } from "../App.js";
import { SdkWriterRoot, type WriterNativeScope } from "./SdkWriterRoot.js";

vi.mock("@mdbase-dev/ui/feedback", () => ({ FeedbackButton: () => null }));

/** Test-only: the SDK fixture's application behind the `createMdbase` front door,
 * mirroring how `createMdbase` maps each call onto the application. */
function fixtureMdbase(entry: MdbaseApplicationEntry): Mdbase {
  const app = entry.application();
  const view = () => app.getSnapshot() as MdbaseSnapshot;
  const settle = async (pending: Promise<unknown>) => { await pending; return view(); };
  return {
    getSnapshot: view, subscribe: listener => app.subscribe(listener),
    start: options => settle(app.start(options)), signIn: options => settle(app.authorize(options)),
    addCollection: options => settle(app.approve(null, options)), approve: (id, options) => settle(app.approve(id, options)),
    select: (id, options) => settle(app.select(id, options)), chooseAnother: options => settle(app.chooseAnother(options)),
    forget: (id, options) => settle(app.forget(id, options)), deleteCollection: (id, options) => settle(app.deleteCollection(id, options)),
    requestAccess: (request, options) => app.requestAccess(request, options), assess: options => app.assess(options),
    setup: {plan: options => app.setup.plan(options), apply: async (plan, options) => ({outcome: "applied", snapshot: await settle(app.setup.apply(plan, options))})},
    connection: id => entry.connection(id), setForeground: active => app.setForeground(active),
    signOut: options => app.signOut ? settle(app.signOut(options)) : Promise.reject(new Error("No signOut")), close: () => app.close(), application: app,
  };
}

const facet = {checking: false, assessment: null, problem: null};
const paired: NonNullable<MdbaseApplicationSnapshot["signIn"]> = {
  requestId: "fixture-request", installationId: "fixture-installation", deviceId: "fixture-device", appId: "fixture-app", kind: "app-runtime", verificationUri: "https://mdbase.test/approve", state: "paired", accountId: "fixture-account", accountProvider: "github", accountLogin: "writer-user", collectionIds: [], createCollections: false, requestedCreateCollections: false,
};
const none = {state: "none", requested: {collectionId: null, source: "none", displayName: null, approved: false}, usable: null, problem: null} as const;
const fixtures: ReturnType<typeof createApplicationFixture>[] = [];
const clients: MdbaseClient[] = [];
function fixture(initial: Partial<MdbaseApplicationSnapshot>, connections: MdbaseApplicationConnection[] = []) {
  const sdkFixture = createApplicationFixture({
    declaration: {id: "writer.fixture", name: "Writer fixture", origin: "https://writer.mdbase.dev", environment: "lab", manifest}, connections,
    initialSnapshot: {status: "unselected", signIn: paired, collections: [], selectedCollectionId: null, problem: null, timing: null,
      readiness: {...facet, facets: {capabilities: facet, contracts: facet, configuration: facet, files: facet, people: facet, notifications: facet}}, selection: none, ...initial},
  }); fixtures.push(sdkFixture);
  const application = sdkFixture.entry.application();
  const publish = (patch: Partial<MdbaseApplicationSnapshot>) => sdkFixture.controls.publishSnapshot({...application.getSnapshot(), ...patch});
  const count = (action: string) => sdkFixture.controls.observedActions().filter(call => call.action === action).length;
  return {mdbase: fixtureMdbase(sdkFixture.entry), publish, count, controls: sdkFixture.controls};
}
async function readyFixture() {
  const replica = new MemoryReplica({confirmDelayMs: 0, contracts: manifest.requirements.contracts.map((contract, index) => ({id: contract.id, version: contract.version, contractDigest: contract.digest, type: ["manuscript", "source", "comment"][index] ?? "unknown", fields: {title: "title", template: "template", csl: "csl"}}))});
  replica.seed({path: "writing/main.md", frontmatter: {title: "Original manuscript"}, body: "Original manuscript", types: ["manuscript"]});
  const client = await connect({connector: replica.connector(), app: {name: "writer-ui-test", version: "test"}, reconnect: false}); clients.push(client);
  const current = vi.fn(() => true);
  const metadata = vi.fn(async () => {throw new Error("No inferred metadata permission");});
  const connection: MdbaseApplicationConnection = {id: replica.collection, displayName: "Writing", scope: {account: "fixture-account", installation: "fixture-installation", collection: replica.collection}, generation: "fixture-generation", records: client, files: client.files,
    people: new MdbasePeopleClient(client, {collection: replica.collection, request: metadata, isCurrent: current}), isCurrent: current};
  const selected = {collectionId: replica.collection, displayName: "Writing", role: "owner"} as const;
  const h = fixture({status: "ready", selectedCollectionId: replica.collection, collections: [selected, {collectionId: "other", displayName: "Archive", role: "editor"}],
    selection: {state: "usable", requested: {collectionId: replica.collection, source: "user", displayName: "Writing", approved: true}, usable: selected, problem: null},
    readiness: {...facet, assessment: {status: "ready", problem: null}, facets: {capabilities: facet, contracts: facet, configuration: facet, files: facet, people: facet, notifications: facet}}}, [connection]);
  return {...h, client, connection};
}
const dialogClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const dialogShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
beforeEach(() => {
  // jsdom omits these browser APIs.
  Object.defineProperty(HTMLDialogElement.prototype, "close", {configurable: true, value(this: HTMLDialogElement) {this.removeAttribute("open");}});
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable: true, value(this: HTMLDialogElement) {this.setAttribute("open", "");}});
  class Observer implements IntersectionObserver {
    readonly root = null; readonly rootMargin = "0px"; readonly thresholds = [0];
    observe() {} unobserve() {} disconnect() {} takeRecords(): IntersectionObserverEntry[] {return [];}
  }
  vi.stubGlobal("IntersectionObserver", Observer);
});
afterEach(() => {
  cleanup(); for (const item of fixtures.splice(0)) item.controls.close(); for (const client of clients.splice(0)) client.close(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (dialogClose) Object.defineProperty(HTMLDialogElement.prototype, "close", dialogClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (dialogShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", dialogShowModal); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
function Capture({scope, publish}: {scope: WriterNativeScope; publish(scope: WriterNativeScope): void}) {
  useEffect(() => {publish(scope);}, [scope, publish]);
  return <p role="status">Native test consumer</p>;
}

it("starts the SDK, hands Writer the gate's ready connection and retires that scope when the collection closes", async () => {
  const h = await readyFixture(); const close = vi.spyOn(h.client, "close");
  const scopes: WriterNativeScope[] = []; const publish = (scope: WriterNativeScope) => scopes.push(scope);
  render(<StrictMode><SdkWriterRoot sdk={h.mdbase} renderNative={scope => <Capture scope={scope} publish={publish} />} /></StrictMode>);
  await screen.findByText("Native test consumer");
  expect(h.count("start")).toBeGreaterThan(0);
  const scope = scopes.at(-1); if (!scope) throw new Error("Missing native scope");
  expect(scope.connection.records).toBe(h.client);
  await act(async () => h.publish({status: "unselected", selectedCollectionId: null, selection: none}));
  expect(screen.queryByText("Native test consumer")).toBeNull();
  expect(scope.signal.aborted).toBe(true);
  expect(await scope.records.open("writing/main.md")).toMatchObject({ok: false, problem: {code: "cancelled"}});
  expect(close).not.toHaveBeenCalled();
});

it("opens the manuscript list with the shared collection switcher in the top bar", async () => {
  const h = await readyFixture();
  const names = ["manuscript", "source", "comment"];
  const catalog: wire.DescribeResult = {specVersion: "0.3.0", settings: new Map(), issues: [], inclusion: {include: ["image"]},
    contracts: manifest.requirements.contracts.map((contract, index) => ({...contract, path: `_contracts/${contract.id}.md`, digest: contract.digest.replace(/^sha256:/, ""), contractType: "record", implementedBy: [names[index] ?? "unknown"]})),
    types: manifest.requirements.contracts.map((contract, index) => ({name: names[index] ?? "unknown", path: `_types/${names[index]}.md`, implements: [{contract: contract.id, version: contract.version, fields: new Map([["title", "title"], ["template", "template"], ["csl", "csl"]])}]}))};
  vi.spyOn(h.client, "describe").mockResolvedValue(catalog);
  const {container} = render(<App sdk={h.mdbase} />);
  await screen.findByText("Original manuscript");
  const trigger = await screen.findByRole("button", {name: "Switch collection, current: Writing"});
  expect(container.querySelector(".topbar-slot")?.contains(trigger)).toBe(true);
  fireEvent.click(trigger);
  // The popover's open state is a browser feature jsdom lacks, so find the row directly.
  const archive = [...document.querySelectorAll<HTMLElement>("[role=radio]")].find(row => row.textContent.includes("Archive"));
  if (!archive) throw new Error("No Archive row in the switcher");
  fireEvent.click(archive);
  await waitFor(() => expect(h.count("select")).toBe(1));
});

it("signs out with signOut and never closes the shared entry", async () => {
  const h = fixture({collections: [{collectionId: "c1", displayName: "Drafts", role: "owner"}]});
  const close = vi.spyOn(h.mdbase, "close");
  render(<SdkWriterRoot sdk={h.mdbase} renderNative={() => <p>Never ready</p>} />);
  expect(await screen.findByText("Drafts")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Sign out"}));
  await waitFor(() => expect(h.count("signOut")).toBe(1));
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByText("Never ready")).toBeNull();
});
