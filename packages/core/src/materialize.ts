// Materialises a manuscript into standalone Pandoc/Quarto Markdown: embedded
// records are inlined, images point into a media folder, and the cited
// sources become a CSL-JSON bibliography. With Quarto cross-references kept
// it builds with `quarto render manuscript.md --to docx`; with them resolved
// (the in-browser Word export) plain `pandoc --citeproc` builds it.
import type { SyntaxNode } from "@lezer/common";
import { stringify as yamlStringify } from "yaml";

import { resolveCrossReferences } from "./crossref.js";
import { manuscriptMeta } from "./meta.js";
import type { CslItem } from "./citeproc.js";
import { CITEKEY, markdownParser } from "./markdown.js";
import { IMAGE_EXTENSION, resolveLinkTarget, type WriterRecord } from "./records.js";

export interface MaterializeInput {
  readonly main: string;
  readonly records: ReadonlyMap<string, WriterRecord>;
  readonly recordPaths: ReadonlySet<string>;
  readonly filePaths: ReadonlySet<string>;
  readonly library: ReadonlyMap<string, CslItem>;
  /** Bundled citation styles by id. */
  readonly styles: ReadonlyMap<string, string>;
  /** CSL locales by tag, to settle the document language as the preview does. */
  readonly locales?: ReadonlyMap<string, string>;
  /** Collection text files loaded so far (a .csl style the settings name). */
  readonly texts?: ReadonlyMap<string, string>;
  /**
   * "quarto" keeps `{#fig-x}`/`@fig-x` for Quarto to number; "resolved"
   * writes the numbers into the text and captions for plain Pandoc.
   */
  readonly crossReferences?: "quarto" | "resolved";
}

export interface MaterializedManuscript {
  readonly markdown: string;
  /** CSL-JSON for every cited source, cleaned for strict processors (Pandoc). */
  readonly references: readonly CslItem[];
  readonly style: string;
  /** The style's CSL XML. */
  readonly styleXml: string;
  /** The document language (BCP 47). */
  readonly lang: string;
  /** Collection file path → path inside the bundle. */
  readonly media: ReadonlyMap<string, string>;
  readonly problems: readonly string[];
}

export const BUNDLE_MEDIA = "media";
const CITED_KEY = new RegExp(`(?:^|[^\\p{L}\\p{N}_])-?@(${CITEKEY.source})`, "gu");

