import { describe, expect, it } from "vitest";

import { byRecentlyEdited, noteName } from "./names.js";

describe("noteName", () => {
  it("reads a note's file name as a title", () => {
    expect(noteName("drafts/on-inoperativity.md")).toBe("On inoperativity");
    expect(noteName("reading_notes.md")).toBe("Reading notes");
  });
});

describe("byRecentlyEdited", () => {
  it("lists the newest first, then unknown times by path without mutating the input", () => {
    const list = [
      { path: "b.md", modified: "2026-01-01T00:00:00Z" },
      { path: "z.md" },
      { path: "a.md", modified: "invalid" },
      { path: "c.md", modified: "2026-03-01T00:00:00Z" },
    ];
    expect(byRecentlyEdited(list).map((m) => m.path)).toEqual(["c.md", "b.md", "a.md", "z.md"]);
    expect(list.map((m) => m.path)).toEqual(["b.md", "z.md", "a.md", "c.md"]);
  });

  it("breaks equal instants by path, not title or arrival order", () => {
    const list = [
      { path: "z.md", title: "A", modified: "2026-03-01T01:00:00+01:00" },
      { path: "a.md", title: "Z", modified: "2026-03-01T00:00:00Z" },
    ];
    expect(byRecentlyEdited(list).map((m) => m.path)).toEqual(["a.md", "z.md"]);
    expect(byRecentlyEdited([...list].reverse())).toEqual(byRecentlyEdited(list));
    expect(byRecentlyEdited(list.map((m) => ({...m, title: "Renamed"}))).map((m) => m.path)).toEqual(["a.md", "z.md"]);
  });
});
