// Completion for citekeys (from the Reader library), cross-reference labels
// and embeds (record paths).
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

import type { LibraryEntry } from "../backend/types.js";

export interface CompletionData {
  library: readonly LibraryEntry[];
  labels: readonly string[];
  recordPaths: readonly string[];
}

function authorYear(entry: LibraryEntry): string {
  const author = (entry.item["author"] ?? entry.item["editor"]) as { family?: string; literal?: string }[] | undefined;
  const first = author?.[0];
  const name = first?.family ?? first?.literal ?? "";
  const issued = entry.item["issued"] as { "date-parts"?: number[][] } | undefined;
  const year = issued?.["date-parts"]?.[0]?.[0];
  return [name + (author && author.length > 1 ? " et al." : ""), year].filter(Boolean).join(", ");
}

const LABEL_KINDS: Record<string, string> = { sec: "Section", fig: "Figure", tbl: "Table", eq: "Equation" };

export function writerCompletions(data: () => CompletionData): CompletionSource {
  let cache: { library: readonly LibraryEntry[]; options: Completion[] } | undefined;
  const citekeyOptions = (library: readonly LibraryEntry[]) => {
    if (cache?.library !== library) {
      cache = {
        library,
        options: library.map((entry) => ({
          label: entry.key,
          detail: authorYear(entry),
          info: entry.title,
          type: "text",
        })),
      };
    }
    return cache.options;
  };

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
    const labelOptions: Completion[] = labels.map((l) => ({ label: l, detail: LABEL_KINDS[l.split("-")[0] ?? ""] ?? "Label", type: "keyword", boost: 1 }));
    return {
      from,
      options: /^(sec|fig|tbl|eq)-/.test(typed) ? labelOptions : [...labelOptions, ...citekeyOptions(library)],
      validFor: /^[\p{L}\p{N}_:.#$%&\-+?<>~/]*$/u,
    };
  };
}
