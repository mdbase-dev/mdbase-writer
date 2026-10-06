// Typing "/" at the start of a line, or after a space, lists what can be
// inserted (a footnote, a figure, a table…) so the syntax need not be
// remembered: choosing one removes the "/" and inserts it.
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

/** Something the editor can insert for the writer, shared by the slash menu, the Insert menu and the command palette. */
export interface InsertCommand {
  readonly id: string;
  readonly label: string;
  /** The Markdown it stands for, shown so it can be learned. */
  readonly syntax: string;
  readonly keywords?: string;
  readonly run: () => void;
}

export function slashCommands(commands: () => readonly InsertCommand[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const slash = context.matchBefore(/(?:^|\s)\/[\p{L}\p{N}-]*$/u);
    if (!slash) return null;
    const from = slash.from + slash.text.indexOf("/");
    const typed = context.state.sliceDoc(from + 1, context.pos).toLowerCase();
    const options: Completion[] = commands()
      .filter((c) => !typed || `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(typed))
      .map((c) => ({
        label: c.label,
        detail: c.syntax,
        type: "keyword",
        apply: (view, _completion, start, end) => {
          view.dispatch({ changes: { from: start, to: end, insert: "" }, userEvent: "delete" });
          c.run();
        },
      }));
    return options.length ? { from, options, filter: false } : null;
  };
}
