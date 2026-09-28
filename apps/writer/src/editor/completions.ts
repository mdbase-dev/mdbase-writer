// Completion for citekeys (from the Reader library, found by key, author,
// title or year), cross-reference labels and embeds (record paths).
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

import type { LibraryEntry } from "../backend/types.js";
import { authorYear, searchLibrary } from "./library-search.js";

export interface CompletionData {
  library: readonly LibraryEntry[];
  labels: readonly string[];
  recordPaths: readonly string[];
}

const LABEL_KINDS: Record<string, string> = { sec: "Section", fig: "Figure", tbl: "Table", eq: "Equation" };

export function writerCompletions(data: () => CompletionData): CompletionSource {
  const citekeyOption = (entry: LibraryEntry): Completion => ({
    label: entry.key,
    detail: authorYear(entry),
    info: entry.title,
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
    const { library, labels } = data();
    const lowered = typed.toLowerCase();
    const labelOptions: Completion[] = labels
      .filter((l) => l.toLowerCase().includes(lowered))
      .map((l) => ({ label: l, detail: LABEL_KINDS[l.split("-")[0] ?? ""] ?? "Label", type: "keyword", boost: 1 }));
    // Sources are matched here, not by CodeMirror's label filter, so typing an
    // author or a word of the title finds them too.
    const sources = /^(sec|fig|tbl|eq)-/.test(typed) ? [] : searchLibrary(library, typed, 200).map(citekeyOption);
    return { from, options: [...labelOptions, ...sources], filter: false };
  };
}
