// Markdown record body → Typst markup.
//
// Translation is per record and independent of every other record, so results
// can be cached by text. Anything that needs the whole manuscript — which
// @-keys are cross-references, citation formatting, note numbering, which
// embeds and images exist — is emitted as a placeholder and resolved during
// assembly. Every emitted run records an anchor (Typst offset → body offset)
// so diagnostics and preview clicks map back to the Markdown.
import type { SyntaxNode } from "@lezer/common";

import { parseCluster, type CiteItem } from "./cite-items.js";
import { escapeMarkup, typstString } from "./escape.js";
import { lintMath, normalizeBars } from "./latex.js";
import { markdownParser } from "./markdown.js";
import { IMAGE_EXTENSION } from "./records.js";

export interface Cluster {
  readonly bracketed: boolean;
  readonly items: readonly CiteItem[];
  readonly from: number;
  readonly to: number;
}

export type TranslationEvent =
  | { readonly t: "fn-open" }
  | { readonly t: "fn-close" }
  | { readonly t: "cluster"; readonly index: number };

export interface ImageRef {
  /** The target as written (relative to the record, or collection-absolute). */
  readonly target: string;
  readonly wikilink: boolean;
  readonly from: number;
  readonly to: number;
  readonly width?: string;
}

export interface IncludeRef {
  readonly target: string;
  readonly from: number;
  readonly to: number;
}

export interface RawBlock {
  /** Offsets in the placeholder Typst (before assembly substitutes placeholders). */
  readonly typstFrom: number;
  readonly typstTo: number;
  readonly from: number;
  readonly to: number;
}

export interface Diagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface TranslatedRecord {
  readonly typst: string;
  /** Flat pairs [typstOffset, bodyOffset, …], increasing. */
  readonly anchors: readonly number[];
  readonly clusters: readonly Cluster[];
  readonly events: readonly TranslationEvent[];
  readonly labels: readonly string[];
  readonly includes: readonly IncludeRef[];
  readonly images: readonly ImageRef[];
  readonly rawBlocks: readonly RawBlock[];
  readonly diagnostics: readonly Diagnostic[];
}

export const PLACEHOLDER = {
  cluster: ["", ""],
  image: ["", ""],
  include: ["", ""],
} as const;
export const HEADER = `#import "/writer/lib.typ": *\n`;

interface Attrs {
  id?: string;
  classes: string[];
  kv: Record<string, string>;
}
const ATTR_TAIL = /\s*\{([^{}]*)\}\s*$/;

