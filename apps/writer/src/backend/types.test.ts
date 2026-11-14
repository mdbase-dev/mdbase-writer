import { describe, expect, it } from "vitest";

import { libraryEntry, manuscriptBody, manuscriptSlug, titleFromNote } from "./types.js";

it("starts a blank manuscript without a scaffold and keeps the worked example opt-in", () => {
  expect(manuscriptBody()).toBe("");
  expect(manuscriptBody(true, "example2026")).toContain("[@example2026, p. 12]");
  expect(manuscriptBody(true)).toContain("# Introduction {#sec-intro}");
});

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



describe("titleFromNote", () => {
  it("uses the first heading, without its attributes, else the file name", () => {
    expect(titleFromNote("a/b.md", "Intro\n\n## On *things* {#sec-x}\n")).toBe("On *things*");
    expect(titleFromNote("drafts/on-inoperativity.md", "No heading.")).toBe("on-inoperativity");
  });
});
