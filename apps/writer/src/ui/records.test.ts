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

it("never calls delayed or refused sync saved, even when the local save settled", () => {
  for (const state of ["saved", "saved_on_device", "saving"] as const) {
    expect(workspaceSaveNotice(state, false, "sync_delayed", true)).toEqual({ tone: "attention", label: "Changes haven't reached the server", shortLabel: "Not on server" });
  }
});

it("keeps every unsettled save state visible on phones", () => {
  for (const state of ["unsaved", "saving", "conflict", "recovery", "error", "deleted", "saved_on_device"] as const) {
    const notice = workspaceSaveNotice(state, false);
    expect(notice.shortLabel).toBeTruthy();
    expect(notice.tone).not.toBe("saved");
  }
  expect(workspaceSaveNotice("saved_on_device", false).label).toBe("Saving…");
  expect(workspaceSaveNotice("saved_on_device", false, null, true).label).toBe("Saved on this device; waiting for sync");
});

it("never announces remote success while offline or holding local-only changes", () => {
  expect(workspaceSaveNotice("saved", false, "offline")).toEqual({ tone: "pending", label: "Offline", shortLabel: "Offline" });
  expect(workspaceSaveNotice("saved_on_device", false, "offline", true)).toEqual({ tone: "pending", label: "Offline · saved on this device; waiting for sync", shortLabel: "Offline · on device, pending sync" });
  expect(workspaceSaveNotice("saved_on_device", false, "reconnecting", true).shortLabel).toBe("Reconnecting · On device · pending sync");
  expect(workspaceSaveNotice("saved", false, "saved_on_device").tone).toBe("pending");
  expect(workspaceSaveNotice("error", false, "offline")).toEqual(workspaceSaveNotice("error", false));
  expect(workspaceSaveNotice("conflict", false, "offline")).toEqual(workspaceSaveNotice("conflict", false));
});

it("keeps connection trouble in the single notice while a local checkpoint settles", () => {
  for (const state of ["unsaved", "saving", "saved_on_device"] as const) {
    expect(workspaceSaveNotice(state, false, "offline", true).label).toMatch(/Offline.*saved on this device/);
    expect(workspaceSaveNotice(state, false, "reconnecting", true).label).toMatch(/Reconnecting · Saved on this device; waiting for sync/);
  }
});

it("only acknowledges a committed local draft, including settled SDK local-only states", () => {
  for (const state of ["unsaved", "saving", "saved_on_device"] as const) {
    for (const connection of [null, "offline", "reconnecting", "saved_on_device"] as const) {
      expect(workspaceSaveNotice(state, false, connection, false).label).not.toMatch(/saved on this device/i);
      expect(workspaceSaveNotice(state, false, connection, true).label).toMatch(/saved on this device/i);
    }
  }
  expect(workspaceSaveNotice("recovery", false, null, true).label).toBe("Recovering save…");
  expect(workspaceSaveNotice("saving", true, null, true).label).toBe("Review local drafts");
});
