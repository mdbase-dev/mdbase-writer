// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createWriterMdbase, deliverWriterGrantReturn, isWriterGrantReturn, writerMdbaseForBuild } from "./sdk-application.js";
import manifest from "../generated/mdbase-app.json";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

it("defaults only LAB builds to the SDK entry while production keeps the legacy entry", () => {
  expect(writerMdbaseForBuild("production")).toBeUndefined();
  expect(writerMdbaseForBuild(undefined)).toBeUndefined();
  const entry = writerMdbaseForBuild("lab");
  expect(entry).toBeDefined();
  // Node/jsdom need not host a native Worker to prove the selected entry.
  expect(entry?.getSnapshot().readiness.assessment).toBeNull();
  expect(entry?.connection("unopened")).toBeNull();
});

it("constructs the actual live public entry without registration, Worker or popup IO", async () => {
  const worker = vi.fn(() => {throw new Error("No test Worker allocation");});
  const channel = vi.fn(() => {throw new Error("No test channel allocation");});
  vi.stubGlobal("Worker", worker); vi.stubGlobal("MessageChannel", channel);
  const fetch = vi.spyOn(globalThis, "fetch");
  const popup = vi.spyOn(window, "open");
  const original = JSON.stringify(manifest);
  // Explicit fixture UUID, not a claimed CP registration or runtime acceptance.
  const entry = createWriterMdbase({registeredApplicationId: "00000000-0000-4000-8000-000000000001", environment: "lab"});
  expect(entry.getSnapshot()).toMatchObject({status: "not_started", problem: null,
    selection: {state: "none", requested: {collectionId: null, approved: false}, usable: null}});
  expect(entry.connection("unopened")).toBeNull();
  expect(JSON.stringify(manifest)).toBe(original);
  expect(worker).not.toHaveBeenCalled(); expect(channel).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(popup).not.toHaveBeenCalled();
  await entry.close();
});

it("recognises the Private collection consent return at the redirect URI, in the SDK entry only", async () => {
  const home = manifest.redirect_uris[0]!;
  expect(isWriterGrantReturn("lab", `${home}?state=s1&code=c1`)).toBe(true);
  expect(isWriterGrantReturn("lab", `${home}?state=s1&error=access_denied`)).toBe(true);
  expect(isWriterGrantReturn("lab", `${home}?collection=x`)).toBe(false);
  expect(isWriterGrantReturn("lab", `${new URL("manuscripts", home).href}?state=s1&code=c1`)).toBe(false);
  // The legacy entry's own OAuth callback shares the root: never intercepted there.
  expect(isWriterGrantReturn("production", `${home}?state=s1&code=c1`)).toBe(false);

  const posted: unknown[] = [];
  class Channel { constructor(readonly name: string) {} postMessage(value: unknown) {posted.push([this.name, value]);} close() {} }
  vi.stubGlobal("BroadcastChannel", Channel);
  await deliverWriterGrantReturn(`${home}?state=s1&code=c1`);
  expect(posted).toEqual([["mdbase.app-grant.v1", {type: "callback", url: `${home}?state=s1&code=c1`}]]);
});
