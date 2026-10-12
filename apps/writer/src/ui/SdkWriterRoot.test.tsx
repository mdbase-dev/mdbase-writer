// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, mdbaseError, describeError, summarizeStatus, MdbasePeopleClient, type MdbaseSetupPlan, type MdbaseApplication, type MdbaseApplicationConnection, type MdbaseApplicationSnapshot, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
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
  for (const reason of ["refused", "expired"]) it(`SDK ${reason} sign-in stays renewable with exact SDK copy`, () => {
    const h = fixture({status: "blocked", problem: reason});
    const copy = describeError(h.application.getSnapshot());
    if (!copy?.actionLabel) throw new Error("Missing SDK sign-in description");
    render(<SdkWriterRoot sdk={h.sdk} />);
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(screen.getByText(copy.message)).toBeTruthy();
    const signIn = screen.getByRole("button", {name: copy.actionLabel});
    expect(signIn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(signIn);
    expect(h.controls.observedActions().filter(call => call.action === "approve")).toHaveLength(1);
    expect(h.controls.observedActions().some(call => call.action === "authorize")).toBe(false);
  });
  it("authorizing still offers an enabled explicit SDK approval gesture", () => {
    const h = fixture({status: "authorizing"});
    render(<SdkWriterRoot sdk={h.sdk} />);
    const signIn = screen.getByRole("button", {name: "Sign in"});
    expect(signIn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(signIn);
    expect(h.controls.observedActions().filter(call => call.action === "approve")).toHaveLength(1);
  });
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
    const h = fixture({status: "blocked", signIn: paired, problem: "forbidden"});
    render(<SdkWriterRoot sdk={h.sdk} />);
    fireEvent.click(screen.getByRole("button", {name: describeError("forbidden")?.actionLabel ?? "Approve"}));
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
    await waitFor(() => expect(scopes.length).toBeGreaterThan(0));
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
  const setupPlan: MdbaseSetupPlan = {status: "setup", canApply: true, digest: `sha256:${"a".repeat(64)}`, summary: "This app will make 1 change to this collection.",
    changes: [{kind: "create", target: "_types/manuscript.md", message: 'Add the "manuscript" record type.'}], conflicts: [], adoptable: {}, packs: [], staged: [], records: []};
  const count = (h: ReturnType<typeof fixture>, action: string) => h.controls.observedActions().filter(call => call.action === action).length;
  function reviewSetup() {
    const h = fixture({status: "setup_required", signIn: paired, selectedCollectionId: "c1", collections: [{collectionId: "c1", displayName: "Drafts", role: "owner"}]});
    h.controls.setSetupPlan(setupPlan); const native = vi.fn(() => <p>Never ready</p>);
    render(<StrictMode><SdkWriterRoot sdk={h.sdk} renderNative={native} /></StrictMode>);
    fireEvent.click(screen.getByRole("button", {name: describeError("setup_required")?.actionLabel ?? "Missing SDK setup label"}));
    return {h, native};
  }
  it("setup shows the SDK review and only Confirm applies that plan, without treating success as READY", async () => {
    const {h, native} = reviewSetup();
    expect(await screen.findByText(setupPlan.summary)).toBeTruthy();
    expect(screen.getByText('Add the "manuscript" record type.')).toBeTruthy();
    expect(count(h, "planSetup")).toBe(1); expect(count(h, "applySetup")).toBe(0);
    fireEvent.click(screen.getByRole("button", {name: "Confirm"}));
    await waitFor(() => expect(count(h, "applySetup")).toBe(1));
    expect(h.controls.observedActions().find(call => call.action === "applySetup")?.signal).toBeInstanceOf(AbortSignal);
    expect(count(h, "configure")).toBe(0);
    await waitFor(() => expect(screen.getByText(describeError("setup_required")?.message ?? "Missing SDK setup copy")).toBeTruthy());
    expect(native).not.toHaveBeenCalled();
  });
  it("a readiness re-check while setup applies keeps the review and its apply running", async () => {
    const {h} = reviewSetup(); const application = h.sdk.application(); let finish!: () => void;
    h.controls.setHandler("applySetup", () => {
      const now = application.getSnapshot();
      h.controls.publishSnapshot({...now, status: "opening", readiness: {...now.readiness, checking: true}});
      return new Promise<void>(resolve => { finish = resolve; });
    });
    fireEvent.click(await screen.findByRole("button", {name: "Confirm"}));
    await waitFor(() => expect(count(h, "applySetup")).toBe(1));
    expect(screen.getByText(setupPlan.summary)).toBeTruthy();
    expect(h.controls.observedActions().find(call => call.action === "applySetup")?.signal?.aborted).toBe(false);
    await act(async () => finish());
  });
  it("a collection that changed during review is planned again, and Cancel writes nothing", async () => {
    const {h} = reviewSetup();
    h.controls.setHandler("applySetup", () => { throw mdbaseError("conflict", "changed", "setup_changed"); });
    fireEvent.click(await screen.findByRole("button", {name: "Confirm"}));
    expect(await screen.findByText(/changed while you were reviewing/)).toBeTruthy();
    expect(count(h, "planSetup")).toBe(2); expect(count(h, "applySetup")).toBe(1);
    fireEvent.click(await screen.findByRole("button", {name: "Cancel"}));
    expect(screen.getByRole("button", {name: describeError("setup_required")?.actionLabel ?? "Missing SDK setup label"})).toBeTruthy();
    expect(count(h, "applySetup")).toBe(1); expect(count(h, "configure")).toBe(0);
  });
  it("an unconfirmed setup outcome re-assesses and never claims nothing changed", async () => {
    const {h} = reviewSetup();
    h.controls.setHandler("applySetup", () => { throw mdbaseError("outcome_unknown", "lost reply"); });
    fireEvent.click(await screen.findByRole("button", {name: "Confirm"}));
    expect(await screen.findByText(/couldn't confirm whether setup finished/)).toBeTruthy();
    await waitFor(() => expect(count(h, "planSetup")).toBe(2));
    expect(screen.queryByText(/Nothing was changed/)).toBeNull();
    expect(await screen.findByText(setupPlan.summary)).toBeTruthy();
  });
  it("a plan with nothing to review keeps the plain configure path", async () => {
    const h = fixture({status: "setup_required", signIn: paired, selectedCollectionId: "c1", collections: [{collectionId: "c1", displayName: "Drafts", role: "owner"}]});
    h.controls.setSetupPlan({...setupPlan, status: "current", canApply: false, summary: "Already set up.", changes: []});
    render(<SdkWriterRoot sdk={h.sdk} />);
    fireEvent.click(screen.getByRole("button", {name: describeError("setup_required")?.actionLabel ?? "Missing SDK setup label"}));
    await waitFor(() => expect(count(h, "configure")).toBe(1));
    expect(count(h, "applySetup")).toBe(0); expect(screen.queryByText("Already set up.")).toBeNull();
  });
  it("shows the plan's refusal message plainly", async () => {
    const h = fixture({status: "setup_required", signIn: paired, selectedCollectionId: "c1", collections: [{collectionId: "c1", displayName: "Drafts", role: "owner"}]});
    h.controls.setSetupPlan({...setupPlan, status: "conflict", canApply: false, changes: [], refusal: {code: "setup_forbidden", message: "Only the collection's owner can set up Writer."}});
    render(<SdkWriterRoot sdk={h.sdk} />);
    fireEvent.click(screen.getByRole("button", {name: describeError("setup_required")?.actionLabel ?? "Missing SDK setup label"}));
    expect(await screen.findByText("Only the collection's owner can set up Writer.")).toBeTruthy();
    expect(screen.getByRole("button", {name: "Confirm"}).hasAttribute("disabled")).toBe(true);
  });
  it.each([null, {code: "unavailable"}])("settled readiness %j checks again without opening native UI", async problem => {
    const h = await readyFixture();
    h.publish({readiness: {...h.application.getSnapshot().readiness, assessment: null, problem}});
    const native = vi.fn(() => <p>Not yet ready</p>);
    render(<SdkWriterRoot sdk={h.sdk} renderNative={native}/>);
    expect(screen.queryByText(/Opening/)).toBeNull();
    if (problem) expect(screen.getByRole("alert").textContent).toContain(describeError(problem)?.message);
    fireEvent.click(screen.getByRole("button", {name: "Check again"}));
    await waitFor(() => expect(h.controls.observedActions().some(call => call.action === "assess")).toBe(true));
    expect(h.controls.observedActions().find(call => call.action === "assess")?.signal).toBeInstanceOf(AbortSignal);
    expect(native).not.toHaveBeenCalled();
  });
  it("an incompatible settled collection uses SDK copy and a validated update link", async () => {
    const h = await readyFixture();
    h.publish({readiness: {...h.application.getSnapshot().readiness, assessment: {status: "incompatible", problem: null}}});
    const native = vi.fn(() => <p>Not permitted</p>);
    render(<SdkWriterRoot sdk={h.sdk} renderNative={native}/>);
    const description = describeError(h.application.getSnapshot());
    expect(screen.getByRole("alert").textContent).toContain(description?.message);
    expect(screen.getByRole("link", {name: description?.actionLabel ?? "Update the app"}).getAttribute("href")).toBe(description?.updateUrl);
    fireEvent.click(screen.getByRole("button", {name: "Choose another collection"}));
    await waitFor(() => expect(h.controls.observedActions().some(call => call.action === "chooseAnother")).toBe(true));
    expect(native).not.toHaveBeenCalled();
  });
  it("active checking ignores a stale incompatible assessment", async () => {
    const h = await readyFixture();
    h.publish({readiness: {...h.application.getSnapshot().readiness, checking: true, assessment: {status: "incompatible", problem: null}}});
    render(<SdkWriterRoot sdk={h.sdk}/>);
    expect(screen.getByRole("status").textContent).toContain("Opening Writing");
    expect(screen.queryByRole("button", {name: "Check again"})).toBeNull();
    expect(screen.queryByRole("link", {name: "Update the app"})).toBeNull();
  });
  it("a thrown registration refusal uses safe SDK copy, not raw or developer diagnostics", async () => {
    const h = fixture();
    h.controls.setHandler("approve", () => {throw Object.assign(new Error("private-registration-detail"), {code: "invalid_request", reason: "application_registration_refused"});});
    render(<SdkWriterRoot sdk={h.sdk}/>);
    fireEvent.click(screen.getByRole("button", {name: "Sign in"}));
    const description = describeError({code: "invalid_request", reason: "application_registration_refused"});
    expect((await screen.findByRole("alert")).textContent).toContain(description?.message);
    expect(screen.queryByText("private-registration-detail")).toBeNull();
    expect(description?.developerMessage).toBeTypeOf("string");
    if (description?.developerMessage) expect(screen.queryByText(description.developerMessage)).toBeNull();
  });
  it.each(["collection_migrating", "update_required", "account_suspended"])("live %s preserves local edits and original record leases", async problem => {
    const h = await readyFixture();
    const close = vi.spyOn(h.client, "close");
    const peer = await h.client.records.open({path: "writing/main.md"}, {autosave: false});
    const scopes: WriterNativeScope[] = [];
    render(<SdkWriterRoot sdk={h.sdk} renderNative={scope => <><Capture scope={scope} publish={value => scopes.push(value)}/><input aria-label="Local manuscript" defaultValue="Draft"/></>}/>);
    await screen.findByText("Native test consumer");
    const scope = scopes.at(-1); if (!scope) throw new Error("Missing original scope");
    const input = screen.getByRole<HTMLInputElement>("textbox", {name: "Local manuscript"});
    fireEvent.change(input, {target: {value: "Unsaved local edit"}});
    await act(async () => h.publish({problem}));
    expect(screen.getByText(summarizeStatus(h.client.status, problem).text)).toBeTruthy();
    expect(screen.getByRole("textbox", {name: "Local manuscript"})).toBe(input);
    expect(input.value).toBe("Unsaved local edit");
    expect(scopes.at(-1)).toBe(scope); expect(scope.signal.aborted).toBe(false);
    expect(peer.session.getSnapshot().body).toBe("Original manuscript");
    expect(close).not.toHaveBeenCalled(); peer.release();
  });
  it("unknown readiness and retired connection cannot invoke native domain UI", async () => {
    const h = await readyFixture(); const native = vi.fn(() => <p>Not permitted</p>);
    h.current.mockReturnValue(false);
    render(<SdkWriterRoot sdk={h.sdk} renderNative={native} />);
    await act(async () => undefined); expect(native).not.toHaveBeenCalled();
    expect(screen.queryByText(/Opening/)).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Choose another collection"}));
    await waitFor(() => expect(h.controls.observedActions().some(call => call.action === "chooseAnother")).toBe(true));
  });
});
