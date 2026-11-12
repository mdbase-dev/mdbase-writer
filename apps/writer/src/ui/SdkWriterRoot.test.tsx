// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "../test/render.js";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestApp, type TestApp, type TestAppOptions } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import { App } from "../App.js";
import { SdkWriterRoot, type WriterNativeScope } from "./SdkWriterRoot.js";

vi.mock("@mdbase-dev/ui/feedback", () => ({ FeedbackButton: () => null }));

const apps: TestApp[] = [];
async function fixture(options: TestAppOptions) {
  const app = await createTestApp({declaration: {id: "writer.fixture", name: "Writer fixture", origin: "https://writer.mdbase.dev", environment: "lab", manifest}, ...options});
  apps.push(app);
  const count = (action: string) => app.controls.observedActions().filter(call => call.action === action).length;
  return {...app, count};
}
function readyFixture() {
  const contracts = manifest.requirements.contracts.map((contract, index) => ({id: contract.id, version: contract.version, contractDigest: contract.digest, type: ["manuscript", "source", "comment"][index] ?? "unknown", fields: {title: "title", template: "template", csl: "csl"}}));
  return fixture({collections: [
    {name: "Writing", contracts, records: [{path: "writing/main.md", frontmatter: {title: "Original manuscript"}, body: "Original manuscript", types: ["manuscript"]}]},
    {name: "Archive", role: "editor"},
  ]});
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
  cleanup(); for (const app of apps.splice(0)) void app.close(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (dialogClose) Object.defineProperty(HTMLDialogElement.prototype, "close", dialogClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (dialogShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", dialogShowModal); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
function Capture({scope, publish}: {scope: WriterNativeScope; publish(scope: WriterNativeScope): void}) {
  useEffect(() => {publish(scope);}, [scope, publish]);
  return <p role="status">Native test consumer</p>;
}

it("retries the selected failed open through the shared recovery control", async () => {
  const h = await fixture({ collections: [{ name: "Writing" }], phase: { problem: "unavailable" } });
  const collectionId = h.mdbase.getSnapshot().selectedCollectionId;
  expect(collectionId).toBeTruthy();
  render(<SdkWriterRoot sdk={h.mdbase} renderNative={() => <p>Recovered Writer</p>} />);
  expect(await screen.findByText("mdbase couldn't complete this request. Try again.")).toBeTruthy();
  expect(screen.queryByText(/couldn't be reached/i)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Try again$/ }));
  await screen.findByText("Recovered Writer");
  expect(h.controls.observedActions().filter(call => call.action === "select")).toEqual([expect.objectContaining({ collectionId })]);
  expect(h.count("start")).toBe(0);
});

it("hands Writer the gate's ready connection and retires that scope when the collection closes", async () => {
  const h = await readyFixture(); const close = vi.spyOn(h.client(), "close");
  const scopes: WriterNativeScope[] = []; const publish = (scope: WriterNativeScope) => scopes.push(scope);
  render(<StrictMode><SdkWriterRoot sdk={h.mdbase} renderNative={scope => <Capture scope={scope} publish={publish} />} /></StrictMode>);
  await screen.findByText("Native test consumer");
  // The consumer publishes its scope from an effect, which can run after its text is on screen.
  const scope = await waitFor(() => { const latest = scopes.at(-1); if (!latest) throw new Error("Missing native scope"); return latest; });
  expect(scope.connection.records).toBe(h.client());
  await act(async () => h.set("choosing"));
  expect(screen.queryByText("Native test consumer")).toBeNull();
  expect(scope.signal.aborted).toBe(true);
  expect(await scope.records.open("writing/main.md")).toMatchObject({ok: false, problem: {code: "cancelled"}});
  expect(close).not.toHaveBeenCalled();
});

it("opens the manuscript list with the shared collection switcher in the top bar", async () => {
  const h = await readyFixture();
  const {container} = render(<App sdk={h.mdbase} />);
  await screen.findByRole("button", { name: /Original manuscript/ });
  expect(screen.queryByText("Continue writing")).toBeNull();
  const trigger = await screen.findByRole("button", {name: "Writing Owner"});
  expect(container.querySelector(".topbar-slot")?.contains(trigger)).toBe(true);
  fireEvent.click(trigger);
  // The popover's open state is a browser feature jsdom lacks, so find the row directly.
  const archive = [...document.querySelectorAll<HTMLElement>("[role=radio]")].find(row => row.textContent.includes("Archive"));
  if (!archive) throw new Error("No Archive row in the switcher");
  fireEvent.click(archive);
  await waitFor(() => expect(h.count("select")).toBe(1));
});

it("signs out with signOut and never closes the shared entry", async () => {
  const h = await fixture({collections: [{name: "Drafts"}], phase: "choosing"});
  render(<SdkWriterRoot sdk={h.mdbase} renderNative={() => <p>Never ready</p>} />);
  expect(await screen.findByText("Drafts")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Sign out"}));
  await waitFor(() => expect(h.count("signOut")).toBe(1));
  expect(h.count("close")).toBe(0);
  expect(screen.queryByText("Never ready")).toBeNull();
});
