// Inline formatting as Markdown: bold, italic and code wrap the selection in
// their markers, or unwrap it when it is already wrapped; a link wraps it as
// link text and selects the address to type. The record stays plain Markdown.
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { Command } from "@codemirror/view";

export type InlineFormat = "bold" | "italic" | "code";

const MARKER: Record<InlineFormat, string> = { bold: "**", italic: "*", code: "`" };

/**
 * Whether text opening with `open` and closing with `close` is wrapped in the
 * format's marker. A single `*` in a `**` is bold, not italic, unless there
 * are three (`***x***`).
 */
function wrapped(format: InlineFormat, open: string, close: string): boolean {
  const marker = MARKER[format];
  if (!open.endsWith(marker) || !close.startsWith(marker)) return false;
  if (format !== "italic") return true;
  const openRun = open.length - open.replace(/\*+$/, "").length;
  const closeRun = close.length - close.replace(/^\*+/, "").length;
  return openRun !== 2 && closeRun !== 2;
}

/** Wraps each selection range in the format's markers, or unwraps it when it is already wrapped (inside or just outside). */
export function toggleFormat(state: EditorState, format: InlineFormat): TransactionSpec {
  const marker = MARKER[format];
  const m = marker.length;
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    // Just outside the selection: **|text|**
    const before = state.sliceDoc(Math.max(0, range.from - 3), range.from);
    const after = state.sliceDoc(range.to, range.to + 3);
    if (wrapped(format, before, after)) {
      return {
        changes: [
          { from: range.from - m, to: range.from },
          { from: range.to, to: range.to + m },
        ],
        range: EditorSelection.range(range.from - m, range.to - m),
      };
    }
    // Inside the selection: |**text**|
    const opening = text.slice(0, 3).replace(/[^*`]+$/, "");
    const closing = text.slice(-3).replace(/^[^*`]+/, "");
    if (text.length > 2 * m && wrapped(format, opening, closing)) {
      const inner = text.slice(m, text.length - m);
      return { changes: { from: range.from, to: range.to, insert: inner }, range: EditorSelection.range(range.from, range.from + inner.length) };
    }
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: EditorSelection.range(range.from + m, range.to + m),
    };
  });
}

/** Makes the selection a link's text, `[text](address)`, and selects `address` to be typed over. */
export function insertLink(state: EditorState): TransactionSpec {
  const placeholder = "address";
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}](${placeholder})`;
    const start = range.from + text.length + 3;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(start, start + placeholder.length) };
  });
}

const run =
  (spec: (state: EditorState) => TransactionSpec): Command =>
  (view) => {
    if (view.state.readOnly) return false;
    view.dispatch(view.state.update(spec(view.state), { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };

export const toggleBold = run((s) => toggleFormat(s, "bold"));
export const toggleItalic = run((s) => toggleFormat(s, "italic"));
export const toggleCode = run((s) => toggleFormat(s, "code"));
export const makeLink = run(insertLink);

export const formattingKeymap = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-Shift-k", run: makeLink },
];
