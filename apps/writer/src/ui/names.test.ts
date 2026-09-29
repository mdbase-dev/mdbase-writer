import { describe, expect, it } from "vitest";

import { byRecentlyEdited, noteName } from "./names.js";

describe("noteName", () => {
  it("reads a note's file name as a title", () => {
    expect(noteName("drafts/on-inoperativity.md")).toBe("On inoperativity");
    expect(noteName("reading_notes.md")).toBe("Reading notes");
  });
});

describe("byRecentlyEdited", () => {
  it("lists the newest first, then those without a time by title", () => {
    const list = [
      { title: "B", modified: "2026-01-01T00:00:00Z" },
      { title: "Z" },
      { title: "A" },
      { title: "C", modified: "2026-03-01T00:00:00Z" },
    ];
    expect(byRecentlyEdited(list).map((m) => m.title)).toEqual(["C", "B", "A", "Z"]);
  });
});
