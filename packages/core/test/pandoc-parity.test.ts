// Citations must match Pandoc's citeproc for the same Markdown and CSL-JSON,
// so PDF output and DOCX (via Pandoc) agree. Runs when pandoc is installed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ManuscriptAssembler } from "../src/index.js";
import { fixturesDir, loadFixture, loadLibrary, loadStyles, locales } from "./helpers.js";

const hasPandoc = (() => {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Plain text of generated Typst markup (drops function calls, keeps content). */
export function typstToPlain(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? "";
    if (ch === "\\") {
      out += s[++i] ?? "";
      continue;
    }
    if (ch === "#") {
      const open = /^#[\w.-]+(\((?:[^()"]|"(?:[^"\\]|\\.)*")*\))?\[/.exec(s.slice(i));
      if (open) {
        i += open[0].length - 1;
        continue;
      }
      const call = /^#[\w.-]+\((?:[^()"]|"(?:[^"\\]|\\.)*")*\);?/.exec(s.slice(i));
      if (call) {
        i += call[0].length - 1;
        continue;
      }
    }
    if (ch === "]" && s[i + 1] === ";") {
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

const normalize = (s: string) =>
  s
    .replace(/[  \s]+/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    // citeproc-js renders number ranges with an en dash; Pandoc keeps the hyphen.
    .replace(/(\d)[–-](\d)/g, "$1-$2")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();

interface PandocNode {
  t: string;
  c?: unknown;
}

function stringify(x: unknown): string {
  if (Array.isArray(x)) return x.map(stringify).join("");
  if (!x || typeof x !== "object") return "";
  const node = x as PandocNode;
  const c = node.c as unknown[];
  switch (node.t) {
    case "Str":
      return String(node.c);
    case "Space":
    case "SoftBreak":
    case "LineBreak":
      return " ";
    case "Quoted": {
      const double = (c[0] as PandocNode).t === "DoubleQuote";
      return (double ? "“" : "‘") + stringify(c[1]) + (double ? "”" : "’");
    }
    case "Link":
    case "Span":
    case "Cite":
      return stringify(c[1]);
    case "Div":
      return stringify(c[1]);
    default:
      return Array.isArray(node.c) ? stringify(node.c) : "";
  }
}

function pandocCitations(markdown: string, style: string, ignore: ReadonlySet<string>) {
  const dir = mkdtempSync(join(tmpdir(), "writer-parity-"));
  // Pandoc rejects the whole library for one invalid field (Reader's data has
  // a `keyword: []`), so hand it a sanitised copy.
  const items = [...loadLibrary().values()].map((i) => (Array.isArray(i["keyword"]) ? { ...i, keyword: undefined } : i));
  writeFileSync(join(dir, "library.json"), JSON.stringify(items));
  writeFileSync(join(dir, "doc.md"), markdown);
  const json = execFileSync(
    "pandoc",
    [join(dir, "doc.md"), "-f", "markdown", "-t", "json", "--citeproc", "--bibliography", join(dir, "library.json"), "--csl", join(fixturesDir, "..", "..", "assets", "csl", `${style}.csl`)],
    { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] },
  );
  const cites: string[] = [];
  const bib = new Map<string, string>();
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    const node = x as PandocNode;
    const c = node.c as unknown[];
    if (node.t === "Cite") {
      const ids = (c[0] as { citationId: string }[]).map((cite) => cite.citationId);
      if (!ids.every((id) => ignore.has(id))) cites.push(normalize(stringify(c[1])));
      return;
    }
    if (node.t === "Div" && (c[0] as unknown[])[0] === "refs") {
      for (const entry of c[1] as PandocNode[]) {
        const entryC = entry.c as unknown[];
        bib.set(String((entryC[0] as unknown[])[0]).replace(/^ref-/, ""), normalize(stringify(entryC[1])));
      }
      return;
    }
    if (node.c) walk(node.c);
  };
  walk((JSON.parse(json) as { blocks: unknown }).blocks);
  return { cites, bib };
}

describe.skipIf(!hasPandoc).each(["chicago-notes-bibliography", "ieee"])("Pandoc parity on the fixture paper (%s)", (style) => {
  it("renders every citation and bibliography entry as Pandoc does", () => {
    const { records, files } = loadFixture("paper");
    const paper = records.get("paper.md");
    if (!paper) throw new Error("fixture");
    const withStyle = new Map([["paper.md", { ...paper, frontmatter: { ...paper.frontmatter, csl: style } }]]);
    const a = new ManuscriptAssembler().assemble({
      main: "paper.md", records: withStyle, recordPaths: new Set(["paper.md"]), filePaths: files, library: loadLibrary(), styles: loadStyles(), locales,
    });
    const pandoc = pandocCitations(paper.body, style, a.labels);
    expect(a.debug.citations.map((s) => normalize(typstToPlain(s)))).toEqual(pandoc.cites);
    expect(new Map(a.debug.bibliography.map((e) => [e.key, normalize(typstToPlain(e.text))]))).toEqual(pandoc.bib);
  });
});
