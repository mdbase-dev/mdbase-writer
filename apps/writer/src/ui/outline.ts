// The headings of a record's Markdown, for the outline.
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