function parseAttrs(body: string): Attrs {
  const attrs: Attrs = { classes: [], kv: {} };
  for (const m of body.matchAll(/#([^\s}]+)|\.([^\s}]+)|([\w-]+)=("[^"]*"|\S+)|(?:^|\s)-(?=\s|$)/g)) {
    if (m[1]) attrs.id = m[1];
    else if (m[2]) attrs.classes.push(m[2]);
    else if (m[3]) attrs.kv[m[3]] = (m[4] ?? "").replace(/^"|"$/g, "");
    else attrs.classes.push("unnumbered");
  }
  return attrs;
}

function typstLength(value: string): string {
  return /^\d+(\.\d+)?$/.test(value) ? `${value}pt` : value;
}

class Emitter {
  parts: string[] = [];
  length = 0;
  anchors: number[] = [];
  atLineStart = true;
  lastChar = "\n";
  /** Source marker for the next block: placed directly before its content so it adds no layout. */
  pendingMarker = "";

  anchor(src: number): void {
    const n = this.anchors.length;
    if (n && this.anchors[n - 2] === this.length) this.anchors[n - 1] = src;
    else this.anchors.push(this.length, src);
  }

  write(s: string): void {
    if (!s) return;
    if (this.pendingMarker) {
      s = s.startsWith("\n") ? `\n${this.pendingMarker}${s.slice(1)}` : this.pendingMarker + s;
      this.pendingMarker = "";
    }
    this.parts.push(s);
    this.length += s.length;
    this.atLineStart = s.endsWith("\n");
    this.lastChar = s[s.length - 1] ?? this.lastChar;
  }

  text(s: string, src: number): void {
    if (!s) return;
    let out = escapeMarkup(s);
    if (this.atLineStart) out = out.replace(/^(\s*)([=+\-/])/, "$1\\$2").replace(/^(\s*\d+)\./, "$1\\.");
    this.anchor(src);
    this.write(out);
  }

  toString(): string {
    return this.parts.join("");
  }
}

const SKIP_MARKS = new Set([
  "EmphasisMark", "CodeMark", "LinkMark", "QuoteMark", "ListMark", "HeaderMark", "StrikethroughMark", "TableDelimiter",
]);
/** Blocks that emit nothing, or raw Typst the author controls, get no source marker. */
const NO_MARKER = new Set([
  "FootnoteDefinition", "LinkReference", "CommentBlock", "HTMLBlock", "ProcessingInstructionBlock", "FencedCode", "EmbedBlock",
]);

interface Shared {
  out: Emitter;
  clusters: Cluster[];
  events: TranslationEvent[];
  labels: string[];
  includes: IncludeRef[];
  images: ImageRef[];
  rawBlocks: RawBlock[];
  diagnostics: Diagnostic[];
  footnotes: Map<string, SyntaxNode>;
  footnoteText: string;
  usedFootnotes: Set<string>;
}

class BodyTranslator {
  readonly consumed = new Set<number>();

  constructor(
    readonly text: string,
    readonly offset: (local: number) => number,
    readonly shared: Shared,
    readonly markers: boolean,
  ) {}

  get out(): Emitter {
    return this.shared.out;
  }
  src(pos: number): number {
    return this.offset(pos);
  }
  slice(from: number, to: number): string {
    return this.text.slice(from, to);
  }
  diag(from: number, to: number, message: string, severity: Diagnostic["severity"] = "warning"): void {
    this.shared.diagnostics.push({ from: this.src(from), to: this.src(to), severity, message });
  }

  document(): void {
    const top = markdownParser.parse(this.text).topNode;
    for (let c = top.firstChild; c; c = c.nextSibling) {
      if (c.name === "FootnoteDefinition") {
        const id = /^\[\^([^\]]+)\]/.exec(this.slice(c.from, c.to))?.[1];
        if (id) this.shared.footnotes.set(id, c);
      }
    }
    this.shared.footnoteText = this.text;
    this.blocks(top);
    for (const [id, node] of this.shared.footnotes) {
      if (!this.shared.usedFootnotes.has(id)) this.diag(node.from, node.to, `Footnote [^${id}] is never referenced.`);
    }
  }

  blocks(parent: SyntaxNode): void {
    const top = parent.name === "Document";
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (this.consumed.has(c.from) || SKIP_MARKS.has(c.name)) continue;
      if (top && this.markers && !NO_MARKER.has(c.name)) {
        this.out.pendingMarker = `#metadata((md-file, ${this.src(c.from)}))<md-src>`;
      }
      this.block(c);
      this.out.pendingMarker = "";
    }
  }

  block(node: SyntaxNode): void {
    const out = this.out;
    const name = node.name;
    if (/^(ATX|Setext)Heading\d$/.test(name)) return this.heading(node, Number(name.slice(-1)));
    switch (name) {
      case "Paragraph":
        if (this.figureParagraph(node)) return;
        out.write("\n");
        this.inline(node, node.from, node.to);
        out.write("\n");
        return;
      case "Blockquote":
        out.anchor(this.src(node.from));
        out.write("\n#quote(block: true)[\n");
        this.blocks(node);
        out.write("];\n");
        return;
      case "BulletList":
      case "OrderedList":
        return this.list(node);
      case "FencedCode":
      case "CodeBlock":
        return this.code(node);
      case "MathBlock":
        return this.mathBlock(node);
      case "Table":
        return this.table(node);
      case "HorizontalRule":
        out.write("\n#line(length: 100%);\n");
        return;
      case "EmbedBlock":
        return this.embed(node);
      case "FootnoteDefinition":
      case "LinkReference":
      case "CommentBlock":
        return;
      case "HTMLBlock":
      case "ProcessingInstructionBlock":
        this.diag(node.from, node.to, "Raw HTML is not rendered in PDF output.");
        return;
      default:
        this.diag(node.from, node.to, `Unsupported Markdown block: ${name}.`);
    }
  }

  heading(node: SyntaxNode, level: number): void {
    const marks = node.getChildren("HeaderMark");
    let from = marks[0] && marks[0].from === node.from ? marks[0].to : node.from;
    let to = marks.length > 1 ? (marks[marks.length - 1]?.from ?? node.to) : node.to;
    if (node.name.startsWith("Setext")) {
      from = node.from;
      to = marks[0]?.from ?? node.to;
    }
    const attr = ATTR_TAIL.exec(this.slice(from, to));
    const attrs = attr ? parseAttrs(attr[1] ?? "") : { classes: [], kv: {} };
    if (attr) to = from + attr.index;
    this.out.anchor(this.src(node.from));
    // The source marker goes inside the heading: templates may start a new
    // page in a heading's show rule, and the marker must land on that page.
    const marker = this.out.pendingMarker;
    this.out.pendingMarker = "";
    this.out.write(`\n#heading(level: ${level}${attrs.classes.includes("unnumbered") ? ", numbering: none" : ""})[${marker}`);
    this.inline(node, from, to, true);
    this.out.write("]");
    this.label(attrs.id);
    this.out.write("\n");
  }

  label(id: string | undefined): void {
    if (!id) return;
    this.out.write(` <${id}>`);
    this.shared.labels.push(id);
  }

  list(node: SyntaxNode): void {
    const out = this.out;
    out.anchor(this.src(node.from));
    let start = "";
    if (node.name === "OrderedList") {
      const mark = node.firstChild?.getChild("ListMark");
      const n = mark ? Number.parseInt(this.slice(mark.from, mark.to), 10) : 1;
      if (n !== 1) start = `start: ${n}, `;
    }
    out.write(`\n#${node.name === "BulletList" ? "list" : "enum"}(${start}\n`);
    for (let item = node.firstChild; item; item = item.nextSibling) {
      if (item.name !== "ListItem") continue;
      out.write("[");
      out.atLineStart = true;
      for (let c = item.firstChild; c; c = c.nextSibling) {
        if (c.name === "ListMark" || c.name === "Task") continue;
        if (c.name === "Paragraph") this.inline(c, c.from, c.to);
        else this.block(c);
      }
      out.write("],\n");
    }
    out.write(");\n");
  }

  code(node: SyntaxNode): void {
    const info = node.getChild("CodeInfo");
    const code = node.getChild("CodeText");
    const lang = info ? this.slice(info.from, info.to).trim() : "";
    const body = code ? this.slice(code.from, code.to) : "";
    const out = this.out;
    if (lang === "{=typst}") {
      out.write("\n");
      if (code) out.anchor(this.src(code.from));
      const typstFrom = out.length;
      out.write(body);
      this.shared.rawBlocks.push({ typstFrom, typstTo: out.length, from: this.src(node.from), to: this.src(node.to) });
      out.write("\n");
      return;
    }
    if (lang.startsWith("{=")) return; // raw block for another output format
    out.anchor(this.src(node.from));
    const l = lang.replace(/^\{?\.?/, "").replace(/\}$/, "").split(/\s/)[0] ?? "";
    out.write(`\n#raw(block: true${l ? `, lang: ${typstString(l)}` : ""}, ${typstString(body)});\n`);
  }

  math(latex: string, at: number): string {
    for (const p of lintMath(latex)) this.diag(at + p.offset, at + p.offset + 1, `Math: ${p.message}`);
    return typstString(normalizeBars(latex));
  }

  mathBlock(node: SyntaxNode): void {
    const raw = this.slice(node.from, node.to);
    const m = /^\$\$([\s\S]*?)\$\$\s*(?:\{([^}]*)\})?\s*$/.exec(raw);
    if (!m) {
      this.diag(node.from, node.to, "Unclosed $$ math block.", "error");
      return;
    }
    const inner = m[1] ?? "";
    const attrs = m[2] ? parseAttrs(m[2]) : undefined;
    const lead = inner.length - inner.trimStart().length;
    this.out.anchor(this.src(node.from));
    const latex = this.math(inner.trim(), node.from + 2 + lead);
    this.out.write(`\n#mitex(${latex}${attrs?.id ? `, numbering: "(1)"` : ""})`);
    this.label(attrs?.id);
    this.out.write("\n");
  }

  image(target: string, wikilink: boolean, from: number, to: number, width?: string): string {
    const index = this.shared.images.length;
    this.shared.images.push({
      target,
      wikilink,
      from: this.src(from),
      to: this.src(to),
      ...(width !== undefined ? { width: typstLength(width) } : {}),
    });
    return `${PLACEHOLDER.image[0]}${index}${PLACEHOLDER.image[1]}`;
  }

  /** A paragraph holding only an image (plus attributes) becomes a figure. */
  figureParagraph(node: SyntaxNode): boolean {
    const img = node.firstChild;
    if (!img || img.name !== "Image" || img.from !== node.from || img.nextSibling) return false;
    const tail = this.slice(img.to, node.to);
    if (tail.trim() && !/^\{[^}]*\}\s*$/.test(tail)) return false;
    const attrs = tail.trim() ? parseAttrs(tail.trim().slice(1, -1)) : { classes: [], kv: {} };
    const marks = img.getChildren("LinkMark");
    const url = img.getChild("URL");
    const altFrom = marks[0]?.to ?? img.from;
    const altTo = marks[1]?.from ?? altFrom;
    const path = url ? this.slice(url.from, url.to).replace(/^<|>$/g, "") : "";
    const out = this.out;
    out.anchor(this.src(node.from));
    const image = this.image(path, false, img.from, img.to, attrs.kv["width"]);
    const numbering = attrs.id ? "" : ", numbering: none";
    if (altTo > altFrom) {
      out.write(`\n#figure(${image}, caption: [`);
      this.inline(img, altFrom, altTo, true);
      out.write(`]${numbering})`);
    } else {
      out.write(`\n#figure(${image}${numbering})`);
    }
    this.label(attrs.id);
    out.write("\n");
    return true;
  }

  embed(node: SyntaxNode): void {
    const raw = this.slice(node.from, node.to);
    const m = /^!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\](?:\{([^}]*)\})?/.exec(raw);
    const target = (m?.[1] ?? "").trim();
    const out = this.out;
    out.anchor(this.src(node.from));
    if (IMAGE_EXTENSION.test(target)) {
      const attrs = m?.[3] ? parseAttrs(m[3]) : { classes: [], kv: {} };
      // Obsidian's ![[img.png|300]] sets a width in pixels.
      const width = attrs.kv["width"] ?? (/^\d+$/.test(m?.[2] ?? "") ? `${m?.[2]}pt` : undefined);
      const image = this.image(target, true, node.from, node.to, width);
      out.write(`\n#figure(${image}${attrs.id ? "" : ", numbering: none"})`);
      this.label(attrs.id);
      out.write("\n");
      return;
    }
    const index = this.shared.includes.length;
    this.shared.includes.push({ target, from: this.src(node.from), to: this.src(node.to) });
    out.write(`\n${PLACEHOLDER.include[0]}${index}${PLACEHOLDER.include[1]}\n`);
  }

  table(node: SyntaxNode): void {
    const out = this.out;
    const rows = node.getChildren("TableRow");
    const header = node.getChild("TableHeader");
    const delimiter = node.getChildren("TableDelimiter").find((d) => /-/.test(this.slice(d.from, d.to)));
    const aligns = delimiter
      ? this.slice(delimiter.from, delimiter.to)
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((cell) => {
            const s = cell.trim();
            return s.startsWith(":") && s.endsWith(":") ? "center" : s.endsWith(":") ? "right" : "left";
          })
      : [];
    const cols = header ? this.cellRanges(header).length : aligns.length;
    let caption: SyntaxNode | null = null;
    const next = node.nextSibling;
    if (next?.name === "Paragraph" && /^(:|Table:)\s/.test(this.slice(next.from, next.to))) {
      caption = next;
      this.consumed.add(next.from);
    }
    out.anchor(this.src(node.from));
    const alignList = (aligns.length ? aligns : Array<string>(cols).fill("left")).slice(0, cols);
    const args = `columns: ${cols}, align: (${alignList.join(", ")},), stroke: none`;
    out.write(caption ? `\n#figure(kind: table, table(${args},\n` : `\n#table(${args},\n`);
    out.write("table.hline(),\n");
    if (header) {
      out.write("table.header(");
      this.cells(header, cols);
      out.write("),\ntable.hline(stroke: 0.5pt),\n");
    }
    for (const row of rows) {
      this.cells(row, cols);
      out.write("\n");
    }
    out.write("table.hline(),\n)");
    if (caption) {
      const lead = /^(:|Table:)\s*/.exec(this.slice(caption.from, caption.to))?.[0].length ?? 0;
      const capFrom = caption.from + lead;
      let capTo = caption.to;
      let attrs: Attrs | undefined;
      const a = ATTR_TAIL.exec(this.slice(capFrom, capTo));
      if (a) {
        attrs = parseAttrs(a[1] ?? "");
        capTo = capFrom + a.index;
      }
      out.write(", caption: figure.caption(position: top)[");
      this.inline(caption, capFrom, capTo, true);
      out.write(`]${attrs?.id ? "" : ", numbering: none"})`);
      this.label(attrs?.id);
    }
    out.write("\n");
  }

  cellRanges(row: SyntaxNode): [number, number][] {
    const pipes = row.getChildren("TableDelimiter").map((d) => d.from);
    const bounds = [row.from - 1, ...pipes, row.to];
    const ranges: [number, number][] = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const from = (bounds[i] ?? 0) + 1;
      const to = bounds[i + 1] ?? from;
      if (to <= from && (i === 0 || i === bounds.length - 2)) continue; // leading/trailing pipe
      ranges.push([from, to]);
    }
    return ranges;
  }

  cells(row: SyntaxNode, cols: number): void {
    const ranges = this.cellRanges(row).slice(0, cols);
    while (ranges.length < cols) ranges.push([row.to, row.to]);
    for (const [from, to] of ranges) {
      this.out.write("[");
      this.inline(row, from, to, true);
      this.out.write("], ");
    }
  }

  /** Translates the inline content of `node` within [from, to). */
  inline(node: SyntaxNode, from: number, to: number, trim = false): void {
    let pos = from;
    const gap = (a: number, b: number) => {
      if (b <= a) return;
      let s = this.slice(a, b).replace(/[ \t]*\n[ \t>]*/g, " ");
      if (trim) {
        if (a === from) s = s.replace(/^\s+/, "");
        if (b === to) s = s.replace(/\s+$/, "");
      }
      if (this.out.lastChar === " " || this.out.lastChar === "\n") s = s.replace(/^ +/, "");
      this.out.text(s, this.src(a));
    };
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.to <= from || c.from >= to) continue;
      if (SKIP_MARKS.has(c.name)) {
        gap(pos, c.from);
        pos = c.to;
        continue;
      }
      gap(pos, Math.max(pos, c.from));
      this.inlineNode(c);
      pos = c.to;
    }
    gap(pos, to);
  }

  /** Content between the first and last mark children (emphasis and the like). */
  inner(node: SyntaxNode, mark: string): void {
    const marks = node.getChildren(mark);
    const from = marks[0]?.to ?? node.from;
    const to = marks.length > 1 ? (marks[marks.length - 1]?.from ?? node.to) : node.to;
    this.inline(node, from, to);
  }

  inlineNode(node: SyntaxNode): void {
    const out = this.out;
    const text = () => this.slice(node.from, node.to);
    out.anchor(this.src(node.from));
    switch (node.name) {
      case "Emphasis":
        out.write("#emph[");
        this.inner(node, "EmphasisMark");
        out.write("];");
        return;
      case "StrongEmphasis":
        out.write("#strong[");
        this.inner(node, "EmphasisMark");
        out.write("];");
        return;
      case "Strikethrough":
        out.write("#strike[");
        this.inner(node, "StrikethroughMark");
        out.write("];");
        return;
      case "InlineCode":
        out.write(`#raw(${typstString(text().replace(/^`+\s?|\s?`+$/g, ""))});`);
        return;
      case "InlineMath":
        out.write(`#mi(${this.math(text().slice(1, -1), node.from + 1)});`);
        return;
      case "HardBreak":
        out.write(" \\\n");
        return;
      case "Escape":
        out.text(text().slice(1), this.src(node.from + 1));
        return;
      case "Entity": {
        const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&quot;": '"' };
        out.text(entities[text()] ?? text(), this.src(node.from));
        return;
      }
      case "Link": {
        const marks = node.getChildren("LinkMark");
        const url = node.getChild("URL");
        const open = marks[0];
        const close = marks[1];
        if (!url || !open || !close) {
          out.text(text(), this.src(node.from));
          return;
        }
        out.write(`#link(${typstString(this.slice(url.from, url.to).replace(/^<|>$/g, ""))})[`);
        this.inline(node, open.to, close.from);
        out.write("];");
        return;
      }
      case "Autolink":
      case "URL":
        out.write(`#link(${typstString(text().replace(/^<|>$/g, ""))});`);
        return;
      case "Image": {
        const url = node.getChild("URL");
        out.write(`#box(${this.image(url ? this.slice(url.from, url.to) : "", false, node.from, node.to)});`);
        return;
      }
      case "Wikilink": {
        const [target = "", alias] = text().slice(2, -2).split("|");
        out.text((alias ?? target.split("/").pop() ?? target).trim(), this.src(node.from + 2));
        return;
      }
      case "FootnoteReference":
        return this.footnote(node);
      case "Citation":
        return this.cluster(node, true);
      case "AtReference":
        return this.cluster(node, false);
      case "HTMLTag": {
        // lezer is more lenient than CommonMark ("a < b > c" parses as a tag).
        // Real tags are dropped (their content stays); anything else is text.
        const tag = text();
        if (/^<br\s*\/?>$/i.test(tag)) out.write(" \\\n");
        else if (!/^<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*)?\/?>$/.test(tag)) out.text(tag, this.src(node.from));
        return;
      }
      case "Comment":
        return;
      default:
        if (node.firstChild) this.inline(node, node.from, node.to);
        else out.text(text(), this.src(node.from));
    }
  }

  cluster(node: SyntaxNode, bracketed: boolean): void {
    const raw = this.slice(node.from, node.to);
    const index = this.shared.clusters.length;
    this.shared.clusters.push({
      bracketed,
      items: parseCluster(bracketed ? raw.slice(1, -1) : raw),
      from: this.src(node.from),
      to: this.src(node.to),
    });
    this.shared.events.push({ t: "cluster", index });
    this.out.write(`${PLACEHOLDER.cluster[0]}${index}${PLACEHOLDER.cluster[1]}`);
  }

  footnote(node: SyntaxNode): void {
    const id = this.slice(node.from + 2, node.to - 1);
    const def = this.shared.footnotes.get(id);
    if (!def) {
      this.diag(node.from, node.to, `Footnote [^${id}] has no definition.`, "error");
      return;
    }
    if (this.shared.usedFootnotes.has(id)) this.diag(node.from, node.to, `Footnote [^${id}] is referenced more than once.`);
    this.shared.usedFootnotes.add(id);
    // De-indent the definition and translate it in place. Definitions always
    // live at the top level of the record body, whose text is footnoteText.
    const source = this.shared.footnoteText;
    const raw = source.slice(def.from, def.to);
    const head = /^\[\^[^\]]+\]:[ \t]?/.exec(raw)?.[0].length ?? 0;
    const lines = raw.slice(head).split("\n");
    let body = "";
    const starts: [number, number][] = [];
    let srcPos = def.from + head;
    lines.forEach((line, i) => {
      const strip = i === 0 ? 0 : Math.min(4, /^ */.exec(line)?.[0].length ?? 0);
      starts.push([body.length, srcPos + strip]);
      body += line.slice(strip) + (i < lines.length - 1 ? "\n" : "");
      srcPos += line.length + 1;
    });
    const map = (local: number) => {
      let at: [number, number] = starts[0] ?? [0, def.from];
      for (const s of starts) if (s[0] <= local) at = s;
      return at[1] + (local - at[0]);
    };
    this.shared.events.push({ t: "fn-open" });
    this.out.write("#footnote[");
    const sub = new BodyTranslator(body, map, this.shared, false);
    let first = true;
    for (let c = markdownParser.parse(body).topNode.firstChild; c; c = c.nextSibling) {
      if (c.name === "Paragraph") {
        if (!first) sub.out.write(" \\ ");
        sub.inline(c, c.from, c.to, true);
      } else sub.block(c);
      first = false;
    }
    this.out.write("];");
    this.shared.events.push({ t: "fn-close" });
  }
}

