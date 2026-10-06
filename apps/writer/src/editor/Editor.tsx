// The Markdown editor for one record. The record session owns the text; the
// editor reports edits and adopts external changes as remote transactions.
import { mdbasePopupTheme } from "@mdbase-dev/ui/codemirror";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, placeholder } from "@codemirror/view";
import { memo, useEffect, useLayoutEffect, useRef } from "react";

import type { WriterDiagnostic } from "../compile/protocol.js";
import { chapterCards, refreshChapterCards, type ChapterCards } from "./chapter-cards.js";
import { commentAnchors, showAnchors, type CommentAnchor } from "./comments.js";
import { writerCompletions, type CompletionData } from "./completions.js";
import { fixesFor } from "./fixes.js";
import { formattingKeymap, makeLink, toggleBold, toggleCode, toggleItalic, type InlineFormat } from "./formatting.js";
import { collapseToEnd, selectionBar, type SelectionAction } from "./selection-bar.js";
import { joinLines as joinLinesExtension } from "./join-lines.js";
import { writerInsight, type EditorInsight, type FollowTarget } from "./insight.js";
import { writerLanguage } from "./language.js";
import { livePreview as livePreviewExtension, refreshLivePreview } from "./live-preview.js";
import { slashCommands, type InsertCommand } from "./slash.js";
import { nextFootnoteId, type Snippet } from "./snippets.js";

const remote = Annotation.define<boolean>();

export interface EditorHandle {
  /** Scrolls to `offset` (selecting up to `to`, when given) and focuses the editor unless `focus` is false. */
  reveal(offset: number, options?: { to?: number; focus?: boolean }): void;
  /** Replaces the selection with text (a citation, a quotation) and leaves the cursor after it; with `complete`, opens completions there. */
  insert(text: string, options?: { complete?: boolean }): void;
  /** Inserts a block (a figure, a table) on lines of its own at the cursor, selecting the snippet's placeholder. */
  insertBlock(snippet: Snippet): void;
  /** Puts a footnote marker at the cursor and its definition at the end of the record, ready to write. */
  insertFootnote(): void;
  /** The main selection (UTF-16 offsets) and the text it is in. */
  selection(): { from: number; to: number; text: string };
  /** Formats the selection as Markdown (toggling bold, italic or code), or makes it a link. */
  format(kind: InlineFormat | "link"): void;
}

export interface RetainedEditor {
  readonly state: EditorState;
  readonly scroll: ReturnType<EditorView["scrollSnapshot"]>;
}

export interface EditorProps {
  /** Scoped to one workspace, retaining history and selection between chapters. */
  states?: Map<string, RetainedEditor>;
  path: string;
  text: string;
  readOnly: boolean;
  /** Draws a paragraph's soft line breaks as spaces, so hard-wrapped text flows. */
  joinLines?: boolean;
  /** Draws citations, figures, tables and marks as the manuscript reads, rather than as Markdown source. */
  livePreview?: boolean;
  /** Images pasted or dropped into the text, to store in the collection as figures. */
  onImageFiles?(files: readonly File[]): void;
  diagnostics: readonly WriterDiagnostic[];
  completion: CompletionData;
  /** What "/" offers to insert (a footnote, a figure…). */
  inserts?: readonly InsertCommand[];
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
  /** An action from the toolbar over a selection, with the selected text. */
  onSelectionAction?(action: SelectionAction, selected: string): void;
}

