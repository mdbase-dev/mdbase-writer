// Hard-wrapped paragraphs shown as flowing text. A line break inside a
// paragraph or footnote reads as a space in Markdown, so it is drawn as one
// and the editor wraps the paragraph to its own width. The text keeps its
// breaks; only how they are shown changes.
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import { EMBED_LINE } from "../workspace/chapters.js";

// The break (and the next line's indent) is hidden, and the space is drawn
// after the line's last character by CSS (.cm-soft-break::after). A widget
// holding the space would be an atomic box the browser can wrap before,
// starting the next visual line with a space.
const hidden = Decoration.replace({});
const spaceAfter = Decoration.mark({ class: "cm-soft-break" });

/** A line ending in two spaces or a backslash is a hard break, kept as a break. */
const HARD_BREAK = /(?: {2,}|\\)$/;

/**
 * A field's text (the abstract) with its soft line breaks as spaces, as
 * joinLines() shows a body. Markdown reads them as spaces, so saving this form
 * after an edit changes nothing in the typeset text.
 */
export function joinSoftBreaks(text: string): string {
  const lines = text.split("\n");
  let out = lines[0] ?? "";
  for (let i = 1; i < lines.length; i++) {
    const before = lines[i - 1] ?? "";
    const line = lines[i] ?? "";
    const soft = before.trim() && line.trim() && !HARD_BREAK.test(before);
    out = soft ? `${out.trimEnd()} ${line.trimStart()}` : `${out}\n${line}`;
  }
  return out;
}

/** Where each soft line break in a paragraph or footnote runs to (the next line's text, past its indent). */
export function softBreaks(state: EditorState): { from: number; to: number }[] {
  const doc = state.doc;
  const out: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Paragraph" && node.name !== "FootnoteDefinition") return;
      const last = doc.lineAt(node.to).number;
      for (let n = doc.lineAt(node.from).number; n < last; n++) {
        const line = doc.line(n);
        const next = doc.line(n + 1);
        if (!line.text.trim() || !next.text.trim() || HARD_BREAK.test(line.text)) continue;
        // A chapter embed is shown as a card on its own line.
        if (EMBED_LINE.test(line.text) || EMBED_LINE.test(next.text)) continue;
        out.push({ from: line.to, to: next.from + (/^[ \t>]*/.exec(next.text)?.[0].length ?? 0) });
      }
      return false;
    },
  });
  return out;
}

interface Joins {
  readonly spaces: DecorationSet;
  readonly breaks: DecorationSet;
}

function build(state: EditorState): Joins {
  const spaces = new RangeSetBuilder<Decoration>();
  const breaks = new RangeSetBuilder<Decoration>();
  for (const { from, to } of softBreaks(state)) {
    spaces.add(from - 1, from, spaceAfter);
    breaks.add(from, to, hidden);
  }
  return { spaces: spaces.finish(), breaks: breaks.finish() };
}

/** Draws soft line breaks as spaces (see the file comment). */
export function joinLines(): Extension {
  const field = StateField.define<Joins>({
    create: build,
    update(value, tr) {
      // The tree grows as the parser catches up, as well as on edits.
      return tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? build(tr.state) : value;
    },
    // Replacing across line breaks has to come from state, not a view plugin.
    provide: (f) => [
      EditorView.decorations.from(f, (j) => j.spaces),
      EditorView.decorations.from(f, (j) => j.breaks),
      EditorView.atomicRanges.of((view) => view.state.field(f).breaks),
    ],
  });
  return field;
}
