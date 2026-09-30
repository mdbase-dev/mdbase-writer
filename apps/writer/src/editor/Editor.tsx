// The Markdown editor for one record. The record session owns the text; the
// editor reports edits and adopts external changes as remote transactions.
import { mdbasePopupTheme } from "@mdbase-dev/ui/codemirror";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Annotation, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, placeholder } from "@codemirror/view";
import { memo, useEffect, useRef } from "react";

import type { WriterDiagnostic } from "../compile/protocol.js";
import { chapterCards, refreshChapterCards, type ChapterCards } from "./chapter-cards.js";
import { commentAnchors, showAnchors, type CommentAnchor } from "./comments.js";
import { writerCompletions, type CompletionData } from "./completions.js";
import { fixesFor } from "./fixes.js";
import { writerInsight, type EditorInsight, type FollowTarget } from "./insight.js";
import { writerLanguage } from "./language.js";

const remote = Annotation.define<boolean>();

export interface EditorHandle {
  reveal(offset: number): void;
  /** Replaces the selection with text (a citation, a quotation) and leaves the cursor after it. */
  insert(text: string): void;
  /** The main selection (UTF-16 offsets) and the text it is in. */
  selection(): { from: number; to: number; text: string };
}

export interface EditorProps {
  path: string;
  text: string;
  readOnly: boolean;
  diagnostics: readonly WriterDiagnostic[];
  completion: CompletionData;
  insight: EditorInsight;
  onChange(text: string): void;
  /** Mod-click on a citation or cross-reference. */
  onFollow?(target: FollowTarget): void;
  onReady?(handle: EditorHandle): void;
  /** The cursor moved (by typing, clicking or keys), to its body offset. */
  onCursor?(offset: number): void;
  /** Cards for records embedded on lines of their own. */
  chapters?: ChapterCards;
  /** Looks for a source in the Sources panel (a quick fix for an unknown citekey). */
  onFindSource?(query: string): void;
  /** Commented passages and suggestions to show, and the thread selected in the sidebar. */
  anchors?: readonly CommentAnchor[];
  activeComment?: string | null;
  /** A click on a commented passage or suggestion. */
  onAnchor?(id: string): void;
}

export const Editor = memo(function Editor({ path, text, readOnly, diagnostics, completion, insight, onChange, onReady, onCursor, onFollow, chapters, onFindSource, anchors, activeComment = null, onAnchor }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Texts this editor reported, newest last. The session echoes them back
  // through React, possibly after more typing; an echo must never be adopted
  // as an external change, or it would undo the keystrokes since.
  const emitted = useRef<string[]>([]);
  // Only a real change to the problems is dispatched: redrawing lint marks
  // replaces the line's DOM, which would cancel a hover in progress.
  const shownDiagnostics = useRef("");
  const latest = useRef({ onChange, completion, insight, onCursor, onFollow, chapters, onFindSource, onAnchor });
  latest.current = { onChange, completion, insight, onCursor, onFollow, chapters, onFindSource, onAnchor };

  // One view per record path.
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          lintGutter(),
          autocompletion({ override: [writerCompletions(() => latest.current.completion)] }),
          mdbasePopupTheme,
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          writerLanguage(),
          writerInsight(() => latest.current.insight, (target) => latest.current.onFollow?.(target)),
          chapterCards(() => latest.current.chapters),
          commentAnchors((id) => latest.current.onAnchor?.(id)),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          placeholder("Write in Markdown. Cite with [@citekey], embed chapters with ![[path]]."),
          EditorView.contentAttributes.of({ "aria-label": `Markdown for ${path}`, spellcheck: "true", autocapitalize: "sentences" }),
          EditorView.updateListener.of((u) => {
            if ((u.selectionSet || u.docChanged) && !u.transactions.some((tr) => tr.annotation(remote))) latest.current.onCursor?.(u.state.selection.main.head);
            if (!u.docChanged || u.transactions.some((tr) => tr.annotation(remote))) return;
            const next = u.state.doc.toString();
            emitted.current.push(next);
            if (emitted.current.length > 50) emitted.current.shift();
            latest.current.onChange(next);
          }),
        ],
      }),
    });
    view.current = v;
    shownDiagnostics.current = "";
    onReady?.({
      reveal(offset) {
        const at = Math.min(offset, v.state.doc.length);
        v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
        v.focus();
      },
      selection() {
        const { from, to } = v.state.selection.main;
        return { from, to, text: v.state.doc.toString() };
      },
      insert(insertion) {
        if (v.state.readOnly) return;
        v.dispatch(v.state.replaceSelection(insertion), { scrollIntoView: true, userEvent: "input" });
        v.focus();
      },
    });
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view is recreated per record
  }, [path, readOnly]);

  // Adopt text the session changed underneath us (another view, a resolved conflict).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === text) {
      emitted.current = [];
      return;
    }
    const echo = emitted.current.indexOf(text);
    if (echo >= 0) {
      emitted.current = emitted.current.slice(echo + 1);
      return;
    }
    emitted.current = [];
    let from = 0;
    while (from < current.length && from < text.length && current[from] === text[from]) from++;
    let endA = current.length;
    let endB = text.length;
    while (endA > from && endB > from && current[endA - 1] === text[endB - 1]) {
      endA--;
      endB--;
    }
    v.dispatch({ changes: { from, to: endA, insert: text.slice(from, endB) }, annotations: [remote.of(true)] });
  }, [text]);

  // Chapter cards follow their records' titles, words and problems.
  useEffect(() => {
    view.current?.dispatch({ effects: refreshChapterCards.of(null) });
  }, [chapters]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const signature = JSON.stringify(diagnostics.map((d) => [d.from, d.to, d.severity, d.message]));
    if (signature === shownDiagnostics.current) return;
    shownDiagnostics.current = signature;
    const length = v.state.doc.length;
    const cm: CmDiagnostic[] = diagnostics.map((d) => {
      const from = Math.min(d.from, length);
      const line = v.state.doc.lineAt(from);
      const to = d.to > d.from ? Math.min(d.to, length) : Math.min(line.to, from + 1);
      const actions = fixesFor(d, latest.current.insight, (query) => latest.current.onFindSource?.(query));
      return { from, to: Math.max(to, from), severity: d.severity, message: d.message, source: d.origin === "typst" ? "Typst" : "writer", ...(actions.length ? { actions } : {}) };
    });
    v.dispatch(setDiagnostics(v.state, cm));
  }, [diagnostics]);

  // Anchors are placed against the text they were located in; one render late
  // they are mapped through the edits since, so they never lag a keystroke.
  useEffect(() => {
    const v = view.current;
    if (v) showAnchors(v, anchors ?? [], activeComment);
  }, [anchors, activeComment, path, readOnly]);

  return <div className="editor" ref={host} />;
});