export const Editor = memo(function Editor({ states, path, text, readOnly, joinLines = false, livePreview = true, onImageFiles, diagnostics, completion, inserts, insight, onChange, onReady, onCursor, onFollow, chapters, onFindSource, anchors, activeComment = null, onAnchor, onSelectionAction }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Texts this editor reported, newest last. The session echoes them back
  // through React, possibly after more typing; an echo must never be adopted
  // as an external change, or it would undo the keystrokes since.
  const emitted = useRef<string[]>([]);
  // Only a real change to the problems is dispatched: redrawing lint marks
  // replaces the line's DOM, which would cancel a hover in progress.
  const shownDiagnostics = useRef("");
  const joining = useRef(new Compartment());
  const preview = useRef<ReturnType<typeof livePreviewExtension> | null>(null);
  const latest = useRef({ onChange, completion, inserts, insight, onCursor, onFollow, chapters, onFindSource, onAnchor, onSelectionAction, onImageFiles });
  latest.current = { onChange, completion, inserts, insight, onCursor, onFollow, chapters, onFindSource, onAnchor, onSelectionAction, onImageFiles };

  // Layout cleanup snapshots the viewport before React detaches its DOM (which
  // would reset scrollTop), including development's setup/cleanup/setup cycle.
  useLayoutEffect(() => {
    if (!host.current) return;
    preview.current = livePreviewExtension(() => latest.current.insight, livePreview);
    const imageFiles = (list: FileList | null | undefined) => {
      const files = [...(list ?? [])].filter((f) => /^image\//.test(f.type));
      return files.length ? files : null;
    };
    const extensions = [
          preview.current.extension,
          EditorView.domEventHandlers({
            paste(event, view) {
              const files = imageFiles(event.clipboardData?.files);
              if (!files || view.state.readOnly || !latest.current.onImageFiles) return false;
              event.preventDefault();
              latest.current.onImageFiles(files);
              return true;
            },
            drop(event, view) {
              const files = imageFiles(event.dataTransfer?.files);
              if (!files || view.state.readOnly || !latest.current.onImageFiles) return false;
              event.preventDefault();
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos !== null) view.dispatch({ selection: EditorSelection.cursor(pos) });
              view.focus();
              latest.current.onImageFiles(files);
              return true;
            },
          }),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          lintGutter(),
          autocompletion({ override: [slashCommands(() => latest.current.inserts ?? []), writerCompletions(() => latest.current.completion)] }),
          mdbasePopupTheme,
          keymap.of([...formattingKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          writerLanguage(),
          writerInsight(() => latest.current.insight, (target) => latest.current.onFollow?.(target)),
          chapterCards(() => latest.current.chapters),
          commentAnchors((id) => latest.current.onAnchor?.(id)),
          selectionBar((action, view) => {
            const { from, to } = view.state.selection.main;
            const selected = view.state.sliceDoc(from, to);
            // A citation follows the passage it is for rather than replacing it.
            if (action === "cite") collapseToEnd(view);
            latest.current.onSelectionAction?.(action, selected);
          }),
          EditorView.lineWrapping,
          joining.current.of(joinLines ? joinLinesExtension() : []),
          EditorState.readOnly.of(readOnly),
          placeholder("Write in Markdown. Cite with [@citekey]; type / to add a footnote, figure or table."),
          EditorView.contentAttributes.of({ "aria-label": `Markdown for ${path}`, spellcheck: "true", autocapitalize: "sentences" }),
          EditorView.updateListener.of((u) => {
            if ((u.selectionSet || u.docChanged) && !u.transactions.some((tr) => tr.annotation(remote))) latest.current.onCursor?.(u.state.selection.main.head);
            if (!u.docChanged || u.transactions.some((tr) => tr.annotation(remote))) return;
            const next = u.state.doc.toString();
            emitted.current.push(next);
            if (emitted.current.length > 50) emitted.current.shift();
            latest.current.onChange(next);
          }),
        ];
    const retained = states?.get(path);
    const state = retained
      ? retained.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: text, extensions });
    // CodeMirror restores against its measured viewport; assigning scrollTop in
    // an animation frame is clamped while long documents are still virtualised.
    const v = new EditorView({ parent: host.current, state, ...(retained ? { scrollTo: retained.scroll } : {}) });
    let measured = false;
    v.requestMeasure({ read: () => undefined, write: () => { measured = true; } });
    view.current = v;
    latest.current.onCursor?.(v.state.selection.main.head);
    shownDiagnostics.current = "";
    onReady?.({
      reveal(offset, options) {
        const at = Math.min(offset, v.state.doc.length);
        const head = options?.to === undefined ? at : Math.min(options.to, v.state.doc.length);
        v.dispatch({ selection: { anchor: at, head }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
        if (options?.focus !== false) v.focus();
      },
      selection() {
        const { from, to } = v.state.selection.main;
        return { from, to, text: v.state.doc.toString() };
      },
      format(kind) {
        const command = kind === "bold" ? toggleBold : kind === "italic" ? toggleItalic : kind === "code" ? toggleCode : makeLink;
        command(v);
        v.focus();
      },
      insert(insertion, options) {
        if (v.state.readOnly) return;
        v.dispatch(v.state.replaceSelection(insertion), { scrollIntoView: true, userEvent: "input" });
        v.focus();
        if (options?.complete) startCompletion(v);
      },
      insertBlock(snippet) {
        if (v.state.readOnly) return;
        // A block goes after whatever is selected; it never replaces text.
        const from = v.state.selection.main.to;
        const to = from;
        const line = v.state.doc.lineAt(from);
        const after = line;
        // On lines of its own: blank lines open before and after as needed.
        const before = line.from === from ? (line.number > 1 && v.state.doc.line(line.number - 1).text.trim() ? "\n" : "") : (line.text.slice(0, from - line.from).trim() ? "\n\n" : "\n");
        const rest = after.text.slice(to - after.from);
        const next = after.number < v.state.doc.lines ? v.state.doc.line(after.number + 1).text : "";
        const trailing = rest.trim() ? "\n\n" : next.trim() ? "\n" : "";
        const text = `${before}${snippet.text}${trailing}`;
        const start = from + before.length + snippet.select[0];
        const end = from + before.length + snippet.select[1];
        v.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.range(start, end), scrollIntoView: true, userEvent: "input" });
        v.focus();
      },
      insertFootnote() {
        if (v.state.readOnly) return;
        const id = nextFootnoteId(v.state.doc.toString());
        const at = v.state.selection.main.to;
        const end = v.state.doc.length;
        const tail = v.state.doc.sliceString(Math.max(0, end - 2), end);
        const gap = end === 0 ? "" : tail.endsWith("\n\n") ? "" : tail.endsWith("\n") ? "\n" : "\n\n";
        const definition = `${gap}[^${id}]: `;
        v.dispatch({
          changes: [{ from: at, insert: `[^${id}]` }, { from: end, insert: definition }],
          selection: EditorSelection.cursor(end + `[^${id}]`.length + definition.length),
          scrollIntoView: true,
          userEvent: "input",
        });
        v.focus();
      },
    });
    return () => {
      // React's development setup/cleanup/setup must not replace the retained
      // scroll target with zero before CodeMirror has had a layout pass.
      states?.set(path, { state: v.state, scroll: retained && !measured ? retained.scroll : v.scrollSnapshot() });
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
    v.dispatch({ changes: { from, to: endA, insert: text.slice(from, endB) }, annotations: [remote.of(true), Transaction.addToHistory.of(false)] });
  }, [text]);

  useEffect(() => {
    view.current?.dispatch({ effects: joining.current.reconfigure(joinLines ? joinLinesExtension() : []) });
  }, [joinLines]);

  useEffect(() => {
    if (view.current) preview.current?.set(view.current, livePreview);
  }, [livePreview]);

  // Chips and figures follow the sources, labels and images they draw.
  useEffect(() => {
    view.current?.dispatch({ effects: refreshLivePreview.of(null) });
  }, [insight]);

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