/** Translates a record body (no frontmatter). */
export function translateRecord(body: string, options: { markers?: boolean } = {}): TranslatedRecord {
  const shared: Shared = {
    out: new Emitter(),
    clusters: [],
    events: [],
    labels: [],
    includes: [],
    images: [],
    rawBlocks: [],
    diagnostics: [],
    footnotes: new Map(),
    footnoteText: body,
    usedFootnotes: new Set(),
  };
  shared.out.write(HEADER);
  new BodyTranslator(body, (x) => x, shared, options.markers ?? true).document();
  return {
    typst: shared.out.toString(),
    anchors: shared.out.anchors,
    clusters: shared.clusters,
    events: shared.events,
    labels: shared.labels,
    includes: shared.includes,
    images: shared.images,
    rawBlocks: shared.rawBlocks,
    diagnostics: shared.diagnostics,
  };
}

/** Translates short inline Markdown (titles, author names, abstracts) to Typst markup. */
export function translateInline(markdown: string): string {
  const placeholders = new RegExp(`[${PLACEHOLDER.cluster[0]}${PLACEHOLDER.image[0]}${PLACEHOLDER.include[0]}]\\d+[${PLACEHOLDER.cluster[1]}${PLACEHOLDER.image[1]}${PLACEHOLDER.include[1]}]`, "g");
  return translateRecord(markdown, { markers: false }).typst.slice(HEADER.length).trim().replace(placeholders, "");
}
