// The Word export end to end in Node: the materialised demo manuscript through
// the same pandoc.wasm the browser loads, with the layout's reference document.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { materialize, splitFrontmatter, type CslItem, type WriterRecord } from "@mdbase-writer/core";
import { STYLES } from "@mdbase-writer/core/styles";
import { describe, expect, it } from "vitest";
import { pandocWarnings } from "./warnings.js";

const root = resolve(import.meta.dirname, "../..");
const csl = resolve(root, "../../packages/core/assets/csl");

describe("Word export", () => {
  it("converts a manuscript to DOCX with citations, cross-references and styles", { timeout: 120_000 }, async () => {
    const { createPandocInstance } = (await import(resolve(root, "node_modules/pandoc-wasm/src/core.js"))) as typeof import("pandoc-wasm/core");
    const pandoc = await createPandocInstance(readFileSync(resolve(root, "node_modules/pandoc-wasm/src/pandoc.wasm")).buffer as ArrayBuffer);
    const text = readFileSync(resolve(root, "demo/manuscripts/slow-change.md"), "utf8");
    const record: WriterRecord = { path: "manuscripts/slow-change.md", ...splitFrontmatter(text) };
    const chapter: WriterRecord = {
      path: "chapters/evidence.md",
      frontmatter: {},
      body: "# An inserted chapter\n\n![Site photo](<figures/à reef (west).png>){#fig-site}\n",
    };
    const photoPath = "chapters/figures/à reef (west).png";
    const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const records = new Map([
      [record.path, { ...record, body: `${record.body}\n\n![[${chapter.path}]]\n` }],
      [chapter.path, chapter],
    ]);
    const library = new Map((JSON.parse(readFileSync(resolve(root, "demo/library.json"), "utf8")) as CslItem[]).map((i) => [i.id, i]));
    const styles = new Map(STYLES.map((s) => [s.id, readFileSync(resolve(csl, `${s.id}.csl`), "utf8")]));
    const out = materialize({
      main: record.path,
      records,
      recordPaths: new Set(records.keys()),
      filePaths: new Set(["manuscripts/figures/reef-stages.svg", photoPath]),
      library,
      styles,
      crossReferences: "resolved",
    });
    const files: Record<string, string | Blob> = {
      "references.json": JSON.stringify(out.references),
      "style.csl": out.styleXml,
      "reference.docx": new Blob([readFileSync(resolve(root, "public/docx/article.docx"))]),
    };
    expect(out.problems).toEqual([]);
    for (const [from, to] of out.media) {
      files[to] = new Blob([from === photoPath ? photo : readFileSync(resolve(root, "demo", from))]);
    }
    const result = await pandoc.convert(
      { from: "markdown", to: "docx", "output-file": "m.docx", standalone: true, citeproc: true, "reference-doc": "reference.docx", "resource-path": ["."] },
      out.markdown,
      files,
    );
    const docx = result.files["m.docx"];
    expect(result.stderr).toBe("");
    expect(docx).toBeDefined();
    // Pandoc embeds the SVG but cannot invoke the external fallback rasterizer
    // in WASM. PNG must embed without warnings.
    expect(pandocWarnings(result.warnings)).toEqual([expect.stringMatching(/^Could not convert image .*reef-stages\.svg:/)]);
    const plain = await pandoc.convert(
      { from: "docx", to: "plain", standalone: true, "input-files": ["m.docx"], "extract-media": "extracted" },
      null,
      { "m.docx": docx as Blob },
    );
    const extracted = Object.entries(plain.files).filter(([path]) => path.startsWith("extracted/media/"));
    const png = extracted.find(([path]) => path.endsWith(".png"))?.[1];
    expect(png).toBeDefined();
    expect(Buffer.from(await png!.arrayBuffer())).toEqual(photo);
    expect(extracted.some(([path]) => path.endsWith(".svg"))).toBe(true);
    expect(plain.stdout).toContain("Small Agents, Large Effects");
    expect(plain.stdout).toMatch(/Section \d/);
    expect(plain.stdout).not.toMatch(/\(sec-[\w-]+\?\)/);
    expect(plain.stdout).toContain("Bibliography");
  });
});
