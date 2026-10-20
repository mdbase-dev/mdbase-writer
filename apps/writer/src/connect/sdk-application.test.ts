// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createWriterMdbase, deliverWriterGrantReturn, isWriterGrantReturn, selectWriterBuildEnvironment, writerMdbaseForBuild } from "./sdk-application.js";
import manifest from "../generated/mdbase-app.json";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

const ORIGINS = {
  lab: "https://lab.mdbase-writer.pages.dev",
  staging: "https://staging.mdbase-writer.pages.dev",
  production: "https://writer.mdbase.dev",
} as const;
const manifestFor = (origin: string) => ({
  homepage: `${origin}/`,
  installation_origins: {
    lab: { "app-runtime": [ORIGINS.lab] },
    staging: { "app-runtime": [ORIGINS.staging] },
    production: { "app-runtime": [ORIGINS.production] },
  },
});

it("selects the native entry for lab, staging and production from the explicit build environment", () => {
  expect(selectWriterBuildEnvironment("lab", manifestFor(ORIGINS.lab)))
    .toEqual({ environment: "lab", origin: ORIGINS.lab });
  expect(selectWriterBuildEnvironment("staging", manifestFor(ORIGINS.staging)))
    .toEqual({ environment: "staging", origin: ORIGINS.staging });
  expect(selectWriterBuildEnvironment("production", manifestFor(ORIGINS.production)))
    .toEqual({ environment: "production", origin: ORIGINS.production });
});

it("refuses an environment whose manifest origin or declaration does not match it", () => {
  // A production-origin manifest must never be retargeted to staging or LAB.
  expect(() => selectWriterBuildEnvironment("staging", manifestFor(ORIGINS.production))).toThrow(/refuses/);
  expect(() => selectWriterBuildEnvironment("lab", manifestFor(ORIGINS.production))).toThrow(/refuses/);
  expect(() => selectWriterBuildEnvironment("production", manifestFor(ORIGINS.staging))).toThrow(/refuses/);
  // The right homepage without a staging installation declaration still refuses.
  const { staging: _dropped, ...withoutStaging } = manifestFor(ORIGINS.staging).installation_origins;
  expect(() => selectWriterBuildEnvironment("staging", { homepage: `${ORIGINS.staging}/`, installation_origins: withoutStaging }))
    .toThrow(/refuses/);
});

it("refuses unknown build environments and leaves an absent one unselected for local/dev entry", () => {
  expect(() => selectWriterBuildEnvironment("qa", manifestFor(ORIGINS.production))).toThrow(/Unsupported/);
  expect(() => writerMdbaseForBuild("qa")).toThrow(/Unsupported/);
  expect(selectWriterBuildEnvironment(undefined, manifestFor(ORIGINS.production))).toBeUndefined();
  expect(writerMdbaseForBuild(undefined)).toBeUndefined();
  expect(writerMdbaseForBuild("")).toBeUndefined();
});

it("builds the native entry for the bundled production manifest and refuses LAB/staging retargets of it", () => {
  // `pnpm manifest` with no origin override declares the production origin.
  expect(new URL(manifest.homepage).origin).toBe(ORIGINS.production);
  const entry = writerMdbaseForBuild("production");
  expect(entry).toBeDefined();
  // Node/jsdom need not host a native Worker to prove the selected entry.
  expect(entry?.getSnapshot().readiness.assessment).toBeNull();
  expect(entry?.connection("unopened")).toBeNull();
  expect(() => writerMdbaseForBuild("lab")).toThrow(/refuses/);
  expect(() => writerMdbaseForBuild("staging")).toThrow(/refuses/);
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
  expect(isWriterGrantReturn("lab", `${ORIGINS.lab}/?state=s1&code=c1`)).toBe(true);
  expect(isWriterGrantReturn("lab", `${ORIGINS.lab}/?state=s1&error=access_denied`)).toBe(true);
  expect(isWriterGrantReturn("staging", `${ORIGINS.staging}/?state=s1&code=c1`)).toBe(true);
  expect(isWriterGrantReturn("production", `${home}?state=s1&code=c1`)).toBe(true);
  expect(isWriterGrantReturn("production", `${home}?state=s1&error=access_denied`)).toBe(true);
  expect(isWriterGrantReturn("lab", `${home}?collection=x`)).toBe(false);
  expect(isWriterGrantReturn("lab", `${new URL("manuscripts", home).href}?state=s1&code=c1`)).toBe(false);
  // The legacy entry's own OAuth callback shares the root: never intercepted there.
  expect(isWriterGrantReturn(undefined, `${home}?state=s1&code=c1`)).toBe(false);
  expect(isWriterGrantReturn("qa", `${home}?state=s1&code=c1`)).toBe(false);

  const posted: unknown[] = [];
  class Channel { constructor(readonly name: string) {} postMessage(value: unknown) {posted.push([this.name, value]);} close() {} }
  vi.stubGlobal("BroadcastChannel", Channel);
  await deliverWriterGrantReturn(`${home}?state=s1&code=c1`);
  expect(posted).toEqual([["mdbase.app-grant.v1", {type: "callback", url: `${home}?state=s1&code=c1`}]]);
});
