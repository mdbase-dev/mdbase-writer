// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, MdbasePeopleClient, type MdbaseApplication, type MdbaseApplicationConnection, type MdbaseApplicationSnapshot, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { createApplicationFixture, MemoryReplica } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import { SdkWriterRoot, type WriterNativeScope, type WriterSdk } from "./SdkWriterRoot.js";

// SDK-owned public fixture supplies lifecycle/readiness metadata. Data is real
// public SDK over MemoryReplica. Neither establishes native/runtime acceptance.
const fixtures: ReturnType<typeof createApplicationFixture>[] = [];
function fixture(initial: Partial<MdbaseApplicationSnapshot> = {}) {
  const facet = {checking: false, assessment: null, problem: null};
  const sdkFixture = createApplicationFixture({
    declaration: {id: "writer.fixture", name: "Writer fixture", origin: "https://writer.mdbase.dev", environment: "lab", manifest},
    connections: [], initialSnapshot: {status: "signed_out", signIn: null, collections: [], selectedCollectionId: null, problem: null, timing: null,
      readiness: {...facet, facets: {capabilities: facet, contracts: facet, configuration: facet, files: facet, people: facet, notifications: facet}},
      selection: {state: "none", requested: {collectionId: null, source: "none", displayName: null, approved: false}, usable: null, problem: null}, ...initial},
  }); fixtures.push(sdkFixture);
  const application = sdkFixture.entry.application();
  // Public subscription instrumentation ONLY. All state/actions remain owned by
  // the SDK fixture, not an app-side fixture engine or fake production session.
  const subscriptions = new Set<() => void>();
  const observed: MdbaseApplication = {...application, subscribe(listener) {
    const stop = application.subscribe(listener);
    subscriptions.add(stop);
    return () => {subscriptions.delete(stop); stop();};
  }};
  const sdk: WriterSdk = {...sdkFixture.entry, application: () => observed};
  const publish = (patch: Partial<MdbaseApplicationSnapshot>) => sdkFixture.controls.publishSnapshot({...application.getSnapshot(), ...patch});
  sdkFixture.controls.setHandler("start", () => ({...application.getSnapshot(), status: "signed_out"}));
  return {sdk, application, publish, subscriptions, controls: sdkFixture.controls};
}
const paired: NonNullable<MdbaseApplicationSnapshot["signIn"]> = {
  requestId: "fixture-request", installationId: "fixture-installation", deviceId: "fixture-device", appId: "fixture-app", kind: "app-runtime", verificationUri: "https://mdbase.test/approve", state: "paired", accountId: "fixture-account", accountProvider: "github", accountLogin: "writer-user", collectionIds: [], createCollections: false, requestedCreateCollections: false,
};
const clients: MdbaseClient[] = [];
const dialogClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const dialogShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
beforeEach(() => {
  // jsdom omits these browser APIs; normal UI lifecycle is tested, not weakened.
  class Observer implements IntersectionObserver {
    readonly root = null; readonly rootMargin = "0px"; readonly thresholds = [0];
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      const rect = target.getBoundingClientRect();
      this.callback([{target, isIntersecting: true, intersectionRatio: 1, boundingClientRect: rect, intersectionRect: rect, rootBounds: null, time: performance.now()}], this);
    }
    unobserve() {} disconnect() {} takeRecords(): IntersectionObserverEntry[] {return [];}
  }
  vi.stubGlobal("IntersectionObserver", Observer);
  Object.defineProperty(HTMLDialogElement.prototype, "close", {configurable: true, value(this: HTMLDialogElement) {this.removeAttribute("open");}});
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable: true, value(this: HTMLDialogElement) {this.setAttribute("open", "");}});
});
afterEach(() => {
  cleanup(); for (const fixture of fixtures.splice(0)) fixture.controls.close(); for (const client of clients.splice(0)) client.close(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (dialogClose) Object.defineProperty(HTMLDialogElement.prototype, "close", dialogClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (dialogShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", dialogShowModal); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
async function readyFixture() {
  const replica = new MemoryReplica({confirmDelayMs: 0, contracts: manifest.requirements.contracts.map((contract, index) => ({id: contract.id, version: contract.version, contractDigest: contract.digest, type: ["manuscript", "source", "comment"][index] ?? "unknown", fields: {title: "title", template: "template", csl: "csl"}}))});
  replica.seed({path: "writing/main.md", frontmatter: {title: "Original manuscript"}, body: "Original manuscript", types: ["manuscript"]});
  const client = await connect({connector: replica.connector(), app: {name: "writer-ui-test", version: "test"}, reconnect: false}); clients.push(client);
  const selected: MdbaseApplicationSnapshot["collections"][number] = {collectionId: replica.collection, displayName: "Writing", role: "owner"};
  const h = fixture({status: "ready", selectedCollectionId: replica.collection, collections: [selected],
    selection: {state: "usable", requested: {collectionId: replica.collection, source: "user", displayName: "Writing", approved: true}, usable: selected, problem: null}});
  h.publish({readiness: {...h.application.getSnapshot().readiness, assessment: {status: "ready", problem: null}}});
  const metadata = vi.fn(async () => {throw new Error("No inferred metadata permission");});
  const current = vi.fn(() => true);
  const connection: MdbaseApplicationConnection = {id: replica.collection, displayName: "Writing", scope: {account: "fixture-account", installation: "fixture-installation", collection: replica.collection}, generation: "fixture-generation", records: client, files: client.files,
    people: new MdbasePeopleClient(client, {collection: replica.collection, request: metadata, isCurrent: current}), isCurrent: current};
  h.controls.setConnections([connection]);
  return {...h, client, connection, metadata, current};
}
function Capture({scope, publish}: {scope: WriterNativeScope; publish(scope: WriterNativeScope): void}) {
  useEffect(() => {publish(scope);}, [scope, publish]);
  return <p role="status">Native test consumer</p>;
}

describe("Writer public SDK fixture boundary", () => {
  it("StrictMode starts once, unsubscribes/aborts caller and never closes the borrowed singleton", async () => {
    const h = fixture({status: "not_started"});
    const view = render(<StrictMode><SdkWriterRoot sdk={h.sdk} /></StrictMode>);
    await waitFor(() => expect(h.controls.observedActions().filter(call => call.action === "start")).toHaveLength(1));
    const signal = h.controls.observedActions().find(call => call.action === "start")?.signal;
    view.unmount(); expect(signal?.aborted).toBe(true); expect(h.subscriptions.size).toBe(0);
    expect(h.controls.observedActions().some(call => call.action === "close")).toBe(false);
  });
  it("approve is synchronous in the gesture, with no app popup or startup sequencing", () => {
    const h = fixture(); const open = vi.spyOn(window, "open");
    render(<SdkWriterRoot sdk={h.sdk} />);
    fireEvent.click(screen.getByRole("button", {name: "Sign in"}));
    expect(h.controls.observedActions().filter(call => call.action === "approve")).toHaveLength(1);
    expect(h.controls.observedActions().some(call => call.action === "start")).toBe(false); expect(open).not.toHaveBeenCalled();
  });
  it("uses canonical SDK GitHub login and selects the original collection ID", () => {
    const h = fixture({status: "unselected", signIn: paired, collections: [{collectionId: "selected-id", displayName: "Writing", role: "owner"}]});
    render(<SdkWriterRoot sdk={h.sdk} />);
    expect(screen.getByText("Signed in as writer-user on GitHub")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Writing"}));
    expect(h.controls.observedActions().find(call => call.action === "select")).toMatchObject({collectionId: "selected-id", signal: expect.any(AbortSignal)});
    expect(screen.queryByText(/fixture-account/)).toBeNull();
  });
  it("unapproved URL request delegates approval without substituting another approved collection", () => {
    const h = fixture({status: "unselected", signIn: paired, collections: [{collectionId: "other-id", displayName: "Other collection", role: "owner"}],
      selection: {state: "approval_required", requested: {collectionId: "requested-id", source: "url", displayName: null, approved: false}, usable: null, problem: null}});
    render(<SdkWriterRoot sdk={h.sdk} />);
    expect(screen.queryByRole("button", {name: "Other collection"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Approve collection"}));
    expect(h.controls.observedActions().find(call => call.action === "approve")).toMatchObject({collectionId: "requested-id", signal: expect.any(AbortSignal)});
    expect(h.controls.observedActions().some(call => call.action === "select")).toBe(false);
  });
  it("blocked access delegates reauthorization to the SDK", () => {
    const h = fixture({status: "blocked", signIn: paired});
    render(<SdkWriterRoot sdk={h.sdk} />);
    fireEvent.click(screen.getByRole("button", {name: "Review access"}));
    expect(h.controls.observedActions().find(call => call.action === "reauthorize")).toMatchObject({signal: expect.any(AbortSignal)});
  });
  it("invalid collection request delegates choosing another without app URL parsing", () => {
    const h = fixture({selection: {state: "invalid", requested: {collectionId: null, source: "url", displayName: null, approved: false}, usable: null, problem: "application_selection_invalid"}});
    render(<SdkWriterRoot sdk={h.sdk} />);
    fireEvent.click(screen.getByRole("button", {name: "Choose another collection"}));
    expect(h.controls.observedActions().find(call => call.action === "chooseAnother")).toMatchObject({signal: expect.any(AbortSignal)});
    expect(screen.queryByRole("button", {name: "Sign in"})).toBeNull();
  });
  it("failed physical-close outcome cannot publish sign-out or leak diagnostics", async () => {
    const h = fixture({status: "unselected", signIn: paired}); const signedOut = vi.fn();
    h.controls.setHandler("close", () => {throw new Error("private-detail");});
    render(<SdkWriterRoot sdk={h.sdk} onSignedOut={signedOut} />);
    fireEvent.click(screen.getByRole("button", {name: "Sign out"}));
    await screen.findByRole("alert"); expect(signedOut).not.toHaveBeenCalled(); expect(screen.queryByText("private-detail")).toBeNull();
  });
  it("late close on a retired owner cannot sign out its replacement", async () => {
    const h = fixture({status: "unselected", signIn: paired}); const next = fixture(); const signedOut = vi.fn();
    let finish!: () => void; h.controls.setHandler("close", () => new Promise<void>(resolve => {finish = resolve;}));
    const view = render(<SdkWriterRoot sdk={h.sdk} onSignedOut={signedOut} />);
    fireEvent.click(screen.getByRole("button", {name: "Sign out"}));
    view.rerender(<SdkWriterRoot sdk={next.sdk} onSignedOut={signedOut} />);
    await act(async () => finish()); expect(signedOut).not.toHaveBeenCalled(); expect(h.subscriptions.size).toBe(0);
  });
  it("unavailable shell offers no pretend sign-in/setup/READY", () => {
    const h = fixture({status: "blocked", problem: "application_not_yet_available"});
    render(<SdkWriterRoot sdk={h.sdk} />);
    expect(screen.getByRole("alert").textContent).toContain("isn't available"); expect(screen.queryByRole("button", {name: "Sign in"})).toBeNull();
  });
  it("root ready delegates to the SAME client/session and scope retirement releases only its own leases", async () => {
    const h = await readyFixture(); const close = vi.spyOn(h.client, "close");
    const scopes: WriterNativeScope[] = []; const publish = (scope: WriterNativeScope) => scopes.push(scope);
    render(<StrictMode><SdkWriterRoot sdk={h.sdk} renderNative={scope => <Capture scope={scope} publish={publish} />} /></StrictMode>);
    await screen.findByText("Native test consumer");
    const scope = scopes.at(-1); if (!scope) throw new Error("Missing public native scope");
    expect(scope.connection.records).toBe(h.client);
    const opened = await scope.records.open("writing/main.md", {autosave: false}); if (!opened.ok) throw new Error(opened.problem.code);
    const peer = await h.client.records.open({path: "writing/main.md"}, {autosave: false});
    opened.value.session.setBody("Updated manuscript"); expect(await opened.value.session.flush()).toEqual({ok: true});
    expect(peer.session.getSnapshot().body).toBe("Updated manuscript");
    await act(async () => h.publish({readiness: {...h.application.getSnapshot().readiness, checking: true, assessment: null}}));
    expect(scope.signal.aborted).toBe(true); expect(() => opened.value.session.setBody("Retired overwrite")).toThrow();
    expect(await scope.records.open("writing/main.md")).toMatchObject({ok: false, problem: {code: "cancelled"}});
    expect(peer.session.getSnapshot().body).toBe("Updated manuscript"); peer.release();
    expect(close).not.toHaveBeenCalled(); expect(h.metadata).not.toHaveBeenCalled();
  });
  it("ready renders the existing manuscript list through the native backend and SDK collection action", async () => {
    const h = await readyFixture();
    const names = ["manuscript", "source", "comment"];
    const catalog: wire.DescribeResult = {specVersion: "0.3.0", settings: new Map(), issues: [], inclusion: {include: ["image"]},
      contracts: manifest.requirements.contracts.map((contract, index) => ({...contract, path: `_contracts/${contract.id}.md`, digest: contract.digest.replace(/^sha256:/, ""), contractType: "record", implementedBy: [names[index] ?? "unknown"]})),
      types: manifest.requirements.contracts.map((contract, index) => ({name: names[index] ?? "unknown", path: `_types/${names[index]}.md`, implements: [{contract: contract.id, version: contract.version, fields: new Map([["title", "title"], ["template", "template"], ["csl", "csl"]])}]}))};
    vi.spyOn(h.client, "describe").mockResolvedValue(catalog);
    const close = vi.spyOn(h.client, "close");
    render(<SdkWriterRoot sdk={h.sdk} />);
    await screen.findByText("Original manuscript");
    expect(screen.queryByText(/workspace integration isn't available/)).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Choose another collection"}));
    await waitFor(() => expect(h.controls.observedActions().some(call => call.action === "chooseAnother")).toBe(true));
    expect(close).not.toHaveBeenCalled();
  });
  it("explicit setup delegates to SDK configure without treating its success as READY", async () => {
    const h = fixture({status: "setup_required"}); const native = vi.fn(() => <p>Never ready</p>);
    render(<SdkWriterRoot sdk={h.sdk} renderNative={native} />);
    fireEvent.click(screen.getByRole("button", {name: "Set up Writer"}));
    await waitFor(() => expect(h.controls.observedActions().some(call => call.action === "configure")).toBe(true));
    expect(native).not.toHaveBeenCalled();
  });
  it("unknown readiness and retired connection cannot invoke native domain UI", async () => {
    const h = await readyFixture(); const native = vi.fn(() => <p>Not permitted</p>);
    h.current.mockReturnValue(false);
    render(<SdkWriterRoot sdk={h.sdk} renderNative={native} />);
    await act(async () => undefined); expect(native).not.toHaveBeenCalled();
  });
});
