import { describe, expect, it } from "vitest";

import { blockQuotation, embeddedQuotation, ManuscriptAssembler, mapToRecord, materialize, splitFrontmatter, typstPathFor, type WriterRecord } from "../src/index.js";
import { loadLibrary, loadStyles, locales } from "./helpers.js";

const record = (path: string, text: string): WriterRecord => ({ path, ...splitFrontmatter(text) });

const annotation = record(
  "annotations/being-1.md",
  "---\ntype: reader-annotation\nsource: \"[[sources/badiou-being|Being and Event]]\"\nlocator:\n  label: p. 178\n---\n\n> The event is *supernumerary*.\n>\n> It belongs to the situation.\n\nMy private note about this.\n",
);
const sourceKeys = new Map([["sources/badiou-being.md", "badiouBeing07"]]);

describe("embeddedQuotation", () => {
  it("quotes an annotation as a block quote, cited from its source and locator, without its note", () => {
    expect(embeddedQuotation(annotation, sourceKeys)).toEqual({
      markdown: "> The event is *supernumerary*.\n>\n> It belongs to the situation. [@badiouBeing07, p. 178]",
      key: "badiouBeing07",
    });
  });

  it("finds the source by its file name, as a wikilink would", () => {
    const short = record("a.md", "---\nsource: \"[[badiou-being]]\"\n---\n\n> Quoted.\n");
    expect(embeddedQuotation(short, sourceKeys).key).toBe("badiouBeing07");
  });

  it("warns when the source is not in the library, and quotes it uncited", () => {
    expect(embeddedQuotation(annotation, new Map())).toEqual({
      markdown: blockQuotation(null, { quote: "The event is *supernumerary*.\n\nIt belongs to the situation." }),
      problem: { severity: "warning", metadata: "library", message: "No source in the library matches sources/badiou-being.md, so the quotation from annotations/being-1.md is not cited." },
    });
  });

  it("has nothing to embed from a note without a quotation", () => {
    const note = record("n.md", "---\nsource: \"[[sources/badiou-being]]\"\n---\n\nJust a note.\n");
    expect(embeddedQuotation(note, sourceKeys)).toMatchObject({ markdown: "", problem: { severity: "error" } });
  });
});

describe("embedding an annotation", () => {
  const records = new Map([
    ["doc.md", record("doc.md", "Before.\n\n![[annotations/being-1]]\n\nAfter [@badiouBeing07, 180].\n")],
    ["annotations/being-1.md", annotation],
  ]);
  const base = { main: "doc.md", records, recordPaths: new Set([...records.keys(), "sources/badiou-being.md"]), filePaths: new Set<string>(), library: loadLibrary(), styles: loadStyles(), sourceKeys };

  it("includes the quotation, cited in document order, mapped to the embed", () => {
    const a = new ManuscriptAssembler().assemble({ ...base, locales });
    expect(a.diagnostics).toEqual([]);
    expect(a.order).toEqual(["doc.md"]);
    const quoted = a.sources.get(typstPathFor("annotations/being-1.md")) ?? "";
    expect(quoted).toContain("supernumerary");
    expect(quoted).not.toContain("private note");
    expect(quoted).toContain(`#let md-file = "doc.md"`);
    expect(a.debug.citations).toHaveLength(2);
    const map = a.maps.get(typstPathFor("annotations/being-1.md"));
    const embedAt = (records.get("doc.md")?.body ?? "").indexOf("![[");
    expect(map?.record).toBe("doc.md");
    expect(map && mapToRecord(map, quoted.indexOf("supernumerary"))).toBe(embedAt);
  });

  it("reports an annotation's problem on the embed", () => {
    const a = new ManuscriptAssembler().assemble({ ...base, locales, sourceKeys: new Map() });
    const embedAt = (records.get("doc.md")?.body ?? "").indexOf("![[");
    expect(a.diagnostics).toEqual([expect.objectContaining({ record: "doc.md", from: embedAt, severity: "warning" })]);
  });

  it("treats a record the collection lists as an annotation as one, whatever its type", () => {
    const untyped = record("annotations/being-1.md", annotation.body);
    const a = new ManuscriptAssembler().assemble({
      ...base,
      locales,
      records: new Map([...records, ["annotations/being-1.md", { ...untyped, frontmatter: { source: "[[sources/badiou-being]]" } }]]),
      annotationPaths: new Set(["annotations/being-1.md"]),
    });
    expect(a.sources.get(typstPathFor("annotations/being-1.md"))).not.toContain("private note");
  });

  it("materialises the quotation and cites its source", () => {
    const out = materialize(base);
    expect(out.problems).toEqual([]);
    expect(out.markdown).toContain("> It belongs to the situation. [@badiouBeing07, p. 178]");
    expect(out.markdown).not.toContain("private note");
    expect(out.references.map((r) => r.id)).toContain("badiouBeing07");
  });
});
