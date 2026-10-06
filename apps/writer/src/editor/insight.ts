// What the editor can tell about a citation or cross-reference: hover a
// `@key` to see the source's bibliography entry or the labelled block it
// points to; Mod-click it to go there. Label attributes (`{#sec-intro}`) and
// footnote markers are drawn quieter than the prose around them.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, MatchDecorator, ViewPlugin, type DecorationSet, type Tooltip, type ViewUpdate } from "@codemirror/view";

import type { LibraryEntry } from "../backend/types.js";
import { authorYear } from "./library-search.js";

export interface LabelTarget {
  readonly record: string;
  /** Body offset of the line carrying the label. */
  readonly offset: number;
  /** The heading, or the start of the labelled line. */
  readonly text: string;
}

export interface EditorInsight {
  readonly library: ReadonlyMap<string, LibraryEntry>;
  /** Bibliography entries (Typst markup) of the sources the manuscript cites. */
  readonly references: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, LabelTarget>;
  /** A URL for an image the record refers to, once it is loaded (for drawing figures in the editor). */
  readonly image?: (target: string) => string | null;
}

export type FollowTarget = { readonly kind: "source"; readonly key: string } | { readonly kind: "label"; readonly target: LabelTarget };

const KEY = /(^|[^\p{L}\p{N}_])(-?@)([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~/]*)/gu;

