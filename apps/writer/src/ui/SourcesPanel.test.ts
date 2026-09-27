import { describe, expect, it } from "vitest";

import { sourceAnnotation } from "../backend/types.js";
import { headings } from "./outline.js";
import { parseAuthors } from "./Settings.js";
import { citationFor, quotationFor } from "./SourcesPanel.js";

describe("Reader annotations", () => {
  it("reads the source link, locator, quotation and note as Reader writes them", () => {
    const a = sourceAnnotation(
      "annotations/a.md",
      { source: "[[sources/agamben|Potentialities]]", locator: { label: "p. 182" } },
      "> To be potential means: to be one's own lack.\n\nThe key definition.\n",
    );
    expect(a).toEqual({ path: "annotations/a.md", source: "sources/agamben.md", quote: "To be potential means: to be one's own lack.", note: "The key definition.", locator: "p. 182" });
    expect(sourceAnnotation("x.md", {}, "> q")).toBeNull();
  });

  it("cites with the locator only when it reads as one", () => {
    expect(citationFor("k", "p. 182")).toBe("[@k, p. 182]");
    expect(citationFor("k", "Chapter 2 · 40% through")).toBe("[@k]");
    expect(citationFor("k")).toBe("[@k]");
  });

  it("quotes short passages inline and long ones as block quotes", () => {
    expect(quotationFor("k", { quote: "Short  text.", locator: "p. 3" })).toBe("“Short text.” [@k, p. 3]");
    const long = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    expect(quotationFor("k", { quote: long })).toBe(`\n\n> ${long} [@k]\n\n`);
  });
});

describe("outline headings", () => {
  it("lists ATX headings outside code fences, without attributes", () => {
    const body = "# One {#sec-one}\n\ntext\n\n```\n# not a heading\n```\n\n## Two ##\n";
    expect(headings(body)).toEqual([
      { level: 1, text: "One", offset: 0 },
      { level: 2, text: "Two", offset: body.indexOf("## Two") },
    ]);
  });
});

describe("authors field", () => {
  it("parses one author per line with an optional affiliation", () => {
    expect(parseAuthors("A. Author; Somewhere\n\nB. Author\n")).toEqual([{ name: "A. Author", affiliation: "Somewhere" }, { name: "B. Author" }]);
  });
});
