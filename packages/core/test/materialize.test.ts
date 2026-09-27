import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { cleanForPandoc, materialize, splitFrontmatter, type WriterRecord } from "../src/index.js";
import { loadLibrary, loadStyles } from "./helpers.js";

const record = (path: string, text: string): WriterRecord => ({ path, ...splitFrontmatter(text) });

const records = new Map([
  ["book.md", record("book.md", "---\ntitle: A *Book*\nauthors: [{name: A. Author, affiliation: Somewhere}]\ncsl: apa\n---\n\n![[chapters/one]]\n\n![[chapters/two]]\n")],
  ["chapters/one.md", record("chapters/one.md", "# One {#sec-one}\n\nFirst [@badiouBeing07, 10]. See [[chapters/two|the next chapter]].\n\n![Site](../figures/site.svg){#fig-site}\n")],
  ["chapters/two.md", record("chapters/two.md", "# Two\n\n@agambenPotentialities99 argues; see @fig-site and @sec-one.[^n]\n\n[^n]: Compare @agambenBartleby99, 253.\n\n![[plot.png]]\n")],
]);
const input = {
  main: "book.md",
  records,
  recordPaths: new Set(records.keys()),
  filePaths: new Set(["figures/site.svg", "figures/plot.png"]),
  library: loadLibrary(),
  styles: loadStyles(),
};

describe("materialize", () => {
  const out = materialize(input);

  it("inlines embedded records and rewrites images into the media folder", () => {
    expect(out.problems).toEqual([]);
    expect(out.markdown).toContain("# One {#sec-one}");
    expect(out.markdown).toContain("# Two");
    expect(out.markdown).toContain("![Site](media/figures/site.svg){#fig-site}");
    expect(out.markdown).toContain("![](media/figures/plot.png)");
    expect(out.markdown).toContain("See the next chapter.");
    expect(out.markdown).not.toContain("![[");
    expect([...out.media]).toEqual([["figures/site.svg", "media/figures/site.svg"], ["figures/plot.png", "media/figures/plot.png"]]);
  });

  it("writes Pandoc frontmatter and only the cited sources", () => {
    expect(out.markdown).toMatch(/^---\ntitle: A \*Book\*\n/);
    expect(out.markdown).toContain("bibliography: references.json");
    expect(out.markdown).toContain("csl: style.csl");
    expect(out.style).toBe("apa");
    expect(out.references.map((r) => r.id)).toEqual(["agambenBartleby99", "agambenPotentialities99", "badiouBeing07"]);
  });

  it("cleans CSL shapes that Pandoc rejects", () => {
    const cleaned = cleanForPandoc({ id: "x", keyword: [], author: [{ family: "A", given: "B", literal: "" }] } as never);
    expect(cleaned).toEqual({ id: "x", author: [{ family: "A", given: "B" }] });
  });

  it.skipIf(!hasPandoc())("builds a DOCX with Pandoc", () => {
    const dir = mkdtempSync(join(tmpdir(), "writer-bundle-"));
    writeFileSync(join(dir, "manuscript.md"), out.markdown);
    writeFileSync(join(dir, "references.json"), JSON.stringify(out.references));
    writeFileSync(join(dir, "style.csl"), loadStyles().get(out.style) ?? "");
    for (const [, bundled] of out.media) {
      mkdirSync(join(dir, dirname(bundled)), { recursive: true });
      writeFileSync(join(dir, bundled), bundled.endsWith(".svg") ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    }
    execFileSync("pandoc", ["manuscript.md", "--citeproc", "-o", "manuscript.docx"], { cwd: dir, stdio: "ignore" });
    const text = execFileSync("pandoc", ["manuscript.docx", "-t", "plain"], { cwd: dir, encoding: "utf8" });
    expect(text).toContain("(Badiou, 2007, p. 10)");
    expect(text).toContain("Agamben (1999b)"); // disambiguated from the Bartleby essay cited in a footnote
    expect(text).toContain("Bartleby, or on contingency");
    expect(text).toMatch(/Badiou, A\. \(2007\)\. Being and event/i);
    // Plain Pandoc leaves Quarto cross-references unresolved; the bundle README says to use Quarto for them.
    expect(text).toContain("(fig-site?)");
  });
});

function hasPandoc(): boolean {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
