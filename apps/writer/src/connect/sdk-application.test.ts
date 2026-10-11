// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createWriterApplication, writerApplicationForBuild } from "./sdk-application.js";
import manifest from "../generated/mdbase-app.json";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

it("defaults only LAB builds to the SDK entry while production keeps the legacy entry", () => {
  expect(writerApplicationForBuild("production")).toBeUndefined();
  expect(writerApplicationForBuild(undefined)).toBeUndefined();
  const entry = writerApplicationForBuild("lab");
  expect(entry).toBeDefined();
  // Node/jsdom need not host a native Worker to prove the selected entry.
  expect(entry?.application().getSnapshot().readiness.assessment).toBeNull();
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
  const entry = createWriterApplication({registeredApplicationId: "00000000-0000-4000-8000-000000000001", environment: "lab"});
  expect(entry.application().getSnapshot()).toMatchObject({status: "not_started", problem: null,
    selection: {state: "none", requested: {collectionId: null, approved: false}, usable: null}});
  expect(entry.connection("unopened")).toBeNull();
  expect(JSON.stringify(manifest)).toBe(original);
  expect(worker).not.toHaveBeenCalled(); expect(channel).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(popup).not.toHaveBeenCalled();
  await entry.application().close();
});