export function materialize(input: MaterializeInput): MaterializedManuscript {
  const problems: string[] = [];
  const media = new Map<string, string>();
  const cited = new Set<string>();
  const mediaPath = (collectionPath: string) => {
    const bundled = `${BUNDLE_MEDIA}/${collectionPath}`;
    media.set(collectionPath, bundled);
    return bundled;
  };

  const expand = (path: string, stack: readonly string[]): string => {
    const record = input.records.get(path);
    if (!record) {
      problems.push(`${path} is not loaded; it was left out.`);
      return "";
    }
    const body = record.body;
    const edits: { from: number; to: number; text: string }[] = [];
    const visit = (node: SyntaxNode) => {
      switch (node.name) {
        case "EmbedBlock": {
          const raw = body.slice(node.from, node.to);
          const m = /^!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\](\{[^}]*\})?/.exec(raw);
          const target = (m?.[1] ?? "").trim();
          if (IMAGE_EXTENSION.test(target)) {
            const file = resolveLinkTarget(target, path, input.filePaths, "");
            edits.push({ from: node.from, to: node.to, text: file ? `![](${mediaPath(file)})${m?.[3] ?? ""}` : raw });
            if (!file) problems.push(`No file matches the image ${target} in ${path}.`);
          } else {
            const resolved = resolveLinkTarget(target, path, input.recordPaths);
            if (!resolved || resolved === path || stack.includes(resolved)) {
              problems.push(`The embed ![[${target}]] in ${path} was left out.`);
              edits.push({ from: node.from, to: node.to, text: "" });
            } else {
              edits.push({ from: node.from, to: node.to, text: expand(resolved, [...stack, path]).trim() });
            }
          }
          return;
        }
        case "Image": {
          const url = node.getChild("URL");
          if (!url) return;
          const target = body.slice(url.from, url.to).replace(/^<|>$/g, "");
          if (/^[a-z]+:\/\//i.test(target)) return;
          const file = resolveLinkTarget(target, path, input.filePaths, "");
          if (file) edits.push({ from: url.from, to: url.to, text: mediaPath(file) });
          else problems.push(`No file matches the image ${target} in ${path}.`);
          return;
        }
        case "Wikilink": {
          const [target = "", alias] = body.slice(node.from + 2, node.to - 2).split("|");
          edits.push({ from: node.from, to: node.to, text: (alias ?? target.split("/").pop() ?? target).trim() });
          return;
        }
      }
      for (let c = node.firstChild; c; c = c.nextSibling) visit(c);
    };
    visit(markdownParser.parse(body).topNode);
    // Citekeys anywhere in the body, including footnote definitions (whose
    // inline content the block parser leaves unparsed). A stray match only
    // adds an unused entry to the bibliography file.
    for (const m of body.matchAll(CITED_KEY)) if (m[1] && input.library.has(m[1])) cited.add(m[1]);
    let out = body;
    for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
    return out;
  };

  const main = input.records.get(input.main);
  const { meta } = manuscriptMeta(main?.frontmatter ?? {}, {
    styles: input.styles,
    main: input.main,
    filePaths: input.filePaths,
    ...(input.locales ? { locales: new Set(input.locales.keys()) } : {}),
    ...(input.texts ? { texts: input.texts } : {}),
  });
  const expanded = expand(input.main, []);
  const body = input.crossReferences === "resolved" ? resolveCrossReferences(expanded, meta.lang).markdown : expanded;
  const front: Record<string, unknown> = {
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.subtitle ? { subtitle: meta.subtitle } : {}),
    ...(meta.authors.length ? { author: meta.authors.map((a) => (a.affiliation ? { name: a.name, affiliation: a.affiliation } : a.name)) } : {}),
    ...(meta.date ? { date: meta.date } : {}),
    ...(meta.abstract ? { abstract: meta.abstract } : {}),
    lang: meta.lang,
    // Both bundled templates number headings 1.1 (resolved output has the numbers written in).
    ...(input.crossReferences === "resolved" ? {} : { "number-sections": true }),
    bibliography: "references.json",
    csl: "style.csl",
    "link-citations": true,
    "reference-section-title": "Bibliography",
  };
  const references = [...cited].sort().map((key) => cleanForPandoc(input.library.get(key) as CslItem));
  return {
    markdown: `---\n${yamlStringify(front).trimEnd()}\n---\n\n${body.trim()}\n`,
    references,
    style: meta.style,
    styleXml: input.styles.get(meta.style) ?? input.texts?.get(meta.style) ?? "",
    lang: meta.lang,
    media,
    problems,
  };
}

/**
 * Pandoc's CSL-JSON reader is strict where citeproc-js is lenient: it rejects
 * a whole library for one mistyped field. Drops the shapes found in real
 * Reader data (array keywords, empty literal names).
 */
export function cleanForPandoc(item: CslItem): CslItem {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if ((k === "keyword" || k === "note" || k === "language") && typeof v !== "string") continue;
    if (Array.isArray(v) && v.every((n) => n && typeof n === "object" && !Array.isArray(n))) {
      out[k] = v.map((n: Record<string, unknown>) => {
        const name = { ...n };
        if (name["literal"] === "") delete name["literal"];
        return name;
      });
      continue;
    }
    out[k] = v;
  }
  return out as CslItem;
}

/** Instructions shipped in the bundle. */
export const BUNDLE_README = `# Building this manuscript

Exported from mdbase writer. The Markdown uses Pandoc citations and Quarto
cross-references.

With Quarto (citations and cross-references):

    quarto render manuscript.md --to docx

With Pandoc (citations; cross-references need the pandoc-crossref filter):

    pandoc manuscript.md --citeproc -o manuscript.docx
`;
