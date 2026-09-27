import { describe, expect, it } from "vitest";

import { libraryEntry, manuscriptSlug } from "./types.js";

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
