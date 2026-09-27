import { describe, expect, it } from "vitest";

import { libraryEntry, manuscriptSlug, titleFromNote, withType } from "./types.js";

describe("libraryEntry", () => {
  it("uses the CSL id as the citekey and the CSL title", () => {
    expect(libraryEntry("sources/a.md", { title: "Note title", csl: { id: "badiouBeing07", title: "Being and Event", type: "book" } })).toEqual({
      key: "badiouBeing07",
      title: "Being and Event",
      path: "sources/a.md",
      item: { id: "badiouBeing07", title: "Being and Event", type: "book" },
    });
  });

  it("skips sources without citation data", () => {
    expect(libraryEntry("sources/b.md", { title: "Saved page" })).toBeNull();
    expect(libraryEntry("sources/c.md", { csl: { title: "No id" } })).toBeNull();
  });
});

describe("manuscriptSlug", () => {
  it("makes a readable file name", () => {
    expect(manuscriptSlug("Potentiality & the Évent: A Study")).toBe("potentiality-the-event-a-study");
    expect(manuscriptSlug("???")).toBe("untitled");
  });
});

describe("withType", () => {
  it("adds the manuscript type and keeps existing types", () => {
    expect(withType(undefined, "writer-manuscript")).toBe("writer-manuscript");
    expect(withType("note", "writer-manuscript")).toEqual(["note", "writer-manuscript"]);
    expect(withType(["note", "draft"], "writer-manuscript")).toEqual(["note", "draft", "writer-manuscript"]);
    expect(withType("Writer-Manuscript", "writer-manuscript")).toBe("Writer-Manuscript");
  });
});

describe("titleFromNote", () => {
  it("uses the first heading, without its attributes, else the file name", () => {
    expect(titleFromNote("a/b.md", "Intro\n\n## On *things* {#sec-x}\n")).toBe("On *things*");
    expect(titleFromNote("drafts/on-inoperativity.md", "No heading.")).toBe("on-inoperativity");
  });
});
