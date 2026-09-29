// Quick fixes for a citation that names a citekey or label that does not
// exist: the keys it was most likely meant to be, and (for a citekey) finding
// the source in the Sources panel.
import type { Action } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

import type { WriterDiagnostic } from "../compile/protocol.js";
import type { EditorInsight } from "./insight.js";
import { searchLibrary } from "./library-search.js";

/** Suggestions offered for one unknown key. */
const MAX_SUGGESTIONS = 3;

/** Levenshtein distance, case-insensitive. */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const row = [i];
    for (let j = 1; j <= t.length; j++) {
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[t.length] ?? 0;
}

/** Keys close enough in spelling to be a typo of `key`, nearest first. */
function nearest(key: string, candidates: Iterable<string>): string[] {
  const limit = Math.max(2, Math.round(key.length * 0.4));
  return [...candidates]
    .map((c) => ({ c, d: editDistance(key, c) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c))
    .map((x) => x.c);
}

/** The citekeys or labels an unknown key was most likely meant to be. */
export function suggestionsFor(unknown: NonNullable<WriterDiagnostic["unknown"]>, insight: Pick<EditorInsight, "library" | "labels">): string[] {
  if (unknown.kind === "label") {
    const prefix = unknown.key.split("-")[0] ?? "";
    const labels = [...insight.labels.keys()];
    const close = nearest(unknown.key, labels);
    // A label of the same kind (fig-, sec-) is the likelier meaning.
    return [...close.filter((l) => l.startsWith(`${prefix}-`)), ...close.filter((l) => !l.startsWith(`${prefix}-`))].slice(0, MAX_SUGGESTIONS);
  }
  const library = [...insight.library.values()];
  // A misspelt key, or one that finds a source by author, year or title ("agamben99").
  const found = [...nearest(unknown.key, insight.library.keys()), ...searchLibrary(library, unknown.key, MAX_SUGGESTIONS).map((e) => e.key)];
  return [...new Set(found)].slice(0, MAX_SUGGESTIONS);
}

/** Replaces `@key` inside a citation's range with `@replacement`. */
function replaceKey(view: EditorView, from: number, to: number, key: string, replacement: string) {
  const text = view.state.sliceDoc(from, to);
  const at = new RegExp(`@${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "u").exec(text);
  if (!at) return;
  const start = from + at.index + 1;
  view.dispatch({ changes: { from: start, to: start + key.length, insert: replacement }, selection: { anchor: start + replacement.length }, userEvent: "input" });
  // Writing goes on where the fix was made.
  view.focus();
}

/** Lint actions for a problem with an unknown citekey or label. */
export function fixesFor(d: WriterDiagnostic, insight: EditorInsight, findSource?: (query: string) => void): Action[] {
  const unknown = d.unknown;
  if (!unknown) return [];
  const actions: Action[] = suggestionsFor(unknown, insight).map((key) => ({
    name: `@${key}`,
    apply: (view, from, to) => replaceKey(view, from, to, unknown.key, key),
  }));
  if (unknown.kind === "citekey" && findSource) actions.push({ name: "Find in Sources", apply: () => findSource(unknown.key) });
  return actions;
}
