import { expect, it } from "vitest";
import { workspaceSaveNotice } from "./records.js";

it("does not label an unreviewed recovered draft as Saved", () => {
  expect(workspaceSaveNotice("saved", true, "connect")).toEqual({ tone: "attention", label: "Review local drafts", shortLabel: "Review drafts" });
  expect(workspaceSaveNotice("saved_on_device", true, "demo").tone).toBe("attention");
});
it("returns to the real save state when recovery has been reviewed", () => {
  expect(workspaceSaveNotice("saved", false, "connect")).toEqual({ tone: "saved", label: "Saved", shortLabel: undefined });
  expect(workspaceSaveNotice("conflict", false, "connect")).toEqual({ tone: "attention", label: "Changed elsewhere", shortLabel: "Conflict" });
});

it("scopes demo save copy without changing connected acknowledgements or attention states", () => {
  expect(workspaceSaveNotice("saved", false, "demo").label).toBe("Saved for this demo session");
  expect(workspaceSaveNotice("saved_on_device", false, "connect").label).toBe("Saved on this device; waiting for sync");
  for (const state of ["unsaved", "saving", "conflict", "recovery", "error", "deleted", "saved_on_device"] as const) {
    expect(workspaceSaveNotice(state, false, "demo")).toEqual(workspaceSaveNotice(state, false, "connect"));
  }
  expect(workspaceSaveNotice("saved", true, "demo").label).toBe("Review local drafts");
});
