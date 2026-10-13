// CodeMirror language for the writer's Markdown dialect: the same lezer
// extensions the translator parses with, plus highlighting for them.
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, EditorState, Prec, StateField, type StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { styleTags, tags as t, Tag } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { writerMarkdown } from "@mdbase-writer/core/markdown";

export const writerTags = {
  citation: Tag.define(),
  reference: Tag.define(),
  math: Tag.define(),
  footnote: Tag.define(),
  embed: Tag.define(),
};

const highlightNodes: MarkdownConfig = {
  props: [
    styleTags({
      Citation: writerTags.citation,
      AtReference: writerTags.reference,
      InlineMath: writerTags.math,
      MathBlock: writerTags.math,
      FootnoteReference: writerTags.footnote,
      FootnoteDefinition: writerTags.footnote,
      Wikilink: writerTags.embed,
      EmbedBlock: writerTags.embed,
    }),
  ],
};

const style = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.25em" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.1em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--faint)" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.9em" },
  { tag: t.quote, color: "var(--ink-soft)" },
  { tag: writerTags.citation, color: "var(--accent)" },
  { tag: writerTags.reference, color: "var(--accent)" },
  { tag: writerTags.math, fontFamily: "var(--mono)", fontSize: "0.9em", color: "var(--ink-soft)" },
  { tag: writerTags.footnote, color: "var(--ink-soft)" },
  { tag: writerTags.embed, color: "var(--connected)", fontFamily: "var(--mono)", fontSize: "0.9em" },
]);

// Provenance for a fresh machine-inserted list marker. It lasts only while the
// next input could be an explicit marker; manually authored nested lists are
// never normalized. No body text or provenance is stored outside this editor.
interface AutoMarker { readonly from: number; readonly to: number; readonly text: string }
const generatedMarkup = Annotation.define<boolean>();
const autoMarker = StateField.define<AutoMarker | null>({
  create: () => null,
  update(value, tr) {
    if (tr.annotation(generatedMarkup)) {
      const { main, ranges } = tr.state.selection;
      const line = tr.state.doc.lineAt(main.head);
      const match = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+$/.exec(line.text);
      return ranges.length === 1 && main.empty && main.head === line.to && match
        ? { from: line.from + match[1]!.length, to: line.to, text: line.text.slice(match[1]!.length) }
        : null;
    }
    if (!value || (tr.selection && !tr.docChanged)) return null;
    if (!tr.docChanged) return value;
    if (!tr.isUserEvent("input")) return null;
    const from = tr.changes.mapPos(value.from, 1), to = tr.changes.mapPos(value.to, -1);
    if (tr.newDoc.sliceString(from, to) !== value.text) return null;
    const tail = tr.newDoc.sliceString(to, tr.newDoc.lineAt(to).to);
    return /^(?:[-*+]?|\d+[.)]?)$/.test(tail) ? { ...value, from, to } : null;
  },
});
const normalizeExplicitMarker = EditorState.transactionFilter.of(tr => {
  const marker = tr.startState.field(autoMarker);
  if (!marker || !tr.docChanged || !tr.isUserEvent("input")) return tr;
  if (tr.startState.doc.sliceString(marker.from, marker.to) !== marker.text) throw new Error("Auto-list marker provenance disagrees with the document");
  const from = tr.changes.mapPos(marker.from, 1), to = tr.changes.mapPos(marker.to, -1);
  if (tr.newDoc.sliceString(from, to) !== marker.text) return tr; // The user edited the generated marker itself.
  const tail = tr.newDoc.sliceString(to, tr.newDoc.lineAt(to).to);
  if (!/^(?:[-*+]|\d+[.)])[ \t]/.test(tail)) return tr;
  // Remove only the generated marker. Keep every character explicitly typed,
  // including the list's indentation and the user's chosen marker style.
  return [tr, { changes: { from, to }, sequential: true }];
});
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });
const continueList: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const { main, ranges } = state.selection;
  const line = state.doc.lineAt(main.head);
  const emptyTopItem = ranges.length === 1 && main.empty && main.head === line.to && /^(?:[-*+]|\d+[.)])[ \t]*$/.test(line.text);
  return continueMarkup({ state, dispatch(tr) {
    if (!emptyTopItem) {
      dispatch(state.update(tr, { annotations: generatedMarkup.of(true) }));
      return;
    }
    const at = tr.newSelection.main.head;
    if (tr.newDoc.lineAt(at).text !== "") throw new Error("Empty top-level list item did not exit its markup");
    // Removing '- ' alone leaves a lazy continuation of the previous item.
    // A blank separator is necessary for the following text to be a paragraph.
    dispatch(state.update(tr, { changes: { from: at, insert: "\n" }, selection: { anchor: at + 1 }, annotations: generatedMarkup.of(true), sequential: true }));
  } });
};

export function writerLanguage() {
  return [
    markdown({ base: markdownLanguage, extensions: [writerMarkdown, highlightNodes], addKeymap: false }),
    syntaxHighlighting(style), autoMarker, normalizeExplicitMarker,
    Prec.high(keymap.of([{ key: "Enter", run: continueList }, { key: "Backspace", run: deleteMarkupBackward }])),
  ];
}
