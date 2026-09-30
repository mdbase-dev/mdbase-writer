// Completion for citekeys (from the Reader library, found by key, author,
// title or year), cross-reference labels and embeds (record paths).
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

import type { LibraryEntry } from "../backend/types.js";
import { authorYear, searchLibrary, shortTitle } from "./library-search.js";

export interface CompletionData {
  library: readonly LibraryEntry[];
  labels: readonly string[];
  recordPaths: readonly string[];
  /** Sources the manuscript already cites, offered first. */
  cited?: { has(key: string): boolean };
}

const LABEL_KINDS: Record<string, string> = { sec: "Section", fig: "Figure", tbl: "Table", eq: "Equation" };

export function writerCompletions(data: () => CompletionData): CompletionSource {
  const citekeyOption = (entry: LibraryEntry): Completion => ({
    label: entry.key,
    // Two sources by one author in one year differ by their titles.
    detail: [authorYear(entry), shortTitle(entry.title)].filter(Boolean).join(" · "),
    // The detail shows the title up to its subtitle; the rest shows beside the list.
    ...(shortTitle(entry.title) !== entry.title ? { info: entry.title } : {}),
    type: "citation",
  });

  return (context: CompletionContext): CompletionResult | null => {
    const embed = context.matchBefore(/!\[\[[^\]\n]*/);
    if (embed) {
      return {
        from: embed.from + 3,
        options: data().recordPaths.filter((p) => p.endsWith(".md")).map((p) => ({ label: p.replace(/\.md$/, ""), type: "namespace", apply: `${p.replace(/\.md$/, "")}]]` })),
        validFor: /^[^\]\n]*$/,
      };
    }
    const at = context.matchBefore(/(?:^|[\s[;(-])-?@[\p{L}\p{N}_:.#$%&\-+?<>~/]*/u);
    if (!at) return null;
    const from = at.from + at.text.indexOf("@") + 1;
    const typed = context.state.sliceDoc(from, context.pos);
    if (!typed && !context.explicit && !/\[-?@$|\s@$|^@$/.test(at.text)) return null;
    const { library, labels, cited } = data();
    // In brackets it is almost always a citation; a bare @ is as often a cross-reference.
    const line = context.state.doc.lineAt(from);
    const inBrackets = /\[[^\]]*$/.test(line.text.slice(0, from - line.from));
    const lowered = typed.toLowerCase();
    const labelOptions: Completion[] = labels
      .filter((l) => l.toLowerCase().includes(lowered))
      .map((l) => ({ label: l, detail: LABEL_KINDS[l.split("-")[0] ?? ""] ?? "Label", type: "keyword" }));
    // Sources are matched here, not by CodeMirror's label filter, so typing an
    // author or a word of the title finds them too.
    const sources = /^(sec|fig|tbl|eq)-/.test(typed) ? [] : searchLibrary(library, typed, 200, cited).map(citekeyOption);
    // Options keep this order (filter: false), so boosts do not apply.
    return { from, options: inBrackets ? [...sources, ...labelOptions] : [...labelOptions, ...sources], filter: false };
  };
}
