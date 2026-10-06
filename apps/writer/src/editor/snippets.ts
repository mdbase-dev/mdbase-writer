// What the editor inserts for a figure, a table, an equation or a footnote:
// the Markdown Writer's translator understands, with a label to refer to and
// the part to write next (a caption, a cell) selected.
import { manuscriptSlug } from "../backend/types.js";

export interface Snippet {
  readonly text: string;
  /** Offsets within `text` to select once inserted, so the placeholder is typed over. */
  readonly select: readonly [number, number];
}

/** `base` itself, or `base-2`, `base-3`… while `taken` has it. */
export function uniqueLabel(base: string, taken: { has(key: string): boolean }): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const labelStem = (name: string) => manuscriptSlug(name.replace(/\.[a-z0-9]{1,5}$/i, "")).slice(0, 40) || "item";

const selecting = (before: string, placeholder: string, after: string): Snippet => ({ text: `${before}${placeholder}${after}`, select: [before.length, before.length + placeholder.length] });

/** A figure from an image in the collection: its caption is selected to write. */
export function figureSnippet(path: string, taken: { has(key: string): boolean }): Snippet {
  const label = uniqueLabel(`fig-${labelStem(path.split("/").pop() ?? path)}`, taken);
  return selecting("![", "Caption", `](${path}){#${label}}`);
}

/** A two-column table with its caption selected to write. */
export function tableSnippet(taken: { has(key: string): boolean }): Snippet {
  const label = uniqueLabel("tbl-table", taken);
  return selecting("| Column | Column |\n|---|---|\n| Cell | Cell |\n| Cell | Cell |\n\n: ", "Caption", ` {#${label}}`);
}

/** Display math with a label, its contents selected to write. */
export function equationSnippet(taken: { has(key: string): boolean }): Snippet {
  const label = uniqueLabel("eq-equation", taken);
  return selecting("$$\n", "y = mx + b", `\n$$ {#${label}}`);
}

/** The next free footnote id in a text: `1`, `2`… past any numbered note it has. */
export function nextFootnoteId(text: string): string {
  let max = 0;
  for (const m of text.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]));
  return String(max + 1);
}
