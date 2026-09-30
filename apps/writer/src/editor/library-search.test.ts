import { describe, expect, it } from "vitest";

import type { LibraryEntry } from "../backend/types.js";
import { authorYear, searchLibrary, shortTitle } from "./library-search.js";

const entry = (key: string, family: string, title: string, year: number): LibraryEntry => ({
  key,
  title,
  path: `sources/${key}.md`,
  item: { id: key, title, author: [{ family, given: "A." }], issued: { "date-parts": [[year]] } },
});
const library = [
  entry("agambenBartleby99", "Agamben", "Bartleby, or on contingency", 1999),
  entry("agambenPotentialities99", "Agamben", "Potentialities", 1999),
  entry("badiouBeing07", "Badiou", "Being and Event", 2007),
  entry("zizekTicklish99", "Žižek", "The Ticklish Subject", 1999),
];

describe("searchLibrary", () => {
  it("finds sources by author, title word and year, not only the key", () => {
    expect(searchLibrary(library, "bartleby").map((e) => e.key)).toEqual(["agambenBartleby99"]);
    expect(searchLibrary(library, "event 2007").map((e) => e.key)).toEqual(["badiouBeing07"]);
    expect(searchLibrary(library, "zizek").map((e) => e.key)).toEqual(["zizekTicklish99"]);
    expect(searchLibrary(library, "agamben99").map((e) => e.key)).toEqual(["agambenBartleby99", "agambenPotentialities99"]);
  });

  it("puts citekey prefixes first", () => {
    expect(searchLibrary(library, "badiou")[0]?.key).toBe("badiouBeing07");
    expect(searchLibrary(library, "1999").map((e) => e.key)).toHaveLength(3);
  });

  it("formats author and year", () => {
    expect(authorYear(library[2] as LibraryEntry)).toBe("Badiou, 2007");
  });

  it("puts preferred (cited) sources first among equal matches", () => {
    const cited = new Set(["agambenPotentialities99"]);
    expect(searchLibrary(library, "agamben", 50, cited).map((e) => e.key)).toEqual(["agambenPotentialities99", "agambenBartleby99"]);
    expect(searchLibrary(library, "", 50, cited)[0]?.key).toBe("agambenPotentialities99");
    // A better match still wins.
    expect(searchLibrary(library, "agambenB", 50, cited).map((e) => e.key)).toEqual(["agambenBartleby99"]);
  });

  it("shortens titles to the part before a subtitle", () => {
    expect(shortTitle("Potentialities: Collected Essays in Philosophy")).toBe("Potentialities");
    expect(shortTitle("The Rigveda. The Earliest Religious Poetry of India")).toBe("The Rigveda");
    expect(shortTitle("An exceptionally long title that goes on well past forty characters", 40)).toBe("An exceptionally long title that goes…");
  });
});
