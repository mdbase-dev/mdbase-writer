// What a click in the preview can land on besides a block: a bibliography
// entry or a generated citation note, from the source markers around them
// (see the assembler's entryMarker / noteMarker / END_MARKER).
import type { SourceMark } from "./protocol.js";

type Position = { page: number; y: string };
export type RawMark = [["entry", string] | ["note", string, number, string[]] | ["end"], Position];

/** Below the top of its last line, how far a marked passage reaches (a line of body text, in pt). */
const LAST_LINE = 11;

/** Pairs each opening marker with the end marker after it; a passage split across pages keeps its first page. */
export function sourceMarks(raw: readonly RawMark[]): SourceMark[] {
  const out: SourceMark[] = [];
  let open: { value: RawMark[0]; at: Position } | null = null;
  for (const [value, at] of raw) {
    if (value[0] !== "end") {
      open = { value, at };
      continue;
    }
    if (!open) continue;
    const top = Number.parseFloat(open.at.y);
    const last = Number.parseFloat(at.y);
    const bottom = at.page === open.at.page ? last + LAST_LINE : Number.POSITIVE_INFINITY;
    const v = open.value;
    const page = open.at.page;
    if (v[0] === "entry") out.push({ kind: "entry", keys: [v[1]], page, top, bottom });
    else if (v[0] === "note") out.push({ kind: "note", keys: v[3], record: v[1], offset: v[2], page, top, bottom });
    open = null;
  }
  return out;
}

/** The marked passage at a point on a page, if any. */
export function markAt(marks: readonly SourceMark[], page: number, y: number): SourceMark | undefined {
  return marks.find((m) => m.page === page && y >= m.top - 2 && y <= m.bottom);
}
