// The editor reads like the manuscript rather than its source: citations
// show as the author and year they cite, cross-references as what they point
// to, footnote markers as their numbers, labels as small tags, and headings,
// emphasis and links without their marks. Figures, tables, code fences and
// display math draw as blocks. The Markdown is never changed: any line the
// cursor is on (and any block the selection touches) shows exactly what is
// written, so there is nothing hidden where you are typing.
import { syntaxTree } from "@codemirror/language";
import { Compartment, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import { authorYear } from "./library-search.js";
import { LABEL_KINDS, parseReference, type EditorInsight, type MarkupNode } from "./insight.js";

type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = Tree["topNode"];

/** Asks the preview to redraw (sources, labels or images changed). */
export const refreshLivePreview = StateEffect.define<null>();

type Span = { readonly from: number; readonly to: number };

/** Line ranges that hold a selection: they show their source as written. */
function activeSpans(state: EditorState): Span[] {
  return state.selection.ranges.map((r) => ({ from: state.doc.lineAt(r.from).from, to: state.doc.lineAt(r.to).to }));
}
const touches = (spans: readonly Span[], from: number, to: number) => spans.some((s) => s.from <= to && s.to >= from);

const CITEKEY_CHARS = "[\\p{L}\\p{N}_][\\p{L}\\p{N}_:.#$%&\\-+?<>~/]*";
const CITE_ITEM = new RegExp(`^(.*?)(-?@)(${CITEKEY_CHARS})([\\s\\S]*)$`, "u");
const TRAILING = /[.:,;?~/#$%&+<>-]+$/u;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\](?!:)/g;
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm;
const ATTRIBUTE = /\{[#.][^}\n]*\}/g;
const FIGURE = /^!\[([\s\S]*?)\]\(([^)\n]*)\)(\{[^}\n]*\})?\s*$/;
const TABLE_CAPTION = /^(?::|Table:)\s*([\s\S]*?)\s*(\{[^}]*\})?\s*$/;

/** Plain text of a bibliography entry's Typst markup. */
function plainReference(typst: string): string {
  const text = (node: MarkupNode): string => node.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
  return text(parseReference(typst));
}

/** What a citation reads as: "see Darwin, 1842, p. 12; Lyell, 1830", or null when a key is unknown. */
export function citationText(inner: string, insight: Pick<EditorInsight, "library" | "labels">): string | null {
  const parts: string[] = [];
  for (const item of inner.split(";")) {
    const m = CITE_ITEM.exec(item);
    if (!m) return null;
    const rawKey = m[3] ?? "";
    const key = rawKey.replace(TRAILING, "");
    const spill = rawKey.slice(key.length);
    const entry = insight.library.get(key);
    const label = entry ? null : insight.labels.get(key);
    if (!entry && !label) return null;
    let name = entry ? authorYear(entry) || key : (label?.text ?? key);
    if (entry && m[2] === "-@") name = name.slice(name.lastIndexOf(", ") + 2);
    const prefix = (m[1] ?? "").trim();
    const suffix = `${spill}${m[4] ?? ""}`.replace(/^[\s,]+/, "").trim();
    parts.push([prefix, [name, suffix].filter(Boolean).join(", ")].filter(Boolean).join(" "));
  }
  return parts.join("; ");
}

class ChipWidget extends WidgetType {
  constructor(readonly text: string, readonly kind: "cite" | "ref" | "label", readonly title: string) {
    super();
  }
  override eq(other: ChipWidget) {
    return other.text === this.text && other.kind === this.kind && other.title === this.title;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-lp-chip is-${this.kind}`;
    el.textContent = this.text;
    // Citations and cross-references get the editor's hover card (insight.ts); a label's title says how to refer to it.
    if (this.title && this.kind === "label") el.title = this.title;
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

class SupWidget extends WidgetType {
  constructor(readonly number: number, readonly title: string, readonly definition: boolean) {
    super();
  }
  override eq(other: SupWidget) {
    return other.number === this.number && other.title === this.title && other.definition === this.definition;
  }
  toDOM() {
    const el = document.createElement(this.definition ? "span" : "sup");
    el.className = this.definition ? "cm-lp-fn-number" : "cm-lp-fn-ref";
    el.textContent = this.definition ? `${this.number}.` : String(this.number);
    if (this.title) el.title = this.title;
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

function block(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `cm-lp-block ${className}`;
  return el;
}

class FigureWidget extends WidgetType {
  constructor(readonly caption: string, readonly src: string, readonly label: string, readonly url: string | null) {
    super();
  }
  override eq(other: FigureWidget) {
    return other.caption === this.caption && other.src === this.src && other.label === this.label && other.url === this.url;
  }
  toDOM() {
    const el = block("cm-lp-figure");
    if (this.url) {
      const img = document.createElement("img");
      img.src = this.url;
      img.alt = this.caption;
      img.className = "cm-lp-figure-image";
      el.append(img);
    } else {
      const missing = document.createElement("div");
      missing.className = "cm-lp-figure-missing";
      missing.textContent = this.src;
      el.append(missing);
    }
    const caption = document.createElement("div");
    caption.className = "cm-lp-caption";
    caption.textContent = this.caption || "Untitled figure";
    if (this.label) {
      const tag = document.createElement("span");
      tag.className = "cm-lp-chip is-label";
      tag.textContent = this.label;
      caption.append(" ", tag);
    }
    el.append(caption);
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

class TableWidget extends WidgetType {
  constructor(readonly header: readonly string[], readonly rows: readonly (readonly string[])[], readonly caption: string, readonly label: string) {
    super();
  }
  override eq(other: TableWidget) {
    return JSON.stringify([other.header, other.rows, other.caption, other.label]) === JSON.stringify([this.header, this.rows, this.caption, this.label]);
  }
  toDOM() {
    const el = block("cm-lp-table");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const cell of this.header) {
      const th = document.createElement("th");
      th.textContent = cell;
      headRow.append(th);
    }
    thead.append(headRow);
    const tbody = document.createElement("tbody");
    for (const row of this.rows) {
      const tr = document.createElement("tr");
      for (let i = 0; i < Math.max(row.length, this.header.length); i++) {
        const td = document.createElement("td");
        td.textContent = row[i] ?? "";
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    el.append(table);
    if (this.caption || this.label) {
      const caption = document.createElement("div");
      caption.className = "cm-lp-caption";
      caption.textContent = this.caption;
      if (this.label) {
        const tag = document.createElement("span");
        tag.className = "cm-lp-chip is-label";
        tag.textContent = this.label;
        caption.append(this.caption ? " " : "", tag);
      }
      el.append(caption);
    }
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

class CodeWidget extends WidgetType {
  constructor(readonly language: string, readonly code: string, readonly math: boolean, readonly label: string) {
    super();
  }
  override eq(other: CodeWidget) {
    return other.language === this.language && other.code === this.code && other.math === this.math && other.label === this.label;
  }
  toDOM() {
    const el = block(this.math ? "cm-lp-math" : "cm-lp-code");
    const head = document.createElement("div");
    head.className = "cm-lp-block-kind";
    head.textContent = this.language;
    const pre = document.createElement("pre");
    pre.textContent = this.code;
    el.append(head, pre);
    if (this.label) {
      const tag = document.createElement("span");
      tag.className = "cm-lp-chip is-label";
      tag.textContent = this.label;
      head.append(" ", tag);
    }
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

/** Footnote numbers by first reference, and each definition's text, for one document (computed once per document). */
const footnoteCache = new WeakMap<object, { numbers: Map<string, number>; definitions: Map<string, string> }>();
function footnotes(state: EditorState): { numbers: Map<string, number>; definitions: Map<string, string> } {
  const known = footnoteCache.get(state.doc);
  if (known) return known;
  const text = state.doc.toString();
  const numbers = new Map<string, number>();
  const definitions = new Map<string, string>();
  for (const m of text.matchAll(FOOTNOTE_REF)) if (!numbers.has(m[1] ?? "")) numbers.set(m[1] ?? "", numbers.size + 1);
  for (const m of text.matchAll(FOOTNOTE_DEF)) {
    const id = m[1] ?? "";
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    definitions.set(id, (m[2] ?? "").trim());
  }
  const out = { numbers, definitions };
  footnoteCache.set(state.doc, out);
  return out;
}

/** Whether a transaction moved the selection onto other lines (what the preview cares about). */
function linesChanged(before: EditorState, after: EditorState): boolean {
  return JSON.stringify(activeSpans(before)) !== JSON.stringify(activeSpans(after));
}

const labelOf = (attrs: string | undefined) => /\{#([^\s}]+)/.exec(attrs ?? "")?.[1] ?? "";
const kindOf = (key: string) => LABEL_KINDS[key.split("-")[0] ?? ""] ?? "Label";
const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function inlineDecorations(view: EditorView, insight: () => EditorInsight): DecorationSet {
  const { state } = view;
  const data = insight();
  const spans = activeSpans(state);
  const notes = footnotes(state);
  const ranges: Range<Decoration>[] = [];
  const hide = (from: number, to: number) => {
    if (to > from) ranges.push(Decoration.replace({}).range(from, to));
  };
  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (touches(spans, node.from, node.to) && node.name !== "FencedCode" && node.name !== "Table" && node.name !== "MathBlock") return;
        switch (node.name) {
          case "FencedCode":
          case "Table":
          case "MathBlock":
          case "EmbedBlock":
            // Drawn as blocks (or left as written); nothing inside them is touched.
            return false;
          case "HeaderMark": {
            const parent = node.node.parent;
            if (!parent?.name.startsWith("ATXHeading")) {
              ranges.push(Decoration.mark({ class: "cm-lp-quiet" }).range(node.from, node.to));
              return;
            }
            hide(node.from, Math.min(node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0), parent.to));
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
            hide(node.from, node.to);
            return;
          case "CodeMark":
            if (node.node.parent?.name === "InlineCode") hide(node.from, node.to);
            return;
          case "Link": {
            const link = node.node;
            const marks: SyntaxNode[] = [];
            let url: SyntaxNode | null = null;
            for (let child = link.firstChild; child; child = child.nextSibling) {
              if (child.name === "LinkMark") marks.push(child);
              else if (child.name === "URL") url = child;
            }
            if (!url || marks.length < 2) return;
            const open = marks[0] as SyntaxNode;
            const close = marks[1] as SyntaxNode;
            hide(open.from, open.to);
            hide(close.from, link.to);
            ranges.push(Decoration.mark({ class: "cm-lp-link", attributes: { title: state.sliceDoc(url.from, url.to) } }).range(open.to, close.from));
            return false;
          }
          case "Citation": {
            const inner = state.sliceDoc(node.from + 1, node.to - 1);
            const text = citationText(inner, data);
            if (text === null) return;
            const keys = [...inner.matchAll(/@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~/]*)/gu)].map((m) => (m[1] ?? "").replace(TRAILING, ""));
            const title = keys.map((k) => { const r = data.references.get(k); return r ? plainReference(r) : (data.library.get(k)?.title ?? ""); }).filter(Boolean).join("\n");
            ranges.push(Decoration.replace({ widget: new ChipWidget(text, "cite", title) }).range(node.from, node.to));
            return false;
          }
          case "AtReference": {
            const key = state.sliceDoc(node.from + 1, node.to).replace(TRAILING, "");
            const to = node.from + 1 + key.length;
            const label = data.labels.get(key);
            if (label) {
              ranges.push(Decoration.replace({ widget: new ChipWidget(`${kindOf(key)} · ${shorten(label.text || key, 36)}`, "ref", `@${key} · ${label.record}`) }).range(node.from, to));
              return false;
            }
            const entry = data.library.get(key);
            if (entry) {
              const reference = data.references.get(key);
              ranges.push(Decoration.replace({ widget: new ChipWidget(authorYear(entry) || key, "cite", reference ? plainReference(reference) : entry.title) }).range(node.from, to));
              return false;
            }
            return;
          }
          case "FootnoteReference": {
            const id = state.sliceDoc(node.from + 2, node.to - 1);
            const number = notes.numbers.get(id);
            if (!number) return;
            ranges.push(Decoration.replace({ widget: new SupWidget(number, notes.definitions.get(id) ?? "", false) }).range(node.from, node.to));
            return false;
          }
          case "FootnoteDefinition": {
            const first = state.doc.lineAt(node.from);
            const marker = /^\[\^([^\]\s]+)\]:[ \t]*/.exec(first.text);
            if (!marker) return;
            const number = notes.numbers.get(marker[1] ?? "");
            for (let line = first; line.from <= node.to; line = state.doc.line(line.number + 1)) {
              ranges.push(Decoration.line({ class: "cm-lp-footnote" }).range(line.from));
              if (line.number === state.doc.lines) break;
            }
            if (number) ranges.push(Decoration.replace({ widget: new SupWidget(number, "", true) }).range(node.from, node.from + marker[0].length));
            return;
          }
          case "Paragraph":
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6": {
            // Attributes ({#sec-intro}, {.unnumbered}) read as small tags.
            const text = state.sliceDoc(node.from, node.to);
            if (node.name === "Paragraph" && FIGURE.test(text)) return false;
            for (const m of text.matchAll(ATTRIBUTE)) {
              const id = labelOf(m[0]);
              const start = node.from + (m.index ?? 0);
              // The space before the tag goes too, so a heading does not end in a gap.
              const leading = start > node.from && state.sliceDoc(start - 1, start) === " " ? 1 : 0;
              ranges.push(Decoration.replace({ widget: new ChipWidget(id || m[0].slice(1, -1), "label", id ? `Refer to this with @${id}` : m[0]) }).range(start - leading, start + m[0].length));
            }
            return;
          }
          default:
            return;
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

function blockDecorations(state: EditorState, insight: () => EditorInsight): DecorationSet {
  const data = insight();
  const ranges: Range<Decoration>[] = [];
  const selected = (from: number, to: number) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const replace = (from: number, to: number, widget: WidgetType) => {
    const start = state.doc.lineAt(from).from;
    const end = state.doc.lineAt(to).to;
    if (selected(start, end)) return;
    ranges.push(Decoration.replace({ widget, block: true }).range(start, end));
  };
  const tree: Tree = syntaxTree(state);
  tree.iterate({
    enter(node) {
      switch (node.name) {
        case "Paragraph": {
          const text = state.sliceDoc(node.from, node.to);
          const figure = FIGURE.exec(text);
          if (!figure) return;
          const src = (figure[2] ?? "").trim();
          replace(node.from, node.to, new FigureWidget((figure[1] ?? "").trim(), src, labelOf(figure[3]), data.image?.(src) ?? null));
          return false;
        }
        case "Table": {
          const header: string[] = [];
          const rows: string[][] = [];
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name !== "TableHeader" && child.name !== "TableRow") continue;
            const cells: string[] = [];
            for (let cell = child.firstChild; cell; cell = cell.nextSibling) if (cell.name === "TableCell") cells.push(state.sliceDoc(cell.from, cell.to).trim());
            if (child.name === "TableHeader") header.push(...cells);
            else rows.push(cells);
          }
          let to = node.to;
          let caption = "";
          let label = "";
          const next = node.node.nextSibling;
          if (next?.name === "Paragraph") {
            const m = TABLE_CAPTION.exec(state.sliceDoc(next.from, next.to));
            if (m) {
              caption = (m[1] ?? "").trim();
              label = labelOf(m[2]);
              to = next.to;
            }
          }
          replace(node.from, to, new TableWidget(header, rows, caption, label));
          return false;
        }
        case "FencedCode": {
          const info = node.node.getChild("CodeInfo");
          const code = node.node.getChild("CodeText");
          const language = info ? state.sliceDoc(info.from, info.to).trim() : "";
          const name = /^\{=typst\}$/.test(language) ? "Typst" : language.replace(/^\{\.?|\}$/g, "") || "Code";
          replace(node.from, node.to, new CodeWidget(name, code ? state.sliceDoc(code.from, code.to).replace(/\n$/, "") : "", false, ""));
          return false;
        }
        case "MathBlock": {
          const text = state.sliceDoc(node.from, node.to);
          const m = /^\$\$([\s\S]*?)\$\$\s*(\{[^}]*\})?\s*$/.exec(text);
          if (!m) return false;
          replace(node.from, node.to, new CodeWidget("Equation", (m[1] ?? "").trim(), true, labelOf(m[2])));
          return false;
        }
        default:
          return;
      }
    },
  });
  return Decoration.set(ranges, true);
}

function livePreviewExtension(insight: () => EditorInsight): Extension {
  const inline = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = inlineDecorations(view, insight);
      }
      update(u: ViewUpdate) {
        const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLivePreview)));
        if (u.docChanged || u.viewportChanged || refreshed || syntaxTree(u.state) !== syntaxTree(u.startState) || (u.selectionSet && linesChanged(u.startState, u.state))) this.decorations = inlineDecorations(u.view, insight);
      }
    },
    { decorations: (v) => v.decorations },
  );
  const blocks = StateField.define<DecorationSet>({
    create: (state) => blockDecorations(state, insight),
    update(value, tr) {
      const refreshed = tr.effects.some((e) => e.is(refreshLivePreview));
      if (tr.docChanged || refreshed || syntaxTree(tr.state) !== syntaxTree(tr.startState) || (tr.selection && linesChanged(tr.startState, tr.state))) return blockDecorations(tr.state, insight);
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return [inline, blocks, EditorView.editorAttributes.of({ class: "is-live-preview" })];
}

/** The live preview in a compartment, so it can be switched off to show the Markdown as written. */
export function livePreview(insight: () => EditorInsight, enabled: boolean): { extension: Extension; set(view: EditorView, enabled: boolean): void } {
  const compartment = new Compartment();
  const configured = (on: boolean) => (on ? livePreviewExtension(insight) : []);
  return {
    extension: compartment.of(configured(enabled)),
    set(view, on) {
      view.dispatch({ effects: compartment.reconfigure(configured(on)) });
    },
  };
}