/** The `@key` whose key covers `offset` in `line` (trailing punctuation is not part of a key). */
export function referenceAt(line: string, offset: number): { key: string; from: number; to: number } | null {
  for (const m of line.matchAll(KEY)) {
    const key = (m[3] ?? "").replace(/[.:,;?~/#$%&+<>-]+$/u, "");
    const from = (m.index ?? 0) + (m[1] ?? "").length;
    const to = from + (m[2] ?? "").length + key.length;
    if (key && offset >= from && offset <= to) return { key, from, to };
  }
  return null;
}

/**
 * The reference at or beside a document position: the `@key` the position is
 * in, or, when the position is at the edge of a citation or cross-reference
 * drawn as a chip (which has no positions inside it), that element's first key.
 */
export function referenceNear(state: EditorState, pos: number): { key: string; from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const inLine = referenceAt(line.text, pos - line.from);
  if (inLine) return { key: inLine.key, from: line.from + inLine.from, to: line.from + inLine.to };
  for (const side of [1, -1] as const) {
    let node: { name: string; from: number; to: number; parent: { name: string; from: number; to: number; parent: unknown } | null } | null = syntaxTree(state).resolveInner(pos, side);
    while (node && node.name !== "Citation" && node.name !== "AtReference") node = node.parent as typeof node;
    if (!node) continue;
    const key = referenceKeys(state.sliceDoc(node.from, node.to))[0];
    if (key) return { key, from: node.from, to: node.to };
  }
  return null;
}

/** Every `@key` in a text, citations and cross-references alike. */
export function referenceKeys(text: string): string[] {
  return [...text.matchAll(KEY)].map((m) => (m[3] ?? "").replace(/[.:,;?~/#$%&+<>-]+$/u, "")).filter(Boolean);
}

/** Body offsets of each `@key` for one key (at the `@`). */
export function referenceOffsets(text: string, key: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(KEY)) {
    if ((m[3] ?? "").replace(/[.:,;?~/#$%&+<>-]+$/u, "") !== key) continue;
    out.push((m.index ?? 0) + (m[1] ?? "").length + (m[2] ?? "").length - 1);
  }
  return out;
}

/** The `@key` at a body offset, if the offset falls on one. */
export function referenceAtOffset(text: string, offset: number): string | null {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  return referenceAt(text.slice(start, end < 0 ? undefined : end), offset - start)?.key ?? null;
}

/** Labels (`{#sec-intro}`) defined in a record body, with the text they label. */
export function labelTargets(record: string, body: string): [string, LabelTarget][] {
  const out: [string, LabelTarget][] = [];
  let offset = 0;
  for (const line of body.split("\n")) {
    for (const m of line.matchAll(/\{#([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)[^}]*\}/gu)) {
      const text = line
        .replace(/\{[#.][^}]*\}/g, "")
        .replace(/^ {0,3}#{1,6}\s+/, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/, "$1")
        .trim();
      out.push([m[1] ?? "", { record, offset, text: text.length > 140 ? `${text.slice(0, 139)}…` : text }]);
    }
    offset += line.length + 1;
  }
  return out;
}

export interface MarkupNode {
  readonly tag: string | null;
  readonly children: (MarkupNode | string)[];
}

const TAGS: Record<string, string> = { emph: "em", strong: "strong", smallcaps: "span", super: "sup", sub: "sub", underline: "u", link: "span" };

/** The citeproc Typst output of a bibliography entry as a tree of inline elements. */
export function parseReference(typst: string): MarkupNode {
  const root: MarkupNode = { tag: null, children: [] };
  const stack = [root];
  const text = (s: string) => {
    const top = stack[stack.length - 1] as MarkupNode;
    const last = top.children[top.children.length - 1];
    if (typeof last === "string") top.children[top.children.length - 1] = last + s;
    else top.children.push(s);
  };
  const source = typst.replace(/ \\\\ /g, " ");
  let i = 0;
  while (i < source.length) {
    const open = /^#(emph|strong|smallcaps|super|sub|underline|link)(?:\("(?:[^"\\]|\\.)*"\))?\[/.exec(source.slice(i, i + 400));
    if (open) {
      const node: MarkupNode = { tag: TAGS[open[1] ?? ""] ?? "span", children: [] };
      (stack[stack.length - 1] as MarkupNode).children.push(node);
      stack.push(node);
      i += open[0].length;
    } else if (source.startsWith("];", i) && stack.length > 1) {
      stack.pop();
      i += 2;
    } else if (source[i] === "\\" && i + 1 < source.length) {
      text(source[i + 1] as string);
      i += 2;
    } else {
      text(source[i] as string);
      i++;
    }
  }
  return root;
}

function renderMarkup(node: MarkupNode, into: HTMLElement) {
  for (const child of node.children) {
    if (typeof child === "string") into.append(child);
    else {
      const el = document.createElement(child.tag ?? "span");
      renderMarkup(child, el);
      into.append(el);
    }
  }
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_LABEL = isMac ? "⌘" : "Ctrl";
export const ALT_LABEL = isMac ? "⌥" : "Alt";

function tip(kind: string, body: (el: HTMLElement) => void, hint?: string): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-ref-tip";
  const head = document.createElement("div");
  head.className = "cm-ref-kind";
  head.textContent = kind;
  const main = document.createElement("div");
  main.className = "cm-ref-body";
  body(main);
  dom.append(head, main);
  if (hint) {
    const h = document.createElement("div");
    h.className = "cm-ref-hint";
    h.textContent = hint;
    dom.append(h);
  }
  return dom;
}

export const LABEL_KINDS: Record<string, string> = { sec: "Section", fig: "Figure", tbl: "Table", eq: "Equation", lst: "Listing" };

function resolve(insight: EditorInsight, key: string): FollowTarget | null {
  const label = insight.labels.get(key);
  if (label) return { kind: "label", target: label };
  if (insight.library.has(key)) return { kind: "source", key };
  return null;
}

/** The card for the citation or cross-reference at `pos`: its bibliography entry, or what it labels. */
export function referenceTooltip(view: EditorView, pos: number, data: EditorInsight): Tooltip | null {
    const ref = referenceNear(view.state, pos);
    if (!ref) return null;
    const target = resolve(data, ref.key);
    return {
      pos: ref.from,
      end: ref.to,
      above: true,
      create: () => {
        if (target?.kind === "label") {
          const kind = LABEL_KINDS[ref.key.split("-")[0] ?? ""] ?? "Label";
          return {
            dom: tip(
              kind,
              (el) => (el.textContent = target.target.text || ref.key),
              `${target.target.record} · ${MOD_LABEL}-click to go there`,
            ),
          };
        }
        if (target?.kind === "source") {
          const entry = data.library.get(ref.key) as LibraryEntry;
          const reference = data.references.get(ref.key);
          return {
            dom: tip(
              "Source",
              (el) => (reference ? renderMarkup(parseReference(reference), el) : (el.textContent = `${authorYear(entry)}. ${entry.title}`)),
              `${MOD_LABEL}-click to show in Sources`,
            ),
          };
        }
        return { dom: tip("Unknown", (el) => (el.textContent = `No source or label is called “${ref.key}”.`)) };
      },
    };
}

export function writerInsight(insight: () => EditorInsight, follow: (target: FollowTarget) => void) {
  const hover = hoverTooltip((view, pos) => referenceTooltip(view, pos, insight()));

  const click = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const ref = referenceNear(view.state, pos);
      const target = ref ? resolve(insight(), ref.key) : null;
      if (!target) return false;
      event.preventDefault();
      follow(target);
      return true;
    },
  });

  return [hover, click, quietMarkup];
}

const attributeMatcher = new MatchDecorator({
  regexp: /\{[#.][^}\n]*\}|\[\^[^\]\s]+\]:?/g,
  decoration: (m) => Decoration.mark({ class: m[0].startsWith("{") ? "cm-attr" : "cm-fnmark" }),
});

const quietMarkup = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = attributeMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = attributeMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);
