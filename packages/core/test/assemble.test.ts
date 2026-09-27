import { describe, expect, it } from "vitest";

import { ManuscriptAssembler, MAIN, mapToRecord, splitFrontmatter, typstPathFor, type AssemblyInput, type WriterRecord } from "../src/index.js";
import { loadFixture, loadLibrary, loadStyles, locales } from "./helpers.js";

const styles = loadStyles();
const library = loadLibrary();

function input(records: Map<string, WriterRecord>, main: string, files = new Set<string>()): AssemblyInput {
  return { main, records, recordPaths: new Set(records.keys()), filePaths: files, library, styles, locales };
}

function record(path: string, text: string): WriterRecord {
  const { body, frontmatter } = splitFrontmatter(text);
  return { path, body, frontmatter };
}

describe("ManuscriptAssembler", () => {
  it("assembles the fixture paper with no diagnostics", () => {
    const { records, files } = loadFixture("paper");
    const a = new ManuscriptAssembler().assemble(input(records, "paper.md", files));
    expect(a.diagnostics).toEqual([]);
    expect(a.order).toEqual(["paper.md"]);
    expect(a.assets).toEqual(["figures/site.svg"]);
    expect(a.citations.clusters).toBe(20);
    const paper = a.sources.get("/paper.typ") ?? "";
    expect(paper).toContain(`#let md-file = "paper.md"`);
    expect(paper).toContain("#ref(<sec-agamben>); reconstructs");
    expect(paper).toContain('image("/figures/site.svg", width: 60%)');
    // Notes move after punctuation and lose the space before them.
    expect(paper).toMatch(/potentiality not to\.#footnote\[/);
    const main = a.sources.get(MAIN) ?? "";
    expect(main).toContain('#import "/templates/article.typ": *');
    expect(main).toContain("title: [Potentiality and the Event");
    expect(main).toContain("#metadata(none)<ref-badiouBeing07>");
  });

  it("maps generated offsets back to the record body", () => {
    const { records, files } = loadFixture("paper");
    const a = new ManuscriptAssembler().assemble(input(records, "paper.md", files));
    const src = a.sources.get("/paper.typ") ?? "";
    const map = a.maps.get("/paper.typ");
    const at = src.indexOf("Melville");
    const body = records.get("paper.md")?.body ?? "";
    expect(map && body.slice(mapToRecord(map, at), mapToRecord(map, at) + 8)).toBe("Melville");
  });

  it("reports missing citekeys, labels and images, with placeholders instead of failing", () => {
    const records = new Map([
      ["doc.md", record("doc.md", "See [@nosuch2020] and @fig-missing.\n\n![Caption](gone.png)\n")],
    ]);
    const a = new ManuscriptAssembler().assemble(input(records, "doc.md"));
    expect(a.diagnostics.map((d) => d.message)).toEqual([
      "No source in the library has the citekey nosuch2020.",
      "Nothing is labelled fig-missing.",
      "No file in the collection matches the image gone.png.",
    ]);
    const src = a.sources.get("/doc.typ") ?? "";
    expect(src).toContain('#missing("nosuch2020");');
    expect(src).toContain('missing-image("gone.png")');
  });

  it("follows embeds across records, numbering notes and citations across them", () => {
    const records = new Map([
      ["book.md", record("book.md", "---\ntitle: Book\ncsl: chicago-notes-bibliography\n---\n\n![[chapters/one]]\n\n![[two]]\n")],
      ["chapters/one.md", record("chapters/one.md", "# One {#sec-one}\n\nFirst [@badiouBeing07, 10].\n")],
      ["chapters/two.md", record("chapters/two.md", "# Two\n\nAgain [@badiouBeing07, 12], see @sec-one.\n")],
    ]);
    const a = new ManuscriptAssembler().assemble(input(records, "book.md"));
    expect(a.diagnostics).toEqual([]);
    expect(a.order).toEqual(["book.md", "chapters/one.md", "chapters/two.md"]);
    expect(a.sources.get("/book.typ")).toContain('#include "/chapters/one.typ"');
    expect(a.sources.get("/book.typ")).toContain('#include "/chapters/two.typ"');
    // The second citation of the same work is a short note, across records.
    expect(a.debug.citations[1]).toContain("#emph[Being and Event];, 12");
    expect(a.sources.get(typstPathFor("chapters/two.md"))).toContain("#ref(<sec-one>);");
  });

  it("reports unloaded, missing and cyclic embeds", () => {
    const records = new Map([
      ["a.md", record("a.md", "![[b]]\n\n![[nowhere]]\n\n![[a]]\n")],
    ]);
    const paths = new Set(["a.md", "b.md"]);
    const a = new ManuscriptAssembler().assemble({ ...input(records, "a.md"), recordPaths: paths });
    expect(a.unloaded).toEqual(["b.md"]);
    expect(a.diagnostics.map((d) => d.message)).toEqual([
      "No record matches the embed ![[nowhere]].",
      "Embedding a.md here would include it inside itself.",
    ]);
  });

  it("falls back from unknown styles and templates with a warning", () => {
    const records = new Map([["m.md", record("m.md", "---\ncsl: made-up\ntemplate: poster\n---\nText.\n")]]);
    const a = new ManuscriptAssembler().assemble(input(records, "m.md"));
    expect(a.meta.style).toBe("chicago-notes-bibliography");
    expect(a.meta.template).toBe("article");
    expect(a.diagnostics.map((d) => d.severity)).toEqual(["warning", "warning"]);
    expect(a.diagnostics.map((d) => d.field)).toEqual(["csl", "template"]);
  });

  it("formats citations in the manuscript's language, and sets it for Typst", () => {
    const body = "A [@agambenBartleby99].\n";
    const us = new ManuscriptAssembler().assemble(input(new Map([["m.md", record("m.md", `---\ncsl: chicago-notes-bibliography\n---\n${body}`)]]), "m.md"));
    const gb = new ManuscriptAssembler().assemble(input(new Map([["m.md", record("m.md", `---\ncsl: chicago-notes-bibliography\nlang: en-GB\n---\n${body}`)]]), "m.md"));
    expect(us.meta.locale).toBe("en-US");
    expect(gb.meta.locale).toBe("en-GB");
    expect(us.debug.citations[0]).toContain("“");
    expect(gb.debug.citations[0]).toContain("‘");
    expect(gb.sources.get(MAIN)).toContain('#set text(lang: "en", region: "gb")');
    const unknown = new ManuscriptAssembler().assemble(input(new Map([["m.md", record("m.md", "---\nlang: tlh\n---\nText.\n")]]), "m.md"));
    expect(unknown.meta.locale).toBe("en-US");
    expect(unknown.diagnostics.map((d) => d.field)).toEqual(["lang"]);
  });

  it("uses a style and a template from the collection once they are loaded", () => {
    const records = new Map([["papers/m.md", record("papers/m.md", "---\ncsl: ../styles/house.csl\ntemplate: house.typ\n---\nA [@agambenBartleby99].\n")]]);
    const files = new Set(["styles/house.csl", "templates/house.typ"]);
    const assembler = new ManuscriptAssembler();
    const loading = assembler.assemble(input(records, "papers/m.md", files));
    expect(loading.diagnostics).toEqual([]);
    expect(loading.assets).toEqual(["styles/house.csl", "templates/house.typ"]);
    expect(loading.meta.style).toBe("chicago-notes-bibliography");
    const texts = new Map([
      ["styles/house.csl", styles.get("apa") ?? ""],
      ["templates/house.typ", "#let template(title: none, subtitle: none, authors: (), abstract: none, date: none, body) = body\n"],
    ]);
    const loaded = assembler.assemble({ ...input(records, "papers/m.md", files), texts });
    expect(loaded.meta.style).toBe("styles/house.csl");
    expect(loaded.meta.template).toBe("templates/house.typ");
    expect(loaded.debug.citations[0]).toMatch(/\(Agamben, 1999\)/);
    const main = loaded.sources.get(MAIN) ?? "";
    expect(main).toContain('#import "/templates/house.typ": template as writer-template');
    expect(main).toContain("#show: writer-template.with(");
    expect(loaded.assets).toContain("templates/house.typ");
    const missing = assembler.assemble(input(new Map([["m.md", record("m.md", "---\ncsl: nowhere.csl\n---\nText.\n")]]), "m.md"));
    expect(missing.diagnostics.map((d) => [d.field, d.message])).toEqual([["csl", "No file in the collection matches the citation style nowhere.csl."]]);
  });

  it("says which setting each line of the main file holds", () => {
    const records = new Map([["m.md", record("m.md", "---\ntitle: T\ndate: 2026\n---\nText.\n")]]);
    const a = new ManuscriptAssembler().assemble(input(records, "m.md"));
    const lines = (a.sources.get(MAIN) ?? "").split("\n");
    const fieldOf = (needle: string) => a.mainFields.get(lines.findIndex((l) => l.includes(needle)));
    expect(fieldOf("title: [T]")).toBe("title");
    expect(fieldOf('date: "2026"')).toBe("date");
    expect(fieldOf("#show:")).toBe("template");
  });

  it("keeps raw Typst block spans correct after substitution", () => {
    const records = new Map([
      ["r.md", record("r.md", "Cite [@badiouBeing07] first.\n\n```{=typst}\n#pagebreak()\n```\n")],
    ]);
    const a = new ManuscriptAssembler().assemble(input(records, "r.md"));
    const src = a.sources.get("/r.typ") ?? "";
    const [block] = a.rawBlocks.get("/r.typ") ?? [];
    expect(block && src.slice(block[0], block[1])).toBe("#pagebreak()");
  });
});
