import { describe, expect, it } from "vitest";

import { embedCount, wordCount } from "../words.js";
import { headingAt, headings, sectionWords } from "./outline.js";

describe("wordCount", () => {
  it("counts prose and leaves markup out", () => {
    expect(wordCount("# Introduction {#sec-intro}\n\nIt is *not* actual [@agamben99, p. 12].[^n]\n\n[^n]: A note.")).toBe(7);
  });
  it("counts a narrative citation or cross-reference as one word", () => {
    expect(wordCount("As @agamben99 argues, see @sec-intro.")).toBe(5);
  });
  it("leaves out code, math and embeds", () => {
    expect(wordCount("One $x + y$ two\n\n```\nlet a = 1\n```\n\n![[chapters/one]]\n\nthree `code`")).toBe(3);
  });
  it("keeps contractions and hyphenated words whole", () => {
    expect(wordCount("Bartleby’s well-known formula")).toBe(3);
  });
});

describe("embedCount", () => {
  it("counts embeds on lines of their own", () => {
    expect(embedCount("# Book\n\n![[chapters/one]]\n![[chapters/two]]\n\nSee ![[inline]] here.")).toBe(2);
  });
});

describe("sectionWords", () => {
  it("counts each section with its subsections and their headings", () => {
    const body = "# One\n\na b\n\n## Two\n\nc d e\n\n# Three\n\nf\n";
    expect(sectionWords(body, headings(body))).toEqual([6, 3, 1]);
  });
});

describe("headingAt", () => {
  it("finds the heading an offset is under", () => {
    const body = "intro\n# One\n\ntext\n# Two\n";
    const list = headings(body);
    expect(headingAt(list, 0)).toBeUndefined();
    expect(headingAt(list, body.indexOf("text"))?.text).toBe("One");
  });
});
