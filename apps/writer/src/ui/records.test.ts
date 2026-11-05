import { expect, it } from "vitest";
import { workspaceSaveNotice } from "./records.js";

it("does not label an unreviewed recovered draft as Saved", () => {
  expect(workspaceSaveNotice("saved", true)).toEqual({ tone: "attention", label: "Review local drafts", shortLabel: "Review drafts" });
  expect(workspaceSaveNotice("saved_on_device", true).tone).toBe("attention");
});

it("returns to the real save state when recovery has been reviewed", () => {
  expect(workspaceSaveNotice("saved", false)).toEqual({ tone: "saved", label: "Saved", shortLabel: undefined });
  expect(workspaceSaveNotice("conflict", false)).toEqual({ tone: "attention", label: "Changed elsewhere", shortLabel: "Conflict" });
});

it("keeps every unsettled save state visible on phones", () => {
  for (const state of ["unsaved", "saving", "conflict", "recovery", "error", "deleted", "saved_on_device"] as const) {
    const notice = workspaceSaveNotice(state, false);
    expect(notice.shortLabel).toBeTruthy();
    expect(notice.tone).not.toBe("saved");
  }
  expect(workspaceSaveNotice("saved_on_device", false).label).toBe("Saved on this device; waiting for sync");
});

it("never announces remote success while offline or holding local-only changes", () => {
  expect(workspaceSaveNotice("saved", false, "offline")).toEqual({ tone: "pending", label: "Offline", shortLabel: "Offline" });
  expect(workspaceSaveNotice("saved_on_device", false, "offline")).toEqual({ tone: "pending", label: "Offline · saved on this device; waiting for sync", shortLabel: "Offline · on device, pending sync" });
  expect(workspaceSaveNotice("saved_on_device", false, "reconnecting").shortLabel).toBe("On device · pending sync");
  expect(workspaceSaveNotice("saved", false, "saved_on_device").tone).toBe("pending");
  expect(workspaceSaveNotice("error", false, "offline")).toEqual(workspaceSaveNotice("error", false));
  expect(workspaceSaveNotice("conflict", false, "offline")).toEqual(workspaceSaveNotice("conflict", false));
});
