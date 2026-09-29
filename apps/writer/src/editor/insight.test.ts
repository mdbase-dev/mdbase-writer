import { describe, expect, it } from "vitest";

import { labelTargets, parseReference, referenceAt, referenceAtOffset, referenceOffsets } from "./insight.js";

describe("referenceAt", () => {
  it("finds the key under the offset, without trailing punctuation", () => {
    const line = "See [@agamben99, p. 12] and @sec-intro.";
    expect(referenceAt(line, line.indexOf("agamben") + 2)).toEqual({ key: "agamben99", from: 5, to: 15 });
    expect(referenceAt(line, line.indexOf("sec-intro") + 3)?.key).toBe("sec-intro");
    expect(referenceAt(line, 1)).toBeNull();
  });
  it("ignores e-mail addresses", () => {
    expect(referenceAt("write to me@example.org", 12)).toBeNull();
  });
});

describe("reference offsets", () => {
  const body = "One [@a, p. 2].\nTwo @ab and [@a; @b].\n";
  it("finds each use of one key, at its @", () => {
    expect(referenceOffsets(body, "a")).toEqual([5, body.lastIndexOf("@a;")]);
    expect(referenceOffsets(body, "c")).toEqual([]);
  });
  it("reads the key under a body offset on any line", () => {
    expect(referenceAtOffset(body, body.indexOf("@ab") + 2)).toBe("ab");
    expect(referenceAtOffset(body, body.indexOf("@b") + 1)).toBe("b");
    expect(referenceAtOffset(body, 1)).toBeNull();
  });
});

describe("labelTargets", () => {
  it("labels headings by their text and figures by their caption", () => {
    const body = "# Introduction {#sec-intro}\n\n![The plan](plan.svg){#fig-plan}\n";
    expect(labelTargets("a.md", body)).toEqual([
      ["sec-intro", { record: "a.md", offset: 0, text: "Introduction" }],
      ["fig-plan", { record: "a.md", offset: 29, text: "The plan" }],
    ]);
  });
});

describe("parseReference", () => {
  it("turns citeproc's Typst markup into inline elements", () => {
    expect(parseReference("Agamben, Giorgio. #emph[Potentialities];. Stanford\\@1999.")).toEqual({
      tag: null,
      children: ["Agamben, Giorgio. ", { tag: "em", children: ["Potentialities"] }, ". Stanford@1999."],
    });
  });
  it("keeps a link's text", () => {
    expect(parseReference('#link("https://doi.org/x")[https:\\/\\/doi.org\\/x];')).toEqual({ tag: null, children: [{ tag: "span", children: ["https://doi.org/x"] }] });
  });
});
