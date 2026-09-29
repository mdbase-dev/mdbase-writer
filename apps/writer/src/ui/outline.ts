// The headings of a record's Markdown, for the outline.
import { wordCount } from "../words.js";

export interface OutlineHeading {
  readonly level: number;
  readonly text: string;
  /** Body offset of the heading line. */
  readonly offset: number;
}

/** ATX headings outside fenced code, with any `{#id .class}` attributes removed. */
export function headings(body: string): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of body.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? null : f;
    else if (!fence) {
      const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      const text = m?.[2]?.replace(/\s*\{[^}]*\}\s*$/, "").trim();
      if (m && text) out.push({ level: m[1]?.length ?? 1, text, offset });
    }
    offset += line.length + 1;
  }
  return out;
}

/** Words in each heading's section, its subsections included (the heading itself is not counted). */
export function sectionWords(body: string, list: readonly OutlineHeading[]): number[] {
  return list.map((h, i) => {
    const end = list.slice(i + 1).find((n) => n.level <= h.level)?.offset ?? body.length;
    return wordCount(body.slice(h.offset, end).replace(/^[^\n]*\n?/, ""));
  });
}

/** The heading a body offset falls under (the last one at or before it). */
export function headingAt(list: readonly OutlineHeading[], offset: number): OutlineHeading | undefined {
  let hit: OutlineHeading | undefined;
  for (const h of list) if (h.offset <= offset) hit = h;
  return hit;
}

/** A heading list without the opening heading when it only repeats the record's title. */
export function withoutTitle(list: readonly OutlineHeading[], title: string): readonly OutlineHeading[] {
  const same = (a: string) => a.replace(/\s+/g, " ").trim().toLowerCase();
  return list[0] && same(list[0].text) === same(title) ? list.slice(1) : list;
}
