import { describe, expect, it } from "vitest";

import type { LibraryEntry } from "../backend/types.js";
import { editDistance, suggestionsFor } from "./fixes.js";
import type { LabelTarget } from "./insight.js";

const entry = (key: string, family: string, title: string, year: number): LibraryEntry => ({
  key,
  title,
  path: `sources/${key}.md`,
  item: { id: key, title, author: [{ family, given: "A." }], issued: { "date-parts": [[year]] } },
});
const library = new Map(
  [
    entry("agambenBartleby99", "Agamben", "Bartleby, or on contingency", 1999),
    entry("agambenPotentialities99", "Agamben", "Potentialities", 1999),
    entry("badiouBeing07", "Badiou", "Being and Event", 2007),
  ].map((e) => [e.key, e]),
);
const label = (text: string): LabelTarget => ({ record: "paper.md", offset: 0, text });
const labels = new Map([
  ["fig-results", label("Results")],
  ["sec-results", label("Results")],
  ["sec-intro", label("Introduction")],
]);

describe("editDistance", () => {
  it("counts insertions, deletions and substitutions, ignoring case", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("Badiou", "badiou")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("suggestionsFor", () => {
  it("offers citekeys a typo away", () => {
    expect(suggestionsFor({ kind: "citekey", key: "badiouBeing7" }, { library, labels })[0]).toBe("badiouBeing07");
  });

  it("offers sources a key finds by author and year", () => {
    expect(suggestionsFor({ kind: "citekey", key: "agamben99" }, { library, labels })).toEqual(["agambenBartleby99", "agambenPotentialities99"]);
  });

  it("offers nothing for a key like no source", () => {
    expect(suggestionsFor({ kind: "citekey", key: "nosuch" }, { library, labels })).toEqual([]);
  });

  it("prefers labels of the same kind", () => {
    expect(suggestionsFor({ kind: "label", key: "fig-result" }, { library, labels })).toEqual(["fig-results", "sec-results"]);
    expect(suggestionsFor({ kind: "label", key: "sec-intr" }, { library, labels })).toEqual(["sec-intro"]);
  });
});
