// Finding text across a manuscript: every record in reading order, searched
// as Markdown (so citekeys and labels are found too), ignoring case.

export interface SearchHit {
  readonly record: string;
  /** The match, as UTF-16 offsets in the record's body. */
  readonly from: number;
  readonly to: number;
  /** The line around the match, clipped and with its whitespace collapsed. */
  readonly before: string;
  readonly match: string;
  readonly after: string;
}

export interface SearchResult {
  /** Matches grouped by record, records in reading order (those with none left out). */
  readonly groups: readonly { readonly record: string; readonly hits: readonly SearchHit[] }[];
  readonly total: number;
  /** More matched than are listed. */
  readonly truncated: boolean;
}

/** Matches listed at most; a very common word stops being useful long before this. */
export const SEARCH_LIMIT = 500;
const BEFORE = 28;
const AFTER = 80;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const collapse = (s: string) => s.replace(/\s+/g, " ");

export function searchManuscript(query: string, order: readonly string[], bodyOf: (record: string) => string | undefined, limit = SEARCH_LIMIT): SearchResult {
  const needle = query.trim();
  if (!needle) return { groups: [], total: 0, truncated: false };
  // A regular expression keeps offsets exact where lower-casing would change a string's length.
  const pattern = new RegExp(escape(needle).replace(/\s+/g, "\\s+"), "giu");
  const groups: { record: string; hits: SearchHit[] }[] = [];
  let total = 0;
  for (const record of order) {
    const body = bodyOf(record);
    if (!body) continue;
    const hits: SearchHit[] = [];
    for (const m of body.matchAll(pattern)) {
      total++;
      if (total > limit) continue;
      const from = m.index;
      const to = from + m[0].length;
      const lineStart = body.lastIndexOf("\n", from - 1) + 1;
      const lineEnd = body.indexOf("\n", to);
      const start = Math.max(lineStart, from - BEFORE);
      const end = Math.min(lineEnd < 0 ? body.length : lineEnd, to + AFTER);
      // Start the snippet at a word, unless the line starts there.
      const lead = start > lineStart ? body.slice(start, from).replace(/^\S*\s/, "") : body.slice(start, from);
      hits.push({
        record,
        from,
        to,
        before: (start > lineStart ? "…" : "") + collapse(lead).trimStart(),
        match: collapse(m[0]),
        after: collapse(body.slice(to, end)).trimEnd() + (end < (lineEnd < 0 ? body.length : lineEnd) ? "…" : ""),
      });
    }
    if (hits.length) groups.push({ record, hits });
  }
  return { groups, total, truncated: total > limit };
}
