// Hard-wrapped paragraphs shown as flowing text. A line break inside a
// paragraph or footnote reads as a space in Markdown, so it is drawn as one
// and the editor wraps the paragraph to its own width. The text keeps its
// breaks; only how they are shown changes.
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

import { EMBED_LINE } from "../workspace/chapters.js";

class SpaceWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = " ";
    return span;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const joint = Decoration.replace({ widget: new SpaceWidget() });

/** A line ending in two spaces or a backslash is a hard break, kept as a break. */
const HARD_BREAK = /(?: {2,}|\\)$/;

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

function build(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of softBreaks(state)) builder.add(from, to, joint);
  return builder.finish();
}

/** Draws soft line breaks as spaces (see the file comment). */
export function joinLines(): Extension {
  const field = StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      // The tree grows as the parser catches up, as well as on edits.
      return tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? build(tr.state) : value;
    },
    // Replacing across line breaks has to come from state, not a view plugin.
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
  });
  return field;
}
