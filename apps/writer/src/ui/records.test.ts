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
