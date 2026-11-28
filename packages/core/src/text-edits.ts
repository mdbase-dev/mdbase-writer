export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Assemble disjoint replacements and insertions without recopying the document for each edit. */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  if (!edits.length) return text;
  const parts: string[] = [];
  let cursor = 0;
  // A heading number and a reference can start at the same offset.
  for (const edit of edits.sort((a, b) => a.from - b.from || a.to - b.to)) {
    parts.push(text.slice(cursor, edit.from), edit.text);
    cursor = edit.to;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}
