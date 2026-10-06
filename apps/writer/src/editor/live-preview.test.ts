import { describe, expect, it } from "vitest";

import type { LibraryEntry } from "../backend/types.js";
import { citationText } from "./live-preview.js";

const entry = (key: string, family: string, year: number): LibraryEntry => ({ key, path: `${key}.md`, title: key, item: { id: key, author: [{ family }], issued: { "date-parts": [[year]] } } });
const insight = {
  library: new Map([entry("darwin42", "Darwin", 1842), entry("lyell30", "Lyell", 1830)].map((e) => [e.key, e])),
  labels: new Map([["sec-intro", { record: "a.md", offset: 0, text: "Introduction" }]]),
};

describe("citation chips", () => {
  it("reads a citation as its authors and years, with prefixes and locators", () => {
    expect(citationText("@darwin42", insight)).toBe("Darwin, 1842");
    expect(citationText("see @darwin42, p. 12; also @lyell30, chap. 1", insight)).toBe("see Darwin, 1842, p. 12; also Lyell, 1830, chap. 1");
  });
  it("keeps a locator written without a comma, and the year alone for a suppressed author", () => {
    expect(citationText("@darwin42 490", insight)).toBe("Darwin, 1842, 490");
    expect(citationText("-@darwin42", insight)).toBe("1842");
  });
  it("does not stand in for a key it cannot resolve, so the problem stays visible", () => {
    expect(citationText("@nobody99", insight)).toBeNull();
    expect(citationText("@darwin42; @nobody99", insight)).toBeNull();
  });
  it("names a labelled target cited in brackets", () => {
    expect(citationText("@sec-intro", insight)).toBe("Introduction");
  });
});
