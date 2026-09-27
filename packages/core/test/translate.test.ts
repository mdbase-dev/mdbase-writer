import { describe, expect, it } from "vitest";

import { lintMath, normalizeBars, parseCiteItem, PLACEHOLDER, translateInline, translateRecord } from "../src/index.js";
import { loadFixture } from "./helpers.js";

describe("citation items", () => {
  it("parses prefixes, locators, labels and suffixes like Pandoc", () => {
    expect(parseCiteItem("see @badiouBeing07, 23--30, for the axioms")).toEqual({
      key: "badiouBeing07", prefix: "see", suffix: ", for the axioms", locator: "23-30", label: "page", suppressAuthor: false,
    });
    expect(parseCiteItem(" -@badiouEthics01, chap. 3")).toMatchObject({ key: "badiouEthics01", locator: "3", label: "chapter", suppressAuthor: true });
    expect(parseCiteItem("@adornoNegative07, xii")).toMatchObject({ locator: "xii", label: "page" });
    expect(parseCiteItem("@allenPower10, emphasis added")).toMatchObject({ suffix: ", emphasis added" });
    expect(parseCiteItem("@allenPower10")).not.toHaveProperty("locator");
    expect(parseCiteItem("no key here")).toBeNull();
  });
});

describe("math", () => {
  it("rewrites paired bars as explicit delimiters", () => {
    expect(normalizeBars("|\\mathcal{P}(S)| > |S|")).toBe("\\lvert \\mathcal{P}(S)\\rvert  > \\lvert S\\rvert ");
    expect(normalizeBars("\\|x\\|_2")).toBe("\\lVert x\\rVert _2");
    expect(normalizeBars("\\left| x \\right|")).toBe("\\left| x \\right|");
    expect(normalizeBars("\\{ x \\mid x > 0 \\}")).toBe("\\{ x \\mid x > 0 \\}");
    expect(normalizeBars("P(A | B)")).toBe("P(A | B)"); // an unpaired bar is left alone
  });

  it("finds structural problems mitex would render silently", () => {
    expect(lintMath("\\frac{a}{")).toEqual([{ offset: 8, message: "Unclosed brace." }]);
    expect(lintMath("a}")[0]?.message).toBe("Unmatched closing brace.");
    expect(lintMath("\\begin{pmatrix} a \\end{bmatrix}")[0]?.message).toContain("closes \\begin{pmatrix}");
    expect(lintMath("\\left( x")[0]?.message).toBe("1 \\left but 0 \\right.");
    expect(lintMath("\\frac{a}{b} + \\left( x \\right)")).toEqual([]);
  });
});

describe("translateRecord", () => {
  const paper = loadFixture("paper").records.get("paper.md");
  const tr = translateRecord(paper?.body ?? "");

  it("translates every construct in the fixture paper without diagnostics", () => {
    expect(tr.diagnostics).toEqual([]);
    expect(tr.labels).toEqual([
      "sec-intro", "sec-agamben", "sec-sources", "sec-badiou", "eq-cantor", "eq-matheme", "tbl-contrast", "fig-site", "sec-politics", "sec-conclusion",
    ]);
    expect(tr.typst).toContain("#heading(level: 1)[Introduction] <sec-intro>");
    expect(tr.typst).toContain('#mitex("\\\\lvert \\\\mathcal{P}(S)\\\\rvert  > \\\\lvert S\\\\rvert  \\\\quad \\\\text{for every set } S", numbering: "(1)") <eq-cantor>');
    expect(tr.typst).toMatch(/#figure\(kind: table, table\(columns: 3/);
    expect(tr.typst).toContain("#footnote[The modal picture");
    expect(tr.clusters).toHaveLength(27);
    expect(tr.images).toEqual([expect.objectContaining({ target: "figures/site.svg", width: "60%", wikilink: false })]);
    expect(tr.rawBlocks).toHaveLength(1);
  });

  it("records the raw Typst block span exactly", () => {
    const block = tr.rawBlocks[0];
    expect(block && tr.typst.slice(block.typstFrom, block.typstTo)).toBe(
      '#v(1em)\n#align(center)[#text(size: 0.9em, style: "italic")[--- End of main text ---]]',
    );
  });

  it("anchors increase and point into the body", () => {
    for (let i = 2; i < tr.anchors.length; i += 2) expect(tr.anchors[i]).toBeGreaterThan(tr.anchors[i - 2] ?? -1);
    const body = paper?.body ?? "";
    const at = tr.typst.indexOf("#heading(level: 1)[Badiou");
    const nearest = [...tr.anchors].filter((_, i) => i % 2 === 0).filter((o) => o <= at).pop() ?? 0;
    const src = tr.anchors[tr.anchors.indexOf(nearest) + 1] ?? 0;
    expect(body.slice(src, src + 9)).toBe("# Badiou:");
  });

  it("places a source marker before each top-level block, without changing content", () => {
    expect(tr.typst).toMatch(/#metadata\(\(md-file, \d+\)\)<md-src>#heading\(level: 1\)\[Introduction\]/);
    expect(translateRecord("# A\n\nText", { markers: false }).typst).not.toContain("md-src");
  });

  it("escapes Typst syntax in text and at line starts", () => {
    const t = translateRecord("Costs $5 and 10% of #tags, *a*, @ symbols, a < b > c and a // comment.\n\n= not a heading", { markers: false }).typst;
    expect(t).toContain("\\#tags");
    expect(t).toContain("\\// comment"); // an escaped first slash is enough to stop a comment
    expect(t).toContain("a \\< b \\> c");
    expect(t).toContain("#emph[a];");
    expect(t).toContain("\n\\= not a heading");
  });

  it("turns image embeds into figures and record embeds into include placeholders", () => {
    const t = translateRecord("![[figures/plot.png|300]]{#fig-plot}\n\n![[chapters/one]]\n");
    expect(t.images).toEqual([expect.objectContaining({ target: "figures/plot.png", width: "300pt", wikilink: true })]);
    expect(t.labels).toEqual(["fig-plot"]);
    expect(t.includes).toEqual([expect.objectContaining({ target: "chapters/one" })]);
    expect(t.typst).toContain(`${PLACEHOLDER.include[0]}0${PLACEHOLDER.include[1]}`);
  });

  it("reports footnote and math problems with body offsets", () => {
    const body = "Text[^a] and $\\frac{a}{$ here.\n\n[^b]: Unused.\n";
    const t = translateRecord(body);
    const messages = t.diagnostics.map((d) => [d.message, body.slice(d.from, d.from + 4)]);
    expect(messages).toContainEqual(["Footnote [^a] has no definition.", "[^a]"]);
    expect(messages).toContainEqual(["Footnote [^b] is never referenced.", "[^b]"]);
    expect(t.diagnostics.find((d) => d.message.startsWith("Math"))?.from).toBe(body.indexOf("{$") );
  });

  it("translates inline Markdown for titles", () => {
    expect(translateInline("On *Being and Event*")).toBe("On #emph[Being and Event];");
  });
});
